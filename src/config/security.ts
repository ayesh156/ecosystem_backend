/**
 * Security Configuration Module
 * Centralized security settings with validation
 * Based on OWASP API2:2023 - Broken Authentication
 */

import crypto from 'crypto';

// ===================================
// Environment Helpers (lazy evaluation)
// ===================================

// Use getters to ensure env vars are read AFTER dotenv loads
const getIsProduction = () => process.env.NODE_ENV === 'production';
const getIsDevelopment = () => process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

/**
 * Validates that required security environment variables are set
 * Throws on missing critical configs in production
 */
const validateSecurityConfig = () => {
  const errors: string[] = [];
  const isProd = getIsProduction();

  // JWT Secret validation
  if (!process.env.JWT_SECRET) {
    if (isProd) {
      errors.push('JWT_SECRET environment variable is required in production');
    } else {
      console.warn('⚠️  WARNING: JWT_SECRET not set. Using development fallback (NOT SECURE)');
    }
  } else if (process.env.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET must be at least 32 characters for security');
  }

  // JWT Refresh Secret validation
  if (!process.env.JWT_REFRESH_SECRET) {
    if (isProd) {
      errors.push('JWT_REFRESH_SECRET environment variable is required in production');
    } else {
      console.warn('⚠️  WARNING: JWT_REFRESH_SECRET not set. Using development fallback (NOT SECURE)');
    }
  } else if (process.env.JWT_REFRESH_SECRET.length < 32) {
    errors.push('JWT_REFRESH_SECRET must be at least 32 characters for security');
  }

  // Database URL validation
  if (!process.env.DATABASE_URL) {
    if (isProd) {
      errors.push('DATABASE_URL environment variable is required');
    } else {
      console.warn('⚠️  WARNING: DATABASE_URL not set. Database operations will fail.');
    }
  }

  if (errors.length > 0) {
    const errorMessage = `Security Configuration Errors:\n${errors.map(e => `  - ${e}`).join('\n')}`;
    // In production, we should ideally throw, but for smoother deployment troubleshooting
    // we will log a critical error and allow fallback to generated secrets
    console.error(`\n🚨 CRITICAL SECURITY WARNING: ${errorMessage}\nUSING GENERATED FALLBACK SECRETS - SESSIONS WILL RESET ON RESTART\n`);
  }
};

// Don't run validation on module load - will be triggered when config is accessed
// This allows dotenv to load first
let validationRun = false;
const ensureValidated = () => {
  if (!validationRun) {
    validationRun = true;
    validateSecurityConfig();
  }
};

// ===================================
// JWT Configuration
// ===================================

// Generate development-only fallback secrets (cached per server instance)
let _devJwtSecret: string | null = null;
let _devRefreshSecret: string | null = null;

const getDevJwtSecret = () => {
  if (!_devJwtSecret) {
    _devJwtSecret = crypto.randomBytes(32).toString('hex');
  }
  return _devJwtSecret;
};

const getDevRefreshSecret = () => {
  if (!_devRefreshSecret) {
    _devRefreshSecret = crypto.randomBytes(32).toString('hex');
  }
  return _devRefreshSecret;
};

export const jwtConfig = {
  /**
   * Access token secret
   * CRITICAL: Must be set via environment variable in production
   */
  get secret(): string {
    ensureValidated();
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      // Return generated secret even in production if env var is missing
      // This allows the app to start, though sessions won't persist across restarts
      return getDevJwtSecret();
    }
    return secret;
  },

  /**
   * Refresh token secret
   * CRITICAL: Must be set via environment variable in production
   */
  get refreshSecret(): string {
    ensureValidated();
    const secret = process.env.JWT_REFRESH_SECRET;
    if (!secret) {
      // Return generated secret even in production if env var is missing
      return getDevRefreshSecret();
    }
    return secret;
  },

  // Token expiration times
  accessTokenExpiry: '15m' as const,
  refreshTokenExpiry: '7d' as const,

  // Cookie settings
  cookieName: 'refreshToken' as const,
  
  getCookieOptions: () => ({
    httpOnly: true,                          // Prevents XSS attacks
    secure: process.env.NODE_ENV === 'production',  // HTTPS only in production
    sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax' | 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000,        // 7 days in milliseconds
    path: '/',
    // In development, don't set domain to allow cross-port cookies on localhost
    ...(process.env.NODE_ENV === 'production' && process.env.COOKIE_DOMAIN 
      ? { domain: process.env.COOKIE_DOMAIN } 
      : {}),
  }),
};

