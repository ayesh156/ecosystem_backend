/**
 * 🌱 EcoSystem Comprehensive Database Seed
 * ==========================================
 * World-class database seeding for all system sections.
 * 
 * This seed file can be run anytime to repopulate the database with:
 * - SuperAdmin user
 * - 2 complete shops with users, products, customers, suppliers, etc.
 * - Sample data for all features/variants of the system
 * 
 * Usage:
 *   npx prisma db seed
 *   OR
 *   npx tsx prisma/seed.ts
 * 
 * Author: World-class Database Engineer @ EcoSystem
 * Version: 2.1.0
 * Last Updated: 2026-02-18
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env before anything else
const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(process.cwd(), 'backend', '.env'),
  path.resolve(__dirname, '../.env'),
];
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    break;
  }
}

import { 
  PrismaClient, 
  InvoiceStatus, 
  PaymentMethod, 
  CreditStatus, 
  SalesChannel, 
  UserRole,
  CustomerType,
  StockMovementType,
  GRNStatus,
  PaymentStatus,
  ItemHistoryAction,
  ReminderType
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

// Use DIRECT_URL (port 5432) to bypass PgBouncer - avoids deadlocks, FK issues
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
});

console.log(`🔗 Using DB: ${(process.env.DIRECT_URL || process.env.DATABASE_URL || '').includes('5432') ? 'DIRECT (port 5432)' : 'POOLER (port 6543)'}`);

// ==========================================
// CONFIGURATION - Edit these as needed
// ==========================================

const CONFIG = {
  // Password hashing rounds
  BCRYPT_ROUNDS: 10,
  
  // Shop 1 Configuration
  SHOP1: {
    name: 'Eco-User',
    slug: 'eco-user',
    subName: 'SOLUTIONS',
    tagline: 'Computer Solutions',
    admin: {
      email: 'ecotec@gmail.com',
      password: 'Eco,1234',
      name: 'Eco Admin'
    }
  },
  
  // Shop 2 Configuration
  SHOP2: {
    name: 'Ecotec',
    slug: 'ecotec',
    subName: 'TECHNOLOGIES',
    tagline: 'Tech & Mobile Solutions',
    admin: {
      email: 'ecotec@ecotec.lk',
      password: 'Ecotec,1234',
      name: 'Ecotec Admin'
    }
  },
  
  // SuperAdmin Configuration
  SUPER_ADMIN: {
    email: 'sdachathuranga@gmail.com',
    password: 'SuperAdmin@123',
    name: 'Sachitha Chathuranga'
  },

  // Shop 3 Configuration - SuperAdmin's Shop (Sri Lankan Fake Details)
  SHOP3: {
    name: 'TechZone Lanka',
    slug: 'techzone-lanka',
    subName: 'ELECTRONICS',
    tagline: 'Your Digital Lifestyle Partner',
    admin: {
      email: 'sdachathuranga@gmail.com',
      password: 'SuperAdmin@123',
      name: 'Sachitha Chathuranga'
    }
  }
};

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Hash password using bcrypt
 */
async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, CONFIG.BCRYPT_ROUNDS);
}

/**
 * Generate random date within range
 */
function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

/**
 * Generate invoice number with format INV-YYYY-XXXX
 */
function generateInvoiceNumber(index: number, year: number = 2026): string {
  return `INV-${year}-${String(index).padStart(4, '0')}`;
}

/**
 * Generate GRN number with format GRN-YYYY-XXXX
 */
function generateGRNNumber(index: number, year: number = 2026): string {
  return `GRN-${year}-${String(index).padStart(4, '0')}`;
}

/**
 * Get random item from array
 */
function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Calculate warranty due date from months
 */
function getWarrantyDueDate(warrantyMonths: number): Date {
  const date = new Date();
  date.setMonth(date.getMonth() + warrantyMonths);
  return date;
}

// ==========================================
// CATEGORY DATA
// ==========================================

const CATEGORIES_DATA = [
  { name: 'Laptops', description: 'Laptop computers and notebooks' },
  { name: 'Desktops', description: 'Desktop computers and workstations' },
  { name: 'Monitors', description: 'Computer monitors and displays' },
  { name: 'Keyboards & Mice', description: 'Input devices and peripherals' },
  { name: 'Storage', description: 'Hard drives, SSDs, and USB drives' },
  { name: 'Networking', description: 'Routers, switches, and cables' },
  { name: 'Mobile Phones', description: 'Smartphones and feature phones' },
  { name: 'Tablets', description: 'Tablets and iPads' },
  { name: 'Accessories', description: 'Computer and mobile accessories' },
  { name: 'Printers', description: 'Printers and scanners' },
  { name: 'Components', description: 'Computer components and parts' },
  { name: 'Audio', description: 'Headphones, speakers, and microphones' }
];

// ==========================================
// BRAND DATA
// ==========================================

const BRANDS_DATA = [
  { name: 'HP', description: 'Hewlett-Packard', website: 'https://hp.com' },
  { name: 'Dell', description: 'Dell Technologies', website: 'https://dell.com' },
  { name: 'Lenovo', description: 'Lenovo Group', website: 'https://lenovo.com' },
  { name: 'Asus', description: 'ASUSTeK Computer Inc.', website: 'https://asus.com' },
  { name: 'Acer', description: 'Acer Inc.', website: 'https://acer.com' },
  { name: 'Samsung', description: 'Samsung Electronics', website: 'https://samsung.com' },
  { name: 'Apple', description: 'Apple Inc.', website: 'https://apple.com' },
  { name: 'LG', description: 'LG Electronics', website: 'https://lg.com' },
  { name: 'Sony', description: 'Sony Corporation', website: 'https://sony.com' },
  { name: 'Logitech', description: 'Logitech International', website: 'https://logitech.com' },
  { name: 'Microsoft', description: 'Microsoft Corporation', website: 'https://microsoft.com' },
  { name: 'TP-Link', description: 'TP-Link Technologies', website: 'https://tp-link.com' },
  { name: 'Western Digital', description: 'WD Storage Solutions', website: 'https://wd.com' },
  { name: 'Seagate', description: 'Seagate Technology', website: 'https://seagate.com' },
  { name: 'Kingston', description: 'Kingston Technology', website: 'https://kingston.com' },
  { name: 'SanDisk', description: 'SanDisk (WD)', website: 'https://sandisk.com' }
];

// ==========================================
// PRODUCT DATA (By Category)
// ==========================================

