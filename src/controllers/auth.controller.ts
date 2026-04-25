import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { jwtConfig, passwordConfig } from '../config/security';

// ===================================
// JWT Configuration - Using Secure Config Module
// ===================================

// Access secrets via secure config (no hardcoded fallbacks in production)
const getJwtSecret = () => jwtConfig.secret;
const getRefreshSecret = () => jwtConfig.refreshSecret;
const ACCESS_TOKEN_EXPIRES_IN = jwtConfig.accessTokenExpiry;
const REFRESH_TOKEN_EXPIRES_IN = jwtConfig.refreshTokenExpiry;

// Cookie configuration
const REFRESH_TOKEN_COOKIE_NAME = jwtConfig.cookieName;
const getRefreshTokenCookieOptions = jwtConfig.getCookieOptions;

// ===================================
// Token Generation Helpers
// ===================================

interface TokenPayload {
  id: string;
  email: string;
  role: string;
  shopId: string | null;
}

const generateAccessToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, getJwtSecret(), { expiresIn: ACCESS_TOKEN_EXPIRES_IN });
};

const generateRefreshToken = (payload: { id: string }): string => {
  return jwt.sign(payload, getRefreshSecret(), { expiresIn: REFRESH_TOKEN_EXPIRES_IN });
};

// Store refresh tokens in database for persistence across server restarts
// This ensures users stay logged in even when Render.com cold-starts the service

const storeRefreshToken = async (userId: string, token: string): Promise<void> => {
  const decoded = jwt.decode(token) as { exp: number };
  const expiresAt = new Date(decoded.exp * 1000);
  
  await prisma.refreshToken.create({
    data: { token, userId, expiresAt },
  });
  
  // Clean up expired tokens for this user (housekeeping)
  await prisma.refreshToken.deleteMany({
    where: { userId, expiresAt: { lt: new Date() } },
  }).catch(() => {}); // Non-critical, ignore errors
};

const validateRefreshToken = async (token: string): Promise<string | null> => {
  const stored = await prisma.refreshToken.findUnique({
    where: { token },
  });
  
  if (!stored || stored.expiresAt < new Date()) {
    // Clean up expired token if found
    if (stored) {
      await prisma.refreshToken.delete({ where: { token } }).catch(() => {});
    }
    return null;
  }
  return stored.userId;
};

const revokeRefreshToken = async (token: string): Promise<void> => {
  await prisma.refreshToken.delete({ where: { token } }).catch(() => {});
};

const revokeAllUserRefreshTokens = async (userId: string): Promise<void> => {
  await prisma.refreshToken.deleteMany({ where: { userId } });
};

// ===================================
// Auth Controller Methods
// ===================================

/**
 * @desc    Register a new user
 * @route   POST /api/v1/auth/register
 * @access  Public
 */
export const register = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password, name, shopSlug } = req.body;

    // Validation
    if (!email || !password || !name) {
      throw new AppError('Please provide email, password, and name', 400);
    }

    if (password.length < 8) {
      throw new AppError('Password must be at least 8 characters long', 400);
    }

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      throw new AppError('User with this email already exists', 409);
    }

    // Find shop if slug provided
    let shopId: string | null = null;
    if (shopSlug) {
      const shop = await prisma.shop.findUnique({
        where: { slug: shopSlug },
      });
      if (!shop) {
        throw new AppError('Shop not found', 404);
      }
      shopId = shop.id;
    }

    // Hash password with bcrypt (using secure config cost factor)
    const salt = await bcrypt.genSalt(passwordConfig.bcryptRounds);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        password: hashedPassword,
        name,
        shopId,
        role: 'STAFF', // Default role
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        shopId: true,
        shop: {
          select: { id: true, name: true, slug: true },
        },
      },
    });

    // Generate tokens
    const tokenPayload: TokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      shopId: user.shopId,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken({ id: user.id });

    // Store refresh token
    await storeRefreshToken(user.id, refreshToken);

    // Set refresh token in HttpOnly cookie
    res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, getRefreshTokenCookieOptions());

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          shop: user.shop,
        },
        accessToken,
        refreshToken, // Also send in body for environments where cookies don't work
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Login user
 * @route   POST /api/v1/auth/login
 * @access  Public
 */
export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      throw new AppError('Please provide email and password', 400);
    }

    // Find user with password
    // Auto-retries on DB connection failure via Prisma $use middleware
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: {
        shop: {
          select: { id: true, name: true, slug: true, logo: true },
        },
      },
    });

    if (!user) {
      throw new AppError('Invalid email or password', 401);
    }

    if (!user.isActive) {
      throw new AppError('Your account has been deactivated. Please contact support.', 401);
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new AppError('Invalid email or password', 401);
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    // Generate tokens
    const tokenPayload: TokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      shopId: user.shopId,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken({ id: user.id });

    // Store refresh token
    await storeRefreshToken(user.id, refreshToken);

    // Set refresh token in HttpOnly cookie
    res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, getRefreshTokenCookieOptions());

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          shop: user.shop,
        },
        accessToken,
        refreshToken, // Also send in body for environments where cookies don't work
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Refresh access token using refresh token from cookie
 * @route   POST /api/v1/auth/refresh
 * @access  Public (requires valid refresh token cookie)
 */
