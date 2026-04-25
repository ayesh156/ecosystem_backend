import { Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import type { AuthRequest } from '../types/express';
import { StockMovementType, GRNStatus, PaymentStatus, PriceChangeType } from '@prisma/client';
import { sendGRNWithPDF, GRNEmailData } from '../services/emailService';
import { generateGRNPDF, GRNPDFData } from '../services/pdfService';

// Helper function to get effective shopId for SuperAdmin shop viewing
const getEffectiveShopId = (req: AuthRequest): string | null => {
  const { shopId: queryShopId } = req.query;
  const userRole = req.user?.role;
  const userShopId = req.user?.shopId;
  
  // SuperAdmin can view any shop by passing shopId query parameter
  if (userRole === 'SUPER_ADMIN' && queryShopId && typeof queryShopId === 'string') {
    return queryShopId;
  }
  
  return userShopId || null;
};

// Helper to generate GRN Number
const generateGRNNumber = async (shopId: string): Promise<string> => {
  const count = await prisma.gRN.count({ where: { shopId } });
  const dateStr = new Date().getFullYear().toString();
  // Format: GRN-2024-001
  return `GRN-${dateStr}-${(count + 1).toString().padStart(4, '0')}`;
};

// Create a new GRN with full stock/price effects
export const createGRN = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shopId = getEffectiveShopId(req);
    const userId = req.user?.id;
    
    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const {
      supplierId,
      referenceNo,
      date,
      expectedDate,
      deliveryNote,
      vehicleNumber,
      receivedBy,
      receivedDate,
      items, // Array of { productId, quantity, costPrice, sellingPrice? }
      discount = 0,
      tax = 0,
      notes,
      paymentStatus = 'UNPAID',
      paidAmount = 0
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'GRN must have at least one item' });
    }

    // Calculate totals
    const subtotal = items.reduce((sum: number, item: any) => sum + (item.quantity * item.costPrice), 0);
    const totalAmount = subtotal + tax - discount;

    const grnNumber = await generateGRNNumber(shopId);

    // Perform everything in a transaction
    const grn = await prisma.$transaction(async (tx) => {
      // 1. Create GRN Header
      const newGRN = await tx.gRN.create({
        data: {
          shopId,
          grnNumber,
          supplierId,
          referenceNo,
          date: date ? new Date(date) : new Date(),
          expectedDate: expectedDate ? new Date(expectedDate) : null,
          deliveryNote,
          vehicleNumber,
          receivedBy,
          receivedDate: receivedDate ? new Date(receivedDate) : null,
          subtotal,
          tax,
          discount,
          totalAmount,
          paidAmount,
          status: 'COMPLETED', // Direct to completed for now, or could be DRAFT
          paymentStatus: paymentStatus as PaymentStatus,
          notes,
          createdById: userId,
        }
      });

      // 2. Process Items
      for (const item of items) {
        // Fetch current product state
        const product = await tx.product.findUnique({
          where: { id: item.productId }
        });

        if (!product || product.shopId !== shopId) {
          throw new Error(`Product not found or access denied: ${item.productId}`);
        }

        // a. Create GRN Item
        await tx.gRNItem.create({
          data: {
            grnId: newGRN.id,
            productId: item.productId,
            quantity: item.quantity,
            costPrice: item.costPrice,
            sellingPrice: item.sellingPrice, // Optional new selling price
            totalCost: item.quantity * item.costPrice
          }
        });

        // b. Update Product Stock & Price
        const newStock = product.stock + item.quantity;
        const totalPurchased = product.totalPurchased + item.quantity;
        
        // Update product data
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stock: newStock,
            totalPurchased,
            costPrice: item.costPrice, // Update to latest cost
            lastCostPrice: product.costPrice, // Archive old cost
            // Update selling price ONLY if provided
            price: item.sellingPrice ? item.sellingPrice : product.price,
            lastGRNId: newGRN.id,
            lastGRNDate: new Date()
          }
        });

        // c. Create Stock Movement
        await tx.stockMovement.create({
          data: {
            shopId,
            productId: item.productId,
            type: StockMovementType.GRN_IN,
            quantity: item.quantity,
            previousStock: product.stock,
            newStock: newStock,
            referenceId: newGRN.id,
            referenceNumber: grnNumber,
            referenceType: 'grn',
            unitPrice: item.costPrice, // Cost price for GRN
            createdBy: userId,
            notes: `GRN Received from Supplier`
          }
        });

        // d. Price History (Track Changes)
        const costChanged = product.costPrice !== item.costPrice;
        const sellingChanged = item.sellingPrice && product.price !== item.sellingPrice;

        if (costChanged || sellingChanged) {
          let changeType: PriceChangeType = PriceChangeType.COST_UPDATE;
          if (costChanged && sellingChanged) changeType = PriceChangeType.BOTH;
          else if (sellingChanged) changeType = PriceChangeType.SELLING_UPDATE;

          await tx.priceHistory.create({
            data: {
              shopId,
              productId: item.productId,
              product: { connect: { id: item.productId } },
              changeType,
              previousCostPrice: product.costPrice || 0,
              newCostPrice: item.costPrice,
              previousSellingPrice: product.price,
              newSellingPrice: item.sellingPrice || product.price,
              reason: `GRN ${grnNumber}`,
              referenceId: newGRN.id,
              createdBy: userId
            }
          });
        }
      }

      return newGRN;
    });

    res.status(201).json({ success: true, data: grn });
  } catch (error: any) {
    next(error);
  }
};

