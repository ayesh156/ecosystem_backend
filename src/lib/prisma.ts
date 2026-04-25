import { PrismaClient } from '@prisma/client';

// ===================================
// Supabase PgBouncer Auto-Configuration for Render (Long-Running Server)
// ===================================

/**
 * Auto-append PgBouncer and TCP keep-alive parameters to DATABASE_URL
 * when using Supabase's connection pooler (port 6543).
 * 
 * For Render (long-running servers), we need:
 * - TCP keep-alive to prevent idle connection drops
 * - Minimal connection_limit to not exhaust Supabase's pool
 * - Generous timeouts to handle cold-start + network latency
 * 
 * This MUST run before PrismaClient is created.
 */
function ensurePoolerParams(): void {
  const url = process.env.DATABASE_URL;
  if (!url) return;

  // Detect Supabase pooler (port 6543 or pooler.supabase.com)
  const isPooler = url.includes('pooler.supabase.com') || url.includes(':6543');
  if (!isPooler) return;

  const separator = url.includes('?') ? '&' : '?';
  const params: string[] = [];
  
  // PgBouncer mode flag — tells Prisma to disable prepared statements
  if (!url.includes('pgbouncer=')) params.push('pgbouncer=true');
  
  // Connection pool settings:
  // Supabase free tier has ~15 pooled connections globally.
  // Prisma opens connection_limit connections per PrismaClient instance.
  // With connection_limit=3, Prisma maintains up to 3 TCP connections.
  // This prevents head-of-line blocking — if one connection drops, the
  // other 2 can still serve queries. 3 out of 15 is safe for one instance.
  // NEVER use connection_limit=1 — a single dropped connection kills ALL queries.
  if (!url.includes('connection_limit=')) params.push('connection_limit=3');
  
  // Pool timeout: how long Prisma waits to get a connection from its OWN pool.
  // 20s is long enough for burst traffic but short enough that users see a
  // proper error instead of an infinite hang. Must be SHORTER than the HTTP
  // layer timeout (DB gate = 45s, Render = 60s) so Prisma fails first.
  if (!url.includes('pool_timeout=')) params.push('pool_timeout=20');
  
  // Connect timeout: how long to wait for a NEW TCP connection to Supabase.
  // 30s handles cross-region latency + cold Supabase wakeup.
  if (!url.includes('connect_timeout=')) params.push('connect_timeout=30');
  
  // PgBouncer transaction mode doesn't support prepared statements
  if (!url.includes('statement_cache_size=')) params.push('statement_cache_size=0');
  
  // TCP Keep-Alive settings to prevent idle connection drops:
  // These are CRITICAL for Render's long-running servers.
  // Supabase's pooler may close idle connections; keep-alive prevents this.
  if (!url.includes('keepalives=')) params.push('keepalives=1');
  if (!url.includes('keepalives_idle=')) params.push('keepalives_idle=30');
  if (!url.includes('keepalives_interval=')) params.push('keepalives_interval=10');
  if (!url.includes('keepalives_count=')) params.push('keepalives_count=3');
  
  if (params.length > 0) {
    process.env.DATABASE_URL = url + separator + params.join('&');
    console.log('🔧 Auto-added PgBouncer + TCP keep-alive params to DATABASE_URL');
    console.log('   connection_limit=3 | pool_timeout=20 | connect_timeout=30');
    console.log('   keepalives=1 | idle=30s | interval=10s | count=3');
  }
}

// Must run before PrismaClient instantiation
ensurePoolerParams();

// ===================================
// Connection State & Mutex
// ===================================

let isReconnecting = false;
let reconnectPromise: Promise<void> | null = null;
let isConnected = false;
let lastConnectAttempt = 0;
let lastHealthProbe = 0;
let lastSuccessfulQuery = 0;
let keepAliveInterval: NodeJS.Timeout | null = null;

/** When true, the $use middleware passes queries through without retry/tracking. */
let bypassMiddleware = false;

/**
 * Promise that resolves when the very first DB connection is established.
 * Used by the "cold-start gate" middleware so incoming HTTP requests
 * wait for DB readiness instead of failing instantly.
 */
