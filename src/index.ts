import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables FIRST (before any security config)
// Try multiple paths for tsx compatibility
const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), 'backend', '.env'),
  path.resolve(__dirname, '../.env'),
];

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    console.log(`📁 Loading .env from: ${envPath}`);
    dotenv.config({ path: envPath });
    break;
  }
}

import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { apiRateLimiter } from './middleware/rateLimiter';
import { sanitizeRequestBody } from './middleware/validation';
import { corsConfig } from './config/security';
import { connectWithRetry, isDbConnected, dbReady } from './lib/prisma';

// Route imports
import authRoutes from './routes/auth.routes';
import invoiceRoutes from './routes/invoice.routes';
import customerRoutes from './routes/customer.routes';
import productRoutes from './routes/product.routes';
import categoryRoutes from './routes/category.routes';
import brandRoutes from './routes/brand.routes';
import shopRoutes from './routes/shop.routes';
import adminRoutes from './routes/admin.routes';
import shopAdminRoutes from './routes/shopAdmin.routes';
import supplierRoutes from './routes/supplier.routes';
import grnRoutes from './routes/grn.routes';

const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';

// ===================================
// TRUST PROXY - Required for Render.com (behind reverse proxy)
// Enables correct client IP detection for rate limiting
// ===================================
if (isProduction) {
  app.set('trust proxy', 1);
  console.log('🔒 Trust proxy enabled for production (reverse proxy detected)');
}

// ===================================
// SECURITY MIDDLEWARE - Order matters!
// ===================================

// 1. Request ID for tracing (NIST AU-3)
app.use((req, _res, next) => {
  (req as any).requestId = req.headers['x-request-id'] || crypto.randomUUID();
  next();
});

// 2. Security headers (Helmet with custom config)
app.use(helmet({
  contentSecurityPolicy: isProduction ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // For HTML test page
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    },
  } : false,
  crossOriginEmbedderPolicy: false, // Allow embedding for HTML test page
  hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
}));

// 3. Cookie parser - Required for refresh token cookies
app.use(cookieParser());

// 4. CORS configuration - Using secure config module
app.use(cors({
  origin: corsConfig.validateOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'Cache-Control', 'Pragma', 'Expires'],
  exposedHeaders: ['set-cookie', 'X-Request-ID', 'RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'],
  maxAge: 86400, // Cache preflight for 24 hours
}));

// 5. Body parsing with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 6. Input sanitization - Prevents XSS and prototype pollution
app.use(sanitizeRequestBody);

// 7. Global rate limiting (applies to all routes)
app.use(apiRateLimiter);

// 8. Logging with request ID
morgan.token('request-id', (req) => (req as any).requestId);
if (!isProduction) {
  app.use(morgan(':method :url :status :response-time ms - :request-id'));
} else {
  app.use(morgan(':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" :request-id'));
}

// 9. Add security response headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (isProduction) {
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  }
  next();
});

// API version prefix
const API_PREFIX = '/api/v1';

// Health check — MUST be instant. Render sends these every 5s from multiple IPs.
// NEVER open a DB connection here. Use cached state from real queries.
app.get('/health', (_req, res) => {
  const dbConnected = isDbConnected();
  
  // Always return 200 so Render doesn't kill the service during cold start.
  res.status(200).json({ 
    status: dbConnected ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    database: dbConnected ? 'connected' : 'disconnected',
  });
});

// ===================================
// COLD-START GATE MIDDLEWARE
// ===================================
// On Render's free tier the service sleeps after inactivity. When it wakes up,
// Render routes incoming requests to the server IMMEDIATELY — often before the
// DB connection is ready. Without this middleware, those requests get an instant
// 503 "Database connection failed".
//
// This gate holds API requests for up to 45s, waiting for the DB to connect.
// Must be >= connectWithRetry's max duration (5 attempts × 2s backoff = ~30s
// + connect_timeout overhead). 45s gives comfortable headroom.
// Health checks (above) are exempt so Render doesn't think the service is dead.
const DB_GATE_TIMEOUT_MS = 45000;