// Get all GRNs
export const getGRNs = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shopId = getEffectiveShopId(req);
    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const { status, supplierId } = req.query;

    const where: any = { shopId };
    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;

    const grns = await prisma.gRN.findMany({
      where,
      include: {
        supplier: {
          select: { name: true }
        },
        items: {
          select: {
            quantity: true
          }
        },
        _count: {
          select: { items: true, reminders: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    // Calculate totals for each GRN from items
    const grnsWithTotals = grns.map(grn => {
      const totalQuantity = grn.items.reduce((sum, item) => sum + item.quantity, 0);
      return {
        ...grn,
        totalOrderedQuantity: totalQuantity,
        totalAcceptedQuantity: totalQuantity, // All accepted for now
        totalRejectedQuantity: 0, // No rejection tracking yet
        reminderCount: grn._count.reminders, // Include reminder count
        items: undefined // Remove items from response to keep it light
      };
    });

    res.json({ success: true, data: grnsWithTotals });
  } catch (error) {
    next(error);
  }
};

// Get GRN Details
export const getGRNById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shopId = getEffectiveShopId(req);
    const { id } = req.params;

    const grn = await prisma.gRN.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: {
          include: {
            product: {
              select: { name: true, barcode: true, serialNumber: true }
            }
          }
        },
        createdBy: {
          select: { name: true }
        },
        _count: {
          select: { reminders: true }
        }
      }
    });

    if (!grn) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    if (grn.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Add reminderCount to response
    const grnWithReminders = {
      ...grn,
      reminderCount: grn._count.reminders
    };

    res.json({ success: true, data: grnWithReminders });
  } catch (error) {
    next(error);
  }
};

// Delete GRN with stock reversal
export const deleteGRN = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shopId = getEffectiveShopId(req);
    const userId = req.user?.id;
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const grn = await prisma.gRN.findUnique({
      where: { id },
      include: {
        items: true
      }
    });

    if (!grn) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    if (grn.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Reverse stock changes in a transaction
    await prisma.$transaction(async (tx) => {
      // Reverse each item's stock
      for (const item of grn.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId }
        });

        if (product) {
          const newStock = Math.max(0, product.stock - item.quantity);
          const newTotalPurchased = Math.max(0, product.totalPurchased - item.quantity);

          await tx.product.update({
            where: { id: item.productId },
            data: {
              stock: newStock,
              totalPurchased: newTotalPurchased
            }
          });

          // Create reversal stock movement
          await tx.stockMovement.create({
            data: {
              shopId,
              productId: item.productId,
              type: StockMovementType.ADJUSTMENT,
              quantity: -item.quantity,
              previousStock: product.stock,
              newStock: newStock,
              referenceId: grn.id,
              referenceNumber: grn.grnNumber,
              referenceType: 'grn_delete',
              unitPrice: item.costPrice,
              createdBy: userId,
              notes: `GRN Deleted - Stock Reversed`
            }
          });
        }
      }

      // Delete GRN items first (due to foreign key)
      await tx.gRNItem.deleteMany({
        where: { grnId: id }
      });

      // Delete the GRN
      await tx.gRN.delete({
        where: { id }
      });
    });

    res.json({ success: true, message: 'GRN deleted and stock reversed' });
  } catch (error) {
    next(error);
  }
};

