/**
 * Express Type Extensions
 * Centralized type definitions for Express request extensions
 */

import { Request } from 'express';

// ===================================
// User Type Definition
// ===================================

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  shopId: string | null;
  iat?: number;
  exp?: number;
}

// ===================================
// Extended Request Type
// ===================================

export interface AuthRequest extends Request {
  user?: AuthUser;
  requestId?: string;
}

// ===================================
// Global Express Type Augmentation
// ===================================

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

export {};