const PRODUCTS_DATA = [
  // Laptops
  { name: 'HP Pavilion 15', category: 'Laptops', brand: 'HP', price: 185000, costPrice: 165000, stock: 8, warranty: '1 Year', warrantyMonths: 12, barcode: 'HP-PAV-15-001' },
  { name: 'HP EliteBook 840', category: 'Laptops', brand: 'HP', price: 295000, costPrice: 265000, stock: 5, warranty: '2 Years', warrantyMonths: 24, barcode: 'HP-ELT-840-001' },
  { name: 'Dell Inspiron 15', category: 'Laptops', brand: 'Dell', price: 175000, costPrice: 155000, stock: 12, warranty: '1 Year', warrantyMonths: 12, barcode: 'DL-INS-15-001' },
  { name: 'Dell XPS 13', category: 'Laptops', brand: 'Dell', price: 385000, costPrice: 345000, stock: 4, warranty: '2 Years', warrantyMonths: 24, barcode: 'DL-XPS-13-001' },
  { name: 'Lenovo ThinkPad X1 Carbon', category: 'Laptops', brand: 'Lenovo', price: 425000, costPrice: 380000, stock: 3, warranty: '3 Years', warrantyMonths: 36, barcode: 'LN-X1C-001' },
  { name: 'Lenovo IdeaPad 3', category: 'Laptops', brand: 'Lenovo', price: 145000, costPrice: 125000, stock: 15, warranty: '1 Year', warrantyMonths: 12, barcode: 'LN-IP3-001' },
  { name: 'Asus VivoBook 15', category: 'Laptops', brand: 'Asus', price: 155000, costPrice: 135000, stock: 10, warranty: '1 Year', warrantyMonths: 12, barcode: 'AS-VB15-001' },
  { name: 'Acer Aspire 5', category: 'Laptops', brand: 'Acer', price: 135000, costPrice: 115000, stock: 18, warranty: '1 Year', warrantyMonths: 12, barcode: 'AC-ASP5-001' },
  
  // Desktops
  { name: 'HP ProDesk 400 G7', category: 'Desktops', brand: 'HP', price: 165000, costPrice: 145000, stock: 6, warranty: '3 Years', warrantyMonths: 36, barcode: 'HP-PD400-001' },
  { name: 'Dell OptiPlex 7080', category: 'Desktops', brand: 'Dell', price: 195000, costPrice: 175000, stock: 4, warranty: '3 Years', warrantyMonths: 36, barcode: 'DL-OP7080-001' },
  { name: 'Lenovo ThinkCentre M70s', category: 'Desktops', brand: 'Lenovo', price: 175000, costPrice: 155000, stock: 5, warranty: '3 Years', warrantyMonths: 36, barcode: 'LN-TC70S-001' },
  
  // Monitors
  { name: 'HP 24" FHD Monitor', category: 'Monitors', brand: 'HP', price: 45000, costPrice: 38000, stock: 20, warranty: '3 Years', warrantyMonths: 36, barcode: 'HP-M24-001' },
  { name: 'Dell 27" 4K Monitor', category: 'Monitors', brand: 'Dell', price: 85000, costPrice: 72000, stock: 8, warranty: '3 Years', warrantyMonths: 36, barcode: 'DL-M27-4K-001' },
  { name: 'LG 27" IPS Monitor', category: 'Monitors', brand: 'LG', price: 65000, costPrice: 55000, stock: 12, warranty: '3 Years', warrantyMonths: 36, barcode: 'LG-M27-IPS-001' },
  { name: 'Samsung 32" Curved Monitor', category: 'Monitors', brand: 'Samsung', price: 95000, costPrice: 82000, stock: 6, warranty: '3 Years', warrantyMonths: 36, barcode: 'SM-M32-CRV-001' },
  
  // Keyboards & Mice
  { name: 'Logitech MK270 Combo', category: 'Keyboards & Mice', brand: 'Logitech', price: 8500, costPrice: 6500, stock: 50, warranty: '1 Year', warrantyMonths: 12, barcode: 'LG-MK270-001' },
  { name: 'Logitech MX Master 3', category: 'Keyboards & Mice', brand: 'Logitech', price: 32000, costPrice: 27000, stock: 15, warranty: '2 Years', warrantyMonths: 24, barcode: 'LG-MXM3-001' },
  { name: 'Microsoft Surface Keyboard', category: 'Keyboards & Mice', brand: 'Microsoft', price: 28000, costPrice: 23000, stock: 11, warranty: '1 Year', warrantyMonths: 12, barcode: 'MS-SRFK-001' },
  { name: 'HP Wireless Mouse', category: 'Keyboards & Mice', brand: 'HP', price: 3500, costPrice: 2500, stock: 85, warranty: '1 Year', warrantyMonths: 12, barcode: 'HP-WM-001' },
  
  // Storage
  { name: 'WD Blue 1TB HDD', category: 'Storage', brand: 'Western Digital', price: 15500, costPrice: 12500, stock: 40, warranty: '2 Years', warrantyMonths: 24, barcode: 'WD-BL1TB-001' },
  { name: 'WD Black 2TB HDD', category: 'Storage', brand: 'Western Digital', price: 28000, costPrice: 23000, stock: 25, warranty: '5 Years', warrantyMonths: 60, barcode: 'WD-BK2TB-001' },
  { name: 'Seagate Barracuda 2TB', category: 'Storage', brand: 'Seagate', price: 22000, costPrice: 18000, stock: 30, warranty: '2 Years', warrantyMonths: 24, barcode: 'SG-BC2TB-001' },
  { name: 'Samsung 970 EVO 500GB SSD', category: 'Storage', brand: 'Samsung', price: 35000, costPrice: 28000, stock: 20, warranty: '5 Years', warrantyMonths: 60, barcode: 'SM-970EVO-001' },
  { name: 'Kingston A2000 1TB NVMe', category: 'Storage', brand: 'Kingston', price: 42000, costPrice: 35000, stock: 15, warranty: '5 Years', warrantyMonths: 60, barcode: 'KN-A2000-001' },
  { name: 'SanDisk 64GB USB Drive', category: 'Storage', brand: 'SanDisk', price: 2800, costPrice: 2000, stock: 100, warranty: '5 Years', warrantyMonths: 60, barcode: 'SD-USB64-001' },
  { name: 'SanDisk 128GB USB Drive', category: 'Storage', brand: 'SanDisk', price: 4500, costPrice: 3500, stock: 75, warranty: '5 Years', warrantyMonths: 60, barcode: 'SD-USB128-001' },
  
  // Networking
  { name: 'TP-Link Archer AX50', category: 'Networking', brand: 'TP-Link', price: 18500, costPrice: 14500, stock: 25, warranty: '3 Years', warrantyMonths: 36, barcode: 'TP-AX50-001' },
  { name: 'TP-Link 8-Port Switch', category: 'Networking', brand: 'TP-Link', price: 5500, costPrice: 4000, stock: 40, warranty: '5 Years', warrantyMonths: 60, barcode: 'TP-SW8-001' },
  { name: 'TP-Link RE305 Range Extender', category: 'Networking', brand: 'TP-Link', price: 8500, costPrice: 6500, stock: 30, warranty: '2 Years', warrantyMonths: 24, barcode: 'TP-RE305-001' },
  
  // Mobile Phones
  { name: 'Samsung Galaxy S23', category: 'Mobile Phones', brand: 'Samsung', price: 285000, costPrice: 255000, stock: 10, warranty: '1 Year', warrantyMonths: 12, barcode: 'SM-GS23-001' },
  { name: 'Samsung Galaxy A54', category: 'Mobile Phones', brand: 'Samsung', price: 135000, costPrice: 115000, stock: 15, warranty: '1 Year', warrantyMonths: 12, barcode: 'SM-GA54-001' },
  { name: 'Apple iPhone 15', category: 'Mobile Phones', brand: 'Apple', price: 385000, costPrice: 345000, stock: 8, warranty: '1 Year', warrantyMonths: 12, barcode: 'AP-IP15-001' },
  { name: 'Apple iPhone 15 Pro', category: 'Mobile Phones', brand: 'Apple', price: 485000, costPrice: 435000, stock: 5, warranty: '1 Year', warrantyMonths: 12, barcode: 'AP-IP15P-001' },
  
  // Tablets
  { name: 'Apple iPad 10th Gen', category: 'Tablets', brand: 'Apple', price: 145000, costPrice: 125000, stock: 12, warranty: '1 Year', warrantyMonths: 12, barcode: 'AP-IPD10-001' },
  { name: 'Samsung Galaxy Tab S9', category: 'Tablets', brand: 'Samsung', price: 195000, costPrice: 170000, stock: 8, warranty: '1 Year', warrantyMonths: 12, barcode: 'SM-TABS9-001' },
  
  // Accessories
  { name: 'Laptop Bag 15.6"', category: 'Accessories', brand: 'HP', price: 4500, costPrice: 3200, stock: 60, warranty: '6 Months', warrantyMonths: 6, barcode: 'HP-BAG15-001' },
  { name: 'USB-C Hub 7-in-1', category: 'Accessories', brand: 'Dell', price: 12500, costPrice: 9500, stock: 35, warranty: '1 Year', warrantyMonths: 12, barcode: 'DL-HUB7-001' },
  { name: 'Laptop Cooling Pad', category: 'Accessories', brand: 'Asus', price: 6500, costPrice: 4800, stock: 45, warranty: '1 Year', warrantyMonths: 12, barcode: 'AS-COOL-001' },
  { name: 'Webcam HD 1080p', category: 'Accessories', brand: 'Logitech', price: 15000, costPrice: 11500, stock: 25, warranty: '2 Years', warrantyMonths: 24, barcode: 'LG-WC1080-001' },
  
  // Printers
  { name: 'HP LaserJet Pro M404n', category: 'Printers', brand: 'HP', price: 85000, costPrice: 72000, stock: 8, warranty: '1 Year', warrantyMonths: 12, barcode: 'HP-LJ404-001' },
  { name: 'HP DeskJet 2720', category: 'Printers', brand: 'HP', price: 22000, costPrice: 17500, stock: 16, warranty: '1 Year', warrantyMonths: 12, barcode: 'HP-DJ2720-001' },
  { name: 'Brother HL-L2350DW', category: 'Printers', brand: 'HP', price: 45000, costPrice: 38000, stock: 10, warranty: '2 Years', warrantyMonths: 24, barcode: 'BR-HLL2350-001' },
  
  // Components
  { name: 'Corsair 16GB DDR4 RAM', category: 'Components', brand: 'Kingston', price: 18500, costPrice: 15000, stock: 30, warranty: 'Lifetime', warrantyMonths: 120, barcode: 'CR-RAM16-001' },
  { name: 'Kingston 8GB DDR4 RAM', category: 'Components', brand: 'Kingston', price: 9500, costPrice: 7500, stock: 48, warranty: 'Lifetime', warrantyMonths: 120, barcode: 'KN-RAM8-001' },
  { name: 'Asus GTX 1660 Super', category: 'Components', brand: 'Asus', price: 95000, costPrice: 82000, stock: 6, warranty: '3 Years', warrantyMonths: 36, barcode: 'AS-GTX1660-001' },
  
  // Audio
  { name: 'Sony WH-1000XM5', category: 'Audio', brand: 'Sony', price: 125000, costPrice: 105000, stock: 10, warranty: '1 Year', warrantyMonths: 12, barcode: 'SN-WH1000-001' },
  { name: 'Logitech H390 USB Headset', category: 'Audio', brand: 'Logitech', price: 12500, costPrice: 9500, stock: 30, warranty: '2 Years', warrantyMonths: 24, barcode: 'LG-H390-001' },
  { name: 'JBL Flip 6 Speaker', category: 'Audio', brand: 'Sony', price: 38000, costPrice: 31000, stock: 15, warranty: '1 Year', warrantyMonths: 12, barcode: 'JBL-FLIP6-001' }
];

