import { Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { AppError } from '../middleware/errorHandler';

// Validation error handler
const handleValidationErrors = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMessages = errors.array().map(err => err.msg).join(', ');
    throw new AppError(errorMessages, 400);
  }
  next();
};

// Invoice validation rules
export const validateInvoice = [
  body('customerId')
    .optional() // Optional for walk-in customers
    .isString()
    .withMessage('Customer ID must be a string'),
  
  body('items')
    .isArray({ min: 1 })
    .withMessage('At least one item is required'),
  
  body('items.*.productId')
    .optional() // Optional for quick-add items
    .isString()
    .withMessage('Product ID must be a string'),
  
  body('items.*.productName')
    .notEmpty()
    .withMessage('Product name is required for each item'),
  
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be at least 1'),
  
  body('items.*.unitPrice')
    .isFloat({ min: 0 })
    .withMessage('Unit price must be a positive number'),
  
  body('dueDate')
    .notEmpty()
    .withMessage('Due date is required')
    .isISO8601()
    .withMessage('Due date must be a valid date'),
  
  body('tax')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Tax must be a positive number'),
  
  body('discount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Discount must be a positive number'),
  
  body('paidAmount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Paid amount must be a positive number'),
  
  body('paymentMethod')
    .optional()
    .isIn(['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT'])
    .withMessage('Invalid payment method'),
  
  body('salesChannel')
    .optional()
    .isIn(['ON_SITE', 'ONLINE'])
    .withMessage('Invalid sales channel'),
  
  handleValidationErrors,
];

// Payment validation rules
export const validatePayment = [
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Payment amount must be greater than 0'),
  
  body('paymentMethod')
    .notEmpty()
    .withMessage('Payment method is required')
    .isIn(['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT'])
    .withMessage('Invalid payment method'),
  
  body('notes')
    .optional()
    .isString()
    .withMessage('Notes must be a string'),
  
  body('reference')
    .optional()
    .isString()
    .withMessage('Reference must be a string'),
  
  handleValidationErrors,
];

// Invoice UPDATE validation rules (less strict - all fields optional)
export const validateInvoiceUpdate = [
  body('customerId')
    .optional()
    .isString()
    .withMessage('Customer ID must be a string'),
  
  body('items')
    .optional()
    .isArray({ min: 1 })
    .withMessage('At least one item is required when updating items'),
  
  body('items.*.productId')
    .optional({ values: 'null' })
    .isString()
    .withMessage('Product ID must be a string when provided'),
  
  body('items.*.productName')
    .optional()
    .notEmpty()
    .withMessage('Product name is required for each item'),
  
  body('items.*.quantity')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Quantity must be at least 1'),
  
  body('items.*.unitPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Unit price must be a positive number'),
  
  body('dueDate')
    .optional()
    .isISO8601()
    .withMessage('Due date must be a valid date'),
  
  body('tax')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Tax must be a positive number'),
  
  body('discount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Discount must be a positive number'),
  
  body('paidAmount')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Paid amount must be a positive number'),
  
  body('paymentMethod')
    .optional()
    .isIn(['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT'])
    .withMessage('Invalid payment method'),
  
  body('salesChannel')
    .optional()
    .isIn(['ON_SITE', 'ONLINE'])
    .withMessage('Invalid sales channel'),
  
  body('status')
    .optional()
    .isIn(['UNPAID', 'HALFPAY', 'FULLPAID', 'CANCELLED', 'REFUNDED'])
    .withMessage('Invalid invoice status'),
  
  body('notes')
    .optional()
    .isString()
    .withMessage('Notes must be a string'),
  
  handleValidationErrors,
];
