/**
 * Product Routes - World-Class CRUD Operations
 * Comprehensive product management for Sri Lankan computer/mobile shops
 * 
 * Features:
 * - Full CRUD with shop isolation (multi-tenant)
 * - Stock management with movement tracking
 * - Price history tracking
 * - IMEI/Serial number tracking for electronics
 * - Barcode support
 * - Search, filter, and pagination
 * - Low stock alerts
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { protect, requireShop, authorize } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { validateProduct } from '../middleware/validation';
import { sensitiveRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// 🔒 All product routes require authentication and shop
router.use(protect, requireShop);

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
// GET /products - List all products with filters
// ==========================================
router.get('/', async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(authReq);
    
    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // Extract query parameters for filtering and pagination
    const {
      search,
      categoryId,
      brandId,
      lowStock,
      minPrice,
      maxPrice,
      page = '1',
      limit = '50',
      sortBy = 'name',
      sortOrder = 'asc'
    } = req.query;

    // Build where clause
    const where: any = { shopId };

    // Search filter - name, serial number, barcode, description
    if (search && typeof search === 'string') {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { serialNumber: { contains: search, mode: 'insensitive' } },
        { barcode: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Category filter
    if (categoryId && typeof categoryId === 'string') {
      where.categoryId = categoryId;
    }

    // Brand filter
    if (brandId && typeof brandId === 'string') {
      where.brandId = brandId;
    }

    // Low stock filter - products with stock <= lowStockThreshold
    if (lowStock === 'true') {
      // Raw SQL needed for comparing columns, using workaround
      where.stock = { lte: prisma.product.fields.lowStockThreshold };
    }

    // Price range filter
    if (minPrice && typeof minPrice === 'string') {
      where.price = { ...where.price, gte: parseFloat(minPrice) };
    }
    if (maxPrice && typeof maxPrice === 'string') {
      where.price = { ...where.price, lte: parseFloat(maxPrice) };
    }

    // Pagination
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 50));
    const skip = (pageNum - 1) * limitNum;

    // Sorting
    const validSortFields = ['name', 'price', 'stock', 'createdAt', 'updatedAt'];
    const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'name';
    const order = sortOrder === 'desc' ? 'desc' : 'asc';

    // Execute query with count
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        orderBy: { [sortField as string]: order },
        skip,
        take: limitNum,
        include: { 
          category: true, 
          brand: true,
          _count: {
            select: { invoiceItems: true, stockMovements: true }
          }
        },
      }),
      prisma.product.count({ where })
    ]);

    // Return with pagination info
    res.json({
      success: true,
      data: products,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// GET /products/stats - Product statistics
// ==========================================
router.get('/stats', async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(authReq);
    
    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // Get all products for this shop to calculate stats
    const products = await prisma.product.findMany({
      where: { shopId },
      select: {
        stock: true,
        lowStockThreshold: true,
        price: true,
        costPrice: true
      }
    });

    const totalProducts = products.length;
    const lowStockCount = products.filter(p => p.stock <= p.lowStockThreshold).length;
    const outOfStockCount = products.filter(p => p.stock === 0).length;
    const totalStockValue = products.reduce((sum, p) => sum + (p.stock * p.price), 0);
    const totalCostValue = products.reduce((sum, p) => sum + (p.stock * (p.costPrice || 0)), 0);
    const totalStock = products.reduce((sum, p) => sum + p.stock, 0);

    res.json({
      success: true,
      data: {
        totalProducts,
        lowStockCount,
        outOfStockCount,
        inStockCount: totalProducts - outOfStockCount,
        totalStock,
        totalStockValue,
        totalCostValue,
        potentialProfit: totalStockValue - totalCostValue
      }
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// GET /products/low-stock - Get low stock products
// ==========================================
router.get('/low-stock', async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(authReq);
    
    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // Get products where stock <= lowStockThreshold
    const products = await prisma.product.findMany({
      where: { shopId },
      include: { category: true, brand: true },
      orderBy: { stock: 'asc' }
    });

    // Filter low stock products (comparing stock with lowStockThreshold)
    const lowStockProducts = products.filter(p => p.stock <= p.lowStockThreshold);

    res.json({ success: true, data: lowStockProducts });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// GET /products/suggestions - Get global product suggestions
// Returns unique product names from ALL shops for suggestions when creating
// This helps avoid duplicate products and reuse existing product info
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

    // Get all unique products from all shops (for suggestions)
    // Include full brand/category details for auto-creation in new shop
    const allProducts = await prisma.product.findMany({
      where,
      select: {
        name: true,
        description: true,
        price: true,
        costPrice: true,
        image: true,
        warranty: true,
        shopId: true,
        category: { 
          select: { 
            id: true, 
            name: true,
            description: true,
            image: true,
          } 
        },
        brand: { 
          select: { 
            id: true, 
            name: true,
            description: true,
            image: true,
            website: true,
            contactEmail: true,
            contactPhone: true,
          } 
        },
      },
      distinct: ['name'],
      orderBy: { name: 'asc' },
      take: 15,
    });

    // Check which products already exist in the user's shop
    const existingInShop = await prisma.product.findMany({
      where: { shopId },
      select: { name: true },
    });
    const existingNames = new Set(existingInShop.map(p => p.name.toLowerCase()));

    // Return suggestions with flag indicating if exists in user's shop
    // Include full brand/category objects for auto-creation
    const suggestions = allProducts.map(product => ({
      name: product.name,
      description: product.description,
      price: product.price,
      costPrice: product.costPrice,
      image: product.image,
      warranty: product.warranty,
      categoryId: product.category?.id,
      categoryName: product.category?.name,
      brandId: product.brand?.id,
      brandName: product.brand?.name,
      existsInYourShop: existingNames.has(product.name.toLowerCase()),
      isFromOtherShop: product.shopId !== shopId,
      // Full brand/category objects for creating in new shop
      brand: product.brand ? {
        name: product.brand.name,
        description: product.brand.description,
        image: product.brand.image,
        website: product.brand.website,
        contactEmail: product.brand.contactEmail,
        contactPhone: product.brand.contactPhone,
      } : undefined,
      category: product.category ? {
        name: product.category.name,
        description: product.category.description,
        image: product.category.image,
      } : undefined,
    }));

    res.json({ success: true, data: suggestions });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// GET /products/:id - Get single product
// ==========================================
router.get('/:id', async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(authReq);
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const product = await prisma.product.findUnique({
      where: { id },
      include: { 
        category: true, 
        brand: true,
        stockMovements: {
          orderBy: { createdAt: 'desc' },
          take: 20
        },
        priceHistory: {
          orderBy: { createdAt: 'desc' },
          take: 10
        },
        _count: {
          select: { invoiceItems: true, stockMovements: true }
        }
      },
    });
    
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    
    // Validate product belongs to user's shop
    if (product.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Product does not belong to your shop' });
    }
    
    res.json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// GET /products/:id/stock-movements - Get stock history
// ==========================================
router.get('/:id/stock-movements', async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(authReq);
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // Verify ownership
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    if (product.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const movements = await prisma.stockMovement.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: movements });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// GET /products/:id/price-history - Get price history
// ==========================================
router.get('/:id/price-history', async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(authReq);
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // Verify ownership
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    if (product.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const history = await prisma.priceHistory.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ success: true, data: history });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// GET /products/:id/sales-history - Get sales history (invoices containing this product)
// ==========================================
router.get('/:id/sales-history', async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(authReq);
    const { id } = req.params;
    const { page = '1', limit = '20' } = req.query;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // Verify product ownership
    const product = await prisma.product.findUnique({ where: { id } });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    if (product.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Pagination
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Get invoice items for this product with invoice details
    const [invoiceItems, total] = await Promise.all([
      prisma.invoiceItem.findMany({
        where: { productId: id },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
        include: {
          invoice: {
            select: {
              id: true,
              invoiceNumber: true,
              customerName: true,
              date: true,
              status: true,
              total: true,
              paidAmount: true,
            }
          }
        }
      }),
      prisma.invoiceItem.count({ where: { productId: id } })
    ]);

    // Calculate sales statistics
    const allSales = await prisma.invoiceItem.aggregate({
      where: { productId: id },
      _sum: { quantity: true, total: true },
      _avg: { unitPrice: true },
      _count: { id: true }
    });

    const salesStats = {
      totalUnitsSold: allSales._sum.quantity || 0,
      totalRevenue: allSales._sum.total || 0,
      averageSellingPrice: allSales._avg.unitPrice || 0,
      totalTransactions: allSales._count.id || 0
    };

    res.json({
      success: true,
      data: invoiceItems,
      stats: salesStats,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// POST /products - Create new product
// ==========================================
router.post('/', sensitiveRateLimiter, validateProduct, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(authReq);
    const userId = authReq.user?.id;
    
    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // Prevent shopId override from request body
    const { shopId: _, id: __, ...safeData } = req.body;

    // Check for duplicate barcode in same shop
    if (safeData.barcode) {
      const existingBarcode = await prisma.product.findFirst({
        where: { shopId, barcode: safeData.barcode }
      });
      if (existingBarcode) {
        return res.status(409).json({ 
          success: false, 
          message: 'A product with this barcode already exists' 
        });
      }
    }

    // Calculate profit margin if both prices provided
    let profitMargin: number | null = null;
    if (safeData.price && safeData.costPrice && safeData.costPrice > 0) {
      profitMargin = ((safeData.price - safeData.costPrice) / safeData.costPrice) * 100;
    }

    const product = await prisma.product.create({
      data: {
        ...safeData,
        shopId,
        profitMargin,
        // Set defaults
        stock: safeData.stock || 0,
        reservedStock: 0,
        lowStockThreshold: safeData.lowStockThreshold || 10,
        totalPurchased: 0,
        totalSold: 0,
      },
      include: { category: true, brand: true },
    });

    // Create initial stock movement if stock > 0
    if (product.stock > 0) {
      await prisma.stockMovement.create({
        data: {
          productId: product.id,
          type: 'ADJUSTMENT',
          quantity: product.stock,
          previousStock: 0,
          newStock: product.stock,
          notes: 'Initial stock on product creation',
          createdBy: userId,
          shopId,
        }
      });
    }
    
    res.status(201).json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// PUT /products/:id - Update product
// ==========================================
router.put('/:id', validateProduct, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(authReq);
    const userId = authReq.user?.id;
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // First check if product belongs to user's shop
    const existing = await prisma.product.findUnique({
      where: { id },
    });
    
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    
    if (existing.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Product does not belong to the specified shop' });
    }

    // Prevent shopId tampering
    const { shopId: _, id: __, ...safeData } = req.body;

    // Check for duplicate barcode (excluding current product)
    if (safeData.barcode && safeData.barcode !== existing.barcode) {
      const existingBarcode = await prisma.product.findFirst({
        where: { shopId, barcode: safeData.barcode, NOT: { id } }
      });
      if (existingBarcode) {
        return res.status(409).json({ 
          success: false, 
          message: 'A product with this barcode already exists' 
        });
      }
    }

    // Track price changes
    const priceChanged = safeData.price !== undefined && safeData.price !== existing.price;
    const costChanged = safeData.costPrice !== undefined && safeData.costPrice !== existing.costPrice;

    // Calculate new profit margin
    let profitMargin = existing.profitMargin;
    const newPrice = safeData.price ?? existing.price;
    const newCost = safeData.costPrice ?? existing.costPrice;
    if (newPrice && newCost && newCost > 0) {
      profitMargin = ((newPrice - newCost) / newCost) * 100;
    }

    // Store last cost price if cost changed
    if (costChanged && existing.costPrice) {
      safeData.lastCostPrice = existing.costPrice;
    }

    const product = await prisma.product.update({
      where: { id },
      data: {
        ...safeData,
        profitMargin,
      },
      include: { category: true, brand: true },
    });

    // Create price history record if prices changed
    if (priceChanged || costChanged) {
      let changeType: 'COST_UPDATE' | 'SELLING_UPDATE' | 'BOTH' = 'BOTH';
      if (priceChanged && !costChanged) changeType = 'SELLING_UPDATE';
      if (costChanged && !priceChanged) changeType = 'COST_UPDATE';

      await prisma.priceHistory.create({
        data: {
          productId: id,
          changeType,
          previousCostPrice: existing.costPrice,
          newCostPrice: costChanged ? safeData.costPrice : undefined,
          previousSellingPrice: existing.price,
          newSellingPrice: priceChanged ? safeData.price : undefined,
          reason: 'manual_adjustment',
          createdBy: userId,
          shopId,
        }
      });
    }
    
    res.json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// PATCH /products/:id/stock - Adjust stock
// ==========================================
router.patch('/:id/stock', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(authReq);
    const userId = authReq.user?.id;
    const { id } = req.params;
    const { quantity, operation, type, notes, referenceId, referenceNumber } = req.body;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // Validate input
    if (typeof quantity !== 'number' || quantity <= 0) {
      return res.status(400).json({ success: false, message: 'Quantity must be a positive number' });
    }

    if (!['add', 'subtract', 'set'].includes(operation)) {
      return res.status(400).json({ success: false, message: 'Operation must be add, subtract, or set' });
    }

    // Verify ownership
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    if (existing.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Calculate new stock
    let newStock: number;
    let movementQuantity: number;
    switch (operation) {
      case 'add':
        newStock = existing.stock + quantity;
        movementQuantity = quantity;
        break;
      case 'subtract':
        newStock = Math.max(0, existing.stock - quantity);
        movementQuantity = -quantity;
        break;
      case 'set':
        newStock = quantity;
        movementQuantity = quantity - existing.stock;
        break;
      default:
        newStock = existing.stock;
        movementQuantity = 0;
    }

    // Determine movement type
    const movementType = type || 'ADJUSTMENT';

    // Update product and create stock movement in transaction
    const [product] = await prisma.$transaction([
      prisma.product.update({
        where: { id },
        data: { stock: newStock },
        include: { category: true, brand: true },
      }),
      prisma.stockMovement.create({
        data: {
          productId: id,
          type: movementType,
          quantity: movementQuantity,
          previousStock: existing.stock,
          newStock,
          referenceId,
          referenceNumber,
          notes,
          createdBy: userId,
          shopId,
        }
      })
    ]);

    res.json({ success: true, data: product });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// DELETE /products/:id - Delete product
// ==========================================
router.delete('/:id', authorize('ADMIN', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(authReq);
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // First check if product belongs to user's shop
    const existing = await prisma.product.findUnique({
      where: { id },
      include: { _count: { select: { invoiceItems: true } } }
    });
    
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Product not found' });
    }
    
    if (existing.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Product does not belong to the specified shop' });
    }

    // Prevent deletion if product has been used in invoices
    if (existing._count.invoiceItems > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot delete product used in ${existing._count.invoiceItems} invoice(s). Archive instead.` 
      });
    }

    // Delete in transaction (stock movements and price history will cascade)
    await prisma.product.delete({ where: { id } });
    
    res.json({ success: true, message: 'Product deleted successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;