let dbReadyResolve: (() => void) | null = null;
export const dbReady: Promise<void> = new Promise((resolve) => {
  dbReadyResolve = resolve;
});

// Timing constants tuned for Render + Supabase:
// Faster recovery is critical — Render's free tier cold-starts must resolve
// within 45s or users get 503. Every second counts.
const RECONNECT_COOLDOWN_MS = 5000;    // 5s cooldown between reconnect attempts
const RECONNECT_PAUSE_MS = 500;        // Brief pause before reconnect probe
const HEALTH_PROBE_INTERVAL_MS = 300000; // 5min between health probes
const RECENT_ACTIVITY_MS = 60000;      // 1min — consider DB active if recent query
const KEEP_ALIVE_INTERVAL_MS = 20000;  // 20s ping — MUST be shorter than PgBouncer idle timeout (~60s)
const QUERY_RETRY_DELAY_MS = 1000;     // 1s delay before retrying a failed query

// ===================================
// Connection Error Detection
// ===================================

const CONNECTION_ERROR_PATTERNS = [
  "Can't reach database",
  'Connection refused',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'socket hang up',
  'server closed the connection',
  'Server has closed the connection',
  'Client has already been disconnected',
  'prepared statement',
  'connection is not available',
  'Connection terminated unexpectedly',
  'Connection timed out',
  'connect ETIMEDOUT',
  'read ECONNRESET',
  'getaddrinfo ENOTFOUND',
  'unable to start a transaction',
  'Transaction API error',
  'invalid length of startup packet',
  'Timed out fetching a new connection from the connection pool',
  'connection pool',
];

const CONNECTION_ERROR_NAMES = [
  'PrismaClientInitializationError',
  'PrismaClientRustPanicError',
];

const CONNECTION_ERROR_CODES = ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'];

function isConnectionError(error: any): boolean {
  if (!error) return false;
  const name = error.name || '';
  const message = error.message || '';
  const code = error.code || '';
  if (CONNECTION_ERROR_NAMES.includes(name)) return true;
  if (CONNECTION_ERROR_CODES.includes(code)) return true;
  return CONNECTION_ERROR_PATTERNS.some(pattern => message.includes(pattern));
}

// ===================================
// Mutex-Based Reconnection
// ===================================

/**
 * Reconnect with mutex to prevent concurrent reconnection storms.
 * If already reconnecting, all callers wait for the SAME promise.
 * 5s cooldown between attempts.
 */
async function reconnect(client: PrismaClient): Promise<void> {
  // If already reconnecting, piggyback on the existing attempt
  if (isReconnecting && reconnectPromise) {
    return reconnectPromise;
  }

  // Cooldown: don't retry if we attempted recently
  const now = Date.now();
  if (now - lastConnectAttempt < RECONNECT_COOLDOWN_MS) {
    const remaining = Math.round((RECONNECT_COOLDOWN_MS - (now - lastConnectAttempt)) / 1000);
    console.log(`⏳ Reconnect cooldown active (${remaining}s remaining)`);
    // Don't throw — let the caller fall through to query retry.
    // Throwing here previously caused instant failures during cooldown.
    return;
  }

  isReconnecting = true;
  lastConnectAttempt = Date.now();

  reconnectPromise = (async () => {
    try {
      console.log('🔄 Reconnecting to database...');
      // Do NOT call $disconnect() — it destroys all active connections in the pool,
      // killing any in-flight queries from other requests.
      await new Promise(resolve => setTimeout(resolve, RECONNECT_PAUSE_MS));
      
      // Try $connect() first to re-establish the engine connection
      try {
        await client.$connect();
      } catch {
        // $connect may fail if already connected, that's fine
      }

      // Verify with a lightweight query (bypasses $use middleware)
      bypassMiddleware = true;
      try {
        await client.$queryRawUnsafe('SELECT 1');
        isConnected = true;
        lastSuccessfulQuery = Date.now();
        console.log('✅ Database reconnected successfully');
      } finally {
        bypassMiddleware = false;
      }
    } catch (err) {
      isConnected = false;
      console.error('❌ Database reconnection failed:', err instanceof Error ? err.message.substring(0, 200) : err);
      throw err;
    } finally {
      isReconnecting = false;
      reconnectPromise = null;
    }
  })();

  return reconnectPromise;
}