app.use(`${API_PREFIX}`, async (req, res, next) => {
  // If DB is already connected, proceed immediately (hot path — no overhead)
  if (isDbConnected()) {
    return next();
  }

  // DB not ready yet — wait for the startup connection to finish
  console.log(`⏳ Request waiting for DB: ${req.method} ${req.originalUrl}`);
  
  const timeout = new Promise<'timeout'>((resolve) =>
    setTimeout(() => resolve('timeout'), DB_GATE_TIMEOUT_MS)
  );

  const result = await Promise.race([dbReady, timeout]);

  if (result === 'timeout' && !isDbConnected()) {
    console.error(`🚫 DB gate timeout for ${req.method} ${req.originalUrl}`);
    return res.status(503).json({
      success: false,
      message: 'Service is starting up. Please try again in a few seconds.',
    });
  }

  next();
});

// API Test endpoint - Shows at root URL (http://localhost:3001 or https://api.ecosystemlk.tech)
app.get('/', async (_req, res) => {
  const currentTime = new Date().toLocaleString('en-US', { 
    dateStyle: 'full', 
    timeStyle: 'medium' 
  });

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Eco System API - Online</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #e2e8f0;
      overflow: hidden;
    }

    .bg-glow {
      position: fixed;
      width: 500px;
      height: 500px;
      border-radius: 50%;
      filter: blur(120px);
      opacity: 0.4;
      pointer-events: none;
      z-index: 0;
    }

    .glow-1 {
      background: linear-gradient(135deg, #10b981, #06b6d4);
      top: -150px;
      right: -150px;
    }

    .glow-2 {
      background: linear-gradient(135deg, #8b5cf6, #ec4899);
      bottom: -200px;
      left: -150px;
    }

    .container {
      text-align: center;
      z-index: 1;
      padding: 2rem;
      animation: fadeInUp 0.8s ease-out;
    }

    @keyframes fadeInUp {
      from {
        opacity: 0;
        transform: translateY(30px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    @keyframes pulse {
      0%, 100% { 
        transform: scale(1);
        box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.4);
      }
      50% { 
        transform: scale(1.05);
        box-shadow: 0 0 0 20px rgba(16, 185, 129, 0);
      }
    }

    @keyframes float {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-10px); }
    }

    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .logo-container {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 120px;
      height: 120px;
      background: linear-gradient(135deg, #10b981, #06b6d4);
      border-radius: 32px;
      margin-bottom: 2rem;
      box-shadow: 0 25px 60px -15px rgba(16, 185, 129, 0.5);
      animation: float 3s ease-in-out infinite;
    }

    .logo-container::before {
      content: '';
      position: absolute;
      inset: -4px;
      background: linear-gradient(135deg, #10b981, #06b6d4, #8b5cf6, #10b981);
      border-radius: 36px;
      z-index: -1;
      animation: spin 4s linear infinite;
      opacity: 0.6;
    }

    .logo {
      font-size: 4rem;
    }

    h1 {
      font-size: 3rem;
      font-weight: 800;
      background: linear-gradient(135deg, #fff 0%, #10b981 50%, #06b6d4 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 0.5rem;
    }

    .subtitle {
      font-size: 1.25rem;
      color: #94a3b8;
      margin-bottom: 2rem;
    }

    .status-card {
      display: inline-flex;
      align-items: center;
      gap: 1rem;
      padding: 1.25rem 2.5rem;
      background: rgba(16, 185, 129, 0.1);
      border: 2px solid rgba(16, 185, 129, 0.3);
      border-radius: 20px;
      margin-bottom: 2rem;
      backdrop-filter: blur(10px);
    }

    .status-dot {
      position: relative;
      width: 16px;
      height: 16px;
      background: #10b981;
      border-radius: 50%;
      animation: pulse 2s ease-in-out infinite;
    }

    .status-dot::before {
      content: '';
      position: absolute;
      inset: -4px;
      background: rgba(16, 185, 129, 0.3);
      border-radius: 50%;
      animation: pulse 2s ease-in-out infinite;
    }

    .status-text {
      font-size: 1.5rem;
      font-weight: 700;
      color: #10b981;
    }

    .version {
      display: inline-block;
      background: rgba(139, 92, 246, 0.2);
      color: #a78bfa;
      padding: 0.5rem 1rem;
      border-radius: 12px;
      font-size: 0.9rem;
      font-weight: 600;
      margin-bottom: 1.5rem;
    }

    .timestamp {
      color: #64748b;
      font-size: 0.875rem;
    }

    .footer {
      margin-top: 2.5rem;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      color: #64748b;
      font-size: 0.875rem;
    }

    @media (max-width: 640px) {
      h1 {
        font-size: 2rem;
      }
      
      .logo-container {
        width: 100px;
        height: 100px;
      }
      
      .logo {
        font-size: 3rem;
      }
      
      .status-card {
        padding: 1rem 1.5rem;
      }
      
      .status-text {
        font-size: 1.25rem;
      }
    }
  </style>
</head>
<body>
  <div class="bg-glow glow-1"></div>
  <div class="bg-glow glow-2"></div>
  
  <div class="container">
    <div class="logo-container">
      <span class="logo">🚀</span>
    </div>
    
    <h1>Eco System API</h1>
    <p class="subtitle">Enterprise Shop Management System</p>
    
    <div class="status-card">
      <span class="status-dot"></span>
      <span class="status-text">API is Working!</span>
    </div>
    
    <div class="version">v1.0.0 • ${process.env.NODE_ENV || 'development'}</div>
    
    <p class="timestamp">${currentTime}</p>
    
    <div class="footer">
      ✨ Powered by Express.js + Prisma + Supabase
    </div>
  </div>
</body>
</html>
  `;

  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(html);
});

// ===================================
// ROUTE-LEVEL TIMEOUT FOR HEAVY OPERATIONS
// ===================================
// Email sending (3 SMTP attempts × 60s each) and PDF generation (Puppeteer ~30s)
// need much longer than Express's default 120s. Without this, the client gets
// a "socket hang up" or empty response before the operation completes.
const HEAVY_ROUTE_TIMEOUT_MS = 210000; // 3.5 minutes

const extendTimeout = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  req.setTimeout(HEAVY_ROUTE_TIMEOUT_MS);
  res.setTimeout(HEAVY_ROUTE_TIMEOUT_MS);
  next();
};

// Apply extended timeout to email and PDF routes BEFORE the route handlers
app.use(`${API_PREFIX}/invoices`, (req, res, next) => {
  // Only extend timeout for email/PDF endpoints, not regular CRUD
  if (req.path.includes('send-email') || req.path.includes('/pdf')) {
    return extendTimeout(req, res, next);
  }
  next();
});
app.use(`${API_PREFIX}/grns`, (req, res, next) => {
  if (req.path.includes('send-email') || req.path.includes('/pdf')) {
    return extendTimeout(req, res, next);
  }
  next();
});

// Routes
app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/invoices`, invoiceRoutes);
app.use(`${API_PREFIX}/customers`, customerRoutes);
app.use(`${API_PREFIX}/products`, productRoutes);
app.use(`${API_PREFIX}/categories`, categoryRoutes);
app.use(`${API_PREFIX}/brands`, brandRoutes);
app.use(`${API_PREFIX}/shops`, shopRoutes);
app.use(`${API_PREFIX}/admin`, adminRoutes);
app.use(`${API_PREFIX}/shop-admin`, shopAdminRoutes);
app.use(`${API_PREFIX}/suppliers`, supplierRoutes);
app.use(`${API_PREFIX}/grns`, grnRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

// ===================================
// STARTUP SEQUENCE
// ===================================
// 1. Connect to DB FIRST (with retries + backoff)
// 2. THEN start accepting HTTP requests
//
// This prevents the race condition where user requests arrive before DB
// is ready, which was the root cause of "Database connection failed" on
// Render's free tier cold starts.
//
// The cold-start gate middleware above is a safety net for requests that
// arrive during the brief window between listen() and connectWithRetry().

const startServer = async () => {
  // Start listening FIRST so Render sees the port is bound (prevents restart loop)
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📡 API available at http://localhost:${PORT}${API_PREFIX}`);
  });

  // Then connect to DB (requests are held by the cold-start gate middleware)
  try {
    await connectWithRetry(5, 2000); // 5 attempts, 2s progressive backoff (2,4,6,8,10s = 30s max)
    console.log('📦 Database initialization complete');
  } catch (err) {
    console.error('⚠️ Database pre-connect failed, per-request retry is still active:', err instanceof Error ? err.message : err);
  }
};

startServer();

export default app;