// ==========================================
// CUSTOMER DATA (Varied types)
// ==========================================

const CUSTOMERS_DATA = [
  // Regular customers
  { name: 'Kamal Perera', email: 'kamal.perera@gmail.com', phone: '0771234567', address: 'No. 45, Galle Road, Colombo 03', nic: '901234567V', type: 'REGULAR' as CustomerType },
  { name: 'Nimal Silva', email: 'nimal.silva@yahoo.com', phone: '0712345678', address: 'No. 123, Main Street, Kandy', nic: '851234568V', type: 'REGULAR' as CustomerType },
  { name: 'Sunil Fernando', email: 'sunil.f@gmail.com', phone: '0761234567', address: 'No. 78, Beach Road, Galle', nic: '921234569V', type: 'REGULAR' as CustomerType },
  { name: 'Priya Jayawardena', email: 'priya.j@outlook.com', phone: '0752345678', address: 'No. 56, Temple Road, Negombo', nic: '941234570V', type: 'REGULAR' as CustomerType },
  { name: 'Ruwan Bandara', email: 'ruwan.b@gmail.com', phone: '0783456789', address: 'No. 89, High Level Road, Nugegoda', nic: '881234571V', type: 'REGULAR' as CustomerType },
  
  // Wholesale customers
  { name: 'ABC Computers', email: 'info@abccomputers.lk', phone: '0114567890', address: 'No. 234, Duplication Road, Colombo 03', nic: null, type: 'WHOLESALE' as CustomerType, creditLimit: 50000 },
  { name: 'Tech Solutions Lanka', email: 'sales@techsolutions.lk', phone: '0115678901', address: 'No. 567, Baseline Road, Colombo 09', nic: null, type: 'WHOLESALE' as CustomerType, creditLimit: 50000 },
  
  // Dealers
  { name: 'CompuMart Dealers', email: 'orders@compumart.lk', phone: '0116789012', address: 'No. 890, Kandy Road, Kadawatha', nic: null, type: 'DEALER' as CustomerType },
  { name: 'Digital Hub Trading', email: 'contact@digitalhub.lk', phone: '0117890123', address: 'No. 45, Negombo Road, Wattala', nic: null, type: 'DEALER' as CustomerType },
  
  // Corporate customers
  { name: 'Lanka Insurance PLC', email: 'it@lankainsurance.lk', phone: '0118901234', address: 'No. 123, Union Place, Colombo 02', nic: null, type: 'CORPORATE' as CustomerType },
  { name: 'ABC Holdings Ltd', email: 'procurement@abcholdings.lk', phone: '0119012345', address: 'No. 456, Galle Face, Colombo 01', nic: null, type: 'CORPORATE' as CustomerType },
  { name: 'National School Polonnaruwa', email: 'office@nsp.edu.lk', phone: '0270123456', address: 'Main Street, Polonnaruwa', nic: null, type: 'CORPORATE' as CustomerType },
  
  // VIP customers
  { name: 'Dr. Saman Wickramasinghe', email: 'dr.saman@gmail.com', phone: '0779876543', address: 'No. 12, Ward Place, Colombo 07', nic: '751234572V', type: 'VIP' as CustomerType },
  { name: 'Eng. Malini Rajapaksa', email: 'malini.eng@yahoo.com', phone: '0718765432', address: 'No. 34, Flower Road, Colombo 07', nic: '801234573V', type: 'VIP' as CustomerType },
  
  // More regular customers with credit
  { name: 'Chaminda Rathnayake', email: 'chaminda.r@gmail.com', phone: '0767654321', address: 'No. 67, Station Road, Moratuwa', nic: '911234574V', type: 'REGULAR' as CustomerType, credit: true },
  { name: 'Sanduni Herath', email: 'sanduni.h@outlook.com', phone: '0756543210', address: 'No. 98, Main Street, Panadura', nic: '961234575V', type: 'REGULAR' as CustomerType, credit: true }
];

// ==========================================
// SUPPLIER DATA
// ==========================================

const SUPPLIERS_DATA = [
  { name: 'HP Sri Lanka', contact: 'Roshan Fernando', email: 'ecoteccomputersolutions@gmail.com', phone: '0112345678', address: 'No. 45, Duplication Road, Colombo 03' },
  { name: 'Dell Technologies Lanka', contact: 'Chamara Perera', email: 'eshararanaveeraa2@gmail.com', phone: '0112456789', address: 'No. 89, Galle Road, Colombo 04' },
  { name: 'Lenovo Authorized Distributor', contact: 'Nirmala Silva', email: 'nebulainfinitex@gmail.com', phone: '0113456789', address: 'No. 123, Union Place, Colombo 02' },
  { name: 'Samsung Electronics Lanka', contact: 'Dilshan Jayawardena', email: 'dilshan@samsung.lk', phone: '0114567890', address: 'No. 234, Baseline Road, Colombo 09' },
  { name: 'Apple Premium Reseller', contact: 'Kavindi Rodrigo', email: 'kavindi@applereseller.lk', phone: '0115678901', address: 'No. 56, Ward Place, Colombo 07' },
  { name: 'Redington Lanka', contact: 'Ajith Bandara', email: 'ajith@redington.lk', phone: '0116789012', address: 'No. 789, Nawala Road, Rajagiriya' },
  { name: 'Softlogic Distribution', contact: 'Priyanka Herath', email: 'priyanka@softlogic.lk', phone: '0117890123', address: 'No. 321, High Level Road, Nugegoda' },
  { name: 'Metropolitan Computer Wholesale', contact: 'Ranjith Fernando', email: 'ranjith@metro.lk', phone: '0118901234', address: 'No. 654, Negombo Road, Wattala' }
];

// ==========================================
// MAIN SEED FUNCTION
// ==========================================

