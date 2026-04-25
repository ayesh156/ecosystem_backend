/**
 * Category Routes - World-Class CRUD Operations
 * Category management for product organization
 * 
 * Features:
 * - Full CRUD with shop isolation (multi-tenant)
 * - Search and pagination
 * - Product count tracking
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { protect, requireShop, authorize } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { body } from 'express-validator';
import { handleValidationErrors } from '../middleware/validation';
import { sensitiveRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// 🔒 All category routes require authentication and shop
router.use(protect, requireShop);

// Validation middleware for category
const validateCategory = [
  body('name')
    .notEmpty()
    .withMessage('Category name is required')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Category name must be 2-100 characters'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description must not exceed 500 characters'),
  body('image')
    .optional()
    .isString()
    .withMessage('Image must be a string (URL or base64)'),
  handleValidationErrors,
];

// Helper function to get effective shopId for SuperAdmin shop viewing
const getEffectiveShopId = (authReq: AuthRequest): string | null => {
  const { shopId: queryShopId } = authReq.query;
  const userRole = authReq.user?.role;
  const userShopId = authReq.user?.shopId;
  
  // SuperAdmin can view any shop by passing shopId query parameter
  if (userRole === 'SUPER_ADMIN' && queryShopId && typeof queryShopId === 'string') {
    return queryShopId;
  }
  
  return userShopId || null;
};

// ==========================================
// GET /categories/suggestions - Get global category suggestions
// Returns unique category names from ALL shops for suggestions when creating
// ==========================================
router.get('/suggestions', async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = authReq.user?.shopId;
    const { search } = req.query;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // Build where clause for search
    const where: any = {};
    if (search && typeof search === 'string') {
      where.name = { contains: search, mode: 'insensitive' };
    }

    // Get all unique category names from all shops (for suggestions)
    const allCategories = await prisma.category.findMany({
      where,
      select: {
        name: true,
        description: true,
        image: true,
        shopId: true,
      },
      distinct: ['name'],
      orderBy: { name: 'asc' },
      take: 20,
    });

    // Filter out categories that already exist in the user's shop
    const existingInShop = await prisma.category.findMany({
      where: { shopId },
      select: { name: true },
    });
    const existingNames = new Set(existingInShop.map(c => c.name.toLowerCase()));

    // Return suggestions with flag indicating if exists in user's shop
    const suggestions = allCategories.map(cat => ({
      name: cat.name,
      description: cat.description,
      image: cat.image,
      existsInYourShop: existingNames.has(cat.name.toLowerCase()),
      isFromOtherShop: cat.shopId !== shopId,
    }));

    res.json({ success: true, data: suggestions });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// GET /categories - List all categories
// ==========================================
router.get('/', async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(authReq);
    
    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const { search, page = '1', limit = '50' } = req.query;

    // Build where clause
    const where: any = { shopId };

    // Search filter
    if (search && typeof search === 'string') {
      where.name = { contains: search, mode: 'insensitive' };
    }

    // Pagination
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [categories, total] = await Promise.all([
      prisma.category.findMany({
        where,
        orderBy: { name: 'asc' },
        skip,
        take: limitNum,
        include: {
          _count: {
            select: { products: true }
          }
        }
      }),
      prisma.category.count({ where }),
    ]);
    
    res.json({
      success: true,
      data: categories,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// GET /categories/:id - Get single category
// ==========================================
router.get('/:id', async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(authReq);
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const category = await prisma.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: { products: true }
        }
      }
    });
    
    if (!category) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    
    if (category.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Category does not belong to your shop' });
    }
    
    res.json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// POST /categories - Create new category
// ==========================================
router.post('/', sensitiveRateLimiter, validateCategory, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = authReq.user?.shopId;
    
    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const { name, description, image, isActive } = req.body;

    // Check for duplicate name in same shop
    const existing = await prisma.category.findFirst({
      where: { shopId, name: { equals: name } }
    });
    if (existing) {
      return res.status(409).json({ 
        success: false, 
        message: 'A category with this name already exists' 
      });
    }

    const category = await prisma.category.create({
      data: {
        name,
        description,
        image,
        isActive: isActive !== undefined ? isActive : true,
        shopId,
      },
      include: {
        _count: {
          select: { products: true }
        }
      }
    });
    
    res.status(201).json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// PUT /categories/:id - Update category
// ==========================================
router.put('/:id', validateCategory, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = authReq.user?.shopId;
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const existing = await prisma.category.findUnique({ where: { id } });
    
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    
    if (existing.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Category does not belong to your shop' });
    }

    const { name, description, image, isActive } = req.body;

    // Check for duplicate name (excluding current category)
    if (name && name.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await prisma.category.findFirst({
        where: { shopId, name: { equals: name }, NOT: { id } }
      });
      if (duplicate) {
        return res.status(409).json({ 
          success: false, 
          message: 'A category with this name already exists' 
        });
      }
    }

    const category = await prisma.category.update({
      where: { id },
      data: { name, description, image, ...(isActive !== undefined && { isActive }) },
      include: {
        _count: {
          select: { products: true }
        }
      }
    });
    
    res.json({ success: true, data: category });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// DELETE /categories/:id - Delete category (Admin only)
// ==========================================
router.delete('/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = authReq.user?.shopId;
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const existing = await prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } }
    });
    
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Category not found' });
    }
    
    if (existing.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Category does not belong to your shop' });
    }

    // Check if category has products
    if (existing._count.products > 0) {
      return res.status(409).json({ 
        success: false, 
        message: `Cannot delete category with ${existing._count.products} products. Reassign products first.` 
      });
    }

    await prisma.category.delete({ where: { id } });
    
    res.json({ success: true, message: 'Category deleted successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
