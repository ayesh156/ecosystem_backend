/**
 * Shop Admin Routes - Shop-level User Management
 * For ADMIN role users to manage users within their own shop
 * SUPER_ADMIN can also access by providing shopId query param
 * Based on OWASP security best practices
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
// Helper function to get effective shop ID
// For SUPER_ADMIN, allows override via query param
// For ADMIN, uses their own shop
// ===================================
const getEffectiveShopId = (req: Request): string | null => {
  const authReq = req as AuthRequest;
  const user = authReq.user;
  
  if (!user) return null;
  
  // SUPER_ADMIN can specify a shopId via query param
  if (user.role === 'SUPER_ADMIN') {
    const shopIdParam = req.query.shopId as string;
    if (shopIdParam) return shopIdParam;
    // SUPER_ADMIN without shopId param - they might have a shop too
    return user.shopId || null;
  }
  
  // ADMIN uses their own shop
  return user.shopId || null;
};

// ===================================
// Apply ADMIN/SUPER_ADMIN protection to ALL routes
// ===================================
router.use(protect, authorize('ADMIN', 'SUPER_ADMIN'));

// ===================================
// Shop User Management
// ===================================

/**
 * @route   GET /api/v1/shop-admin/users
 * @desc    Get all users in the current shop (or specified shop for SUPER_ADMIN)
 * @access  Shop Admin or SUPER_ADMIN
 */