// Update GRN (full update including items)
export const updateGRN = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shopId = getEffectiveShopId(req);
    const { id } = req.params;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const existingGRN = await prisma.gRN.findUnique({
      where: { id },
      include: { items: true }
    });

    if (!existingGRN) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    if (existingGRN.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const { 
      notes, paymentStatus, paidAmount, status, 
      supplierId, referenceNo, date, expectedDate,
      deliveryNote, vehicleNumber, receivedBy, receivedDate,
      discount, tax, items 
    } = req.body;

    // Calculate totals if items are provided
    let subtotal = existingGRN.subtotal;
    let totalAmount = existingGRN.totalAmount;
    
    if (items && Array.isArray(items) && items.length > 0) {
      subtotal = items.reduce((sum: number, item: { quantity: number; costPrice: number }) => 
        sum + (item.quantity * item.costPrice), 0);
      const discountAmount = discount || existingGRN.discount || 0;
      const taxAmount = tax || existingGRN.tax || 0;
      totalAmount = subtotal - discountAmount + taxAmount;
    }

    // Use transaction for atomic update
    const updated = await prisma.$transaction(async (tx) => {
      // If updating items, first reverse the old stock quantities
      if (items && Array.isArray(items) && items.length > 0) {
        // Reverse old item stock
        for (const oldItem of existingGRN.items) {
          if (oldItem.productId) {
            await tx.product.update({
              where: { id: oldItem.productId },
              data: {
                stock: { decrement: oldItem.quantity },
              }
            });
          }
        }
        
        // Delete existing items
        await tx.gRNItem.deleteMany({
          where: { grnId: id }
        });
      }

      // Update the GRN
      const updatedGRN = await tx.gRN.update({
        where: { id },
        data: {
          supplierId: supplierId || existingGRN.supplierId,
          referenceNo: referenceNo !== undefined ? referenceNo : existingGRN.referenceNo,
          date: date ? new Date(date) : existingGRN.date,
          expectedDate: expectedDate ? new Date(expectedDate) : existingGRN.expectedDate,
          deliveryNote: deliveryNote !== undefined ? deliveryNote : existingGRN.deliveryNote,
          vehicleNumber: vehicleNumber !== undefined ? vehicleNumber : existingGRN.vehicleNumber,
          receivedBy: receivedBy !== undefined ? receivedBy : existingGRN.receivedBy,
          receivedDate: receivedDate ? new Date(receivedDate) : existingGRN.receivedDate,
          notes: notes !== undefined ? notes : existingGRN.notes,
          paymentStatus: paymentStatus ? paymentStatus as PaymentStatus : existingGRN.paymentStatus,
          paidAmount: paidAmount !== undefined ? paidAmount : existingGRN.paidAmount,
          status: status ? status as GRNStatus : existingGRN.status,
          discount: discount !== undefined ? discount : existingGRN.discount,
          tax: tax !== undefined ? tax : existingGRN.tax,
          subtotal,
          totalAmount,
        }
      });

      // Create new items if provided and update stock
      if (items && Array.isArray(items) && items.length > 0) {
        for (const item of items) {
          await tx.gRNItem.create({
            data: {
              grnId: id,
              productId: item.productId,
              quantity: item.quantity,
              costPrice: item.costPrice,
              sellingPrice: item.sellingPrice || 0,
              totalCost: item.quantity * item.costPrice,
            }
          });
          
          // Update product stock and cost price
          if (item.productId) {
            const product = await tx.product.findUnique({
              where: { id: item.productId }
            });
            
            if (product) {
              await tx.product.update({
                where: { id: item.productId },
                data: {
                  stock: { increment: item.quantity },
                  costPrice: item.costPrice,
                  ...(item.sellingPrice && { price: item.sellingPrice }),
                }
              });
            }
          }
        }
      }

      // Return updated GRN with relations
      return await tx.gRN.findUnique({
        where: { id },
        include: {
          supplier: true,
          items: {
            include: {
              product: {
                select: { name: true }
              }
            }
          }
        }
      });
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
};

/**
 * Send GRN Email to Supplier with PDF attachment
 * POST /api/v1/grns/:id/send-email
 */
export const sendGRNEmail = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { pdfBase64, includeAttachment } = req.body;
    const shopId = getEffectiveShopId(req);

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // Find GRN with all related data
    const grn = await prisma.gRN.findFirst({
      where: {
        OR: [
          { id },
          { grnNumber: id },
          { grnNumber: id.replace(/^GRN-/, '') },
        ],
        shopId,
      },
      include: {
        supplier: true,
        shop: true,
        items: {
          include: {
            product: {
              select: { name: true }
            }
          }
        }
      }
    });

    if (!grn) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    // Check if supplier exists and has email
    if (!grn.supplier) {
      return res.status(400).json({ success: false, message: 'GRN has no registered supplier' });
    }

    if (!grn.supplier.email) {
      return res.status(400).json({ success: false, message: 'Supplier does not have an email address' });
    }

    // Prepare email data
    const emailData: GRNEmailData = {
      email: grn.supplier.email,
      supplierName: grn.supplier.name,
      grnNumber: grn.grnNumber,
      date: grn.date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }),
      items: grn.items.map(item => ({
        productName: item.product?.name || 'Unknown Product',
        quantity: item.quantity,
        costPrice: Number(item.costPrice),
        total: Number(item.totalCost)
      })),
      subtotal: Number(grn.subtotal),
      tax: Number(grn.tax),
      discount: Number(grn.discount),
      totalAmount: Number(grn.totalAmount),
      paidAmount: Number(grn.paidAmount),
      balanceDue: Number(grn.totalAmount) - Number(grn.paidAmount),
      paymentStatus: grn.paymentStatus,
      shopName: grn.shop?.name || 'Shop',
      shopSubName: grn.shop?.subName || undefined,
      shopAddress: grn.shop?.address || undefined,
      shopPhone: grn.shop?.phone || undefined,
      shopEmail: grn.shop?.email || undefined,
      shopWebsite: grn.shop?.website || undefined,
      shopLogo: grn.shop?.logo || undefined,
      notes: grn.notes || undefined,
    };

    // Send email synchronously (sendMailWithRetry has 30s hard timeout per attempt)
    const emailResult = await sendGRNWithPDF(
      emailData,
      includeAttachment ? pdfBase64 : undefined
    );

    if (!emailResult.success) {
      return res.status(500).json({
        success: false,
        message: `Failed to send email: ${emailResult.error || 'Unknown error'}`,
      });
    }

    console.log(`✅ GRN email sent to ${grn.supplier.email} for GRN #${grn.grnNumber}`);

    res.status(200).json({
      success: true,
      message: 'GRN email sent successfully',
      data: {
        sentTo: grn.supplier.email,
        grnNumber: grn.grnNumber,
        messageId: emailResult.messageId,
        hasPdfAttachment: !!(includeAttachment && pdfBase64),
      },
    });

  } catch (error) {
    next(error);
  }
};/**
 * Generate GRN PDF
 * GET /api/v1/grns/:id/pdf
 */
