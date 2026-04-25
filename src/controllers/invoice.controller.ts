import { Request, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errorHandler';
import { Prisma, InvoiceStatus, PaymentMethod, SalesChannel, ReminderType } from '@prisma/client';
import { sendInvoiceEmail, sendInvoiceWithPDF } from '../services/emailService';
import { generateInvoicePDF, InvoicePDFData } from '../services/pdfService';
// Import centralized type definitions
import '../types/express';

// Helper function to get effective shopId for SuperAdmin shop viewing
const getEffectiveShopId = (req: Request & { user?: { id: string; role?: string; shopId: string | null } }): string | null => {
  const { shopId: queryShopId } = req.query;
  const userRole = req.user?.role;
  const userShopId = req.user?.shopId;
  
  // SuperAdmin can view any shop by passing shopId query parameter
  if (userRole === 'SUPER_ADMIN' && queryShopId && typeof queryShopId === 'string') {
    return queryShopId;
  }
  
  return userShopId || null;
};

/**
 * World-Class Invoice Number Generation System
 * 
 * Format: {10-digit unique number}
 * 
 * Strategy: Millisecond timestamp + Random digits
 * - First 7 digits: Last 7 digits of epoch milliseconds (changes every ms)
 * - Last 3 digits: Random number (000-999) for collision prevention
 * 
 * Why this works:
 * - Epoch milliseconds provide natural uniqueness (changes every ms)
 * - Random component prevents collision if 2 users click at exact same ms
 * - Combined probability of collision: 1 in 1,000 per millisecond
 * - With retry logic (5 attempts): virtually impossible to fail
 * - Shop-specific unique constraint in DB provides final safety net
 * 
 * Example: 4567890123 (where 4567890 = ms component, 123 = random)
 * 
 * Capacity:
 * - 7 digit ms component cycles every ~115 days (10M milliseconds)
 * - 3 digit random = 1000 variations per ms
 * - Total: 10 billion unique numbers before any cycling
 */
const generateInvoiceNumber = async (shopId: string, tx?: any): Promise<string> => {
  // Get current timestamp in milliseconds
  const now = Date.now();
  
  // Extract last 7 digits of epoch milliseconds
  // This changes every millisecond and cycles every ~115 days
  const msPart = (now % 10000000).toString().padStart(7, '0');
  
  // Generate 3 random digits for collision prevention
  // If 2 users click at exact same millisecond, this provides 1000 variations
  const randomPart = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  
  // Combine: 7 digits from ms + 3 random digits = 10 digit unique number
  return `${msPart}${randomPart}`;
};

/**
 * Generate invoice number with retry logic for concurrent requests
 * Uses optimistic locking pattern to handle race conditions
 * 
 * Retry Strategy:
 * - Generate new number each attempt (fresh ms + random)
 * - Check if exists in database
 * - If collision, wait briefly and try again with new values
 * - 5 attempts = virtually impossible to fail
 */
const generateUniqueInvoiceNumber = async (
  shopId: string,
  maxRetries: number = 5
): Promise<string> => {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Generate fresh invoice number (new timestamp + new random)
    const invoiceNumber = await generateInvoiceNumber(shopId);
    
    // Check if this number already exists for this shop
    const existing = await prisma.invoice.findUnique({
      where: {
        shopId_invoiceNumber: {
          shopId,
          invoiceNumber,
        }
      },
      select: { id: true }
    });
    
    if (!existing) {
      return invoiceNumber;
    }
    
    // Collision occurred - wait a bit then retry
    // Each retry waits progressively longer: 5ms, 10ms, 15ms, 20ms, 25ms
    await new Promise(resolve => setTimeout(resolve, 5 * (attempt + 1)));
  }
  
  // Fallback: Use full epoch timestamp (last 10 digits)
  // This is extremely unlikely to be reached
  const timestamp = Date.now().toString().slice(-10);
  return timestamp;
};

// Helper function to calculate invoice status
const calculateInvoiceStatus = (total: number, paidAmount: number): InvoiceStatus => {
  if (paidAmount >= total) return 'FULLPAID';
  if (paidAmount > 0) return 'HALFPAY';
  return 'UNPAID';
};