router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shopId = getEffectiveShopId(req);

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop ID required (SUPER_ADMIN must provide shopId query param)' });
    }

    const users = await prisma.user.findMany({
      where: { shopId },
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
 * @route   GET /api/v1/shop-admin/users/:id
 * @desc    Get a specific user in the shop
 * @access  Shop Admin or SUPER_ADMIN
 */
router.get('/users/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shopId = getEffectiveShopId(req);
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop ID required' });
    }

    // Validate ID format
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
      },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Verify user belongs to the same shop
    if (user.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'User does not belong to your shop' });
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
 * @route   GET /api/v1/shop-admin/stats
 * @desc    Get shop statistics
 * @access  Shop Admin or SUPER_ADMIN
 */
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shopId = getEffectiveShopId(req);

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop ID required' });
    }

    const [totalUsers, activeUsers, shop] = await Promise.all([
      prisma.user.count({ where: { shopId } }),
      prisma.user.count({ where: { shopId, isActive: true } }),
      prisma.shop.findUnique({
        where: { id: shopId },
        select: {
          id: true,
          name: true,
          slug: true,
          _count: {
            select: {
              customers: true,
              products: true,
              invoices: true,
            },
          },
        },
      }),
    ]);

    res.json({
      success: true,
      data: {
        shop: shop ? {
          id: shop.id,
          name: shop.name,
          slug: shop.slug,
        } : null,
        totalUsers,
        activeUsers,
        inactiveUsers: totalUsers - activeUsers,
        totalCustomers: shop?._count.customers || 0,
        totalProducts: shop?._count.products || 0,
        totalInvoices: shop?._count.invoices || 0,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   POST /api/v1/shop-admin/users
 * @desc    Create a new user in the shop (MANAGER or STAFF only)
 * @access  Shop Admin or SUPER_ADMIN
 */
router.post('/users', sensitiveRateLimiter, [
  body('email').isEmail().normalizeEmail(),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and number'),
  body('name').trim().isLength({ min: 2, max: 100 }),
  body('role').isIn(['ADMIN', 'MANAGER', 'STAFF']).withMessage('Invalid role'),
], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const authReq = req as AuthRequest;
    const isSuperAdmin = authReq.user?.role === 'SUPER_ADMIN';
    
    // For SUPER_ADMIN, allow shopId in body; for ADMIN, use their own shop
    let shopId: string | null;
    if (isSuperAdmin && req.body.shopId) {
      shopId = req.body.shopId;
    } else {
      shopId = getEffectiveShopId(req);
    }

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop ID required' });
    }

    const { email, password, name, role } = req.body;

    // SECURITY: Only SUPER_ADMIN can create ADMIN users; regular shop admins can only create MANAGER or STAFF
    if (role === 'ADMIN' && !isSuperAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: 'Only Super Admin can create ADMIN users' 
      });
    }

    // SECURITY: Nobody can create SUPER_ADMIN users via this endpoint
    if (role === 'SUPER_ADMIN') {
      return res.status(403).json({ 
        success: false, 
        message: 'Cannot create SUPER_ADMIN users' 
      });
    }

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
        shopId, // Force to current shop
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
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

/**
 * @route   PUT /api/v1/shop-admin/users/:id
 * @desc    Update user details (within shop only)
 * @access  Shop Admin or SUPER_ADMIN
 */
router.put('/users/:id', sensitiveRateLimiter, [
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('email').optional().isEmail().normalizeEmail(),
  body('role').optional().isIn(['ADMIN', 'MANAGER', 'STAFF']),  // Accept ADMIN for validation, but won't update it
  body('isActive').optional().custom(val => typeof val === 'boolean'),
], async (req: Request, res: Response, next: NextFunction) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(req);
    const currentUserId = authReq.user?.id;
    const isSuperAdmin = authReq.user?.role === 'SUPER_ADMIN';
    const { id } = req.params;

    // Validate ID format
    if (!id || !/^[a-z0-9]+$/.test(id)) {
      return res.status(400).json({ success: false, message: 'Invalid user ID format' });
    }

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop ID required' });
    }

    // SECURITY: Find user and verify they belong to the same shop
    const user = await prisma.user.findUnique({ where: { id } });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'User does not belong to the specified shop' });
    }

    // SECURITY: Cannot modify SUPER_ADMIN users from any shop
    if (user.role === 'SUPER_ADMIN') {
      return res.status(403).json({ 
        success: false, 
        message: 'Cannot modify SUPER_ADMIN users' 
      });
    }

    const { name, email, role, isActive } = req.body;

    // Determine if editing own account
    const isOwnAccount = user.id === currentUserId;

    // SECURITY: Prevent unauthorized role changes
    if (role && role !== user.role) {
      // Nobody can elevate to SUPER_ADMIN
      if (role === 'SUPER_ADMIN') {
        return res.status(403).json({ 
          success: false, 
          message: 'Cannot elevate user to SUPER_ADMIN' 
        });
      }
      
      // Only SUPER_ADMIN can change role to/from ADMIN
      if ((role === 'ADMIN' || user.role === 'ADMIN') && !isSuperAdmin) {
        return res.status(403).json({ 
          success: false, 
          message: 'Only Super Admin can modify ADMIN role' 
        });
      }
    }

    // Check email uniqueness if changing
    if (email && email !== user.email) {
      const existingUser = await prisma.user.findUnique({ where: { email } });
      if (existingUser) {
        return res.status(400).json({ success: false, message: 'Email already in use' });
      }
    }

    // SUPER_ADMIN can modify any user's role/status; ADMIN cannot modify other ADMINs
    const canModifyRoleStatus = isSuperAdmin || (user.role !== 'ADMIN' && !isOwnAccount);

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(email && { email }),
        // Only update role/status if allowed
        ...(role && canModifyRoleStatus && { role }),
        ...(isActive !== undefined && canModifyRoleStatus && { isActive }),
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
 * @route   PUT /api/v1/shop-admin/users/:id/reset-password
 * @desc    Reset user password (within shop only)
 * @access  Shop Admin or SUPER_ADMIN
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

    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(req);
    const currentUserId = authReq.user?.id;
    const isSuperAdmin = authReq.user?.role === 'SUPER_ADMIN';
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop ID required' });
    }

    // SECURITY: Find user and verify they belong to the same shop
    const user = await prisma.user.findUnique({ where: { id } });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'User does not belong to the specified shop' });
    }

    // SECURITY: Cannot reset SUPER_ADMIN passwords
    if (user.role === 'SUPER_ADMIN') {
      return res.status(403).json({ 
        success: false, 
        message: 'Cannot reset SUPER_ADMIN passwords' 
      });
    }

    // Allow ADMIN to reset their own password
    const isOwnAccount = user.id === currentUserId;

    // SECURITY: If resetting other ADMIN's password (not own), only SUPER_ADMIN can do it
    if (user.role === 'ADMIN' && !isOwnAccount && !isSuperAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: 'Cannot reset other ADMIN passwords' 
      });
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
 * @route   DELETE /api/v1/shop-admin/users/:id
 * @desc    Deactivate user (within shop only)
 * @access  Shop Admin or SUPER_ADMIN
 */
