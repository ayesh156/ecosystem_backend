import { Router } from 'express';
import {
  registerShop,
  getShopBySlug,
  getShopById,
  updateShop,
  getShopUsers,
  addShopUser,
  updateUserRole,
  getShopStats,
  listAllShops,
  toggleShopStatus,
  createShopForUser,
  getShopSections,
  updateShopSections,
  debugShopSections,
} from '../controllers/shop.controller';
import { protect, authorize, requireShop, requireShopAccess } from '../middleware/auth';
import { shopRegistrationRateLimiter, sensitiveRateLimiter } from '../middleware/rateLimiter';
import { validateShopRegistration } from '../middleware/validation';

const router = Router();

// ==========================================
// PUBLIC ROUTES (with rate limiting)
// ==========================================

// Register a new shop with admin user
// 🔒 Rate limited: 3 per day per IP
router.post('/register', shopRegistrationRateLimiter, validateShopRegistration, registerShop);

// Get shop by slug (public info - limited data exposure)
router.get('/slug/:slug', getShopBySlug);

// ==========================================
// CREATE SHOP FOR EXISTING USER (Protected - for users without a shop)
// ==========================================
router.post('/create-for-user', protect, sensitiveRateLimiter, createShopForUser);

// ==========================================
// AUTHENTICATED ROUTES (require shop access)
// ==========================================

// Get shop by ID - requires auth and shop access validation
router.get('/:id', protect, requireShopAccess, getShopById);

// Update shop settings (admin or super admin)
router.put('/:id', protect, requireShopAccess, authorize('ADMIN', 'SUPER_ADMIN'), sensitiveRateLimiter, updateShop);

// Get shop statistics
router.get('/:id/stats', protect, requireShopAccess, authorize('ADMIN', 'MANAGER', 'SUPER_ADMIN'), getShopStats);

// ==========================================
// USER MANAGEMENT (admin only)
// ==========================================

// Get all users in shop
router.get('/:id/users', protect, requireShopAccess, authorize('ADMIN', 'SUPER_ADMIN'), getShopUsers);

// Add new user to shop
router.post('/:id/users', protect, requireShopAccess, authorize('ADMIN', 'SUPER_ADMIN'), sensitiveRateLimiter, addShopUser);

// Update user role/status
router.put('/:id/users/:userId', protect, requireShopAccess, authorize('ADMIN', 'SUPER_ADMIN'), sensitiveRateLimiter, updateUserRole);

// ==========================================
// SECTION VISIBILITY (shop access or super admin)
// ==========================================

// Get hidden sections for a shop (for navigation filtering)
router.get('/:id/sections', protect, requireShopAccess, getShopSections);

// Update hidden sections
// SuperAdmin can update hiddenSections (affects ADMIN + USER)
// Shop ADMIN can update adminHiddenSections (affects USER only)
router.put('/:id/sections', protect, requireShopAccess, authorize('ADMIN', 'SUPER_ADMIN'), sensitiveRateLimiter, updateShopSections);

// DEBUG: Shop sections diagnostic endpoint
router.get('/:id/debug/sections', protect, requireShopAccess, debugShopSections);

// ==========================================
// SUPER ADMIN ROUTES (platform-wide)
// ==========================================

// List all shops (super admin only)
router.get('/', protect, authorize('SUPER_ADMIN'), listAllShops);

// Toggle shop active status
router.patch('/:id/toggle-status', protect, authorize('SUPER_ADMIN'), sensitiveRateLimiter, toggleShopStatus);

export default router;
