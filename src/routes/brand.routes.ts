/**
 * Brand Routes - World-Class CRUD Operations
 * Brand management for product organization
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

// 🔒 All brand routes require authentication and shop
router.use(protect, requireShop);

// Validation middleware for brand
const validateBrand = [
  body('name')
    .notEmpty()
    .withMessage('Brand name is required')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Brand name must be 2-100 characters'),
  body('description')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description must not exceed 500 characters'),
  body('image')
    .optional({ values: 'falsy' })
    .isString()
    .withMessage('Image must be a string (URL or base64)'),
  body('website')
    .optional({ values: 'falsy' })
    .trim()
    .isURL({ require_protocol: false })
    .withMessage('Website must be a valid URL'),
  body('contactEmail')
    .optional({ values: 'falsy' })
    .trim()
    .isEmail()
    .withMessage('Contact email must be valid'),
  body('contactPhone')
    .optional({ values: 'falsy' })
    .trim()
    .isLength({ min: 8, max: 20 })
    .withMessage('Contact phone must be 8-20 characters'),
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
// GET /brands/suggestions - Get global brand suggestions
// Returns unique brand names from ALL shops for suggestions when creating
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

    // Get all unique brand names from all shops (for suggestions)
    const allBrands = await prisma.brand.findMany({
      where,
      select: {
        name: true,
        description: true,
        image: true,
        website: true,
        contactEmail: true,
        contactPhone: true,
        shopId: true,
      },
      distinct: ['name'],
      orderBy: { name: 'asc' },
      take: 20,
    });

    // Filter out brands that already exist in the user's shop
    const existingInShop = await prisma.brand.findMany({
      where: { shopId },
      select: { name: true },
    });
    const existingNames = new Set(existingInShop.map(b => b.name.toLowerCase()));

    // Return suggestions with flag indicating if exists in user's shop
    const suggestions = allBrands.map(brand => ({
      name: brand.name,
      description: brand.description,
      image: brand.image,
      website: brand.website,
      contactEmail: brand.contactEmail,
      contactPhone: brand.contactPhone,
      existsInYourShop: existingNames.has(brand.name.toLowerCase()),
      isFromOtherShop: brand.shopId !== shopId,
    }));

    res.json({ success: true, data: suggestions });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// GET /brands - List all brands
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

    const [brands, total] = await Promise.all([
      prisma.brand.findMany({
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
      prisma.brand.count({ where }),
    ]);
    
    res.json({
      success: true,
      data: brands,
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
// GET /brands/:id - Get single brand
// ==========================================
router.get('/:id', async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(authReq);
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const brand = await prisma.brand.findUnique({
      where: { id },
      include: {
        _count: {
          select: { products: true }
        }
      }
    });
    
    if (!brand) {
      return res.status(404).json({ success: false, message: 'Brand not found' });
    }
    
    if (brand.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Brand does not belong to your shop' });
    }
    
    res.json({ success: true, data: brand });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// POST /brands - Create new brand
// ==========================================
router.post('/', sensitiveRateLimiter, validateBrand, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = authReq.user?.shopId;
    
    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const { name, description, image, website, contactEmail, contactPhone, isActive } = req.body;

    // Check for duplicate name in same shop
    const existing = await prisma.brand.findFirst({
      where: { shopId, name: { equals: name } }
    });
    if (existing) {
      return res.status(409).json({ 
        success: false, 
        message: 'A brand with this name already exists' 
      });
    }

    const brand = await prisma.brand.create({
      data: {
        name,
        description,
        image,
        website,
        contactEmail,
        contactPhone,
        isActive: isActive !== undefined ? isActive : true,
        shopId,
      },
      include: {
        _count: {
          select: { products: true }
        }
      }
    });
    
    res.status(201).json({ success: true, data: brand });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// PUT /brands/:id - Update brand
// ==========================================
router.put('/:id', validateBrand, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = authReq.user?.shopId;
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const existing = await prisma.brand.findUnique({ where: { id } });
    
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Brand not found' });
    }
    
    if (existing.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Brand does not belong to your shop' });
    }

    const { name, description, image, website, contactEmail, contactPhone, isActive } = req.body;

    // Check for duplicate name (excluding current brand)
    if (name && name.toLowerCase() !== existing.name.toLowerCase()) {
      const duplicate = await prisma.brand.findFirst({
        where: { shopId, name: { equals: name }, NOT: { id } }
      });
      if (duplicate) {
        return res.status(409).json({ 
          success: false, 
          message: 'A brand with this name already exists' 
        });
      }
    }

    const brand = await prisma.brand.update({
      where: { id },
      data: { name, description, image, website, contactEmail, contactPhone, ...(isActive !== undefined && { isActive }) },
      include: {
        _count: {
          select: { products: true }
        }
      }
    });
    
    res.json({ success: true, data: brand });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// DELETE /brands/:id - Delete brand (Admin only)
// ==========================================
router.delete('/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = authReq.user?.shopId;
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const existing = await prisma.brand.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } }
    });
    
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Brand not found' });
    }
    
    if (existing.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Brand does not belong to your shop' });
    }

    // Check if brand has products
    if (existing._count.products > 0) {
      return res.status(409).json({ 
        success: false, 
        message: `Cannot delete brand with ${existing._count.products} products. Reassign products first.` 
      });
    }

    await prisma.brand.delete({ where: { id } });
    
    res.json({ success: true, message: 'Brand deleted successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