// ===================================
// Prisma Client with Auto-Retry Middleware
// ===================================

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error', 'warn'],
  });

  // Global query middleware: auto-retry ONCE on connection failure.
  // Waits for reconnection instead of failing fast — this is the key
  // difference that prevents users from seeing "database connection failed"
  // on transient connection blips.
  client.$use(async (params, next) => {
    // Health check / keep-alive probes bypass retry logic entirely
    if (bypassMiddleware) {
      return next(params);
    }

    try {
      const result = await next(params);
      // Query succeeded — update connection state
      isConnected = true;
      lastSuccessfulQuery = Date.now();
      return result;
    } catch (error) {
      if (!isConnectionError(error)) {
        throw error; // Not a connection error → rethrow immediately
      }

      // ---- Connection error: attempt ONE retry after reconnection ----
      isConnected = false;
      const model = params.model || 'unknown';
      const action = params.action || 'unknown';
      console.warn(`⚠️ DB error on ${model}.${action}: ${(error as Error).message?.substring(0, 120)}`);
      console.log(`🔁 Attempting retry for ${model}.${action}...`);

      try {
        // Wait for reconnection (or trigger one). This is the key change:
        // instead of failing fast, we WAIT for the reconnect to finish.
        await reconnect(client);
      } catch {
        // Reconnect failed or is in cooldown — add a small delay then
        // try the query anyway (Prisma may have recovered internally).
        await new Promise(resolve => setTimeout(resolve, QUERY_RETRY_DELAY_MS));
      }

      // Retry the query ONCE
      try {
        const retryResult = await next(params);
        isConnected = true;
        lastSuccessfulQuery = Date.now();
        console.log(`✅ Retry succeeded for ${model}.${action}`);
        return retryResult;
      } catch (retryError) {
        // Retry also failed — surface the error
        isConnected = false;
        console.error(`❌ Retry failed for ${model}.${action}: ${(retryError as Error).message?.substring(0, 120)}`);
        throw retryError;
      }
    }
  });

  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// ===================================
// Health Check Helper (non-cascading)
// ===================================

/**
 * Check if the database is reachable.
 * - Uses `bypassMiddleware` flag so $queryRawUnsafe does NOT trigger
 *   the $use() retry/reconnect logic (prevents health check storms).
 * - Probes DB at most once per 60s.
 * - When DB is down and a reconnect was tried recently, returns cached state.
 * - NEVER triggers reconnection storms.
 */
export async function checkDbHealth(): Promise<{ connected: boolean; error?: string }> {
  const now = Date.now();

  // If a real query succeeded recently, DB is definitely up
  if (isConnected && (now - lastSuccessfulQuery) < RECENT_ACTIVITY_MS) {
    return { connected: true };
  }

  // If currently reconnecting, report status without touching DB
  if (isReconnecting) {
    return { connected: false, error: 'Reconnecting...' };
  }

  // If connected and recently probed, trust cached state
  if (isConnected && (now - lastHealthProbe) < HEALTH_PROBE_INTERVAL_MS) {
    return { connected: true };
  }

  // If NOT connected and a reconnect was attempted recently, don't probe
  if (!isConnected && (now - lastConnectAttempt) < RECONNECT_COOLDOWN_MS) {
    return { connected: false, error: 'Database unreachable (cooldown active)' };
  }

  // Only probe DB if there has been NO activity for a long time
  lastHealthProbe = now;
  bypassMiddleware = true;
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    isConnected = true;
    lastSuccessfulQuery = now;
    return { connected: true };
  } catch (err) {
    isConnected = false;
    const msg = err instanceof Error ? err.message.substring(0, 200) : String(err);

    // Trigger ONE reconnect in background (non-blocking)
    reconnect(prisma).catch(() => { /* handled inside reconnect */ });

    return { connected: false, error: msg };
  } finally {
    bypassMiddleware = false;
  }
}