router.delete('/users/:id', sensitiveRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(req);
    const currentUserId = authReq.user?.id;
    const isSuperAdmin = authReq.user?.role === 'SUPER_ADMIN';
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop ID required' });
    }

    // SECURITY: Prevent self-deletion
    if (currentUserId === id) {
      return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
    }

    // SECURITY: Find user and verify they belong to the same shop
    const user = await prisma.user.findUnique({ where: { id } });
    
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'User does not belong to the specified shop' });
    }

    // SECURITY: Cannot delete SUPER_ADMIN users
    if (user.role === 'SUPER_ADMIN') {
      return res.status(403).json({ 
        success: false, 
        message: 'Cannot delete SUPER_ADMIN users' 
      });
    }

    // SECURITY: Only SUPER_ADMIN can delete ADMIN users
    if (user.role === 'ADMIN' && !isSuperAdmin) {
      return res.status(403).json({ 
        success: false, 
        message: 'Cannot delete ADMIN users' 
      });
    }

    // Soft delete - deactivate
    await prisma.user.update({
      where: { id },
      data: { isActive: false },
    });

    res.json({
      success: true,
      message: 'User deactivated successfully',
    });
  } catch (error) {
    next(error);
  }
});

// ===================================
// WhatsApp Settings Management
// ===================================

// Creative Default Templates with Sri Lankan context
const DEFAULT_PAYMENT_REMINDER_TEMPLATE = `Hello {{customerName}}! 👋

Greetings from *{{shopName}}*!

This is a friendly reminder about your pending payment:

📄 *Invoice:* #{{invoiceId}}
💰 *Total Amount:* Rs. {{totalAmount}}
✅ *Paid:* Rs. {{paidAmount}}
⏳ *Balance Due:* Rs. {{dueAmount}}
📅 *Due Date:* {{dueDate}}

We kindly request you to settle your outstanding balance at your earliest convenience.

If you've already made the payment, please disregard this message.

Thank you for your continued trust! 🙏

*{{shopName}}*
📞 {{shopPhone}}
📍 {{shopAddress}}
🌐 {{shopWebsite}}`;

const DEFAULT_OVERDUE_REMINDER_TEMPLATE = `⚠️ *URGENT: Payment Overdue Notice*

Dear {{customerName}},

We regret to inform you that your payment is now *OVERDUE*.

📄 *Invoice:* #{{invoiceId}}
📅 *Original Due Date:* {{dueDate}}
⏰ *Days Overdue:* {{daysOverdue}} days
💰 *Outstanding Amount:* Rs. {{dueAmount}}

*Immediate action is required.* Please settle this payment as soon as possible to avoid any inconvenience.

For payment assistance or queries, please contact us immediately.

We value your business and appreciate your prompt attention to this matter.

Best regards,
*{{shopName}}*
📞 {{shopPhone}}
📍 {{shopAddress}}
🌐 {{shopWebsite}}`;

// GRN/Supplier Reminder Templates
const DEFAULT_GRN_PAYMENT_REMINDER_TEMPLATE = `Hello! 👋

Greetings from *{{shopName}}*!

This is a friendly notification regarding your GRN payment:

📄 *GRN Number:* #{{grnNumber}}
🏢 *Supplier:* {{supplierName}}
💰 *Total Amount:* Rs. {{totalAmount}}
✅ *Paid:* Rs. {{paidAmount}}
⏳ *Balance Due:* Rs. {{balanceDue}}
📅 *GRN Date:* {{grnDate}}

We will process the remaining payment as per our agreement.

For any queries, please contact us.

Thank you for your partnership! 🙏

*{{shopName}}*
📞 {{shopPhone}}
📍 {{shopAddress}}`;

const DEFAULT_GRN_OVERDUE_REMINDER_TEMPLATE = `📋 *GRN Payment Reminder*

Dear {{supplierName}},

This is a reminder regarding the pending payment for:

📄 *GRN Number:* #{{grnNumber}}
📅 *GRN Date:* {{grnDate}}
💰 *Total Amount:* Rs. {{totalAmount}}
⏳ *Balance Due:* Rs. {{balanceDue}}

We are processing your payment and will update you soon.

For any queries, please contact us.

Best regards,
*{{shopName}}*
📞 {{shopPhone}}
📍 {{shopAddress}}`;

// Supplier Order Template (for placing new orders via WhatsApp)
const DEFAULT_SUPPLIER_ORDER_TEMPLATE = `🛒 *NEW ORDER REQUEST*
━━━━━━━━━━━━━━━━━━━━━

Hello {{supplierName}}! 👋

This is *{{shopName}}* reaching out for a new order.

📅 *Date:* {{orderDate}}
🏢 *Supplier:* {{supplierCompany}}

━━━━━━━━━━━━━━━━━━━━━
📦 *ORDER DETAILS:*
━━━━━━━━━━━━━━━━━━━━━

Please share your:
✅ Latest product catalog
✅ Current stock availability
✅ Best pricing for bulk orders
✅ Expected delivery timeline

━━━━━━━━━━━━━━━━━━━━━

We look forward to doing business with you! 🤝

_Sent via {{shopName}} POS System_
🌟 *Quality Products, Quality Service*
📞 {{shopPhone}}
📍 {{shopAddress}}`;