async function main() {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           🌱 ECOSYSTEM DATABASE SEEDING                       ║');
  console.log('║              World-Class Sample Data                          ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');

  // ==========================================
  // STEP 0: CLEAN EXISTING DATA
  // ==========================================
  console.log('🧹 Cleaning existing data...');
  
  // Using DIRECT_URL (not PgBouncer), so sequential deleteMany works reliably
  await prisma.invoiceReminder.deleteMany();
  await prisma.gRNReminder.deleteMany();
  await prisma.invoiceItemHistory.deleteMany();
  await prisma.invoicePayment.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.gRNPayment.deleteMany();
  await prisma.gRNItem.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.priceHistory.deleteMany();
  await prisma.customerPaymentRecord.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.gRN.deleteMany();
  await prisma.product.deleteMany();
  await prisma.customer.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.category.deleteMany();
  await prisma.brand.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.shop.deleteMany();
  
  console.log('   ✅ Database cleaned successfully');
  console.log('');

  // ==========================================
  // STEP 1: SUPER ADMIN
  // ==========================================
  console.log('📌 STEP 1: Creating Super Admin...');
  
  const superAdminPassword = await hashPassword(CONFIG.SUPER_ADMIN.password);
  
  const superAdmin = await prisma.user.upsert({
    where: { email: CONFIG.SUPER_ADMIN.email },
    update: {
      name: CONFIG.SUPER_ADMIN.name,
      password: superAdminPassword,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
    },
    create: {
      email: CONFIG.SUPER_ADMIN.email,
      password: superAdminPassword,
      name: CONFIG.SUPER_ADMIN.name,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
      lastLogin: new Date(),
      shopId: null,
    },
  });
  console.log(`   ✅ SUPER_ADMIN: ${superAdmin.email} / ${CONFIG.SUPER_ADMIN.password}`);
  console.log('');

  // ==========================================
  // STEP 2: CREATE SHOPS
  // ==========================================
  console.log('📌 STEP 2: Creating Shops...');
  
  // Shop 1: Eco-User
  const shop1 = await prisma.shop.upsert({
    where: { slug: CONFIG.SHOP1.slug },
    update: {},
    create: {
      name: CONFIG.SHOP1.name,
      slug: CONFIG.SHOP1.slug,
      subName: CONFIG.SHOP1.subName,
      tagline: CONFIG.SHOP1.tagline,
      description: 'Your trusted partner for computer solutions',
      address: 'No. 123, Galle Road, Colombo 03, Sri Lanka',
      phone: '+94 11 234 5678',
      email: 'info@ecouser.lk',
      website: 'https://ecouser.lk',
      businessRegNo: 'PV00123456',
      taxId: 'TIN123456789',
      currency: 'LKR',
      taxRate: 0,
      isActive: true,
      reminderEnabled: true,
      paymentReminderTemplate: `Hello {{customerName}}! 👋\n\nGreetings from *{{shopName}}*!\n\nThis is a friendly reminder about your pending payment:\n\n📄 *Invoice:* #{{invoiceId}}\n💰 *Total Amount:* Rs. {{totalAmount}}\n✅ *Paid:* Rs. {{paidAmount}}\n⏳ *Balance Due:* Rs. {{dueAmount}}\n📅 *Due Date:* {{dueDate}}\n\nWe kindly request you to settle your outstanding balance at your earliest convenience.\n\nIf you've already made the payment, please disregard this message.\n\nFor any queries, please contact us.\n\nThank you for your continued trust! 🙏\n\n*{{shopName}}*\n📞 {{shopPhone}}\n📍 {{shopAddress}}`,
      overdueReminderTemplate: `⚠️ *URGENT: Payment Overdue Notice*\n\nDear {{customerName}},\n\nWe regret to inform you that your payment is now *OVERDUE*.\n\n📄 *Invoice:* #{{invoiceId}}\n📅 *Original Due Date:* {{dueDate}}\n⏰ *Days Overdue:* {{daysOverdue}} days\n💰 *Outstanding Amount:* Rs. {{dueAmount}}\n\n*Immediate action is required.* Please settle this payment as soon as possible to avoid any inconvenience.\n\nFor payment assistance or queries, please contact us immediately.\n\nWe value your business and appreciate your prompt attention to this matter.\n\nBest regards,\n*{{shopName}}*\n📞 {{shopPhone}}\n📍 {{shopAddress}}`,
      grnReminderEnabled: true,
      grnPaymentReminderTemplate: `Hello! 👋\n\nGreetings from *{{shopName}}*!\n\nThis is a friendly notification regarding your GRN payment:\n\n📄 *GRN Number:* #{{grnNumber}}\n🏢 *Supplier:* {{supplierName}}\n💰 *Total Amount:* Rs. {{totalAmount}}\n✅ *Paid:* Rs. {{paidAmount}}\n⏳ *Balance Due:* Rs. {{balanceDue}}\n📅 *GRN Date:* {{grnDate}}\n\nWe will process the remaining payment as per our agreement.\n\nFor any queries, please contact us.\n\nThank you for your partnership! 🙏\n\n*{{shopName}}*\n📞 {{shopPhone}}\n📍 {{shopAddress}}`,
      grnOverdueReminderTemplate: `🚨 *URGENT: Payment Overdue*\n\nDear {{supplierName}},\n\nThis is an urgent reminder regarding the *overdue* payment for:\n\n📄 *GRN Number:* #{{grnNumber}}\n📅 *GRN Date:* {{grnDate}}\n💰 *Total Amount:* Rs. {{totalAmount}}\n✅ *Paid:* Rs. {{paidAmount}}\n⏳ *Balance Due:* Rs. {{balanceDue}}\n\n⚠️ Please note that this payment is now overdue. We kindly request you to coordinate with us for the settlement.\n\nFor any queries or to discuss payment arrangements, please contact us immediately.\n\nBest regards,\n*{{shopName}}*\n📞 {{shopPhone}}\n📍 {{shopAddress}}`,
      supplierOrderTemplate: `🛒 *NEW ORDER REQUEST*\n━━━━━━━━━━━━━━━━━━━━━\n\nHello {{supplierName}}! 👋\n\nThis is *{{shopName}}* reaching out for a new order.\n\n📅 *Date:* {{orderDate}}\n🏢 *Supplier:* {{supplierCompany}}\n\n━━━━━━━━━━━━━━━━━━━━━\n📦 *ORDER DETAILS:*\n━━━━━━━━━━━━━━━━━━━━━\n\nPlease share your:\n✅ Latest product catalog\n✅ Current stock availability\n✅ Best pricing for bulk orders\n✅ Expected delivery timeline\n\n━━━━━━━━━━━━━━━━━━━━━\n\nWe look forward to doing business with you! 🤝\n\n_Sent via {{shopName}} POS System_\n🌟 *Quality Products, Quality Service*\n📞 {{shopPhone}}\n📍 {{shopAddress}}`,
      hiddenSections: [
        '/job-notes',
        '/service-categories',
        '/services',
        '/quotations',
        '/data-export',
        '/pricing-proposals',
        '/cash-management/insights',
        '/cash-management/accounts',
        '/reports',
        '/cash-management/transactions',
        '/warranties',
        '/estimates',
      ],
    },
  });
  console.log(`   ✅ Shop 1: ${shop1.name} (${shop1.slug})`);

  // Shop 2: Ecotec
  const shop2 = await prisma.shop.upsert({
    where: { slug: CONFIG.SHOP2.slug },
    update: {},
    create: {
      name: CONFIG.SHOP2.name,
      slug: CONFIG.SHOP2.slug,
      subName: CONFIG.SHOP2.subName,
      tagline: CONFIG.SHOP2.tagline,
      description: 'Tech & Mobile Solutions for Modern Business',
      address: 'No. 456, Kandy Road, Kadawatha, Sri Lanka',
      phone: '+94 11 456 7890',
      email: 'info@ecotec.lk',
      website: 'https://ecotec.lk',
      businessRegNo: 'PV00789012',
      taxId: 'TIN987654321',
      currency: 'LKR',
      taxRate: 0,
      isActive: true,
      reminderEnabled: true,
      paymentReminderTemplate: `Hello {{customerName}}! 👋\n\nGreetings from *{{shopName}}*!\n\nThis is a friendly reminder about your pending payment:\n\n📄 *Invoice:* #{{invoiceId}}\n💰 *Total Amount:* Rs. {{totalAmount}}\n✅ *Paid:* Rs. {{paidAmount}}\n⏳ *Balance Due:* Rs. {{dueAmount}}\n📅 *Due Date:* {{dueDate}}\n\nWe kindly request you to settle your outstanding balance at your earliest convenience.\n\nIf you've already made the payment, please disregard this message.\n\nFor any queries, please contact us.\n\nThank you for your continued trust! 🙏\n\n*{{shopName}}*\n📞 {{shopPhone}}\n📍 {{shopAddress}}`,
      overdueReminderTemplate: `⚠️ *URGENT: Payment Overdue Notice*\n\nDear {{customerName}},\n\nWe regret to inform you that your payment is now *OVERDUE*.\n\n📄 *Invoice:* #{{invoiceId}}\n📅 *Original Due Date:* {{dueDate}}\n⏰ *Days Overdue:* {{daysOverdue}} days\n💰 *Outstanding Amount:* Rs. {{dueAmount}}\n\n*Immediate action is required.* Please settle this payment as soon as possible to avoid any inconvenience.\n\nFor payment assistance or queries, please contact us immediately.\n\nWe value your business and appreciate your prompt attention to this matter.\n\nBest regards,\n*{{shopName}}*\n📞 {{shopPhone}}\n📍 {{shopAddress}}`,
      grnReminderEnabled: true,
      grnPaymentReminderTemplate: `Hello! 👋\n\nGreetings from *{{shopName}}*!\n\nThis is a friendly notification regarding your GRN payment:\n\n📄 *GRN Number:* #{{grnNumber}}\n🏢 *Supplier:* {{supplierName}}\n💰 *Total Amount:* Rs. {{totalAmount}}\n✅ *Paid:* Rs. {{paidAmount}}\n⏳ *Balance Due:* Rs. {{balanceDue}}\n📅 *GRN Date:* {{grnDate}}\n\nWe will process the remaining payment as per our agreement.\n\nFor any queries, please contact us.\n\nThank you for your partnership! 🙏\n\n*{{shopName}}*\n📞 {{shopPhone}}\n📍 {{shopAddress}}`,
      grnOverdueReminderTemplate: `🚨 *URGENT: Payment Overdue*\n\nDear {{supplierName}},\n\nThis is an urgent reminder regarding the *overdue* payment for:\n\n📄 *GRN Number:* #{{grnNumber}}\n📅 *GRN Date:* {{grnDate}}\n💰 *Total Amount:* Rs. {{totalAmount}}\n✅ *Paid:* Rs. {{paidAmount}}\n⏳ *Balance Due:* Rs. {{balanceDue}}\n\n⚠️ Please note that this payment is now overdue. We kindly request you to coordinate with us for the settlement.\n\nFor any queries or to discuss payment arrangements, please contact us immediately.\n\nBest regards,\n*{{shopName}}*\n📞 {{shopPhone}}\n📍 {{shopAddress}}`,
      supplierOrderTemplate: `🛒 *NEW ORDER REQUEST*\n━━━━━━━━━━━━━━━━━━━━━\n\nHello {{supplierName}}! 👋\n\nThis is *{{shopName}}* reaching out for a new order.\n\n📅 *Date:* {{orderDate}}\n🏢 *Supplier:* {{supplierCompany}}\n\n━━━━━━━━━━━━━━━━━━━━━\n📦 *ORDER DETAILS:*\n━━━━━━━━━━━━━━━━━━━━━\n\nPlease share your:\n✅ Latest product catalog\n✅ Current stock availability\n✅ Best pricing for bulk orders\n✅ Expected delivery timeline\n\n━━━━━━━━━━━━━━━━━━━━━\n\nWe look forward to doing business with you! 🤝\n\n_Sent via {{shopName}} POS System_\n🌟 *Quality Products, Quality Service*\n📞 {{shopPhone}}\n📍 {{shopAddress}}`,
    },
  });
  console.log(`   ✅ Shop 2: ${shop2.name} (${shop2.slug})`);

  // Shop 3: TechZone Lanka (SuperAdmin's Shop) - Sri Lankan Fake Details
  const shop3 = await prisma.shop.upsert({
    where: { slug: CONFIG.SHOP3.slug },
    update: {},
    create: {
      name: CONFIG.SHOP3.name,
      slug: CONFIG.SHOP3.slug,
      subName: CONFIG.SHOP3.subName,
      tagline: CONFIG.SHOP3.tagline,
      description: 'Premium computers, mobiles & accessories in Nugegoda',
      address: 'No. 78/A, High Level Road, Nugegoda, Sri Lanka',
      phone: '+94 11 285 6743',
      email: 'info@techzonelanka.lk',
      website: 'https://techzonelanka.lk',
      businessRegNo: 'PV00456789',
      taxId: 'TIN456789123',
      currency: 'LKR',
      taxRate: 0,
      isActive: true,
      reminderEnabled: true,
      paymentReminderTemplate: `Hello {{customerName}}! 👋\n\nGreetings from *{{shopName}}*!\n\nThis is a friendly reminder about your pending payment:\n\n📄 *Invoice:* #{{invoiceId}}\n💰 *Total Amount:* Rs. {{totalAmount}}\n✅ *Paid:* Rs. {{paidAmount}}\n⏳ *Balance Due:* Rs. {{dueAmount}}\n📅 *Due Date:* {{dueDate}}\n\nWe kindly request you to settle your outstanding balance at your earliest convenience.\n\nIf you've already made the payment, please disregard this message.\n\nFor any queries, please contact us.\n\nThank you for your continued trust! 🙏\n\n*{{shopName}}*\n📞 {{shopPhone}}\n📍 {{shopAddress}}`,
      overdueReminderTemplate: `⚠️ *URGENT: Payment Overdue Notice*\n\nDear {{customerName}},\n\nWe regret to inform you that your payment is now *OVERDUE*.\n\n📄 *Invoice:* #{{invoiceId}}\n📅 *Original Due Date:* {{dueDate}}\n⏰ *Days Overdue:* {{daysOverdue}} days\n💰 *Outstanding Amount:* Rs. {{dueAmount}}\n\n*Immediate action is required.* Please settle this payment as soon as possible to avoid any inconvenience.\n\nFor payment assistance or queries, please contact us immediately.\n\nWe value your business and appreciate your prompt attention to this matter.\n\nBest regards,\n*{{shopName}}*\n📞 {{shopPhone}}\n📍 {{shopAddress}}`,
      grnReminderEnabled: true,
      grnPaymentReminderTemplate: `Hello! 👋\n\nGreetings from *{{shopName}}*!\n\nThis is a friendly notification regarding your GRN payment:\n\n📄 *GRN Number:* #{{grnNumber}}\n🏢 *Supplier:* {{supplierName}}\n💰 *Total Amount:* Rs. {{totalAmount}}\n✅ *Paid:* Rs. {{paidAmount}}\n⏳ *Balance Due:* Rs. {{balanceDue}}\n📅 *GRN Date:* {{grnDate}}\n\nWe will process the remaining payment as per our agreement.\n\nFor any queries, please contact us.\n\nThank you for your partnership! 🙏\n\n*{{shopName}}*\n📞 {{shopPhone}}\n📍 {{shopAddress}}`,
      grnOverdueReminderTemplate: `🚨 *URGENT: Payment Overdue*\n\nDear {{supplierName}},\n\nThis is an urgent reminder regarding the *overdue* payment for:\n\n📄 *GRN Number:* #{{grnNumber}}\n📅 *GRN Date:* {{grnDate}}\n💰 *Total Amount:* Rs. {{totalAmount}}\n✅ *Paid:* Rs. {{paidAmount}}\n⏳ *Balance Due:* Rs. {{balanceDue}}\n\n⚠️ Please note that this payment is now overdue. We kindly request you to coordinate with us for the settlement.\n\nFor any queries or to discuss payment arrangements, please contact us immediately.\n\nBest regards,\n*{{shopName}}*\n📞 {{shopPhone}}\n📍 {{shopAddress}}`,
      supplierOrderTemplate: `🛒 *NEW ORDER REQUEST*\n━━━━━━━━━━━━━━━━━━━━━\n\nHello {{supplierName}}! 👋\n\nThis is *{{shopName}}* reaching out for a new order.\n\n📅 *Date:* {{orderDate}}\n🏢 *Supplier:* {{supplierCompany}}\n\n━━━━━━━━━━━━━━━━━━━━━\n📦 *ORDER DETAILS:*\n━━━━━━━━━━━━━━━━━━━━━\n\nPlease share your:\n✅ Latest product catalog\n✅ Current stock availability\n✅ Best pricing for bulk orders\n✅ Expected delivery timeline\n\n━━━━━━━━━━━━━━━━━━━━━\n\nWe look forward to doing business with you! 🤝\n\n_Sent via {{shopName}} POS System_\n🌟 *Quality Products, Quality Service*\n📞 {{shopPhone}}\n📍 {{shopAddress}}`,
    },
  });
  console.log(`   ✅ Shop 3: ${shop3.name} (${shop3.slug}) [SuperAdmin's Shop]`);

  // Assign SuperAdmin to Shop 3
  await prisma.user.update({
    where: { email: CONFIG.SUPER_ADMIN.email },
    data: { shopId: shop3.id },
  });
  console.log(`   🔗 SuperAdmin assigned to ${shop3.name}`);
  console.log('');

  // ==========================================
  // STEP 3: CREATE SHOP USERS
  // ==========================================
  console.log('📌 STEP 3: Creating Shop Users...');
  
  // Shop 1 Admin
  const shop1AdminPassword = await hashPassword(CONFIG.SHOP1.admin.password);
  const shop1Admin = await prisma.user.upsert({
    where: { email: CONFIG.SHOP1.admin.email },
    update: {
      name: CONFIG.SHOP1.admin.name,
      password: shop1AdminPassword,
      role: UserRole.ADMIN,
      shopId: shop1.id,
      isActive: true,
    },
    create: {
      email: CONFIG.SHOP1.admin.email,
      password: shop1AdminPassword,
      name: CONFIG.SHOP1.admin.name,
      role: UserRole.ADMIN,
      shopId: shop1.id,
      isActive: true,
      lastLogin: new Date(),
    },
  });
  console.log(`   ✅ Shop 1 ADMIN: ${shop1Admin.email} / ${CONFIG.SHOP1.admin.password}`);

  // Shop 1 Manager
  const managerPassword = await hashPassword('manager123');
  const shop1Manager = await prisma.user.upsert({
    where: { email: 'manager@ecotec.lk' },
    update: {
      name: 'Shop Manager',
      password: managerPassword,
      role: UserRole.MANAGER,
      shopId: shop1.id,
      isActive: true,
    },
    create: {
      email: 'manager@ecotec.lk',
      password: managerPassword,
      name: 'Shop Manager',
      role: UserRole.MANAGER,
      shopId: shop1.id,
      isActive: true,
      lastLogin: new Date(),
    },
  });
  console.log(`   ✅ Shop 1 MANAGER: ${shop1Manager.email} / manager123`);

  // Shop 1 Staff
  const staffPassword = await hashPassword('staff123');
  const shop1Staff = await prisma.user.upsert({
    where: { email: 'staff@ecotec.lk' },
    update: {
      name: 'Shop Staff',
      password: staffPassword,
      role: UserRole.STAFF,
      shopId: shop1.id,
      isActive: true,
    },
    create: {
      email: 'staff@ecotec.lk',
      password: staffPassword,
      name: 'Shop Staff',
      role: UserRole.STAFF,
      shopId: shop1.id,
      isActive: true,
      lastLogin: new Date(),
    },
  });
  console.log(`   ✅ Shop 1 STAFF: ${shop1Staff.email} / staff123`);

  // Shop 2 Admin
  const shop2AdminPassword = await hashPassword(CONFIG.SHOP2.admin.password);
  const shop2Admin = await prisma.user.upsert({
    where: { email: CONFIG.SHOP2.admin.email },
    update: {
      name: CONFIG.SHOP2.admin.name,
      password: shop2AdminPassword,
      role: UserRole.ADMIN,
      shopId: shop2.id,
      isActive: true,
    },
    create: {
      email: CONFIG.SHOP2.admin.email,
      password: shop2AdminPassword,
      name: CONFIG.SHOP2.admin.name,
      role: UserRole.ADMIN,
      shopId: shop2.id,
      isActive: true,
      lastLogin: new Date(),
    },
  });
  console.log(`   ✅ Shop 2 ADMIN: ${shop2Admin.email} / ${CONFIG.SHOP2.admin.password}`);

  // Shop 2 Manager
  const shop2Manager = await prisma.user.upsert({
    where: { email: 'manager2@ecotec.lk' },
    update: {
      name: 'Shop 2 Manager',
      password: managerPassword,
      role: UserRole.MANAGER,
      shopId: shop2.id,
      isActive: true,
    },
    create: {
      email: 'manager2@ecotec.lk',
      password: managerPassword,
      name: 'Shop 2 Manager',
      role: UserRole.MANAGER,
      shopId: shop2.id,
      isActive: true,
      lastLogin: new Date(),
    },
  });
  console.log(`   ✅ Shop 2 MANAGER: ${shop2Manager.email} / manager123`);

  // Shop 2 Staff
  const shop2Staff = await prisma.user.upsert({
    where: { email: 'staff2@ecotec.lk' },
    update: {
      name: 'Shop 2 Staff',
      password: staffPassword,
      role: UserRole.STAFF,
      shopId: shop2.id,
      isActive: true,
    },
    create: {
      email: 'staff2@ecotec.lk',
      password: staffPassword,
      name: 'Shop 2 Staff',
      role: UserRole.STAFF,
      shopId: shop2.id,
      isActive: true,
      lastLogin: new Date(),
    },
  });
  console.log(`   ✅ Shop 2 STAFF: ${shop2Staff.email} / staff123`);
  console.log('');

  // ==========================================
  // STEP 4: SEED DATA FOR BOTH SHOPS
  // ==========================================
  
  // Seed for Shop 1
  await seedShopData(shop1.id, 'Shop 1 (Eco-User)', shop1Admin.id);
  
  // Seed for Shop 2
  await seedShopData(shop2.id, 'Shop 2 (Ecotec)', shop2Admin.id);

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           ✅ DATABASE SEEDING COMPLETE!                       ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('📝 Login Credentials Summary:');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log('');
  console.log('🛡️  SUPER ADMIN:');
  console.log(`   Email: ${CONFIG.SUPER_ADMIN.email}`);
  console.log(`   Password: ${CONFIG.SUPER_ADMIN.password}`);
  console.log('');
  console.log(`🏪 SHOP 1 (${CONFIG.SHOP1.name}):`);
  console.log(`   ADMIN:   ${CONFIG.SHOP1.admin.email} / ${CONFIG.SHOP1.admin.password}`);
  console.log(`   MANAGER: manager@ecotec.lk / manager123`);
  console.log(`   STAFF:   staff@ecotec.lk / staff123`);
  console.log('');
  console.log(`🏪 SHOP 2 (${CONFIG.SHOP2.name}):`);
  console.log(`   ADMIN:   ${CONFIG.SHOP2.admin.email} / ${CONFIG.SHOP2.admin.password}`);
  console.log(`   MANAGER: manager2@ecotec.lk / manager123`);
  console.log(`   STAFF:   staff2@ecotec.lk / staff123`);
  console.log('');
}

