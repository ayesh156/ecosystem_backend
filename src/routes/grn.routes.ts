import { Router, Request, Response, NextFunction } from 'express';
import { protect, requireShop, authorize } from '../middleware/auth';
import type { AuthRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { PaymentMethod, PaymentStatus } from '@prisma/client';
import { routeTimeout } from '../middleware/timeout';
import { 
  createGRN, 
  getGRNs, 
  getGRNById,
  deleteGRN,
  updateGRN,
  sendGRNEmail,
  generateGRNPDFController
} from '../controllers/grn.controller';

const router = Router();

router.use(protect, requireShop);

router.post('/', createGRN);
router.get('/', getGRNs);
router.get('/:id', getGRNById);
router.get('/:id/pdf', routeTimeout(60000, 'PDF generation timed out. Please try again.'), generateGRNPDFController);
router.put('/:id', updateGRN);
router.delete('/:id', authorize('ADMIN', 'MANAGER'), deleteGRN);

// ==========================================
// GRN Payment Routes
// ==========================================

// GET /grns/:id/payments - Get payment history for a GRN
router.get('/:id/payments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = authReq.user?.shopId || (req.query.shopId as string);
    const grnIdOrNumber = req.params.id;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // Find GRN by ID or GRN number
    let grn = await prisma.gRN.findFirst({
      where: {
        OR: [
          { id: grnIdOrNumber },
          { grnNumber: grnIdOrNumber },
          { grnNumber: grnIdOrNumber.replace('GRN-', '') }
        ],
        shopId
      }
    });

    if (!grn) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    // Get all payments for this GRN
    const payments = await prisma.gRNPayment.findMany({
      where: { grnId: grn.id },
      orderBy: { sentAt: 'desc' },
      include: {
        recordedBy: {
          select: { id: true, name: true }
        }
      }
    });

    res.json({ success: true, data: payments });
  } catch (error) {
    next(error);
  }
});

// POST /grns/:id/payments - Record a new payment for a GRN
router.post('/:id/payments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = authReq.user?.shopId || (req.body.shopId as string);
    const userId = authReq.user?.id;
    const grnIdOrNumber = req.params.id;
    const { amount, paymentMethod, notes, message } = req.body;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid payment amount is required' });
    }

    // Find GRN by ID or GRN number
    let grn = await prisma.gRN.findFirst({
      where: {
        OR: [
          { id: grnIdOrNumber },
          { grnNumber: grnIdOrNumber },
          { grnNumber: grnIdOrNumber.replace('GRN-', '') }
        ],
        shopId
      }
    });

    if (!grn) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    // Validate payment amount doesn't exceed remaining
    const remainingAmount = grn.totalAmount - grn.paidAmount;
    if (amount > remainingAmount) {
      return res.status(400).json({ 
        success: false, 
        message: `Payment amount (${amount}) exceeds remaining balance (${remainingAmount})` 
      });
    }

    // Map payment method
    const validPaymentMethods: Record<string, PaymentMethod> = {
      'cash': 'CASH',
      'card': 'CARD',
      'bank': 'BANK_TRANSFER',
      'bank_transfer': 'BANK_TRANSFER',
      'credit': 'CREDIT',
      'cheque': 'CHEQUE'
    };
    
    const mappedPaymentMethod = validPaymentMethods[paymentMethod?.toLowerCase()] || 'CASH';

    // Calculate new paid amount and status
    const newPaidAmount = grn.paidAmount + amount;
    let newPaymentStatus: PaymentStatus = 'PARTIAL';
    if (newPaidAmount >= grn.totalAmount) {
      newPaymentStatus = 'PAID';
    } else if (newPaidAmount === 0) {
      newPaymentStatus = 'UNPAID';
    }

    // Create payment record and update GRN in transaction
    const [payment, updatedGRN] = await prisma.$transaction([
      prisma.gRNPayment.create({
        data: {
          grnId: grn.id,
          shopId,
          amount,
          paymentMethod: mappedPaymentMethod,
          notes: notes || message,
          message: message || notes,
          recordedById: userId,
        }
      }),
      prisma.gRN.update({
        where: { id: grn.id },
        data: {
          paidAmount: newPaidAmount,
          paymentStatus: newPaymentStatus
        },
        include: {
          supplier: true,
          items: { include: { product: { select: { id: true, name: true } } } }
        }
      })
    ]);

    res.status(201).json({ 
      success: true, 
      data: updatedGRN,
      payment,
    });
  } catch (error) {
    next(error);
  }
});