// @desc    Get all invoices with filtering and pagination
// @route   GET /api/v1/invoices
// @access  Private (requires authentication and shop access)
export const getAllInvoices = async (
  req: Request & { user?: { id: string; role?: string; shopId: string | null } },
  res: Response,
  next: NextFunction
) => {
  try {
    // 🔒 Get effective shopId (supports SuperAdmin shop viewing)
    const shopId = getEffectiveShopId(req);
    
    if (!shopId) {
      throw new AppError('User is not associated with any shop', 403);
    }

    const {
      page = '1',
      limit = '10',
      status,
      customerId,
      startDate,
      endDate,
      search,
      sortBy = 'date',
      sortOrder = 'desc',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 10)); // Max 100 per page
    const skip = (pageNum - 1) * limitNum;

    // Build filter conditions
    const where: Prisma.InvoiceWhereInput = {
      // 🔒 CRITICAL: Only show invoices for the effective shop
      shopId,
    };

    if (status && status !== 'all') {
      where.status = status as InvoiceStatus;
    }

    if (customerId && customerId !== 'all') {
      where.customerId = customerId as string;
    }

    if (startDate || endDate) {
      where.date = {};
      if (startDate) {
        where.date.gte = new Date(startDate as string);
      }
      if (endDate) {
        where.date.lte = new Date(endDate as string);
      }
    }

    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search as string } },
        { customerName: { contains: search as string } },
      ];
    }

    // Build sort options - validate sortBy to prevent invalid fields
    const validSortFields = ['date', 'total', 'customerName', 'status', 'invoiceNumber', 'createdAt'];
    const sortField = validSortFields.includes(sortBy as string) ? (sortBy as string) : 'date';
    const orderBy: Prisma.InvoiceOrderByWithRelationInput = {
      [sortField]: (sortOrder as 'asc' | 'desc') || 'desc',
    };

    // Execute queries
    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          customer: {
            select: { id: true, name: true, email: true, phone: true }
          },
          items: {
            include: {
              product: {
                select: { id: true, name: true, price: true }
              }
            }
          },
          payments: true,
          reminders: {
            select: { type: true }
          },
        },
        orderBy,
        skip,
        take: limitNum,
      }),
      prisma.invoice.count({ where }),
    ]);

    // Map the response to include reminder counts by type
    const mappedInvoices = invoices.map(invoice => {
      const { reminders, ...invoiceData } = invoice;
      const friendlyCount = reminders?.filter(r => r.type === 'PAYMENT').length || 0;
      const urgentCount = reminders?.filter(r => r.type === 'OVERDUE').length || 0;
      return {
        ...invoiceData,
        reminderCount: (reminders?.length || 0),
        friendlyReminderCount: friendlyCount,
        urgentReminderCount: urgentCount,
      };
    });

    res.json({
      success: true,
      data: mappedInvoices,
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
};

// @desc    Get invoice by ID
// @route   GET /api/v1/invoices/:id
// @access  Public (will be protected)
export const getInvoiceById = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    
    // Try to find by ID first, then by invoice number
    let invoice = await prisma.invoice.findUnique({
      where: { id },
      include: {
        customer: true,
        items: {
          include: {
            product: true
          }
        },
        payments: {
          orderBy: { paymentDate: 'desc' }
        },
        createdBy: {
          select: { id: true, name: true, email: true }
        },
        updatedBy: {
          select: { id: true, name: true, email: true }
        },
        reminders: {
          select: { type: true }
        },
      },
    });

    // If not found by ID, try by invoice number
    if (!invoice) {
      invoice = await prisma.invoice.findFirst({
        where: { 
          OR: [
            { invoiceNumber: id },
            { invoiceNumber: { contains: id } }
          ]
        },
        include: {
          customer: true,
          items: {
            include: {
              product: true
            }
          },
          payments: {
            orderBy: { paymentDate: 'desc' }
          },
          createdBy: {
            select: { id: true, name: true, email: true }
          },
          updatedBy: {
            select: { id: true, name: true, email: true }
          },
          reminders: {
            select: { type: true }
          },
        },
      });
    }

    if (!invoice) {
      throw new AppError(`Invoice not found with ID or number: ${id}`, 404);
    }

    // 🔐 SECURITY: Verify invoice belongs to user's shop or SuperAdmin viewing shop
    const effectiveShopId = getEffectiveShopId(req as Request & { user?: { id: string; role?: string; shopId: string | null } });
    if (!effectiveShopId) {
      throw new AppError('User is not associated with any shop', 403);
    }
    if (invoice.shopId !== effectiveShopId) {
      throw new AppError('You do not have permission to access this invoice', 403);
    }

    // Map to include reminder counts by type
    const { reminders, ...invoiceData } = invoice;
    const friendlyCount = reminders?.filter(r => r.type === 'PAYMENT').length || 0;
    const urgentCount = reminders?.filter(r => r.type === 'OVERDUE').length || 0;
    const mappedInvoice = {
      ...invoiceData,
      reminderCount: reminders?.length || 0,
      friendlyReminderCount: friendlyCount,
      urgentReminderCount: urgentCount,
    };

    res.json({
      success: true,
      data: mappedInvoice,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new invoice
// @route   POST /api/v1/invoices
// @access  Public (will be protected)
export const createInvoice = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const {
      customerId,
      items,
      tax = 0,
      discount = 0,
      dueDate,
      paymentMethod,
      salesChannel = 'ON_SITE',
      paidAmount = 0,
      notes,
      shopId, // Can be provided in request body
    } = req.body;

    console.log('📝 Creating invoice:', { customerId, itemCount: items?.length, tax, discount, dueDate, paymentMethod, salesChannel, paidAmount });

    // 🔐 SECURITY: Verify user has shop access
    if (!req.user?.shopId) {
      throw new AppError('User is not associated with any shop', 403);
    }
    const invoiceShopId = req.user.shopId;

    // Check if this is a walk-in customer
    const isWalkIn = !customerId || customerId === 'walk-in';
    
    let customerName = 'Walk-in Customer';
    let validCustomerId: string | null = null;

    // Validate customer exists (only if not walk-in)
    if (!isWalkIn) {
      const customer = await prisma.customer.findUnique({
        where: { id: customerId },
      });

      if (!customer) {
        throw new AppError(`Customer not found with ID: ${customerId}`, 404);
      }

      // Verify customer belongs to user's shop
      if (customer.shopId !== req.user.shopId) {
        throw new AppError('Customer does not belong to your shop', 403);
      }
      
      customerName = customer.name;
      validCustomerId = customer.id;
    }

    // Validate items
    if (!items || items.length === 0) {
      throw new AppError('At least one item is required', 400);
    }

    // Define the validated item type
    type ValidatedItem = {
      productId: string | null;
      productName: string;
      quantity: number;
      unitPrice: number;
      originalPrice?: number;
      discount?: number;
      warrantyDueDate?: string;
    };

    // Validate product IDs - check if they exist, set to null if not found (for quick-add items)
    const validatedItems: ValidatedItem[] = [];
    for (const item of items) {
      let validProductId: string | null = null;
      
      if (item.productId) {
        const product = await prisma.product.findUnique({
          where: { id: item.productId }
        });
        if (product) {
          validProductId = item.productId;
        } else {
          console.log(`⚠️ Product not found: ${item.productId} (${item.productName}) - treating as quick-add item`);
        }
      }
      
      validatedItems.push({
        ...item,
        productId: validProductId,
      });
    }

    // Calculate totals
    // Calculate totals using validated items
    const subtotal = validatedItems.reduce((sum: number, item: { quantity: number; unitPrice: number }) => {
      return sum + (item.quantity * item.unitPrice);
    }, 0);

    const total = subtotal + tax - discount;
    const dueAmount = total - paidAmount;
    const status = calculateInvoiceStatus(total, paidAmount);

    // Generate unique invoice number for this shop
    // Uses shop-specific sequence + millisecond precision + random component
    const invoiceNumber = await generateUniqueInvoiceNumber(invoiceShopId);

    // Create invoice with items in a transaction
    const invoice = await prisma.$transaction(async (tx) => {
      const newInvoice = await tx.invoice.create({
        data: {
          invoiceNumber,
          customerId: validCustomerId, // null for walk-in customers
          customerName, // "Walk-in Customer" or actual customer name
          subtotal,
          tax,
          discount,
          total,
          paidAmount,
          dueAmount,
          status,
          dueDate: new Date(dueDate),
          paymentMethod: paymentMethod as PaymentMethod,
          salesChannel: salesChannel as SalesChannel,
          notes,
          shopId: invoiceShopId,
          items: {
            create: validatedItems.map((item: {
              productId: string | null;
              productName: string;
              quantity: number;
              unitPrice: number;
              originalPrice?: number;
              discount?: number;
              warrantyDueDate?: string;
            }) => ({
              productId: item.productId, // Can be null for quick-add items
              productName: item.productName,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              originalPrice: item.originalPrice || item.unitPrice,
              discount: item.discount || 0,
              total: item.quantity * item.unitPrice,
              warrantyDueDate: item.warrantyDueDate ? new Date(item.warrantyDueDate) : null,
            })),
          },
        },
        include: {
          customer: true,
          items: true,
        },
      });

      // Create initial payment record if paidAmount > 0
      if (paidAmount > 0 && paymentMethod) {
        await tx.invoicePayment.create({
          data: {
            invoiceId: newInvoice.id,
            amount: paidAmount,
            paymentMethod: paymentMethod as PaymentMethod,
          },
        });
      }

      // Update customer stats (only for non-walk-in customers)
      if (validCustomerId) {
        await tx.customer.update({
          where: { id: validCustomerId },
          data: {
            totalOrders: { increment: 1 },
            totalSpent: { increment: paidAmount },
            lastPurchase: new Date(),
            creditBalance: status !== 'FULLPAID' ? { increment: dueAmount } : undefined,
            creditStatus: status !== 'FULLPAID' ? 'ACTIVE' : undefined,
          },
        });
      }

      // Update product stock (only for items with valid productId)
      for (const item of validatedItems) {
        if (item.productId) {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              stock: { decrement: item.quantity },
            },
          });
        }
      }

      return newInvoice;
    });

    res.status(201).json({
      success: true,
      message: 'Invoice created successfully',
      data: invoice,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update invoice
// @route   PUT /api/v1/invoices/:id
// @access  Public (will be protected)
export const updateInvoice = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const {
      customerId,
      items,
      tax,
      discount,
      dueDate,
      paymentMethod,
      salesChannel,
      paidAmount,
      notes,
      status: manualStatus,
    } = req.body;

    // Check if invoice exists - try by ID first, then by invoiceNumber
    let existingInvoice = await prisma.invoice.findUnique({
      where: { id },
      include: { items: true },
    });

    // If not found by ID, try by invoice number (for legacy/display ID support)
    if (!existingInvoice) {
      existingInvoice = await prisma.invoice.findFirst({
        where: { 
          OR: [
            { invoiceNumber: id },
            { invoiceNumber: { contains: id } }
          ]
        },
        include: { items: true },
      });
    }

    if (!existingInvoice) {
      throw new AppError(`Invoice not found with ID or number: ${id}`, 404);
    }

    // 🔐 SECURITY: Verify invoice belongs to user's shop
    if (!req.user?.shopId) {
      throw new AppError('User is not associated with any shop', 403);
    }
    if (existingInvoice.shopId !== req.user.shopId) {
      throw new AppError('You do not have permission to modify this invoice', 403);
    }

    // 🔐 SECURITY: If customer is being changed, verify new customer belongs to user's shop
    if (customerId && customerId !== existingInvoice.customerId) {
      const newCustomer = await prisma.customer.findUnique({
        where: { id: customerId }
      });
      if (!newCustomer) {
        throw new AppError(`Customer not found with ID: ${customerId}`, 404);
      }
      if (newCustomer.shopId !== req.user.shopId) {
        throw new AppError('New customer does not belong to your shop', 403);
      }
    }

    // Use the actual database ID for updates
    const invoiceId = existingInvoice.id;

    // Calculate new totals if items are provided
    let subtotal = existingInvoice.subtotal;
    let newTax = tax !== undefined ? tax : existingInvoice.tax;
    let newDiscount = discount !== undefined ? discount : existingInvoice.discount;
    let newPaidAmount = paidAmount !== undefined ? paidAmount : existingInvoice.paidAmount;
    let validatedItems: Array<{
      productId: string | null;
      productName: string;
      quantity: number;
      unitPrice: number;
      originalPrice?: number;
      discount?: number;
      warrantyDueDate?: string;
    }> = [];

    if (items && items.length > 0) {
      subtotal = items.reduce((sum: number, item: { quantity: number; unitPrice: number }) => {
        return sum + (item.quantity * item.unitPrice);
      }, 0);

      // Validate products and allow null productId for quick-add items
      for (const item of items) {
        let product = null;
        if (item.productId) {
          product = await prisma.product.findUnique({
            where: { id: item.productId },
          });
        }
        
        validatedItems.push({
          ...item,
          productId: product ? item.productId : null, // Set to null if product doesn't exist or quick-add
        });
      }
    }

    const total = subtotal + newTax - newDiscount;
    const dueAmount = total - newPaidAmount;
    const status = manualStatus || calculateInvoiceStatus(total, newPaidAmount);

    // Update in transaction with stock management
    const invoice = await prisma.$transaction(async (tx) => {
      // ==================== STOCK MANAGEMENT ====================
      // When items are being updated, we need to:
      // 1. Restore stock from old items (add back to inventory)
      // 2. Deduct stock for new items (subtract from inventory)
      
      if (validatedItems.length > 0) {
        // Step 1: Create a map of old items by productId for comparison
        const oldItemsMap = new Map<string, number>();
        for (const oldItem of existingInvoice.items) {
          if (oldItem.productId) {
            const currentQty = oldItemsMap.get(oldItem.productId) || 0;
            oldItemsMap.set(oldItem.productId, currentQty + oldItem.quantity);
          }
        }
        
        // Step 2: Create a map of new items by productId
        const newItemsMap = new Map<string, number>();
        for (const newItem of validatedItems) {
          if (newItem.productId) {
            const currentQty = newItemsMap.get(newItem.productId) || 0;
            newItemsMap.set(newItem.productId, currentQty + newItem.quantity);
          }
        }
        
        // Step 3: Calculate stock adjustments for each product
        // Get all unique product IDs from both old and new items
        const allProductIds = new Set([...oldItemsMap.keys(), ...newItemsMap.keys()]);
        
        for (const productId of allProductIds) {
          const oldQty = oldItemsMap.get(productId) || 0;
          const newQty = newItemsMap.get(productId) || 0;
          const difference = newQty - oldQty;
          
          if (difference !== 0) {
            // If difference > 0: We need MORE stock (decrement)
            // If difference < 0: We need LESS stock (increment - returning to inventory)
            await tx.product.update({
              where: { id: productId },
              data: {
                stock: difference > 0 
                  ? { decrement: difference }  // Taking more from stock
                  : { increment: Math.abs(difference) }, // Returning to stock
              },
            });
            
            console.log(`📦 Stock adjusted for product ${productId}: ${difference > 0 ? '-' : '+'}${Math.abs(difference)} (old: ${oldQty}, new: ${newQty})`);
          }
        }
        
        // Delete existing items after stock adjustment
        await tx.invoiceItem.deleteMany({
          where: { invoiceId: invoiceId },
        });
      }

      // Update invoice
      const updatedInvoice = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          ...(customerId && { customerId }),
          subtotal,
          tax: newTax,
          discount: newDiscount,
          total,
          paidAmount: newPaidAmount,
          dueAmount,
          status: status as InvoiceStatus,
          ...(dueDate && { dueDate: new Date(dueDate) }),
          ...(paymentMethod && { paymentMethod: paymentMethod as PaymentMethod }),
          ...(salesChannel && { salesChannel: salesChannel as SalesChannel }),
          ...(notes !== undefined && { notes }),
          ...(validatedItems.length > 0 && {
            items: {
              create: validatedItems.map((item: {
                productId: string | null;
                productName: string;
                quantity: number;
                unitPrice: number;
                originalPrice?: number;
                discount?: number;
                warrantyDueDate?: string;
              }) => ({
                productId: item.productId, // Can be null for quick-add items
                productName: item.productName,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                originalPrice: item.originalPrice || item.unitPrice,
                discount: item.discount || 0,
                total: item.quantity * item.unitPrice,
                warrantyDueDate: item.warrantyDueDate ? new Date(item.warrantyDueDate) : null,
              })),
            },
          }),
        },
        include: {
          customer: true,
          items: true,
          payments: true,
        },
      });

      return updatedInvoice;
    });

    res.json({
      success: true,
      message: 'Invoice updated successfully',
      data: invoice,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete invoice
// @route   DELETE /api/v1/invoices/:id
// @access  Public (will be protected)
export const deleteInvoice = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;

    // Check if invoice exists - try by ID first, then by invoiceNumber
    let invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { items: true },
    });

    // If not found by ID, try by invoice number
    if (!invoice) {
      invoice = await prisma.invoice.findFirst({
        where: { 
          OR: [
            { invoiceNumber: id },
            { invoiceNumber: { contains: id } }
          ]
        },
        include: { items: true },
      });
    }

    if (!invoice) {
      throw new AppError(`Invoice not found with ID or number: ${id}`, 404);
    }

    // 🔐 SECURITY: Verify invoice belongs to user's shop
    if (!req.user?.shopId) {
      throw new AppError('User is not associated with any shop', 403);
    }
    if (invoice.shopId !== req.user.shopId) {
      throw new AppError('You do not have permission to delete this invoice', 403);
    }

    // Use actual database ID
    const invoiceId = invoice.id;

    // Delete in transaction (restore stock)
    await prisma.$transaction(async (tx) => {
      // Restore product stock (only for items with valid productId)
      for (const item of invoice.items) {
        if (item.productId) {
          await tx.product.update({
            where: { id: item.productId },
            data: {
              stock: { increment: item.quantity },
            },
          });
        }
      }

      // Update customer stats (only for non-walk-in customers with valid customerId)
      if (invoice.customerId) {
        await tx.customer.update({
          where: { id: invoice.customerId },
          data: {
            totalOrders: { decrement: 1 },
            totalSpent: { decrement: invoice.paidAmount },
            creditBalance: { decrement: invoice.dueAmount },
          },
        });
      }

      // Delete invoice (cascade deletes items and payments)
      await tx.invoice.delete({
        where: { id: invoiceId },
      });
    });

    res.json({
      success: true,
      message: 'Invoice deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add payment to invoice
// @route   POST /api/v1/invoices/:id/payments
// @access  Public (will be protected)
export const addPayment = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { amount, paymentMethod, notes, reference } = req.body;

    // Get invoice - try by ID first, then by invoiceNumber
    let invoice = await prisma.invoice.findUnique({
      where: { id },
    });

    // If not found by ID, try by invoice number
    if (!invoice) {
      invoice = await prisma.invoice.findFirst({
        where: { 
          OR: [
            { invoiceNumber: id },
            { invoiceNumber: { contains: id } }
          ]
        },
      });
    }

    if (!invoice) {
      throw new AppError(`Invoice not found with ID or number: ${id}`, 404);
    }

    // 🔐 SECURITY: Verify invoice belongs to user's shop
    if (!req.user?.shopId) {
      throw new AppError('User is not associated with any shop', 403);
    }
    if (invoice.shopId !== req.user.shopId) {
      throw new AppError('You do not have permission to add payments to this invoice', 403);
    }

    // Use actual database ID
    const invoiceId = invoice.id;

    if (invoice.status === 'FULLPAID') {
      throw new AppError('Invoice is already fully paid', 400);
    }

    const maxPayment = invoice.dueAmount;
    if (amount > maxPayment) {
      throw new AppError(`Payment amount cannot exceed due amount of ${maxPayment}`, 400);
    }

    // Calculate new amounts
    const newPaidAmount = invoice.paidAmount + amount;
    const newDueAmount = invoice.total - newPaidAmount;
    const newStatus = calculateInvoiceStatus(invoice.total, newPaidAmount);

    // Create payment and update invoice in transaction
    const [payment, updatedInvoice] = await prisma.$transaction(async (tx) => {
      const newPayment = await tx.invoicePayment.create({
        data: {
          invoiceId: invoiceId,
          amount,
          paymentMethod: paymentMethod as PaymentMethod,
          notes,
          reference,
        },
      });

      const updated = await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          paidAmount: newPaidAmount,
          dueAmount: newDueAmount,
          status: newStatus,
        },
        include: {
          customer: true,
          items: true,
          payments: {
            orderBy: { paymentDate: 'desc' }
          },
        },
      });

      // Update customer stats (only if not walk-in customer)
      if (invoice.customerId) {
        await tx.customer.update({
          where: { id: invoice.customerId },
          data: {
            totalSpent: { increment: amount },
            creditBalance: { decrement: amount },
            creditStatus: newStatus === 'FULLPAID' ? 'CLEAR' : undefined,
          },
        });
      }

      return [newPayment, updated];
    });

    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      data: {
        payment,
        invoice: updatedInvoice,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get invoice statistics
// @route   GET /api/v1/invoices/stats
// @access  Public (will be protected)
export const getInvoiceStats = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    // 🔐 SECURITY: Filter stats by user's shop (or SuperAdmin viewing shop)
    const shopId = getEffectiveShopId(req as Request & { user?: { id: string; role?: string; shopId: string | null } });
    if (!shopId) {
      throw new AppError('User is not associated with any shop', 403);
    }

    const [
      totalInvoices,
      statusCounts,
      revenueStats,
      recentInvoices,
    ] = await Promise.all([
      // Total invoices count (filtered by shop)
      prisma.invoice.count({ where: { shopId } }),
      
      // Count by status (filtered by shop)
      prisma.invoice.groupBy({
        by: ['status'],
        where: { shopId },
        _count: { status: true },
        _sum: { total: true, paidAmount: true, dueAmount: true },
      }),
      
      // Revenue statistics (filtered by shop)
      prisma.invoice.aggregate({
        where: { shopId },
        _sum: {
          total: true,
          paidAmount: true,
          dueAmount: true,
          tax: true,
          discount: true,
        },
        _avg: {
          total: true,
        },
      }),
      
      // Recent invoices (filtered by shop)
      prisma.invoice.findMany({
        where: { shopId },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: {
            select: { name: true }
          }
        },
      }),
    ]);

    // Format status counts
    const statusStats = statusCounts.reduce((acc, curr) => {
      acc[curr.status.toLowerCase()] = {
        count: curr._count.status,
        total: curr._sum.total || 0,
        paid: curr._sum.paidAmount || 0,
        due: curr._sum.dueAmount || 0,
      };
      return acc;
    }, {} as Record<string, { count: number; total: number; paid: number; due: number }>);

    res.json({
      success: true,
      data: {
        totalInvoices,
        statusStats,
        revenue: {
          total: revenueStats._sum.total || 0,
          paid: revenueStats._sum.paidAmount || 0,
          due: revenueStats._sum.dueAmount || 0,
          tax: revenueStats._sum.tax || 0,
          discount: revenueStats._sum.discount || 0,
          average: revenueStats._avg.total || 0,
        },
        recentInvoices,
      },
    });
  } catch (error) {
    next(error);
  }
};
// @desc    Get reminders for an invoice
// @route   GET /api/v1/invoices/:id/reminders
// @access  Public (will be protected)
export const getInvoiceReminders = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    
    // Try to find invoice by ID first, then by invoice number
    let invoice = await prisma.invoice.findUnique({
      where: { id },
      select: { id: true, shopId: true },
    });

    // If not found by ID, try by invoice number
    if (!invoice) {
      const invoiceNumber = id.startsWith('INV-') ? id : `INV-${id}`;
      invoice = await prisma.invoice.findFirst({
        where: { invoiceNumber },
        select: { id: true, shopId: true },
      });
    }

    if (!invoice) {
      throw new AppError('Invoice not found', 404);
    }

    // 🔐 SECURITY: Verify invoice belongs to user's shop (or SuperAdmin viewing shop)
    const effectiveShopId = getEffectiveShopId(req as Request & { user?: { id: string; role?: string; shopId: string | null } });
    if (!effectiveShopId) {
      throw new AppError('User is not associated with any shop', 403);
    }
    if (invoice.shopId !== effectiveShopId) {
      throw new AppError('You do not have permission to access reminders for this invoice', 403);
    }

    // Get all reminders for this invoice
    const reminders = await prisma.invoiceReminder.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { sentAt: 'desc' },
    });

    res.json({
      success: true,
      data: reminders,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a reminder for an invoice
// @route   POST /api/v1/invoices/:id/reminders
// @access  Public (will be protected)
export const createInvoiceReminder = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { type, channel, message, customerPhone, customerName } = req.body;
    
    // Try to find invoice by ID first, then by invoice number
    let invoice = await prisma.invoice.findUnique({
      where: { id },
      select: { id: true, shopId: true },
    });

    // If not found by ID, try by invoice number
    if (!invoice) {
      const invoiceNumber = id.startsWith('INV-') ? id : `INV-${id}`;
      invoice = await prisma.invoice.findFirst({
        where: { invoiceNumber },
        select: { id: true, shopId: true },
      });
    }

    if (!invoice) {
      throw new AppError('Invoice not found', 404);
    }

    // 🔐 SECURITY: Verify invoice belongs to user's shop
    if (!req.user?.shopId) {
      throw new AppError('User is not associated with any shop', 403);
    }
    if (invoice.shopId !== req.user.shopId) {
      throw new AppError('You do not have permission to create reminders for this invoice', 403);
    }

    // Create the reminder - normalize type to uppercase enum
    const normalizedType = (type || 'PAYMENT').toUpperCase() as ReminderType;
    const reminder = await prisma.invoiceReminder.create({
      data: {
        invoiceId: invoice.id,
        shopId: invoice.shopId,
        type: normalizedType,
        channel: channel || 'whatsapp',
        message,
        customerPhone,
        customerName,
      },
    });

    // Get updated reminder counts (total, friendly, urgent)
    const [reminderCount, friendlyReminderCount, urgentReminderCount] = await Promise.all([
      prisma.invoiceReminder.count({
        where: { invoiceId: invoice.id },
      }),
      prisma.invoiceReminder.count({
        where: { invoiceId: invoice.id, type: 'PAYMENT' },
      }),
      prisma.invoiceReminder.count({
        where: { invoiceId: invoice.id, type: 'OVERDUE' },
      }),
    ]);

    res.status(201).json({
      success: true,
      data: reminder,
      reminderCount,
      friendlyReminderCount,
      urgentReminderCount,
    });
  } catch (error) {
    next(error);
  }
};