// ==========================================
// SEED SHOP DATA FUNCTION
// ==========================================

async function seedShopData(shopId: string, shopName: string, adminId: string) {
  console.log(`📌 Seeding ${shopName}...`);

  // ==========================================
  // CATEGORIES (Batch)
  // ==========================================
  console.log('   📁 Creating Categories...');
  await prisma.category.createMany({
    data: CATEGORIES_DATA.map(cat => ({
      name: cat.name,
      description: cat.description,
      shopId,
    })),
  });
  const allCategories = await prisma.category.findMany({ where: { shopId } });
  const categoryMap = new Map(allCategories.map(c => [c.name, c.id]));
  console.log(`      ✅ Created ${CATEGORIES_DATA.length} categories`);

  // ==========================================
  // BRANDS (Batch)
  // ==========================================
  console.log('   🏷️  Creating Brands...');
  await prisma.brand.createMany({
    data: BRANDS_DATA.map(brand => ({
      name: brand.name,
      description: brand.description,
      website: brand.website,
      shopId,
    })),
  });
  const allBrands = await prisma.brand.findMany({ where: { shopId } });
  const brandMap = new Map(allBrands.map(b => [b.name, b.id]));
  console.log(`      ✅ Created ${BRANDS_DATA.length} brands`);

  // ==========================================
  // PRODUCTS (Batch)
  // ==========================================
  console.log('   📦 Creating Products...');
  await prisma.product.createMany({
    data: PRODUCTS_DATA.map(product => {
      const uniqueBarcode = `${shopId.slice(0, 4)}-${product.barcode}`;
      return {
        name: product.name,
        description: `${product.brand} ${product.name} - Premium quality product`,
        price: product.price,
        costPrice: product.costPrice,
        profitMargin: ((product.price - product.costPrice) / product.price) * 100,
        stock: product.stock,
        lowStockThreshold: Math.ceil(product.stock * 0.2),
        warranty: product.warranty,
        warrantyMonths: product.warrantyMonths,
        barcode: uniqueBarcode,
        categoryId: categoryMap.get(product.category),
        brandId: brandMap.get(product.brand),
        shopId,
        totalPurchased: product.stock,
        totalSold: 0,
      };
    }),
  });
  const allProducts = await prisma.product.findMany({ where: { shopId } });
  const productMap = new Map(allProducts.map(p => [p.name, p.id]));
  console.log(`      ✅ Created ${PRODUCTS_DATA.length} products`);

  // ==========================================
  // SUPPLIERS (Batch)
  // ==========================================
  console.log('   🚚 Creating Suppliers...');
  await prisma.supplier.createMany({
    data: SUPPLIERS_DATA.map(supplier => ({
      name: supplier.name,
      contactPerson: supplier.contact,
      email: supplier.email,
      phone: supplier.phone,
      address: supplier.address,
      isActive: true,
      shopId,
    })),
  });
  const allSuppliers = await prisma.supplier.findMany({ where: { shopId } });
  const supplierMap = new Map(allSuppliers.map(s => [s.name, s.id]));
  console.log(`      ✅ Created ${SUPPLIERS_DATA.length} suppliers`);

  // ==========================================
  // CUSTOMERS (Batch)
  // ==========================================
  console.log('   👥 Creating Customers...');
  await prisma.customer.createMany({
    data: CUSTOMERS_DATA.map(customer => {
      const hasCredit = 'credit' in customer && customer.credit;
      const hasCreditLimit = 'creditLimit' in customer && (customer as Record<string, unknown>).creditLimit;
      return {
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        address: customer.address,
        nic: customer.nic,
        customerType: customer.type,
        totalSpent: 0,
        totalOrders: 0,
        creditBalance: hasCredit ? Math.floor(Math.random() * 50000) + 10000 : 0,
        creditLimit: hasCreditLimit ? Number((customer as Record<string, unknown>).creditLimit) : (hasCredit ? 100000 : 0),
        creditStatus: hasCredit ? CreditStatus.ACTIVE : CreditStatus.CLEAR,
        creditDueDate: hasCredit ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null,
        shopId,
      };
    }),
  });
  const allCustomers = await prisma.customer.findMany({ where: { shopId } });
  const customerMap = new Map(allCustomers.map(c => [c.name, c.id]));
  console.log(`      ✅ Created ${CUSTOMERS_DATA.length} customers`);

  // ==========================================
  // GRNs (Sample GRNs - using already-fetched data)
  // ==========================================
  console.log('   📥 Creating GRNs...');
  
  const products = allProducts.slice(0, 10);
  const suppliers = allSuppliers.slice(0, 3);
  
  if (suppliers.length > 0 && products.length > 0) {
    const grnStatuses: GRNStatus[] = [GRNStatus.COMPLETED, GRNStatus.COMPLETED, GRNStatus.PENDING, GRNStatus.DRAFT];
    const vehicleNumbers = ['CAB-1234', 'WP KA-5678', 'NW ABC-9012', 'CP XY-3456', 'SP LM-7890'];
    const receivedByNames = ['Nuwan Perera', 'Kasun Silva', 'Chaminda Fernando', 'Amal Bandara', 'Saman Kumara'];
    
    for (let i = 0; i < 4; i++) {
      const supplier = suppliers[i % suppliers.length];
      const grnProducts = products.slice(i * 2, i * 2 + 3);
      if (grnProducts.length === 0) continue;
      
      const grnItems = grnProducts.map(p => {
        const qty = Math.floor(Math.random() * 20) + 5;
        const cost = p.costPrice || p.price * 0.8;
        return { productId: p.id, quantity: qty, costPrice: cost, sellingPrice: p.price, totalCost: cost * qty };
      });
      
      const subtotal = grnItems.reduce((sum, item) => sum + item.totalCost, 0);
      const grnDate = randomDate(new Date('2026-01-01'), new Date());
      const receivedDate = grnStatuses[i] !== GRNStatus.DRAFT
        ? new Date(grnDate.getTime() + (Math.random() * 3 * 24 * 60 * 60 * 1000))
        : null;
      
      await prisma.gRN.create({
        data: {
          grnNumber: generateGRNNumber(i + 1),
          supplierId: supplier.id,
          shopId,
          referenceNo: `SUP-INV-${String(Math.floor(Math.random() * 100000)).padStart(6, '0')}`,
          date: grnDate,
          deliveryNote: `DN${String(10000000 + Math.floor(Math.random() * 90000000)).padStart(8, '0')}`,
          vehicleNumber: vehicleNumbers[i % vehicleNumbers.length],
          receivedBy: receivedByNames[i % receivedByNames.length],
          receivedDate,
          subtotal,
          tax: 0,
          discount: Math.random() > 0.5 ? Math.floor(subtotal * 0.02) : 0,
          totalAmount: subtotal,
          paidAmount: grnStatuses[i] === GRNStatus.COMPLETED ? subtotal : 0,
          status: grnStatuses[i],
          paymentStatus: grnStatuses[i] === GRNStatus.COMPLETED ? PaymentStatus.PAID : PaymentStatus.UNPAID,
          notes: `GRN from ${supplier.name}`,
          createdById: adminId,
          items: {
            create: grnItems.map(item => ({
              productId: item.productId,
              quantity: item.quantity,
              costPrice: item.costPrice,
              sellingPrice: item.sellingPrice,
              totalCost: item.totalCost,
            })),
          },
        },
      });
    }
    console.log(`      ✅ Created 4 sample GRNs`);
  }

  // ==========================================
  // INVOICES (Various statuses - batch payments & stock)
  // ==========================================
  console.log('   🧾 Creating Invoices...');
  
  const customers = allCustomers.slice(0, 10);
  
  // Collect batch data
  const paymentRecords: { invoiceId: string; amount: number; paymentMethod: PaymentMethod; paymentDate: Date; notes: string; recordedById: string }[] = [];
  const stockMovements: { productId: string; type: StockMovementType; quantity: number; previousStock: number; newStock: number; referenceId: string; referenceNumber: string; referenceType: string; unitPrice: number; createdBy: string; shopId: string }[] = [];
  const customerUpdates: Map<string, { totalSpent: number; totalOrders: number; lastPurchase: Date }> = new Map();
  const productStockUpdates: Map<string, { soldQty: number; newStock: number }> = new Map();
  
  if (customers.length > 0 && products.length > 0) {
    const invoiceStatuses: InvoiceStatus[] = [
      InvoiceStatus.FULLPAID, InvoiceStatus.FULLPAID, InvoiceStatus.FULLPAID, 
      InvoiceStatus.HALFPAY, InvoiceStatus.HALFPAY, 
      InvoiceStatus.UNPAID, InvoiceStatus.UNPAID, 
      InvoiceStatus.CANCELLED
    ];
    const paymentMethods: PaymentMethod[] = [
      PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.BANK_TRANSFER, 
      PaymentMethod.CREDIT, PaymentMethod.CHEQUE
    ];
    
    for (let i = 0; i < 8; i++) {
      const customer = customers[i % customers.length];
      const invoiceProducts = products.slice((i * 2) % products.length, ((i * 2) % products.length) + 3);
      if (invoiceProducts.length === 0) continue;
      
      const invoiceItems = invoiceProducts.map(p => {
        const qty = Math.floor(Math.random() * 3) + 1;
        const unitPrice = p.price;
        const discount = Math.random() > 0.7 ? Math.floor(unitPrice * 0.05) : 0;
        return {
          productId: p.id,
          productName: p.name,
          quantity: qty,
          unitPrice,
          originalPrice: unitPrice,
          discount,
          total: (unitPrice - discount) * qty,
          warranty: p.warranty,
          warrantyDueDate: p.warrantyMonths ? getWarrantyDueDate(p.warrantyMonths) : null,
        };
      });
      
      const subtotal = invoiceItems.reduce((sum, item) => sum + item.total, 0);
      const status = invoiceStatuses[i];
      const paidAmount = status === InvoiceStatus.FULLPAID ? subtotal : 
                         status === InvoiceStatus.HALFPAY ? Math.floor(subtotal / 2) : 0;
      
      const invoiceDate = randomDate(new Date('2026-01-01'), new Date());
      const dueDate = new Date(invoiceDate);
      dueDate.setDate(dueDate.getDate() + 30);
      const payMethod = status !== InvoiceStatus.UNPAID ? randomItem(paymentMethods) : null;
      
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber: generateInvoiceNumber(i + 1),
          shopId,
          customerId: customer.id,
          customerName: customer.name,
          subtotal, tax: 0, discount: 0, total: subtotal,
          paidAmount, dueAmount: subtotal - paidAmount,
          status, date: invoiceDate, dueDate,
          paymentMethod: payMethod,
          salesChannel: Math.random() > 0.2 ? SalesChannel.ON_SITE : SalesChannel.ONLINE,
          notes: status === InvoiceStatus.CANCELLED ? 'Customer cancelled order' : null,
          createdById: adminId,
          items: { create: invoiceItems },
        },
      });
      
      // Collect payment record
      if (paidAmount > 0 && status !== InvoiceStatus.CANCELLED) {
        paymentRecords.push({
          invoiceId: invoice.id, amount: paidAmount,
          paymentMethod: payMethod || PaymentMethod.CASH,
          paymentDate: invoiceDate, notes: 'Initial payment', recordedById: adminId,
        });
      }
      
      // Collect customer update
      if (status !== InvoiceStatus.CANCELLED) {
        const existing = customerUpdates.get(customer.id) || { totalSpent: 0, totalOrders: 0, lastPurchase: new Date(0) };
        existing.totalSpent += paidAmount;
        existing.totalOrders += 1;
        if (invoiceDate > existing.lastPurchase) existing.lastPurchase = invoiceDate;
        customerUpdates.set(customer.id, existing);
      }
      
      // Collect stock movements
      if (status === InvoiceStatus.FULLPAID || status === InvoiceStatus.HALFPAY) {
        for (const item of invoiceItems) {
          if (item.productId) {
            const product = invoiceProducts.find(p => p.id === item.productId);
            if (product) {
              const prevUpdate = productStockUpdates.get(item.productId);
              const previousStock = prevUpdate ? prevUpdate.newStock : product.stock;
              const newStock = Math.max(0, previousStock - item.quantity);
              
              stockMovements.push({
                productId: item.productId, type: StockMovementType.INVOICE_OUT,
                quantity: -item.quantity, previousStock, newStock,
                referenceId: invoice.id, referenceNumber: invoice.invoiceNumber,
                referenceType: 'invoice', unitPrice: item.unitPrice,
                createdBy: adminId, shopId,
              });
              
              const existingUpdate = productStockUpdates.get(item.productId) || { soldQty: 0, newStock: product.stock };
              existingUpdate.soldQty += item.quantity;
              existingUpdate.newStock = newStock;
              productStockUpdates.set(item.productId, existingUpdate);
            }
          }
        }
      }
    }
    
    // Batch insert payment records
    if (paymentRecords.length > 0) {
      await prisma.invoicePayment.createMany({ data: paymentRecords });
    }
    
    // Batch insert stock movements
    if (stockMovements.length > 0) {
      await prisma.stockMovement.createMany({ data: stockMovements });
    }
    
    // Batch update customer stats
    for (const [custId, update] of customerUpdates) {
      await prisma.customer.update({
        where: { id: custId },
        data: {
          totalSpent: { increment: update.totalSpent },
          totalOrders: { increment: update.totalOrders },
          lastPurchase: update.lastPurchase,
        },
      });
    }
    
    // Batch update product stocks
    for (const [prodId, update] of productStockUpdates) {
      await prisma.product.update({
        where: { id: prodId },
        data: {
          stock: update.newStock,
          totalSold: { increment: update.soldQty },
        },
      });
    }
    
    console.log(`      ✅ Created 8 invoices, ${paymentRecords.length} payments, ${stockMovements.length} stock movements`);
  }

  // ==========================================
  // REMINDERS (Batch)
  // ==========================================
  console.log('   📨 Creating Reminders...');
  
  const unpaidInvoices = await prisma.invoice.findMany({
    where: { shopId, status: { in: [InvoiceStatus.UNPAID, InvoiceStatus.HALFPAY] } },
    include: { customer: true },
    take: 3,
  });
  
  const invoiceReminderData = unpaidInvoices
    .filter(inv => inv.customer)
    .map(invoice => ({
      invoiceId: invoice.id,
      shopId,
      type: invoice.dueDate && invoice.dueDate < new Date() ? ReminderType.OVERDUE : ReminderType.PAYMENT,
      channel: 'whatsapp',
      message: `Dear ${invoice.customerName}, reminder for invoice ${invoice.invoiceNumber} - Amount due: Rs. ${invoice.dueAmount.toLocaleString()}`,
      customerPhone: invoice.customer!.phone,
      customerName: invoice.customerName,
    }));
  
  if (invoiceReminderData.length > 0) {
    await prisma.invoiceReminder.createMany({ data: invoiceReminderData });
  }
  
  const unpaidGRNs = await prisma.gRN.findMany({
    where: { shopId, paymentStatus: { in: [PaymentStatus.UNPAID, PaymentStatus.PARTIAL] } },
    include: { supplier: true },
    take: 3,
  });
  
  const grnReminderData = unpaidGRNs
    .filter(grn => grn.supplier)
    .map(grn => ({
      grnId: grn.id,
      shopId,
      type: ReminderType.PAYMENT,
      channel: 'whatsapp',
      message: `Dear ${grn.supplier!.name}, reminder for GRN ${grn.grnNumber} - Balance Due: Rs. ${(grn.totalAmount - (grn.paidAmount || 0)).toLocaleString()}`,
      supplierPhone: grn.supplier!.phone,
      supplierName: grn.supplier!.name,
    }));
  
  if (grnReminderData.length > 0) {
    await prisma.gRNReminder.createMany({ data: grnReminderData });
  }
  
  console.log(`      ✅ Created ${invoiceReminderData.length} invoice + ${grnReminderData.length} GRN reminders`);

  // ==========================================
  // INVOICE ITEM HISTORY (Single record)
  // ==========================================
  console.log('   📜 Creating Invoice Item History...');
  
  const recentInvoice = await prisma.invoice.findFirst({
    where: { shopId, status: InvoiceStatus.FULLPAID },
    include: { items: true },
  });
  
  if (recentInvoice && recentInvoice.items.length > 0) {
    await prisma.invoiceItemHistory.create({
      data: {
        invoiceId: recentInvoice.id,
        action: ItemHistoryAction.ADDED,
        productId: recentInvoice.items[0].productId,
        productName: recentInvoice.items[0].productName,
        oldQuantity: null,
        newQuantity: recentInvoice.items[0].quantity,
        unitPrice: recentInvoice.items[0].unitPrice,
        amountChange: recentInvoice.items[0].total,
        changedById: adminId,
        changedByName: 'Admin',
        reason: 'Initial item added',
        shopId,
      },
    });
  }
  console.log(`      ✅ Created sample invoice item history`);

  console.log(`   ✅ ${shopName} seeding complete!`);
  console.log('');
}

// ==========================================
// EXECUTE SEED
// ==========================================

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('❌ Seeding failed:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