// POST /grns/:id/payment (singular - legacy support)
router.post('/:id/payment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = authReq.user?.shopId || (req.query.shopId as string) || (req.body.shopId as string);
    const userId = authReq.user?.id;
    const grnIdOrNumber = req.params.id;
    const { amount, paymentMethod, notes, message } = req.body;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid payment amount is required' });
    }

    // Find GRN by ID or GRN number
    let grn = await prisma.gRN.findFirst({
      where: {
        OR: [
          { id: grnIdOrNumber },
          { grnNumber: grnIdOrNumber },
          { grnNumber: grnIdOrNumber.replace('GRN-', '') }
        ],
        shopId
      }
    });

    if (!grn) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    // Map payment method
    const validPaymentMethods: Record<string, PaymentMethod> = {
      'cash': 'CASH',
      'card': 'CARD',
      'bank': 'BANK_TRANSFER',
      'bank_transfer': 'BANK_TRANSFER',
      'credit': 'CREDIT',
      'cheque': 'CHEQUE'
    };
    
    const mappedPaymentMethod = validPaymentMethods[paymentMethod?.toLowerCase()] || 'CASH';

    // Calculate new paid amount and status
    const newPaidAmount = grn.paidAmount + amount;
    let newPaymentStatus: PaymentStatus = 'PARTIAL';
    if (newPaidAmount >= grn.totalAmount) {
      newPaymentStatus = 'PAID';
    } else if (newPaidAmount === 0) {
      newPaymentStatus = 'UNPAID';
    }

    // Create payment record and update GRN in transaction
    const [payment, updatedGRN] = await prisma.$transaction([
      prisma.gRNPayment.create({
        data: {
          grnId: grn.id,
          shopId,
          amount,
          paymentMethod: mappedPaymentMethod,
          notes: notes || message,
          message: message || notes,
          recordedById: userId,
        }
      }),
      prisma.gRN.update({
        where: { id: grn.id },
        data: {
          paidAmount: newPaidAmount,
          paymentStatus: newPaymentStatus
        },
        include: {
          supplier: true,
          items: { include: { product: { select: { id: true, name: true } } } }
        }
      })
    ]);

    res.status(200).json({ 
      success: true, 
      data: updatedGRN,
      message: 'Payment recorded successfully'
    });
  } catch (error) {
    next(error);
  }
});

// ==========================================
// GRN Email Route
// ==========================================

// POST /grns/:id/send-email - Send GRN email to supplier (timeout: 120s for SMTP retries)
router.post('/:id/send-email', routeTimeout(120000, 'Email sending timed out. The SMTP server may be unreachable.'), sendGRNEmail);

// ==========================================
// GRN Reminder Routes
// ==========================================

// GET /grns/:id/reminders - Get all reminders for a GRN
router.get('/:id/reminders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = authReq.user?.shopId || (req.query.shopId as string);
    const grnIdOrNumber = req.params.id;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // Find GRN by ID or GRN number
    let grn = await prisma.gRN.findFirst({
      where: {
        OR: [
          { id: grnIdOrNumber },
          { grnNumber: grnIdOrNumber },
          { grnNumber: grnIdOrNumber.replace('GRN-', '') },
          { grnNumber: `GRN-${grnIdOrNumber}` }
        ],
        shopId
      }
    });

    if (!grn) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    // Get all reminders for this GRN
    const reminders = await prisma.gRNReminder.findMany({
      where: { grnId: grn.id },
      orderBy: { sentAt: 'desc' }
    });

    res.json({ 
      success: true, 
      data: reminders,
      reminderCount: reminders.length
    });
  } catch (error) {
    next(error);
  }
});

// POST /grns/:id/reminders - Create a new reminder for a GRN
router.post('/:id/reminders', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthRequest;
    const shopId = authReq.user?.shopId || (req.body.shopId as string);
    const grnIdOrNumber = req.params.id;
    const { type, channel, message, supplierPhone, supplierName } = req.body;

    if (!shopId) {
      return res.status(403).json({ success: false, message: 'Shop access required' });
    }

    // Find GRN by ID or GRN number
    let grn = await prisma.gRN.findFirst({
      where: {
        OR: [
          { id: grnIdOrNumber },
          { grnNumber: grnIdOrNumber },
          { grnNumber: grnIdOrNumber.replace('GRN-', '') },
          { grnNumber: `GRN-${grnIdOrNumber}` }
        ],
        shopId
      },
      include: { supplier: true }
    });

    if (!grn) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    // Create reminder record
    const reminder = await prisma.gRNReminder.create({
      data: {
        grnId: grn.id,
        shopId,
        type: type || 'PAYMENT',
        channel: channel || 'whatsapp',
        message,
        supplierPhone: supplierPhone || grn.supplier?.phone,
        supplierName: supplierName || grn.supplier?.name,
      }
    });

    // Get updated reminder count
    const reminderCount = await prisma.gRNReminder.count({
      where: { grnId: grn.id }
    });

    res.status(201).json({ 
      success: true, 
      data: reminder,
      reminderCount,
      message: 'Reminder recorded successfully'
    });
  } catch (error) {
    next(error);
  }
});

export default router;
