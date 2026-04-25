/**
 * Customer Routes - World-Class CRUD Operations
 * Comprehensive customer management for Sri Lankan computer/mobile shops
 * 
 * Features:
 * - Full CRUD with shop isolation (multi-tenant)
 * - Credit management (Naya system)
 * - Customer payment tracking
 * - Search, filter, and pagination
 * - NIC validation for warranty claims
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { protect, requireShop, authorize } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { validateCustomer } from '../middleware/validation';
import { sensitiveRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// 🔒 All customer routes require authentication and shop
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
// GET /customers - List all customers with filters
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
      creditStatus,
      customerType,
      page = '1',
      limit = '50',
      sortBy = 'name',
      sortOrder = 'asc'
    } = req.query;

    // Build where clause
    const where: any = { shopId };

    // Search filter - name, email, phone, NIC
    if (search && typeof search === 'string') {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { nic: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Credit status filter
    if (creditStatus && typeof creditStatus === 'string' && creditStatus !== 'all') {
      where.creditStatus = creditStatus.toUpperCase();
    }

    // Customer type filter
    if (customerType && typeof customerType === 'string' && customerType !== 'all') {
      where.customerType = customerType.toUpperCase();
    }

    // Pagination
    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 50));
    const skip = (pageNum - 1) * limitNum;

    // Sorting
    const validSortFields = ['name', 'creditBalance', 'totalSpent', 'lastPurchase', 'createdAt'];
    const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'name';
    const order = sortOrder === 'desc' ? 'desc' : 'asc';

    // Execute query with count
    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        orderBy: { [sortField as string]: order },
        skip,
        take: limitNum,
        include: {
          _count: {
            select: { invoices: true, payments: true }
          }
        }
      }),
      prisma.customer.count({ where })
    ]);

    // Return with pagination info
    res.json({
      success: true,
      data: customers,
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
// GET /customers/reminders - Get reminder history for a customer
// ==========================================
router.get('/reminders', async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(authReq);
    
    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const { customerId } = req.query;
    
    if (!customerId || typeof customerId !== 'string') {
      return res.status(400).json({ success: false, message: 'customerId is required' });
    }

    // Get all reminders for invoices belonging to this customer
    const reminders = await prisma.invoiceReminder.findMany({
      where: {
        shopId,
        invoice: {
          customerId: customerId,
        },
      },
      include: {
        invoice: {
          select: {
            id: true,
            invoiceNumber: true,
            total: true,
            paidAmount: true,
            dueAmount: true,
          },
        },
      },
      orderBy: { sentAt: 'desc' },
    });

    res.json({
      success: true,
      data: reminders,
      meta: { count: reminders.length },
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// GET /customers/stats - Customer statistics
// ==========================================
router.get('/stats', async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(authReq);
    
    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const [
      totalCustomers,
      clearCount,
      activeCount,
      overdueCount,
      creditStats
    ] = await Promise.all([
      prisma.customer.count({ where: { shopId } }),
      prisma.customer.count({ where: { shopId, creditStatus: 'CLEAR' } }),
      prisma.customer.count({ where: { shopId, creditStatus: 'ACTIVE' } }),
      prisma.customer.count({ where: { shopId, creditStatus: 'OVERDUE' } }),
      prisma.customer.aggregate({
        where: { shopId },
        _sum: {
          creditBalance: true,
          totalSpent: true
        }
      })
    ]);

    res.json({
      success: true,
      data: {
        totalCustomers,
        byStatus: {
          clear: clearCount,
          active: activeCount,
          overdue: overdueCount
        },
        totals: {
          creditBalance: creditStats._sum.creditBalance || 0,
          totalSpent: creditStats._sum.totalSpent || 0
        }
      }
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// GET /customers/:id - Get single customer
// ==========================================
router.get('/:id', async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(authReq);
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const customer = await prisma.customer.findUnique({
      where: { id },
      include: {
        invoices: {
          orderBy: { date: 'desc' },
          take: 10,
          select: {
            id: true,
            invoiceNumber: true,
            total: true,
            paidAmount: true,
            dueAmount: true,
            status: true,
            date: true
          }
        },
        payments: {
          orderBy: { paymentDate: 'desc' },
          take: 10
        },
        _count: {
          select: { invoices: true, payments: true }
        }
      },
    });
    
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    
    // Validate customer belongs to user's shop
    if (customer.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Customer does not belong to your shop' });
    }
    
    res.json({ success: true, data: customer });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// POST /customers - Create new customer
// ==========================================
router.post('/', sensitiveRateLimiter, validateCustomer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = authReq.user?.shopId;
    
    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // Prevent shopId override from request body
    const { shopId: _, id: __, ...safeData } = req.body;

    // Check for duplicate phone number in same shop
    const existingPhone = await prisma.customer.findFirst({
      where: { shopId, phone: safeData.phone }
    });
    if (existingPhone) {
      return res.status(409).json({ 
        success: false, 
        message: 'A customer with this phone number already exists' 
      });
    }

    // Check for duplicate NIC if provided
    if (safeData.nic) {
      const existingNIC = await prisma.customer.findFirst({
        where: { shopId, nic: safeData.nic }
      });
      if (existingNIC) {
        return res.status(409).json({ 
          success: false, 
          message: 'A customer with this NIC already exists' 
        });
      }
    }

    const customer = await prisma.customer.create({
      data: {
        ...safeData,
        shopId,
        // Set defaults
        creditBalance: safeData.creditBalance || 0,
        creditLimit: safeData.creditLimit || 0,
        creditStatus: safeData.creditStatus || 'CLEAR',
        customerType: safeData.customerType || 'REGULAR',
        totalSpent: 0,
        totalOrders: 0,
      },
    });
    
    res.status(201).json({ success: true, data: customer });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// PUT /customers/:id - Update customer
// ==========================================
router.put('/:id', validateCustomer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = authReq.user?.shopId;
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // First check if customer belongs to user's shop
    const existing = await prisma.customer.findUnique({
      where: { id },
    });
    
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    
    if (existing.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Customer does not belong to your shop' });
    }

    // Prevent shopId tampering
    const { shopId: _, id: __, ...safeData } = req.body;

    // Check for duplicate phone number (excluding current customer)
    if (safeData.phone && safeData.phone !== existing.phone) {
      const existingPhone = await prisma.customer.findFirst({
        where: { shopId, phone: safeData.phone, NOT: { id } }
      });
      if (existingPhone) {
        return res.status(409).json({ 
          success: false, 
          message: 'A customer with this phone number already exists' 
        });
      }
    }

    // Check for duplicate NIC (excluding current customer)
    if (safeData.nic && safeData.nic !== existing.nic) {
      const existingNIC = await prisma.customer.findFirst({
        where: { shopId, nic: safeData.nic, NOT: { id } }
      });
      if (existingNIC) {
        return res.status(409).json({ 
          success: false, 
          message: 'A customer with this NIC already exists' 
        });
      }
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: safeData,
    });
    
    res.json({ success: true, data: customer });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// PATCH /customers/:id/credit - Update credit balance
// ==========================================
router.patch('/:id/credit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = authReq.user?.shopId;
    const { id } = req.params;
    const { amount, operation, invoiceId, notes, paymentMethod } = req.body;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // Validate input
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be a positive number' });
    }

    if (!['add', 'subtract', 'set'].includes(operation)) {
      return res.status(400).json({ success: false, message: 'Operation must be add, subtract, or set' });
    }

    // Verify ownership
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    if (existing.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Calculate new balance
    let newBalance: number;
    switch (operation) {
      case 'add':
        newBalance = existing.creditBalance + amount;
        break;
      case 'subtract':
        newBalance = existing.creditBalance - amount;
        break;
      case 'set':
        newBalance = amount;
        break;
      default:
        newBalance = existing.creditBalance;
    }

    // Determine credit status
    let creditStatus: 'CLEAR' | 'ACTIVE' | 'OVERDUE' = 'CLEAR';
    if (newBalance > 0) {
      creditStatus = existing.creditDueDate && new Date(existing.creditDueDate) < new Date() 
        ? 'OVERDUE' 
        : 'ACTIVE';
    }

    // Update customer and create payment record in transaction
    const [customer] = await prisma.$transaction([
      prisma.customer.update({
        where: { id },
        data: { 
          creditBalance: newBalance,
          creditStatus 
        },
      }),
      prisma.customerPaymentRecord.create({
        data: {
          customerId: id,
          invoiceId: invoiceId || null,
          amount: operation === 'subtract' ? -amount : amount,
          paymentMethod: paymentMethod || 'CASH',
          source: invoiceId ? 'INVOICE' : 'CUSTOMER',
          notes,
          shopId,
        }
      })
    ]);

    res.json({ success: true, data: customer });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// GET /customers/:id/payments - Get payment history
// ==========================================
router.get('/:id/payments', async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = getEffectiveShopId(authReq);
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // Verify ownership
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    if (customer.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const payments = await prisma.customerPaymentRecord.findMany({
      where: { customerId: id },
      orderBy: { paymentDate: 'desc' },
    });

    res.json({ success: true, data: payments });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// DELETE /customers/:id - Delete customer
// ==========================================
router.delete('/:id', authorize('ADMIN'), async (req, res, next) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = authReq.user?.shopId;
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // First check if customer belongs to user's shop
    const existing = await prisma.customer.findUnique({
      where: { id },
      include: { _count: { select: { invoices: true } } }
    });
    
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Customer not found' });
    }
    
    if (existing.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Customer does not belong to your shop' });
    }

    // Prevent deletion if customer has invoices
    if (existing._count.invoices > 0) {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot delete customer with ${existing._count.invoices} invoice(s). Archive instead.` 
      });
    }

    await prisma.customer.delete({ where: { id } });
    
    res.json({ success: true, message: 'Customer deleted successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