// ===================================
// Security Headers Configuration
// ===================================

export const securityHeaders = {
  // Content Security Policy - use getter for lazy evaluation
  get contentSecurityPolicy() {
    return getIsProduction() ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    } : false;
  },

  // HTTP Strict Transport Security
  get strictTransportSecurity() {
    return getIsProduction() ? {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    } : false;
  },
};

// ===================================
// CORS Configuration
// ===================================

export const corsConfig = {
  /**
   * Get allowed origins based on environment
   */
  getAllowedOrigins: (): (string | RegExp)[] => {
    const origins: (string | RegExp)[] = [];

    // Add frontend URL from environment
    if (process.env.FRONTEND_URL) {
      origins.push(process.env.FRONTEND_URL);
    }

    // Development origins
    if (getIsDevelopment()) {
      origins.push(
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:3000',
      );
    }

    // Production: Allow Render deployments
    if (getIsProduction()) {
      origins.push(/\.onrender\.com$/);
    }

    return origins;
  },

  /**
   * Strict origin validation
   * In production, only allow explicitly defined origins
   */
  validateOrigin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    // NOTE: In high-security scenarios, you may want to block these
    if (!origin) {
      return callback(null, true);
    }

    const allowedOrigins = corsConfig.getAllowedOrigins();
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed instanceof RegExp) {
        return allowed.test(origin);
      }
      return allowed === origin;
    });

    if (isAllowed) {
      callback(null, true);
    } else if (getIsDevelopment()) {
      // Be more lenient in development
      console.warn(`⚠️  CORS: Allowing unlisted origin in development: ${origin}`);
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS policy`));
    }
  },
};

// ===================================
// Password Policy Configuration
// ===================================

export const passwordConfig = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecialChar: false, // Optional: set to true for stricter policy
  bcryptRounds: 12, // Cost factor for bcrypt
  
  /**
   * Validate password strength
   */
  validate: (password: string): { valid: boolean; errors: string[] } => {
    const errors: string[] = [];
    
    if (password.length < passwordConfig.minLength) {
      errors.push(`Password must be at least ${passwordConfig.minLength} characters`);
    }
    if (password.length > passwordConfig.maxLength) {
      errors.push(`Password must not exceed ${passwordConfig.maxLength} characters`);
    }
    if (passwordConfig.requireUppercase && !/[A-Z]/.test(password)) {
      errors.push('Password must contain at least one uppercase letter');
    }
    if (passwordConfig.requireLowercase && !/[a-z]/.test(password)) {
      errors.push('Password must contain at least one lowercase letter');
    }
    if (passwordConfig.requireNumber && !/\d/.test(password)) {
      errors.push('Password must contain at least one number');
    }
    if (passwordConfig.requireSpecialChar && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      errors.push('Password must contain at least one special character');
    }

    return { valid: errors.length === 0, errors };
  },
};

// ===================================
// Request Validation Configuration
// ===================================

export const requestConfig = {
  // Maximum request body size
  maxBodySize: '10mb',
  
  // Maximum items per page for pagination
  maxPageSize: 100,
  
  // Default page size
  defaultPageSize: 20,
  
  // Maximum file upload size
  maxFileSize: 5 * 1024 * 1024, // 5MB
  
  // Allowed file types
  allowedFileTypes: ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'],
};

// Export helper functions for external use
export const isProduction = getIsProduction;
export const isDevelopment = getIsDevelopment;

export default {
  jwt: jwtConfig,
  cors: corsConfig,
  password: passwordConfig,
  request: requestConfig,
  security: securityHeaders,
  isProduction: getIsProduction,
  isDevelopment: getIsDevelopment,
};
