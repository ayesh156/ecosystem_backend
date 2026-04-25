/**
 * Forgot Password Controller
 * Handles password reset with OTP verification
 */

import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { passwordConfig } from '../config/security';
import { sendPasswordResetOTP, generateOTP } from '../services/emailService';

// ===================================
// Constants
// ===================================

const OTP_EXPIRY_MINUTES = 10;
const MAX_OTP_ATTEMPTS = 5;
const OTP_COOLDOWN_MINUTES = 1; // Prevent spam requests

// ===================================
// Controller Methods
// ===================================

/**
 * @desc    Request password reset OTP
 * @route   POST /api/v1/auth/forgot-password
 * @access  Public
 */
export const requestPasswordReset = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email } = req.body;

    if (!email) {
      throw new AppError('Email is required', 400);
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, name: true, email: true, isActive: true },
    });

    // Don't reveal if user exists for security
    if (!user || !user.isActive) {
      // Return success even if user doesn't exist (security best practice)
      res.status(200).json({
        success: true,
        message: 'If an account with this email exists, you will receive a password reset code.',
      });
      return;
    }

    // Check for recent OTP requests (prevent spam)
    const recentToken = await prisma.passwordResetToken.findFirst({
      where: {
        email: normalizedEmail,
        createdAt: {
          gte: new Date(Date.now() - OTP_COOLDOWN_MINUTES * 60 * 1000),
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (recentToken) {
      const waitSeconds = Math.ceil(
        (OTP_COOLDOWN_MINUTES * 60 * 1000 - (Date.now() - recentToken.createdAt.getTime())) / 1000
      );
      throw new AppError(
        `Please wait ${waitSeconds} seconds before requesting a new code`,
        429
      );
    }

    // Invalidate any existing tokens for this email
    await prisma.passwordResetToken.updateMany({
      where: {
        email: normalizedEmail,
        used: false,
      },
      data: { used: true },
    });

    // Generate new OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

    // Store OTP in database
    await prisma.passwordResetToken.create({
      data: {
        email: normalizedEmail,
        otp,
        expiresAt,
      },
    });

    // Send OTP email
    const emailResult = await sendPasswordResetOTP({
      email: normalizedEmail,
      otp,
      userName: user.name,
    });

    if (!emailResult.success && process.env.NODE_ENV === 'production') {
      throw new AppError('Failed to send reset email. Please try again later.', 500);
    }

    res.status(200).json({
      success: true,
      message: 'If an account with this email exists, you will receive a password reset code.',
      data: {
        expiresIn: OTP_EXPIRY_MINUTES * 60, // seconds
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Verify OTP code
 * @route   POST /api/v1/auth/verify-otp
 * @access  Public
 */
export const verifyOTP = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      throw new AppError('Email and OTP are required', 400);
    }

    const normalizedEmail = email.toLowerCase().trim();
    const normalizedOtp = otp.toString().trim();

    // Find the most recent valid token
    const token = await prisma.passwordResetToken.findFirst({
      where: {
        email: normalizedEmail,
        used: false,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!token) {
      throw new AppError('Invalid or expired OTP. Please request a new code.', 400);
    }

    // Check attempts
    if (token.attempts >= MAX_OTP_ATTEMPTS) {
      // Invalidate token after too many attempts
      await prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { used: true },
      });
      throw new AppError('Too many failed attempts. Please request a new code.', 429);
    }

    // Verify OTP
    if (token.otp !== normalizedOtp) {
      // Increment attempts
      await prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { attempts: { increment: 1 } },
      });

      const remainingAttempts = MAX_OTP_ATTEMPTS - token.attempts - 1;
      throw new AppError(
        `Invalid OTP. ${remainingAttempts} attempt${remainingAttempts !== 1 ? 's' : ''} remaining.`,
        400
      );
    }

    // OTP is valid - generate a temporary reset token
    const resetToken = require('crypto').randomBytes(32).toString('hex');

    // Store reset token for password change step
    await prisma.passwordResetToken.update({
      where: { id: token.id },
      data: {
        otp: resetToken, // Replace OTP with reset token
        expiresAt: new Date(Date.now() + 15 * 60 * 1000), // 15 more minutes
      },
    });

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      data: {
        resetToken,
        expiresIn: 15 * 60, // 15 minutes
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Reset password with verified token
 * @route   POST /api/v1/auth/reset-password
 * @access  Public
 */
export const resetPassword = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { email, resetToken, newPassword } = req.body;

    if (!email || !resetToken || !newPassword) {
      throw new AppError('Email, reset token, and new password are required', 400);
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Validate password strength
    const validation = passwordConfig.validate(newPassword);
    if (!validation.valid) {
      throw new AppError(validation.errors.join('. '), 400);
    }

    // Find valid reset token
    const token = await prisma.passwordResetToken.findFirst({
      where: {
        email: normalizedEmail,
        otp: resetToken,
        used: false,
        expiresAt: { gte: new Date() },
      },
    });

    if (!token) {
      throw new AppError('Invalid or expired reset token. Please restart the process.', 400);
    }

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Hash new password
    const salt = await bcrypt.genSalt(passwordConfig.bcryptRounds);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    // Update password and mark token as used
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { password: hashedPassword },
      }),
      prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { used: true },
      }),
    ]);

    // Clean up old tokens for this user
    await prisma.passwordResetToken.deleteMany({
      where: {
        email: normalizedEmail,
        OR: [
          { used: true },
          { expiresAt: { lt: new Date() } },
        ],
      },
    });

    res.status(200).json({
      success: true,
      message: 'Password reset successfully. You can now log in with your new password.',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Resend OTP code
 * @route   POST /api/v1/auth/resend-otp
 * @access  Public
 */
export const resendOTP = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Reuse the requestPasswordReset logic
  await requestPasswordReset(req, res, next);
};

export default {
  requestPasswordReset,
  verifyOTP,
  resetPassword,
  resendOTP,
};