/**
 * @route   GET /api/v1/shop-admin/whatsapp-settings
 * @desc    Get WhatsApp settings for the shop
 * @access  Shop Admin or SUPER_ADMIN
 */
router.get('/whatsapp-settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shopId = getEffectiveShopId(req);

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop ID required' });
    }

    const shop = await prisma.shop.findUnique({
      where: { id: shopId },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        address: true,
        reminderEnabled: true,
        paymentReminderTemplate: true,
        overdueReminderTemplate: true,
        grnReminderEnabled: true,
        grnPaymentReminderTemplate: true,
        grnOverdueReminderTemplate: true,
        supplierOrderTemplate: true,
      },
    });

    if (!shop) {
      return res.status(404).json({ success: false, message: 'Shop not found' });
    }

    // Return saved templates or creative defaults if null/empty
    res.json({
      success: true,
      data: {
        enabled: shop.reminderEnabled ?? true,
        paymentReminderTemplate: shop.paymentReminderTemplate || DEFAULT_PAYMENT_REMINDER_TEMPLATE,
        overdueReminderTemplate: shop.overdueReminderTemplate || DEFAULT_OVERDUE_REMINDER_TEMPLATE,
        grnReminderEnabled: shop.grnReminderEnabled ?? true,
        grnPaymentReminderTemplate: shop.grnPaymentReminderTemplate || DEFAULT_GRN_PAYMENT_REMINDER_TEMPLATE,
        grnOverdueReminderTemplate: shop.grnOverdueReminderTemplate || DEFAULT_GRN_OVERDUE_REMINDER_TEMPLATE,
        supplierOrderTemplate: shop.supplierOrderTemplate || DEFAULT_SUPPLIER_ORDER_TEMPLATE,
        shopDetails: {
          name: shop.name || '',
          phone: shop.phone || '',
          email: shop.email || '',
          address: shop.address || '',
        },
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @route   PUT /api/v1/shop-admin/whatsapp-settings
 * @desc    Update WhatsApp settings for the shop
 * @access  Shop Admin or SUPER_ADMIN
 */
router.put('/whatsapp-settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const shopId = getEffectiveShopId(req);

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop ID required' });
    }

    const { 
      enabled, paymentReminderTemplate, overdueReminderTemplate,
      grnReminderEnabled, grnPaymentReminderTemplate, grnOverdueReminderTemplate,
      supplierOrderTemplate
    } = req.body;

    const updatedShop = await prisma.shop.update({
      where: { id: shopId },
      data: {
        ...(enabled !== undefined && { reminderEnabled: enabled }),
        ...(paymentReminderTemplate !== undefined && { paymentReminderTemplate }),
        ...(overdueReminderTemplate !== undefined && { overdueReminderTemplate }),
        ...(grnReminderEnabled !== undefined && { grnReminderEnabled }),
        ...(grnPaymentReminderTemplate !== undefined && { grnPaymentReminderTemplate }),
        ...(grnOverdueReminderTemplate !== undefined && { grnOverdueReminderTemplate }),
        ...(supplierOrderTemplate !== undefined && { supplierOrderTemplate }),
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        address: true,
        reminderEnabled: true,
        paymentReminderTemplate: true,
        overdueReminderTemplate: true,
        grnReminderEnabled: true,
        grnPaymentReminderTemplate: true,
        grnOverdueReminderTemplate: true,
        supplierOrderTemplate: true,
      },
    });

    res.json({
      success: true,
      data: {
        enabled: updatedShop.reminderEnabled,
        paymentReminderTemplate: updatedShop.paymentReminderTemplate || '',
        overdueReminderTemplate: updatedShop.overdueReminderTemplate || '',
        grnReminderEnabled: updatedShop.grnReminderEnabled,
        grnPaymentReminderTemplate: updatedShop.grnPaymentReminderTemplate || '',
        grnOverdueReminderTemplate: updatedShop.grnOverdueReminderTemplate || '',
        supplierOrderTemplate: updatedShop.supplierOrderTemplate || '',
        shopDetails: {
          name: updatedShop.name || '',
          phone: updatedShop.phone || '',
          email: updatedShop.email || '',
          address: updatedShop.address || '',
        },
      },
      message: 'WhatsApp settings updated successfully',
    });
  } catch (error) {
    next(error);
  }
});

export default router;