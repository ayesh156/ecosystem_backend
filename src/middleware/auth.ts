import { Request, Response, NextFunction } from 'express';
import jwt, { TokenExpiredError, JsonWebTokenError } from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { AppError } from './errorHandler';
import { jwtConfig } from '../config/security';
import { AuthRequest, AuthUser } from '../types/express';

// Use secure config instead of hardcoded fallback
const getJwtSecret = () => jwtConfig.secret;

// Re-export AuthRequest for backward compatibility
export type { AuthRequest };

/**
 * Protect middleware - Validates JWT access token from Authorization header
 * Returns 401 with specific error codes for token issues:
 * - TOKEN_MISSING: No token provided
 * - TOKEN_EXPIRED: Token has expired (client should refresh)
 * - TOKEN_INVALID: Token is malformed or invalid
 * - USER_INACTIVE: User account is deactivated
 */
export const protect = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  try {
    let token: string | undefined;

    // Get token from Authorization header (Bearer token)
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      const error = new AppError('No access token provided', 401);
      (error as AppError & { code: string }).code = 'TOKEN_MISSING';
      throw error;
    }

    // Verify token
    let decoded: { id: string; email: string; role: string; shopId: string | null };
    try {
      decoded = jwt.verify(token, getJwtSecret()) as typeof decoded;
    } catch (jwtError) {
      if (jwtError instanceof TokenExpiredError) {
        const error = new AppError('Access token has expired', 401);
        (error as AppError & { code: string }).code = 'TOKEN_EXPIRED';
        throw error;
      }
      if (jwtError instanceof JsonWebTokenError) {
        const error = new AppError('Invalid access token', 401);
        (error as AppError & { code: string }).code = 'TOKEN_INVALID';
        throw error;
      }
      throw jwtError;
    }

    // Get user from database with shopId
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: { id: true, email: true, name: true, role: true, isActive: true, shopId: true },
    });

    if (!user) {
      const error = new AppError('User not found', 401);
      (error as AppError & { code: string }).code = 'USER_NOT_FOUND';
      throw error;
    }

    if (!user.isActive) {
      const error = new AppError('User account is deactivated', 401);
      (error as AppError & { code: string }).code = 'USER_INACTIVE';
      throw error;
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Optional auth middleware - Attaches user if token is valid, but doesn't require it
 * Useful for routes that work differently for authenticated vs anonymous users
 */
export const optionalAuth = async (
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) => {
  try {
    let token: string | undefined;

    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(); // Continue without user
    }

    try {
      const decoded = jwt.verify(token, getJwtSecret()) as { id: string };
      
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { id: true, email: true, name: true, role: true, isActive: true, shopId: true },
      });

      if (user && user.isActive) {
        req.user = user;
      }
    } catch {
      // Token invalid, continue without user
    }

    next();
  } catch (error) {
    next(error);
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return next(
        new AppError('Not authorized to perform this action', 403)
      );
    }
    next();
  };
};

// Middleware to ensure user belongs to a shop (or SUPER_ADMIN with shopId query param)
export const requireShop = (req: AuthRequest, _res: Response, next: NextFunction) => {
  // SUPER_ADMIN can access any shop via query parameter
  if (req.user?.role === 'SUPER_ADMIN') {
    const viewingShopId = req.query.shopId as string | undefined;
    if (viewingShopId) {
      // Set the shopId on the user object for use in controllers
      req.user.shopId = viewingShopId;
      return next();
    }
    // SUPER_ADMIN without shopId query param - they don't belong to a shop
    // Allow them to continue but shopId will be null
    return next();
  }
  
  if (!req.user?.shopId) {
    return next(new AppError('User is not associated with any shop', 403));
  }
  next();
};

// Middleware to verify user has access to the specified shop
export const requireShopAccess = (req: AuthRequest, _res: Response, next: NextFunction) => {
  const shopId = req.params.id || req.params.shopId || req.body.shopId;
  
  // SUPER_ADMIN can access any shop
  if (req.user?.role === 'SUPER_ADMIN') {
    return next();
  }
  
  if (!req.user?.shopId || req.user.shopId !== shopId) {
    return next(new AppError('Not authorized to access this shop', 403));
  }
  next();
};
