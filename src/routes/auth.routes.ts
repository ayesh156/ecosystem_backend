import { Router } from 'express';
import { body } from 'express-validator';
import {
  register,
  login,
  refresh,
  logout,
  logoutAll,
  getMe,
  updateMe,
  changePassword,
} from '../controllers/auth.controller';
import {
  requestPasswordReset,
  verifyOTP,
  resetPassword,
  resendOTP,
} from '../controllers/forgotPassword.controller';
import { protect } from '../middleware/auth';
import { authRateLimiter, loginRateLimiter, sensitiveRateLimiter } from '../middleware/rateLimiter';
import { handleValidationErrors } from '../middleware/validation';

const router = Router();

// ===================================
// Validation Schemas
// ===================================

const registerValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('shopSlug')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Shop slug must be between 2 and 50 characters'),
  handleValidationErrors,
];

const loginValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  handleValidationErrors,
];

const updateProfileValidation = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  body('email')
    .optional()
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  handleValidationErrors,
];

const changePasswordValidation = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  handleValidationErrors,
];

// ===================================
// Public Routes (No Auth Required)
// ===================================

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register a new user
 * @access  Public
 * @rateLimit 10 attempts per 15 minutes
 */
router.post('/register', authRateLimiter, registerValidation, register);

/**
 * @route   POST /api/v1/auth/login
 * @desc    Login user & get tokens
 * @access  Public
 * @rateLimit 5 failed attempts per hour (per IP+email)
 */
router.post('/login', authRateLimiter, loginRateLimiter, loginValidation, login);

/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Refresh access token using refresh token cookie
 * @access  Public (requires valid refresh token cookie)
 * @rateLimit Standard API rate limit
 */
router.post('/refresh', authRateLimiter, refresh);

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Logout user (revoke refresh token)
 * @access  Public
 */
router.post('/logout', logout);

// ===================================
// Password Reset Routes (No Auth Required)
// ===================================

const forgotPasswordValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  handleValidationErrors,
];

const verifyOTPValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('otp')
    .isLength({ min: 6, max: 6 })
    .withMessage('OTP must be 6 digits')
    .isNumeric()
    .withMessage('OTP must contain only numbers'),
  handleValidationErrors,
];

const resetPasswordValidation = [
  body('email')
    .isEmail()
    .withMessage('Please provide a valid email')
    .normalizeEmail(),
  body('resetToken')
    .notEmpty()
    .withMessage('Reset token is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  handleValidationErrors,
];

/**
 * @route   POST /api/v1/auth/forgot-password
 * @desc    Request password reset OTP
 * @access  Public
 * @rateLimit 10 attempts per 15 minutes
 */
router.post('/forgot-password', authRateLimiter, forgotPasswordValidation, requestPasswordReset);

/**
 * @route   POST /api/v1/auth/verify-otp
 * @desc    Verify OTP code for password reset
 * @access  Public
 * @rateLimit 10 attempts per 15 minutes
 */
router.post('/verify-otp', authRateLimiter, verifyOTPValidation, verifyOTP);

/**
 * @route   POST /api/v1/auth/reset-password
 * @desc    Reset password with verified token
 * @access  Public
 * @rateLimit Extra protection for password reset
 */
router.post('/reset-password', sensitiveRateLimiter, resetPasswordValidation, resetPassword);

/**
 * @route   POST /api/v1/auth/resend-otp
 * @desc    Resend OTP code
 * @access  Public
 * @rateLimit 10 attempts per 15 minutes
 */
router.post('/resend-otp', authRateLimiter, forgotPasswordValidation, resendOTP);

// ===================================
// Protected Routes (Auth Required)
// ===================================

/**
 * @route   POST /api/v1/auth/logout-all
 * @desc    Logout from all devices
 * @access  Private
 */
router.post('/logout-all', protect, sensitiveRateLimiter, logoutAll);

/**
 * @route   GET /api/v1/auth/me
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/me', protect, getMe);

/**
 * @route   PUT /api/v1/auth/me
 * @desc    Update current user profile
 * @access  Private
 */
router.put('/me', protect, sensitiveRateLimiter, updateProfileValidation, updateMe);

/**
 * @route   PUT /api/v1/auth/password
 * @desc    Change password
 * @access  Private
 * @rateLimit Extra protection for password changes
 */
router.put('/password', protect, sensitiveRateLimiter, changePasswordValidation, changePassword);

export default router;
