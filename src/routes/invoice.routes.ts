import { Router } from 'express';
import { protect, requireShop } from '../middleware/auth';
import { routeTimeout } from '../middleware/timeout';
import {
  createInvoice,
  getAllInvoices,
  getInvoiceById,
  updateInvoice,
  deleteInvoice,
  addPayment,
  getInvoiceStats,
  getInvoiceReminders,
  createInvoiceReminder,
  getInvoiceItemHistory,
  createInvoiceItemHistory,
  sendInvoiceViaEmail,
  getInvoiceEmailStatus,
  downloadInvoicePDF,
  sendInvoiceEmailWithPDF,
} from '../controllers/invoice.controller';
import { validateInvoice, validateInvoiceUpdate, validatePayment } from '../validators/invoice.validator';

const router = Router();

// 🔒 All invoice routes require authentication
router.use(protect, requireShop);

// Invoice CRUD routes
router.route('/')
  .get(getAllInvoices)
  .post(validateInvoice, createInvoice);

router.route('/stats')
  .get(getInvoiceStats);

router.route('/:id')
  .get(getInvoiceById)
  .put(validateInvoiceUpdate, updateInvoice)
  .delete(deleteInvoice);

// Payment routes
router.route('/:id/payments')
  .post(validatePayment, addPayment);

// Reminder routes
router.route('/:id/reminders')
  .get(getInvoiceReminders)
  .post(createInvoiceReminder);

// Item history routes - Track changes to invoice items
router.route('/:id/item-history')
  .get(getInvoiceItemHistory)
  .post(createInvoiceItemHistory);

// PDF routes - Download invoice as PDF (timeout: 60s for Chromium PDF generation)
router.route('/:id/pdf')
  .get(routeTimeout(60000, 'PDF generation timed out. Please try again.'), downloadInvoicePDF);

// Email routes - Send invoice to customer email (timeout: 120s for SMTP retries)
router.route('/:id/send-email')
  .post(routeTimeout(120000, 'Email sending timed out. The SMTP server may be unreachable.'), sendInvoiceViaEmail);

// Email with PDF (timeout: 180s — PDF generation + SMTP retries)
router.route('/:id/send-email-with-pdf')
  .post(routeTimeout(180000, 'Email with PDF timed out. Please try again.'), sendInvoiceEmailWithPDF);

router.route('/:id/email-status')
  .get(getInvoiceEmailStatus);

export default router;
