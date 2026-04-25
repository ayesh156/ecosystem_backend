import { Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import type { AuthRequest } from '../types/express';

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

// Create a new supplier
export const createSupplier = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shopId = getEffectiveShopId(req);
    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const { name, contactPerson, email, phone, address } = req.body;

    // Check if supplier with same name exists in this shop
    const existing = await prisma.supplier.findFirst({
      where: {
        shopId,
        name: { equals: name }
      }
    });

    if (existing) {
      return res.status(400).json({ success: false, message: 'Supplier with this name already exists' });
    }

    const supplier = await prisma.supplier.create({
      data: {
        shopId,
        name,
        contactPerson,
        email,
        phone,
        address
      }
    });

    res.status(201).json({ success: true, data: supplier });
  } catch (error) {
    next(error);
  }
};

// Get all suppliers for the shop
export const getSuppliers = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shopId = getEffectiveShopId(req);
    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    const suppliers = await prisma.supplier.findMany({
      where: { shopId, isActive: true },
      orderBy: { name: 'asc' },
      include: {
        grns: {
          where: {
            status: { in: ['COMPLETED', 'PENDING'] } // Only count completed/pending GRNs
          },
          select: {
            totalAmount: true,
            createdAt: true
          }
        },
        _count: {
          select: { grns: true }
        }
      }
    });

    // Calculate total purchases and add to response
    const suppliersWithTotals = suppliers.map(supplier => {
      const totalPurchases = supplier.grns.reduce((sum, grn) => sum + (grn.totalAmount || 0), 0);
      const lastOrder = supplier.grns.length > 0 
        ? supplier.grns.reduce((latest, grn) => 
            new Date(grn.createdAt) > new Date(latest.createdAt) ? grn : latest
          ).createdAt
        : null;
      
      return {
        ...supplier,
        totalPurchases,
        totalOrders: supplier._count.grns,
        lastOrder,
        grns: undefined // Remove grns array from response to keep it light
      };
    });

    res.json({ success: true, data: suppliersWithTotals });
  } catch (error) {
    next(error);
  }
};

// Get single supplier
export const getSupplierById = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shopId = getEffectiveShopId(req);
    const { id } = req.params;

    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: {
        grns: {
          orderBy: { createdAt: 'desc' },
          take: 5
        }
      }
    });

    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    if (supplier.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    res.json({ success: true, data: supplier });
  } catch (error) {
    next(error);
  }
};

// Update supplier
export const updateSupplier = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shopId = getEffectiveShopId(req);
    const { id } = req.params;
    const { name, contactPerson, email, phone, address, isActive } = req.body;

    const existing = await prisma.supplier.findUnique({
      where: { id }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    if (existing.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        name,
        contactPerson,
        email,
        phone,
        address,
        isActive
      }
    });

    res.json({ success: true, data: supplier });
  } catch (error) {
    next(error);
  }
};

// Delete supplier (soft delete usually better, but if no GRNs, maybe hard delete?)
// For now, let's allow delete if no GRNs, otherwise soft delete (isActive = false)
export const deleteSupplier = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const shopId = getEffectiveShopId(req);
    const { id } = req.params;

    const existing = await prisma.supplier.findUnique({
      where: { id },
      include: { _count: { select: { grns: true } } }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Supplier not found' });
    }

    if (existing.shopId !== shopId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (existing._count.grns > 0) {
      // Soft delete
      await prisma.supplier.update({
        where: { id },
        data: { isActive: false }
      });
      return res.json({ success: true, message: 'Supplier deactivated (has existing GRNs)' });
    }

    // Hard delete
    await prisma.supplier.delete({
      where: { id }
    });

    res.json({ success: true, message: 'Supplier deleted successfully' });
  } catch (error) {
    next(error);
  }
};