export const refresh = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Get refresh token from cookie first, then fallback to body (for development/mobile)
    let refreshToken = req.cookies[REFRESH_TOKEN_COOKIE_NAME];
    
    // Fallback: Check request body (for environments where cookies don't work)
    if (!refreshToken && req.body?.refreshToken) {
      refreshToken = req.body.refreshToken;
    }

    if (!refreshToken) {
      throw new AppError('No refresh token provided', 401);
    }

    // Verify refresh token
    let decoded: { id: string };
    try {
      decoded = jwt.verify(refreshToken, getRefreshSecret()) as { id: string };
    } catch (error) {
      // Clear invalid cookie
      res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, getRefreshTokenCookieOptions());
      throw new AppError('Invalid or expired refresh token', 401);
    }

    // Validate refresh token is still in store (not revoked)
    const storedUserId = await validateRefreshToken(refreshToken);
    if (!storedUserId || storedUserId !== decoded.id) {
      res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, getRefreshTokenCookieOptions());
      throw new AppError('Refresh token has been revoked', 401);
    }

    // Get user from database
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: {
        shop: {
          select: { id: true, name: true, slug: true, logo: true },
        },
      },
    });

    if (!user || !user.isActive) {
      await revokeRefreshToken(refreshToken);
      res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, getRefreshTokenCookieOptions());
      throw new AppError('User not found or inactive', 401);
    }

    // Revoke old refresh token (token rotation)
    await revokeRefreshToken(refreshToken);

    // Generate new tokens
    const tokenPayload: TokenPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      shopId: user.shopId,
    };

    const newAccessToken = generateAccessToken(tokenPayload);
    const newRefreshToken = generateRefreshToken({ id: user.id });

    // Store new refresh token
    await storeRefreshToken(user.id, newRefreshToken);

    // Set new refresh token in HttpOnly cookie
    res.cookie(REFRESH_TOKEN_COOKIE_NAME, newRefreshToken, getRefreshTokenCookieOptions());

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          shop: user.shop,
        },
        accessToken: newAccessToken,
        refreshToken: newRefreshToken, // Also send in body for environments where cookies don't work
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Logout user (revoke refresh token)
 * @route   POST /api/v1/auth/logout
 * @access  Public
 */
export const logout = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Accept refresh token from cookie OR request body (for environments where cookies don't work)
    const refreshToken = req.cookies[REFRESH_TOKEN_COOKIE_NAME] || req.body?.refreshToken;

    if (refreshToken) {
      // Revoke the refresh token
      await revokeRefreshToken(refreshToken);
    }

    // Clear the cookie
    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, getRefreshTokenCookieOptions());

    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Logout from all devices (revoke all refresh tokens)
 * @route   POST /api/v1/auth/logout-all
 * @access  Private (requires authentication)
 */
export const logoutAll = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new AppError('Not authenticated', 401);
    }

    // Revoke all refresh tokens for this user
    await revokeAllUserRefreshTokens(req.user.id);

    // Clear the cookie
    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, getRefreshTokenCookieOptions());

    res.status(200).json({
      success: true,
      message: 'Logged out from all devices successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get current user profile
 * @route   GET /api/v1/auth/me
 * @access  Private
 */
export const getMe = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new AppError('Not authenticated', 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        lastLogin: true,
        shop: {
          select: {
            id: true,
            name: true,
            slug: true,
            logo: true,
            address: true,
            phone: true,
            email: true,
          },
        },
      },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    res.status(200).json({
      success: true,
      data: { user },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update current user profile
 * @route   PUT /api/v1/auth/me
 * @access  Private
 */
export const updateMe = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new AppError('Not authenticated', 401);
    }

    const { name, email } = req.body;

    // Check if email is being changed and if it's already taken
    if (email && email.toLowerCase() !== req.user.email) {
      const existingUser = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });
      if (existingUser) {
        throw new AppError('Email is already in use', 409);
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        ...(name && { name }),
        ...(email && { email: email.toLowerCase() }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        shop: {
          select: { id: true, name: true, slug: true },
        },
      },
    });

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: updatedUser },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Change password
 * @route   PUT /api/v1/auth/password
 * @access  Private
 */
export const changePassword = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user) {
      throw new AppError('Not authenticated', 401);
    }

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      throw new AppError('Please provide current and new password', 400);
    }

    if (newPassword.length < 8) {
      throw new AppError('New password must be at least 8 characters long', 400);
    }

    // Get user with password
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Verify current password
    const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
    if (!isPasswordValid) {
      throw new AppError('Current password is incorrect', 401);
    }

    // Hash new password
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password
    await prisma.user.update({
      where: { id: req.user.id },
      data: { password: hashedPassword },
    });

    // Revoke all refresh tokens (force re-login on all devices)
    await revokeAllUserRefreshTokens(req.user.id);

    // Clear current cookie
    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, getRefreshTokenCookieOptions());

    res.status(200).json({
      success: true,
      message: 'Password changed successfully. Please login again.',
    });
  } catch (error) {
    next(error);
  }
};