export const generateGRNPDFController = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shopId = getEffectiveShopId(req);
    const { id } = req.params;
    
    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // Fetch GRN with all necessary relations
    const grn = await prisma.gRN.findFirst({
      where: {
        OR: [
          { id },
          { grnNumber: id },
          { grnNumber: id.replace(/^GRN-/, '') },
        ],
        shopId,
      },
      include: {
        supplier: true,
        items: {
          include: {
            product: {
              include: {
                category: true,
              },
            },
          },
        },
        shop: true,
      },
    });
    
    if (!grn) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    // Prepare GRN PDF data
    const pdfData: GRNPDFData = {
      grnNumber: grn.grnNumber,
      supplierName: grn.supplier.name,
      supplierEmail: grn.supplier.email || undefined,
      supplierPhone: grn.supplier.phone || undefined,
      supplierAddress: grn.supplier.address || undefined,
      orderDate: grn.date.toISOString(),
      expectedDeliveryDate: grn.expectedDate?.toISOString() || grn.date.toISOString(),
      receivedDate: grn.receivedDate?.toISOString() || new Date().toISOString(),
      deliveryNote: grn.deliveryNote || undefined,
      receivedBy: grn.receivedBy || undefined,
      vehicleNumber: grn.vehicleNumber || undefined,
      status: grn.status.toLowerCase() as 'completed' | 'partial' | 'pending' | 'rejected',
      paymentStatus: grn.paymentStatus.toLowerCase() as 'paid' | 'unpaid' | 'partial',
      paymentMethod: undefined,
      items: grn.items.map((item) => ({
        productName: item.product?.name || 'Unknown Product',
        category: item.product?.category?.name || undefined,
        unitPrice: Number(item.costPrice),
        originalUnitPrice: undefined,
        orderedQuantity: item.quantity,
        receivedQuantity: item.quantity,
        acceptedQuantity: item.quantity,
        rejectedQuantity: 0,
        totalAmount: Number(item.totalCost),
        sellingPrice: item.sellingPrice ? Number(item.sellingPrice) : undefined,
        discountType: undefined,
        discountValue: undefined,
      })),
      totalOrderedQuantity: grn.items.reduce((sum, item) => sum + item.quantity, 0),
      totalReceivedQuantity: grn.items.reduce((sum, item) => sum + item.quantity, 0),
      totalAcceptedQuantity: grn.items.reduce((sum, item) => sum + item.quantity, 0),
      totalRejectedQuantity: 0,
      subtotal: Number(grn.subtotal),
      totalDiscount: grn.discount ? Number(grn.discount) : undefined,
      discountAmount: Number(grn.discount),
      taxAmount: Number(grn.tax),
      totalAmount: Number(grn.totalAmount),
      paidAmount: grn.paidAmount ? Number(grn.paidAmount) : undefined,
      notes: grn.notes || undefined,
      // Shop branding
      shopName: grn.shop.name,
      shopSubName: grn.shop.subName || undefined,
      shopAddress: grn.shop.address || undefined,
      shopPhone: grn.shop.phone || undefined,
      shopEmail: grn.shop.email || undefined,
      shopLogo: grn.shop.logo || undefined,
    };

    // Generate PDF
    const pdfBuffer = await generateGRNPDF(pdfData);
    
    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${grn.grnNumber}.pdf"`);
    res.send(pdfBuffer);
  } catch (error) {
    next(error);
  }
};