// ==========================================
// INVOICE ITEM HISTORY
// ==========================================

/**
 * Get item change history for an invoice
 */
export const getInvoiceItemHistory = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const userRole = (req.user as any)?.role;
    const effectiveShopId = getEffectiveShopId(req);
    
    // SUPER_ADMIN can access any invoice, regular users need a shopId
    const isSuperAdmin = userRole === 'SUPER_ADMIN';
    
    if (!isSuperAdmin && !effectiveShopId) {
      throw new AppError('User is not associated with any shop', 403);
    }

    // Try to find invoice by ID first, then by invoice number
    let invoice = await prisma.invoice.findUnique({
      where: { id },
      select: { id: true, shopId: true, invoiceNumber: true },
    });

    // If not found by ID, try by invoice number
    if (!invoice) {
      const invoiceNumber = id.startsWith('INV-') ? id : `INV-${id}`;
      invoice = await prisma.invoice.findFirst({
        where: { invoiceNumber },
        select: { id: true, shopId: true, invoiceNumber: true },
      });
    }

    if (!invoice) {
      throw new AppError('Invoice not found', 404);
    }

    // SUPER_ADMIN can view any invoice, regular users must own the invoice
    if (!isSuperAdmin && invoice.shopId !== effectiveShopId) {
      throw new AppError('You do not have permission to view this invoice history', 403);
    }

    const history = await prisma.invoiceItemHistory.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      success: true,
      data: history,
      meta: { 
        count: history.length,
        invoiceNumber: invoice.invoiceNumber,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create item change history record(s) for an invoice
 * Supports batch creation for multiple changes at once
 */
export const createInvoiceItemHistory = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const userRole = (req.user as any)?.role;
    const effectiveShopId = getEffectiveShopId(req);
    
    // SUPER_ADMIN can access any invoice, regular users need a shopId
    const isSuperAdmin = userRole === 'SUPER_ADMIN';
    
    if (!isSuperAdmin && !effectiveShopId) {
      throw new AppError('User is not associated with any shop', 403);
    }

    // Request body can be a single change or array of changes
    const changes = Array.isArray(req.body) ? req.body : [req.body];

    // Try to find invoice by ID first, then by invoice number
    let invoice = await prisma.invoice.findUnique({
      where: { id },
      select: { id: true, shopId: true, invoiceNumber: true },
    });

    // If not found by ID, try by invoice number
    if (!invoice) {
      const invoiceNumber = id.startsWith('INV-') ? id : `INV-${id}`;
      invoice = await prisma.invoice.findFirst({
        where: { invoiceNumber },
        select: { id: true, shopId: true, invoiceNumber: true },
      });
    }

    if (!invoice) {
      throw new AppError('Invoice not found', 404);
    }

    // SUPER_ADMIN can modify any invoice, regular users must own the invoice
    if (!isSuperAdmin && invoice.shopId !== effectiveShopId) {
      throw new AppError('You do not have permission to modify this invoice history', 403);
    }

    // Get user info for audit trail
    const user = req.user as { id: string; name?: string; email?: string } | undefined;
    const changedById = user?.id || null;
    const changedByName = user?.name || user?.email || 'Unknown';
    
    // Use invoice's shopId for the history record (not user's shopId)
    const historyShopId = invoice.shopId;

    // Create all history records
    const historyRecords = await prisma.invoiceItemHistory.createMany({
      data: changes.map((change: {
        action: string;
        productId?: string;
        productName: string;
        oldQuantity?: number;
        newQuantity?: number;
        unitPrice: number;
        amountChange: number;
        reason?: string;
        notes?: string;
      }) => ({
        invoiceId: invoice!.id,
        shopId: historyShopId,
        action: change.action as 'ADDED' | 'REMOVED' | 'QTY_INCREASED' | 'QTY_DECREASED' | 'PRICE_CHANGED',
        productId: change.productId || null,
        productName: change.productName,
        oldQuantity: change.oldQuantity ?? null,
        newQuantity: change.newQuantity ?? null,
        unitPrice: change.unitPrice,
        amountChange: change.amountChange,
        changedById,
        changedByName,
        reason: change.reason || null,
        notes: change.notes || null,
      })),
    });

    // Fetch the created records
    const createdHistory = await prisma.invoiceItemHistory.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { createdAt: 'desc' },
      take: changes.length,
    });

    res.status(201).json({
      success: true,
      data: createdHistory,
      meta: { 
        created: historyRecords.count,
        invoiceNumber: invoice.invoiceNumber,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Send Invoice via Email
 * POST /api/v1/invoices/:id/send-email
 * 
 * Sends the invoice details to the customer's email.
 * Updates emailSent and emailSentAt fields in the database.
 */
export const sendInvoiceViaEmail = async (
  req: Request & { user?: { id: string; role?: string; shopId: string | null } },
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const shopId = getEffectiveShopId(req);

    if (!shopId) {
      throw new AppError('Shop context required to send invoice email', 403);
    }

    // Find invoice with all related data
    const invoice = await prisma.invoice.findFirst({
      where: {
        OR: [
          { id },
          { invoiceNumber: id },
          { invoiceNumber: id.replace(/^INV-/, '') },
        ],
        shopId,
      },
      include: {
        customer: true,
        shop: true,
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new AppError('Invoice not found', 404);
    }

    // Check if customer exists and has email
    if (!invoice.customer) {
      throw new AppError('Invoice has no registered customer', 400);
    }

    if (!invoice.customer.email) {
      throw new AppError('Customer does not have an email address', 400);
    }

    // Prepare invoice email data
    const invoiceItems = invoice.items.map((item) => ({
      productName: item.product?.name || item.productName || 'Unknown Product',
      quantity: item.quantity,
      unitPrice: Number(item.unitPrice),
      total: Number(item.unitPrice) * item.quantity,
    }));

    const emailData = {
      email: invoice.customer.email,
      customerName: invoice.customer.name,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.date.toLocaleDateString('en-GB', { 
        day: '2-digit', 
        month: 'short', 
        year: 'numeric' 
      }),
      dueDate: invoice.dueDate.toLocaleDateString('en-GB', { 
        day: '2-digit', 
        month: 'short', 
        year: 'numeric' 
      }),
      items: invoiceItems,
      subtotal: Number(invoice.subtotal),
      tax: Number(invoice.tax),
      discount: Number(invoice.discount),
      total: Number(invoice.total),
      paidAmount: Number(invoice.paidAmount),
      dueAmount: Number(invoice.dueAmount),
      status: invoice.status,
      shopName: invoice.shop?.name || 'Our Store',
      shopPhone: invoice.shop?.phone || undefined,
      shopEmail: invoice.shop?.email || undefined,
      shopAddress: invoice.shop?.address || undefined,
      shopWebsite: invoice.shop?.website || undefined,
      notes: invoice.notes || undefined,
    };

    // Send email synchronously (sendMailWithRetry has 30s hard timeout per attempt)
    const emailResult = await sendInvoiceEmail(emailData);

    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        message: `Failed to send email: ${emailResult.error || 'Unknown error'}`,
      });
    }

    console.log(`✅ Invoice email sent to ${invoice.customer.email} for Invoice #${invoice.invoiceNumber}`);

    // Update invoice with email sent status
    try {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          emailSent: true,
          emailSentAt: new Date(),
        },
      });
    } catch (dbErr) {
      console.error(`⚠️ Failed to update emailSent status for Invoice #${invoice.invoiceNumber}:`, dbErr);
    }

    res.status(200).json({
      success: true,
      message: 'Invoice email sent successfully',
      data: {
        messageId: emailResult.messageId,
        sentTo: invoice.customer.email,
        invoiceNumber: invoice.invoiceNumber,
        emailSentAt: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get Invoice Email Status
 * GET /api/v1/invoices/:id/email-status
 * 
 * Returns the email sent status for an invoice
 */
export const getInvoiceEmailStatus = async (
  req: Request & { user?: { id: string; role?: string; shopId: string | null } },
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const shopId = getEffectiveShopId(req);

    if (!shopId) {
      throw new AppError('Shop context required', 403);
    }

    const invoice = await prisma.invoice.findFirst({
      where: {
        OR: [
          { id },
          { invoiceNumber: id },
          { invoiceNumber: id.replace(/^INV-/, '') },
        ],
        shopId,
      },
      select: {
        id: true,
        invoiceNumber: true,
        emailSent: true,
        emailSentAt: true,
        customer: {
          select: {
            email: true,
            name: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new AppError('Invoice not found', 404);
    }

    res.json({
      success: true,
      data: {
        invoiceNumber: invoice.invoiceNumber,
        emailSent: invoice.emailSent,
        emailSentAt: invoice.emailSentAt,
        customerEmail: invoice.customer?.email,
        customerName: invoice.customer?.name,
        canSendEmail: !!invoice.customer?.email,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Download Invoice PDF
 * GET /api/v1/invoices/:id/pdf
 * 
 * Generates and returns a PDF file of the invoice
 */
export const downloadInvoicePDF = async (
  req: Request & { user?: { id: string; role?: string; shopId: string | null } },
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const shopId = getEffectiveShopId(req);

    if (!shopId) {
      throw new AppError('Shop context required to download invoice PDF', 403);
    }

    // Find invoice with all related data
    const invoice = await prisma.invoice.findFirst({
      where: {
        OR: [
          { id },
          { invoiceNumber: id },
          { invoiceNumber: id.replace(/^INV-/, '') },
        ],
        shopId,
      },
      include: {
        customer: true,
        shop: true,
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new AppError('Invoice not found', 404);
    }

    // Prepare PDF data
    const pdfData: InvoicePDFData = {
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.customerName || invoice.customer?.name || 'Walk-in Customer',
      customerPhone: invoice.customer?.phone || undefined,
      customerEmail: invoice.customer?.email || undefined,
      customerAddress: invoice.customer?.address || undefined,
      date: invoice.date.toISOString(),
      dueDate: invoice.dueDate.toISOString(),
      items: invoice.items.map((item) => ({
        productName: item.product?.name || item.productName || 'Unknown Product',
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        originalPrice: item.originalPrice ? Number(item.originalPrice) : undefined,
        total: Number(item.unitPrice) * item.quantity,
        // Get warranty from product if available
        warranty: item.product?.warranty || undefined,
      })),
      subtotal: Number(invoice.subtotal),
      tax: Number(invoice.tax),
      discount: Number(invoice.discount),
      total: Number(invoice.total),
      paidAmount: Number(invoice.paidAmount),
      dueAmount: Number(invoice.dueAmount),
      status: invoice.status,
      notes: invoice.notes || undefined,
      // Shop branding
      shopName: invoice.shop?.name || 'Shop',
      shopSubName: invoice.shop?.subName || undefined,
      shopAddress: invoice.shop?.address || undefined,
      shopPhone: invoice.shop?.phone || undefined,
      shopEmail: invoice.shop?.email || undefined,
      shopLogo: invoice.shop?.logo || undefined,
    };

    // Generate PDF
    const pdfBuffer = await generateInvoicePDF(pdfData);

    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice-${invoice.invoiceNumber}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);

    // Send the PDF
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};

/**
 * Send Invoice via Email with PDF Attachment
 * POST /api/v1/invoices/:id/send-email-with-pdf
 * 
 * Sends the invoice email with optional PDF attachment to the customer.
 * Accepts client-generated pdfBase64 (same pattern as GRN emails).
 * Updates emailSent and emailSentAt fields in the database.
 */
export const sendInvoiceEmailWithPDF = async (
  req: Request & { user?: { id: string; role?: string; shopId: string | null } },
  res: Response,
  next: NextFunction
) => {
  try {
    const { id } = req.params;
    const { pdfBase64, includeAttachment } = req.body;
    const shopId = getEffectiveShopId(req);

    if (!shopId) {
      throw new AppError('Shop context required to send invoice email', 403);
    }

    // Find invoice with all related data
    const invoice = await prisma.invoice.findFirst({
      where: {
        OR: [
          { id },
          { invoiceNumber: id },
          { invoiceNumber: id.replace(/^INV-/, '') },
        ],
        shopId,
      },
      include: {
        customer: true,
        shop: true,
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!invoice) {
      throw new AppError('Invoice not found', 404);
    }

    // Check if customer exists and has email
    if (!invoice.customer) {
      throw new AppError('Invoice has no registered customer', 400);
    }

    if (!invoice.customer.email) {
      throw new AppError('Customer does not have an email address', 400);
    }

    // Prepare invoice email data
    const emailData = {
      email: invoice.customer.email,
      customerName: invoice.customer.name,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.date.toLocaleDateString('en-GB', { 
        day: '2-digit', 
        month: 'short', 
        year: 'numeric' 
      }),
      dueDate: invoice.dueDate.toLocaleDateString('en-GB', { 
        day: '2-digit', 
        month: 'short', 
        year: 'numeric' 
      }),
      items: invoice.items.map((item) => ({
        productName: item.product?.name || item.productName || 'Unknown Product',
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        total: Number(item.unitPrice) * item.quantity,
        warranty: item.product?.warranty || undefined,
      })),
      subtotal: Number(invoice.subtotal),
      tax: Number(invoice.tax),
      discount: Number(invoice.discount),
      total: Number(invoice.total),
      paidAmount: Number(invoice.paidAmount),
      dueAmount: Number(invoice.dueAmount),
      status: invoice.status,
      shopName: invoice.shop?.name || 'Our Store',
      shopSubName: invoice.shop?.subName || undefined,
      shopPhone: invoice.shop?.phone || undefined,
      shopEmail: invoice.shop?.email || undefined,
      shopAddress: invoice.shop?.address || undefined,
      shopWebsite: invoice.shop?.website || undefined,
      shopLogo: invoice.shop?.logo || undefined,
      notes: invoice.notes || undefined,
    };

    // Use client-side pdfBase64 if provided (same pattern as GRN emails)
    // includeAttachment defaults to true if pdfBase64 is present
    const shouldIncludePdf = includeAttachment !== false && !!pdfBase64;

    // Send email with optional PDF (sendInvoiceWithPDF handles base64 → Buffer conversion)
    const sendResult = await sendInvoiceWithPDF(
      emailData,
      shouldIncludePdf ? pdfBase64 : undefined
    );

    if (!sendResult.success) {
      return res.status(500).json({
        success: false,
        message: `Failed to send email: ${sendResult.error || 'Unknown error'}`,
      });
    }

    console.log(`✅ Invoice email sent to ${invoice.customer.email} for Invoice #${invoice.invoiceNumber}`);

    // Update invoice with email sent status
    try {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          emailSent: true,
          emailSentAt: new Date(),
        },
      });
    } catch (dbErr) {
      console.error(`⚠️ Failed to update emailSent status for Invoice #${invoice.invoiceNumber}:`, dbErr);
    }

    res.status(200).json({
      success: true,
      message: 'Invoice email sent successfully',
      data: {
        messageId: sendResult.messageId,
        sentTo: invoice.customer.email,
        invoiceNumber: invoice.invoiceNumber,
        emailSentAt: new Date(),
        hasPdfAttachment: sendResult.hasPdfAttachment || false,
      },
    });
  } catch (error) {
    next(error);
  }
};