/**
 * Returns the cached connection state without making any DB call.
 */
export function isDbConnected(): boolean {
  return isConnected;
}

// ===================================
// Keep-Alive Ping (Critical for Render + Supabase)
// ===================================

/**
 * Periodic ping to keep database connections warm.
 * Supabase's PgBouncer may close idle connections; this prevents that.
 * Only pings if no recent query activity (to avoid unnecessary load).
 */
async function keepAlivePing(): Promise<void> {
  if (isReconnecting) return;
  if (Date.now() - lastSuccessfulQuery < KEEP_ALIVE_INTERVAL_MS) return;

  bypassMiddleware = true;
  try {
    await prisma.$queryRawUnsafe('SELECT 1');
    lastSuccessfulQuery = Date.now();
    if (!isConnected) {
      isConnected = true;
      console.log('💓 Keep-alive: Connection restored');
    }
  } catch (err) {
    if (isConnected) {
      isConnected = false;
      console.warn('💔 Keep-alive: Connection lost, will reconnect on next request');
    }
  } finally {
    bypassMiddleware = false;
  }
}

function startKeepAlive(): void {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(keepAlivePing, KEEP_ALIVE_INTERVAL_MS);
  console.log(`💓 Keep-alive started (every ${KEEP_ALIVE_INTERVAL_MS / 1000}s — Supabase PgBouncer idle timeout is ~60s)`);
}

export function stopKeepAlive(): void {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
    console.log('💓 Keep-alive stopped');
  }
}

// ===================================
// Startup Connection with Retry (No $disconnect!)
// ===================================

/**
 * Connect on startup with retry. 
 * 
 * CRITICAL CHANGES vs previous version:
 *  1. NEVER calls $disconnect() — that destroys the connection pool mid-flight.
 *  2. Resolves `dbReady` promise so the cold-start gate middleware knows when
 *     it's safe to let requests through.
 *  3. Starts server AFTER connection is established (see index.ts changes).
 */
export const connectWithRetry = async (retries = 5, delay = 2000): Promise<void> => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await prisma.$connect();

      // Verify with a real query (bypasses $use middleware)
      bypassMiddleware = true;
      try {
        await prisma.$queryRawUnsafe('SELECT 1');
      } finally {
        bypassMiddleware = false;
      }

      isConnected = true;
      lastConnectAttempt = Date.now();
      lastHealthProbe = Date.now();
      lastSuccessfulQuery = Date.now();
      console.log(`✅ Database connected (attempt ${attempt}/${retries})`);
      
      // Signal that DB is ready — unblocks waiting HTTP requests
      if (dbReadyResolve) {
        dbReadyResolve();
        dbReadyResolve = null;
      }

      // Start keep-alive ping to prevent idle connection closure
      startKeepAlive();
      return;
    } catch (error) {
      bypassMiddleware = false;
      isConnected = false;
      const msg = error instanceof Error ? error.message.substring(0, 150) : String(error);
      console.error(`❌ DB connect attempt ${attempt}/${retries}: ${msg}`);
      if (attempt < retries) {
        const waitTime = delay * attempt; // Progressive backoff: 2s, 4s, 6s, 8s, 10s (total=30s max)
        console.log(`⏳ Waiting ${waitTime / 1000}s before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }
  console.error('🚨 All startup connection attempts failed.');
  console.error('🚨 DATABASE_URL set:', !!process.env.DATABASE_URL);
  console.error('🚨 URL prefix:', process.env.DATABASE_URL ? process.env.DATABASE_URL.substring(0, 40) + '...' : 'NOT SET');
  
  // Resolve dbReady even on failure so requests don't hang forever
  // (they'll get a proper 503 from the error handler instead)
  if (dbReadyResolve) {
    dbReadyResolve();
    dbReadyResolve = null;
  }

  // Start keep-alive to attempt recovery in background
  startKeepAlive();
};

export default prisma;
