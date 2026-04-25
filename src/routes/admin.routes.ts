/**
 * Admin Routes - Super Admin Platform Management
 * CRUD operations for managing all shops and users in the system
 * Only accessible by SUPER_ADMIN role
 */

import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma';
import { protect, authorize } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { sensitiveRateLimiter } from '../middleware/rateLimiter';
import { body, validationResult } from 'express-validator';
import { passwordConfig } from '../config/security';

const router = Router();

// ===================================
// Apply SUPER_ADMIN protection to ALL routes
// ===================================
router.use(protect, authorize('SUPER_ADMIN'));

// ===================================
// Dashboard Statistics
// ===================================

/**
 * @route   GET /api/v1/admin/stats
 * @desc    Get platform statistics
 * @access  Super Admin Only
 */
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Run counts sequentially to avoid exhausting Supabase's limited connection pool.
    // Each count() is fast (<50ms), so sequential is fine for an admin dashboard.
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const totalShops = await prisma.shop.count();
    const activeShops = await prisma.shop.count({ where: { isActive: true } });
    const totalUsers = await prisma.user.count();
    const totalInvoices = await prisma.invoice.count();
    const totalCustomers = await prisma.customer.count();
    const totalProducts = await prisma.product.count();
    const recentShops = await prisma.shop.count({ where: { createdAt: { gte: sevenDaysAgo } } });
    const recentUsers = await prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } });

    res.json({
      success: true,
      data: {
        totalShops,
        totalUsers,
        activeShops,
        inactiveShops: totalShops - activeShops,
        totalInvoices,
        totalCustomers,
        totalProducts,
        recentShops,
        recentUsers,
      },
    });
  } catch (error) {
    next(error);
  }
});

// ===================================
// Shop Management
// ===================================

/**
 * @route   GET /api/v1/admin/shops
 * @desc    Get all shops with user counts
 * @access  Super Admin Only
 */
router.get('/shops', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shops = await prisma.shop.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            users: true,
            customers: true,
            products: true,
            invoices: true,
          },
        },
      },
    });

    res.json({
      success: true,
      data: shops.map(shop => ({
        id: shop.id,
        name: shop.name,
        slug: shop.slug,
        email: shop.email,
        phone: shop.phone,
        address: shop.address,
        logo: shop.logo,
        isActive: shop.isActive,
        currency: shop.currency,
        taxRate: shop.taxRate,
        businessRegNo: shop.businessRegNo,
        createdAt: shop.createdAt,
        updatedAt: shop.updatedAt,
        userCount: shop._count.users,
        customerCount: shop._count.customers,
        productCount: shop._count.products,
        invoiceCount: shop._count.invoices,
      })),
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/v1/admin/shops/:id
 * @desc    Get shop details with all users
 * @access  Super Admin Only
 */
router.get('/shops/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const shop = await prisma.shop.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
            createdAt: true,
            updatedAt: true,
            lastLogin: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: {
            customers: true,
            products: true,
            invoices: true,
          },
        },
      },
    });

    if (!shop) {
      return res.status(404).json({ success: false, message: 'Shop not found' });
    }

    res.json({
      success: true,
      data: {
        ...shop,
        customerCount: shop._count.customers,
        productCount: shop._count.products,
        invoiceCount: shop._count.invoices,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PUT /api/v1/admin/shops/:id
 * @desc    Update shop details
 * @access  Super Admin Only
 */
router.put('/shops/:id', sensitiveRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { name, email, phone, address, isActive, taxRate, currency } = req.body;

    const shop = await prisma.shop.findUnique({ where: { id } });
    if (!shop) {
      return res.status(404).json({ success: false, message: 'Shop not found' });
    }

    const updatedShop = await prisma.shop.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(address !== undefined && { address }),
        ...(isActive !== undefined && { isActive }),
        ...(taxRate !== undefined && { taxRate }),
        ...(currency !== undefined && { currency }),
      },
    });

    res.json({
      success: true,
      message: 'Shop updated successfully',
      data: updatedShop,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   DELETE /api/v1/admin/shops/:id
 * @desc    Delete a shop (soft delete - deactivate)
 * @access  Super Admin Only
 */
router.delete('/shops/:id', sensitiveRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const shop = await prisma.shop.findUnique({ where: { id } });
    if (!shop) {
      return res.status(404).json({ success: false, message: 'Shop not found' });
    }

    // Soft delete - just deactivate
    await prisma.shop.update({
      where: { id },
      data: { isActive: false },
    });

    res.json({
      success: true,
      message: 'Shop deactivated successfully',
    });
  } catch (error) {
    next(error);
  }
});

// ===================================
// User Management
// ===================================

/**
 * @route   GET /api/v1/admin/users
 * @desc    Get all users across all shops
 * @access  Super Admin Only
 */
router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        lastLogin: true,
        shopId: true,
        shop: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    res.json({
      success: true,
      data: users,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/v1/admin/users/:id
 * @desc    Get user details
 * @access  Super Admin Only
 */
router.get('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Validate UUID format
    if (!id || !/^[a-z0-9]+$/.test(id)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID format' });
    }

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        lastLogin: true,
        shopId: true,
        shop: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PUT /api/v1/admin/users/:id
 * @desc    Update user details
 * @access  Super Admin Only
 */
router.put('/users/:id', sensitiveRateLimiter, [
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('email').optional().isEmail().normalizeEmail(),
  body('role').optional().isIn(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF']),
  body('isActive').optional().custom(val => typeof val === 'boolean'),
], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    
    // Validate ID format
    if (!id || !/^[a-z0-9]+$/.test(id)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID format' });
    }

    const { name, email, role, isActive, shopId } = req.body;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check email uniqueness if changing
    if (email && email !== user.email) {
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ success: false, message: 'Email already in use' });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(email && { email }),
        ...(role && { role }),
        ...(isActive !== undefined && { isActive }),
        ...(shopId !== undefined && { shopId }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        lastLogin: true,
        shopId: true,
        shop: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    res.json({
      success: true,
      message: 'User updated successfully',
      data: updatedUser,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PUT /api/v1/admin/users/:id/reset-password
 * @desc    Reset user password (Admin sets new password)
 * @access  Super Admin Only
 */
router.put('/users/:id/reset-password', sensitiveRateLimiter, [
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and number'),
], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { id } = req.params;
    const { newPassword } = req.body;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(passwordConfig.bcryptRounds);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    await prisma.user.update({
      where: { id },
      data: { password: hashedPassword },
    });

    res.json({
      success: true,
      message: 'Password reset successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   DELETE /api/v1/admin/users/:id
 * @desc    Delete/Deactivate user
 * @access  Super Admin Only
 */
router.delete('/users/:id', sensitiveRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const authReq = req as AuthRequest;

    // Prevent self-deletion
    if (authReq.user?.id === id) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
    }

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Hard delete - remove from database
    await prisma.user.delete({
      where: { id },
    });

    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/v1/admin/users
 * @desc    Create a new user (for any shop)
 * @access  Super Admin Only
 */
router.post('/users', sensitiveRateLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
  body('name').trim().isLength({ min: 2, max: 100 }),
  body('role').isIn(['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF']),
  body('shopId').optional(),
], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const { email, password, name, role, shopId } = req.body;

    // Check if email exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email already in use' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(passwordConfig.bcryptRounds);
    const hashedPassword = await bcrypt.hash(password, salt);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role,
        shopId: shopId || null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        shopId: true,
        shop: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: user,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
