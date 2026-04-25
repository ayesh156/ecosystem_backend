/**
 * Rate Limiting Middleware
 * Implements tiered rate limiting for different API operations
 * Based on OWASP API4:2023 - Unrestricted Resource Consumption
 */

import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';

// ===================================
// Rate Limit Configuration
// ===================================

// Check if we should skip rate limiting (development/test mode)
const shouldSkipRateLimit = (): boolean => {
  return process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development';
};

// Standard error response format
const createRateLimitResponse = (message: string, retryAfter: number) => ({
  success: false,
  error: 'RATE_LIMIT_EXCEEDED',
  message,
  retryAfter,
});

// ===================================
// Strict Rate Limiter - For Auth Endpoints
// ===================================
// Prevents brute force attacks on login/register
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: createRateLimitResponse(
    'Too many authentication attempts. Please try again after 15 minutes.',
    15 * 60
  ),
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false, // Disable `X-RateLimit-*` headers
  // Use default keyGenerator (handles IPv6 properly)
  handler: (req: Request, res: Response) => {
    res.status(429).json(createRateLimitResponse(
      'Too many authentication attempts. Please try again after 15 minutes.',
      15 * 60
    ));
  },
  skip: () => shouldSkipRateLimit(),
});

// ===================================
// ===================================
// Login Rate Limiter - Extra strict for login
// ===================================
// Prevents credential stuffing attacks
export const loginRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 failed login attempts per hour
  message: createRateLimitResponse(
    'Too many failed login attempts. Account temporarily locked for 1 hour.',
    60 * 60
  ),
  standardHeaders: true,
  legacyHeaders: false,
  // Use default keyGenerator (handles IPv6 properly)
  handler: (req: Request, res: Response) => {
    res.status(429).json(createRateLimitResponse(
      'Too many failed login attempts. Account temporarily locked for 1 hour.',
      60 * 60
    ));
  },
  skipSuccessfulRequests: true, // Only count failed attempts
  skip: () => shouldSkipRateLimit(),
});

// ===================================
// API Rate Limiter - For general API endpoints
// ===================================
export const apiRateLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute per user
  message: createRateLimitResponse(
    'Too many requests. Please slow down.',
    60
  ),
  standardHeaders: true,
  legacyHeaders: false,
  // Use default keyGenerator (handles IPv6 properly)
  handler: (req: Request, res: Response) => {
    res.status(429).json(createRateLimitResponse(
      'Too many requests. Please slow down.',
      60
    ));
  },
  skip: () => shouldSkipRateLimit(),
});

// ===================================
// Sensitive Operations Rate Limiter
// ===================================
// For operations like password change, invoice creation
export const sensitiveRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 sensitive operations per 15 minutes
  message: createRateLimitResponse(
    'Too many sensitive operations. Please wait before trying again.',
    15 * 60
  ),
  standardHeaders: true,
  legacyHeaders: false,
  // Use default keyGenerator (handles IPv6 properly)
  handler: (req: Request, res: Response) => {
    res.status(429).json(createRateLimitResponse(
      'Too many sensitive operations. Please wait before trying again.',
      15 * 60
    ));
  },
  skip: () => shouldSkipRateLimit(),
});

// ===================================
// Shop Registration Rate Limiter
// ===================================
// Prevents spam shop creation
export const shopRegistrationRateLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 3, // 3 shop registrations per day per IP
  message: createRateLimitResponse(
    'Too many shop registrations. Maximum 3 shops per day.',
    24 * 60 * 60
  ),
  standardHeaders: true,
  legacyHeaders: false,
  // Use default keyGenerator (handles IPv6 properly)
  handler: (req: Request, res: Response) => {
    res.status(429).json(createRateLimitResponse(
      'Too many shop registrations. Maximum 3 shops per day.',
      24 * 60 * 60
    ));
  },
  skip: () => shouldSkipRateLimit(),
});
