"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
var client_1 = require("@prisma/client");
var bcrypt = require("bcrypt");
var prisma = new client_1.PrismaClient();
function main() {
    return __awaiter(this, void 0, void 0, function () {
        var ecotechShop, hashedPassword, ecotechUser, staffUser, _a, _b, managerUser, _c, _d, categoryData, categories, _i, categoryData_1, cat, category, brandData, brands, _e, brandData_1, brand, b, customerData, _f, customerData_1, cust, productData, _g, productData_1, prod, invoiceData, _h, invoiceData_1, inv, items, payments, invoiceFields, invoice, _j, items_1, item, _k, payments_1, payment;
        var _l, _m, _o, _p;
        return __generator(this, function (_q) {
            switch (_q.label) {
                case 0:
                    console.log('🌱 Starting seed...');
                    console.log('');
                    return [4 /*yield*/, prisma.shop.upsert({
                            where: { slug: 'ecotech' },
                            update: {},
                            create: {
                                name: 'EcoTech Computer Shop',
                                slug: 'ecotech',
                                description: 'Your trusted partner for computer hardware and accessories',
                                address: 'No. 123, Galle Road, Colombo 03, Sri Lanka',
                                phone: '+94 11 234 5678',
                                email: 'info@ecotech.lk',
                                website: 'https://ecotech.lk',
                                businessRegNo: 'PV00123456',
                                taxId: 'TIN123456789',
                                currency: 'LKR',
                                taxRate: 15, // 15% default tax
                                isActive: true,
                            },
                        })];
                case 1:
                    ecotechShop = _q.sent();
                    console.log("\uD83C\uDFEA Created shop: ".concat(ecotechShop.name, " (").concat(ecotechShop.slug, ")"));
                    return [4 /*yield*/, bcrypt.hash('ecotech123', 10)];
                case 2:
                    hashedPassword = _q.sent();
                    return [4 /*yield*/, prisma.user.upsert({
                            where: { email: 'ecotech@ecotech.lk' },
                            update: { shopId: ecotechShop.id },
                            create: {
                                email: 'ecotech@ecotech.lk',
                                password: hashedPassword,
                                name: 'EcoTech Admin',
                                role: client_1.UserRole.ADMIN,
                                isActive: true,
                                lastLogin: new Date(),
                                shopId: ecotechShop.id,
                            },
                        })];
                case 3:
                    ecotechUser = _q.sent();
                    console.log("\u2705 Created user: ".concat(ecotechUser.name, " (").concat(ecotechUser.email, ")"));
                    _b = (_a = prisma.user).upsert;
                    _l = {
                        where: { email: 'staff@ecotech.lk' },
                        update: { shopId: ecotechShop.id }
                    };
                    _m = {
                        email: 'staff@ecotech.lk'
                    };
                    return [4 /*yield*/, bcrypt.hash('staff123', 10)];
                case 4: return [4 /*yield*/, _b.apply(_a, [(_l.create = (_m.password = _q.sent(),
                            _m.name = 'Kasun Silva',
                            _m.role = client_1.UserRole.STAFF,
                            _m.isActive = true,
                            _m.shopId = ecotechShop.id,
                            _m),
                            _l)])];
                case 5:
                    staffUser = _q.sent();
                    _d = (_c = prisma.user).upsert;
                    _o = {
                        where: { email: 'manager@ecotech.lk' },
                        update: { shopId: ecotechShop.id }
                    };
                    _p = {
                        email: 'manager@ecotech.lk'
                    };
                    return [4 /*yield*/, bcrypt.hash('manager123', 10)];
                case 6: return [4 /*yield*/, _d.apply(_c, [(_o.create = (_p.password = _q.sent(),
                            _p.name = 'Nimali Perera',
                            _p.role = client_1.UserRole.MANAGER,
                            _p.isActive = true,
                            _p.shopId = ecotechShop.id,
                            _p),
                            _o)])];
                case 7:
                    managerUser = _q.sent();
                    console.log("\u2705 Created 3 users (Admin, Manager, Staff) for ".concat(ecotechShop.name));
                    categoryData = [
                        { name: 'Processors', description: 'CPUs and processors' },
                        { name: 'Graphics Cards', description: 'GPUs and video cards' },
                        { name: 'Storage', description: 'SSDs, HDDs and storage devices' },
                        { name: 'Memory', description: 'RAM modules and memory' },
                        { name: 'Motherboards', description: 'Motherboards for desktops and laptops' },
                        { name: 'Power Supply', description: 'PSUs and power supplies' },
                        { name: 'Cooling', description: 'Coolers, fans and thermal solutions' },
                        { name: 'Cases', description: 'PC cases and enclosures' },
                        { name: 'Monitors', description: 'Display monitors' },
                        { name: 'Peripherals', description: 'Keyboards, mice, headsets etc.' },
                    ];
                    categories = {};
                    _i = 0, categoryData_1 = categoryData;
                    _q.label = 8;
                case 8:
                    if (!(_i < categoryData_1.length)) return [3 /*break*/, 11];
                    cat = categoryData_1[_i];
                    return [4 /*yield*/, prisma.category.upsert({
                            where: { shopId_name: { shopId: ecotechShop.id, name: cat.name } },
                            update: {},
                            create: __assign(__assign({}, cat), { shopId: ecotechShop.id }),
                        })];
                case 9:
                    category = _q.sent();
                    categories[cat.name] = category;
                    _q.label = 10;
                case 10:
                    _i++;
                    return [3 /*break*/, 8];
                case 11:
                    console.log("\u2705 Created ".concat(Object.keys(categories).length, " categories"));
                    brandData = [
                        { name: 'AMD', description: 'Advanced Micro Devices' },
                        { name: 'Intel', description: 'Intel Corporation' },
                        { name: 'NVIDIA', description: 'NVIDIA Corporation' },
                        { name: 'Samsung', description: 'Samsung Electronics' },
                        { name: 'Western Digital', description: 'Western Digital Corporation' },
                        { name: 'Corsair', description: 'Corsair Gaming' },
                        { name: 'G.Skill', description: 'G.Skill International' },
                        { name: 'ASUS', description: 'ASUSTeK Computer' },
                        { name: 'MSI', description: 'Micro-Star International' },
                        { name: 'NZXT', description: 'NZXT Inc.' },
                        { name: 'Lian Li', description: 'Lian Li Industrial' },
                        { name: 'LG', description: 'LG Electronics' },
                        { name: 'Logitech', description: 'Logitech International' },
                        { name: 'Razer', description: 'Razer Inc.' },
                        { name: 'SteelSeries', description: 'SteelSeries ApS' },
                        { name: 'Seagate', description: 'Seagate Technology' },
                    ];
                    brands = {};
                    _e = 0, brandData_1 = brandData;
                    _q.label = 12;
                case 12:
                    if (!(_e < brandData_1.length)) return [3 /*break*/, 15];
                    brand = brandData_1[_e];
                    return [4 /*yield*/, prisma.brand.upsert({
                            where: { shopId_name: { shopId: ecotechShop.id, name: brand.name } },
                            update: {},
                            create: __assign(__assign({}, brand), { shopId: ecotechShop.id }),
                        })];
                case 13:
                    b = _q.sent();
                    brands[brand.name] = b;
                    _q.label = 14;
                case 14:
                    _e++;
                    return [3 /*break*/, 12];
                case 15:
                    console.log("\u2705 Created ".concat(Object.keys(brands).length, " brands"));
                    customerData = [
                        { id: '1', name: 'Kasun Perera', email: 'kasun@gmail.com', phone: '078-3233760', address: 'No. 12, Galle Road, Colombo', totalSpent: 580000, totalOrders: 5, creditBalance: 0, creditLimit: 100000, creditStatus: client_1.CreditStatus.CLEAR },
                        { id: '2', name: 'Nimali Fernando', email: 'nimali@email.com', phone: '078-3233760', address: '12A, Kandy Rd, Kurunegala', totalSpent: 320000, totalOrders: 3, creditBalance: 103500, creditLimit: 200000, creditStatus: client_1.CreditStatus.ACTIVE },
                        { id: '3', name: 'Tech Solutions Ltd', email: 'info@techsol.lk', phone: '078-3233760', address: 'No. 45, Industrial Estate, Colombo 15', totalSpent: 2500000, totalOrders: 18, creditBalance: 488000, creditLimit: 1000000, creditStatus: client_1.CreditStatus.ACTIVE },
                        { id: '4', name: 'Dilshan Silva', email: 'dilshan.s@hotmail.com', phone: '078-3233760', address: '78/2, Hill Street, Kandy', totalSpent: 185000, totalOrders: 2, creditBalance: 72500, creditLimit: 100000, creditStatus: client_1.CreditStatus.ACTIVE },
                        { id: '5', name: 'GameZone Café', email: 'contact@gamezone.lk', phone: '078-3233760', address: 'Shop 5, Arcade Mall, Colombo', totalSpent: 3200000, totalOrders: 25, creditBalance: 1231250, creditLimit: 1500000, creditStatus: client_1.CreditStatus.ACTIVE },
                        { id: '6', name: 'Priya Jayawardena', email: 'priya.j@yahoo.com', phone: '078-3233760', address: 'No. 7, Lake Road, Galle', totalSpent: 95000, totalOrders: 1, creditBalance: 0, creditLimit: 50000, creditStatus: client_1.CreditStatus.CLEAR },
                        { id: '7', name: 'Creative Studios', email: 'studio@creative.lk', phone: '078-3233760', address: 'Studio 3, Art Lane, Colombo', totalSpent: 1850000, totalOrders: 12, creditBalance: 1322500, creditLimit: 1500000, creditStatus: client_1.CreditStatus.ACTIVE },
                        { id: '8', name: 'Sanjay Mendis', email: 'sanjay.m@gmail.com', phone: '078-3233760', address: 'No. 21, Thotalanga Road, Colombo', totalSpent: 420000, totalOrders: 4, creditBalance: 0, creditLimit: 100000, creditStatus: client_1.CreditStatus.CLEAR },
                    ];
                    _f = 0, customerData_1 = customerData;
                    _q.label = 16;
                case 16:
                    if (!(_f < customerData_1.length)) return [3 /*break*/, 19];
                    cust = customerData_1[_f];
                    return [4 /*yield*/, prisma.customer.upsert({
                            where: { id: cust.id },
                            update: { shopId: ecotechShop.id },
                            create: __assign(__assign({}, cust), { shopId: ecotechShop.id }),
                        })];
                case 17:
                    _q.sent();
                    _q.label = 18;
                case 18:
                    _f++;
                    return [3 /*break*/, 16];
                case 19:
                    console.log("\u2705 Created ".concat(customerData.length, " customers"));
                    productData = [
                        { id: '1', name: 'AMD Ryzen 9 7950X', category: 'Processors', brand: 'AMD', price: 185000, costPrice: 155000, stock: 12, serialNumber: '70451234', barcode: '4938271650123', warranty: '3 years' },
                        { id: '2', name: 'Intel Core i9-14900K', category: 'Processors', brand: 'Intel', price: 195000, costPrice: 165000, stock: 8, serialNumber: '70452345', barcode: '4938271650124', warranty: '3 years' },
                        { id: '3', name: 'NVIDIA GeForce RTX 4090', category: 'Graphics Cards', brand: 'NVIDIA', price: 620000, costPrice: 520000, stock: 5, serialNumber: '70453456', barcode: '4938271650125', warranty: '3 years' },
                        { id: '4', name: 'NVIDIA GeForce RTX 4070 Ti', category: 'Graphics Cards', brand: 'NVIDIA', price: 280000, costPrice: 235000, stock: 15, serialNumber: '70454567', barcode: '4938271650126', warranty: '3 years' },
                        { id: '5', name: 'AMD Radeon RX 7900 XTX', category: 'Graphics Cards', brand: 'AMD', price: 350000, costPrice: 295000, stock: 7, serialNumber: '70455678', barcode: '4938271650127', warranty: '2 years' },
                        { id: '6', name: 'Samsung 990 Pro 2TB NVMe SSD', category: 'Storage', brand: 'Samsung', price: 75000, costPrice: 62000, stock: 30, serialNumber: '70456789', barcode: '4938271650128', warranty: '5 years' },
                        { id: '7', name: 'WD Black SN850X 1TB', category: 'Storage', brand: 'Western Digital', price: 42000, costPrice: 34000, stock: 45, serialNumber: '70457890', barcode: '4938271650129', warranty: '5 years' },
                        { id: '8', name: 'Corsair Vengeance DDR5 32GB (2x16GB)', category: 'Memory', brand: 'Corsair', price: 48000, costPrice: 40000, stock: 25, serialNumber: '70458901', barcode: '4938271650130', warranty: 'Lifetime' },
                        { id: '9', name: 'G.Skill Trident Z5 64GB DDR5', category: 'Memory', brand: 'G.Skill', price: 95000, costPrice: 78000, stock: 10, serialNumber: '70459012', barcode: '4938271650131', warranty: 'Lifetime' },
                        { id: '10', name: 'ASUS ROG Maximus Z790 Hero', category: 'Motherboards', brand: 'ASUS', price: 185000, costPrice: 155000, stock: 6, serialNumber: '70460123', barcode: '4938271650132', warranty: '3 years' },
                        { id: '11', name: 'MSI MEG Z790 ACE', category: 'Motherboards', brand: 'MSI', price: 165000, costPrice: 138000, stock: 8, serialNumber: '70461234', barcode: '4938271650133', warranty: '3 years' },
                        { id: '12', name: 'Corsair RM1000x 1000W PSU', category: 'Power Supply', brand: 'Corsair', price: 55000, costPrice: 45000, stock: 20, serialNumber: '70462345', barcode: '4938271650134', warranty: '10 years' },
                        { id: '13', name: 'NZXT Kraken X73 RGB', category: 'Cooling', brand: 'NZXT', price: 75000, costPrice: 62000, stock: 18, serialNumber: '70463456', barcode: '4938271650135', warranty: '6 years' },
                        { id: '14', name: 'Lian Li O11 Dynamic EVO', category: 'Cases', brand: 'Lian Li', price: 58000, costPrice: 48000, stock: 12, serialNumber: '70464567', barcode: '4938271650136', warranty: '2 years' },
                        { id: '15', name: 'LG UltraGear 27GP950-B 4K Monitor', category: 'Monitors', brand: 'LG', price: 195000, costPrice: 165000, stock: 6, serialNumber: '70465678', barcode: '4938271650137', warranty: '3 years' },
                        { id: '16', name: 'Samsung Odyssey G9 49" Monitor', category: 'Monitors', brand: 'Samsung', price: 380000, costPrice: 320000, stock: 3, serialNumber: '70466789', barcode: '4938271650138', warranty: '3 years' },
                        { id: '17', name: 'Logitech G Pro X Superlight 2', category: 'Peripherals', brand: 'Logitech', price: 52000, costPrice: 42000, stock: 35, serialNumber: '70467890', barcode: '4938271650139', warranty: '2 years' },
                        { id: '18', name: 'Razer Huntsman V3 Pro', category: 'Peripherals', brand: 'Razer', price: 68000, costPrice: 55000, stock: 20, serialNumber: '70468901', barcode: '4938271650140', warranty: '2 years' },
                        { id: '19', name: 'SteelSeries Arctis Nova Pro', category: 'Peripherals', brand: 'SteelSeries', price: 95000, costPrice: 78000, stock: 15, serialNumber: '70469012', barcode: '4938271650141', warranty: '1 year' },
                        { id: '20', name: 'Seagate Exos 18TB HDD', category: 'Storage', brand: 'Seagate', price: 125000, costPrice: 105000, stock: 8, serialNumber: '70470123', barcode: '4938271650142', warranty: '5 years' },
                    ];
                    _g = 0, productData_1 = productData;
                    _q.label = 20;
                case 20:
                    if (!(_g < productData_1.length)) return [3 /*break*/, 23];
                    prod = productData_1[_g];
                    return [4 /*yield*/, prisma.product.upsert({
                            where: { id: prod.id },
                            update: { shopId: ecotechShop.id },
                            create: {
                                id: prod.id,
                                name: prod.name,
                                price: prod.price,
                                costPrice: prod.costPrice,
                                stock: prod.stock,
                                serialNumber: prod.serialNumber,
                                barcode: prod.barcode,
                                warranty: prod.warranty,
                                categoryId: categories[prod.category].id,
                                brandId: brands[prod.brand].id,
                                shopId: ecotechShop.id,
                            },
                        })];
                case 21:
                    _q.sent();
                    _q.label = 22;
                case 22:
                    _g++;
                    return [3 /*break*/, 20];
                case 23:
                    console.log("\u2705 Created ".concat(productData.length, " products"));
                    invoiceData = [
                        {
                            id: '10260001',
                            invoiceNumber: 'INV-10260001',
                            customerId: '1',
                            customerName: 'Kasun Perera',
                            subtotal: 281000,
                            tax: 42150,
                            total: 323150,
                            paidAmount: 323150,
                            dueAmount: 0,
                            status: client_1.InvoiceStatus.FULLPAID,
                            date: new Date('2026-01-03'),
                            dueDate: new Date('2026-01-18'),
                            paymentMethod: client_1.PaymentMethod.CARD,
                            salesChannel: client_1.SalesChannel.ON_SITE,
                            items: [
                                { productId: '1', productName: 'AMD Ryzen 9 7950X', quantity: 1, unitPrice: 185000, total: 185000, warrantyDueDate: new Date('2029-01-03') },
                                { productId: '8', productName: 'Corsair Vengeance DDR5 32GB', quantity: 2, unitPrice: 48000, total: 96000 },
                            ],
                        },
                        {
                            id: '10260002',
                            invoiceNumber: 'INV-10260002',
                            customerId: '3',
                            customerName: 'Tech Solutions Ltd',
                            subtotal: 1720000,
                            tax: 258000,
                            total: 1978000,
                            paidAmount: 1978000,
                            dueAmount: 0,
                            status: client_1.InvoiceStatus.FULLPAID,
                            date: new Date('2026-01-05'),
                            dueDate: new Date('2026-01-20'),
                            paymentMethod: client_1.PaymentMethod.BANK_TRANSFER,
                            salesChannel: client_1.SalesChannel.ON_SITE,
                            items: [
                                { productId: '3', productName: 'NVIDIA GeForce RTX 4090', quantity: 2, unitPrice: 620000, total: 1240000, warrantyDueDate: new Date('2029-01-05') },
                                { productId: '10', productName: 'ASUS ROG Maximus Z790 Hero', quantity: 2, unitPrice: 185000, total: 370000, warrantyDueDate: new Date('2029-01-05') },
                                { productId: '12', productName: 'Corsair RM1000x 1000W PSU', quantity: 2, unitPrice: 55000, total: 110000, warrantyDueDate: new Date('2036-01-05') },
                            ],
                        },
                        {
                            id: '10260003',
                            invoiceNumber: 'INV-10260003',
                            customerId: '5',
                            customerName: 'GameZone Café',
                            subtotal: 2375000,
                            tax: 356250,
                            total: 2731250,
                            paidAmount: 1500000,
                            dueAmount: 1231250,
                            status: client_1.InvoiceStatus.HALFPAY,
                            date: new Date('2026-01-08'),
                            dueDate: new Date('2026-01-23'),
                            paymentMethod: client_1.PaymentMethod.CREDIT,
                            salesChannel: client_1.SalesChannel.ONLINE,
                            items: [
                                { productId: '4', productName: 'NVIDIA GeForce RTX 4070 Ti', quantity: 5, unitPrice: 280000, total: 1400000, warrantyDueDate: new Date('2029-01-08') },
                                { productId: '15', productName: 'LG UltraGear 27GP950-B 4K Monitor', quantity: 5, unitPrice: 195000, total: 975000, warrantyDueDate: new Date('2029-01-08') },
                            ],
                            payments: [
                                { amount: 500000, paymentMethod: client_1.PaymentMethod.CASH, paymentDate: new Date('2026-01-08T10:30:00'), notes: 'Initial deposit payment' },
                                { amount: 500000, paymentMethod: client_1.PaymentMethod.BANK_TRANSFER, paymentDate: new Date('2026-01-12T14:15:00'), notes: 'Second installment' },
                                { amount: 500000, paymentMethod: client_1.PaymentMethod.CARD, paymentDate: new Date('2026-01-16T11:00:00'), notes: 'Third payment via credit card' },
                            ],
                        },
                        {
                            id: '10260004',
                            invoiceNumber: 'INV-10260004',
                            customerId: '2',
                            customerName: 'Nimali Fernando',
                            subtotal: 120000,
                            tax: 18000,
                            total: 138000,
                            paidAmount: 138000,
                            dueAmount: 0,
                            status: client_1.InvoiceStatus.FULLPAID,
                            date: new Date('2026-01-02'),
                            dueDate: new Date('2026-01-17'),
                            paymentMethod: client_1.PaymentMethod.CASH,
                            salesChannel: client_1.SalesChannel.ON_SITE,
                            items: [
                                { productId: '17', productName: 'Logitech G Pro X Superlight 2', quantity: 1, unitPrice: 52000, total: 52000, warrantyDueDate: new Date('2028-01-02') },
                                { productId: '18', productName: 'Razer Huntsman V3 Pro', quantity: 1, unitPrice: 68000, total: 68000, warrantyDueDate: new Date('2028-01-02') },
                            ],
                        },
                        {
                            id: '10260005',
                            invoiceNumber: 'INV-10260005',
                            customerId: '7',
                            customerName: 'Creative Studios',
                            subtotal: 1150000,
                            tax: 172500,
                            total: 1322500,
                            paidAmount: 0,
                            dueAmount: 1322500,
                            status: client_1.InvoiceStatus.UNPAID,
                            date: new Date('2026-01-10'),
                            dueDate: new Date('2026-01-25'),
                            paymentMethod: client_1.PaymentMethod.CREDIT,
                            salesChannel: client_1.SalesChannel.ON_SITE,
                            items: [
                                { productId: '16', productName: 'Samsung Odyssey G9 49" Monitor', quantity: 2, unitPrice: 380000, total: 760000, warrantyDueDate: new Date('2029-01-10') },
                                { productId: '2', productName: 'Intel Core i9-14900K', quantity: 2, unitPrice: 195000, total: 390000, warrantyDueDate: new Date('2029-01-10') },
                            ],
                        },
                        {
                            id: '10260006',
                            invoiceNumber: 'INV-10260006',
                            customerId: '4',
                            customerName: 'Dilshan Silva',
                            subtotal: 150000,
                            tax: 22500,
                            total: 172500,
                            paidAmount: 100000,
                            dueAmount: 72500,
                            status: client_1.InvoiceStatus.HALFPAY,
                            date: new Date('2026-01-06'),
                            dueDate: new Date('2026-01-21'),
                            paymentMethod: client_1.PaymentMethod.CASH,
                            salesChannel: client_1.SalesChannel.ON_SITE,
                            items: [
                                { productId: '6', productName: 'Samsung 990 Pro 2TB NVMe SSD', quantity: 1, unitPrice: 75000, total: 75000, warrantyDueDate: new Date('2031-01-06') },
                                { productId: '13', productName: 'NZXT Kraken X73 RGB', quantity: 1, unitPrice: 75000, total: 75000, warrantyDueDate: new Date('2032-01-06') },
                            ],
                            payments: [
                                { amount: 50000, paymentMethod: client_1.PaymentMethod.CASH, paymentDate: new Date('2026-01-06T09:00:00'), notes: 'Down payment at purchase' },
                                { amount: 50000, paymentMethod: client_1.PaymentMethod.BANK_TRANSFER, paymentDate: new Date('2026-01-13T15:30:00'), notes: 'Bank transfer installment' },
                            ],
                        },
                        {
                            id: '10260007',
                            invoiceNumber: 'INV-10260007',
                            customerId: '1',
                            customerName: 'Kasun Perera',
                            subtotal: 95000,
                            tax: 14250,
                            total: 109250,
                            paidAmount: 109250,
                            dueAmount: 0,
                            status: client_1.InvoiceStatus.FULLPAID,
                            date: new Date('2026-01-11'),
                            dueDate: new Date('2026-01-26'),
                            paymentMethod: client_1.PaymentMethod.CARD,
                            salesChannel: client_1.SalesChannel.ON_SITE,
                            items: [
                                { productId: '19', productName: 'SteelSeries Arctis Nova Pro', quantity: 1, unitPrice: 95000, total: 95000, warrantyDueDate: new Date('2027-01-11') },
                            ],
                        },
                        {
                            id: '10260008',
                            invoiceNumber: 'INV-10260008',
                            customerId: '8',
                            customerName: 'Sanjay Mendis',
                            subtotal: 434000,
                            tax: 65100,
                            total: 499100,
                            paidAmount: 499100,
                            dueAmount: 0,
                            status: client_1.InvoiceStatus.FULLPAID,
                            date: new Date('2026-01-12'),
                            dueDate: new Date('2026-01-27'),
                            paymentMethod: client_1.PaymentMethod.BANK_TRANSFER,
                            salesChannel: client_1.SalesChannel.ONLINE,
                            items: [
                                { productId: '5', productName: 'AMD Radeon RX 7900 XTX', quantity: 1, unitPrice: 350000, total: 350000, warrantyDueDate: new Date('2028-01-12') },
                                { productId: '7', productName: 'WD Black SN850X 1TB', quantity: 2, unitPrice: 42000, total: 84000, warrantyDueDate: new Date('2031-01-12') },
                            ],
                        },
                        {
                            id: '10260009',
                            invoiceNumber: 'INV-10260009',
                            customerId: '6',
                            customerName: 'Priya Jayawardena',
                            subtotal: 153000,
                            tax: 22950,
                            total: 175950,
                            paidAmount: 175950,
                            dueAmount: 0,
                            status: client_1.InvoiceStatus.FULLPAID,
                            date: new Date('2026-01-14'),
                            dueDate: new Date('2026-01-29'),
                            paymentMethod: client_1.PaymentMethod.CASH,
                            salesChannel: client_1.SalesChannel.ON_SITE,
                            items: [
                                { productId: '14', productName: 'Lian Li O11 Dynamic EVO', quantity: 1, unitPrice: 58000, total: 58000, warrantyDueDate: new Date('2028-01-14') },
                                { productId: '9', productName: 'G.Skill Trident Z5 64GB DDR5', quantity: 1, unitPrice: 95000, total: 95000 },
                            ],
                        },
                        {
                            id: '10260010',
                            invoiceNumber: 'INV-10260010',
                            customerId: '3',
                            customerName: 'Tech Solutions Ltd',
                            subtotal: 1120000,
                            tax: 168000,
                            total: 1288000,
                            paidAmount: 800000,
                            dueAmount: 488000,
                            status: client_1.InvoiceStatus.HALFPAY,
                            date: new Date('2026-01-15'),
                            dueDate: new Date('2026-01-30'),
                            paymentMethod: client_1.PaymentMethod.CREDIT,
                            salesChannel: client_1.SalesChannel.ON_SITE,
                            items: [
                                { productId: '11', productName: 'MSI MEG Z790 ACE', quantity: 3, unitPrice: 165000, total: 495000, warrantyDueDate: new Date('2029-01-15') },
                                { productId: '20', productName: 'Seagate Exos 18TB HDD', quantity: 5, unitPrice: 125000, total: 625000, warrantyDueDate: new Date('2031-01-15') },
                            ],
                        },
                        {
                            id: '10260011',
                            invoiceNumber: 'INV-10260011',
                            customerId: '5',
                            customerName: 'GameZone Café',
                            subtotal: 1170000,
                            tax: 175500,
                            total: 1345500,
                            paidAmount: 1345500,
                            dueAmount: 0,
                            status: client_1.InvoiceStatus.FULLPAID,
                            date: new Date('2026-01-17'),
                            dueDate: new Date('2026-02-01'),
                            paymentMethod: client_1.PaymentMethod.BANK_TRANSFER,
                            salesChannel: client_1.SalesChannel.ONLINE,
                            items: [
                                { productId: '17', productName: 'Logitech G Pro X Superlight 2', quantity: 10, unitPrice: 52000, originalPrice: 55000, total: 520000, warrantyDueDate: new Date('2028-01-17') },
                                { productId: '18', productName: 'Razer Huntsman V3 Pro', quantity: 10, unitPrice: 65000, originalPrice: 68000, total: 650000, warrantyDueDate: new Date('2028-01-17') },
                            ],
                        },
                        {
                            id: '10260012',
                            invoiceNumber: 'INV-10260012',
                            customerId: '2',
                            customerName: 'Nimali Fernando',
                            subtotal: 90000,
                            tax: 13500,
                            total: 103500,
                            paidAmount: 0,
                            dueAmount: 103500,
                            status: client_1.InvoiceStatus.UNPAID,
                            date: new Date('2026-01-19'),
                            dueDate: new Date('2026-02-03'),
                            paymentMethod: client_1.PaymentMethod.CREDIT,
                            salesChannel: client_1.SalesChannel.ON_SITE,
                            items: [
                                { productId: '8', productName: 'Corsair Vengeance DDR5 32GB', quantity: 2, unitPrice: 45000, originalPrice: 48000, total: 90000 },
                            ],
                        },
                    ];
                    _h = 0, invoiceData_1 = invoiceData;
                    _q.label = 24;
                case 24:
                    if (!(_h < invoiceData_1.length)) return [3 /*break*/, 34];
                    inv = invoiceData_1[_h];
                    items = inv.items, payments = inv.payments, invoiceFields = __rest(inv, ["items", "payments"]);
                    return [4 /*yield*/, prisma.invoice.upsert({
                            where: { id: inv.id },
                            update: { shopId: ecotechShop.id },
                            create: __assign(__assign({}, invoiceFields), { shopId: ecotechShop.id, createdById: ecotechUser.id }),
                        })];
                case 25:
                    invoice = _q.sent();
                    _j = 0, items_1 = items;
                    _q.label = 26;
                case 26:
                    if (!(_j < items_1.length)) return [3 /*break*/, 29];
                    item = items_1[_j];
                    return [4 /*yield*/, prisma.invoiceItem.create({
                            data: {
                                invoiceId: invoice.id,
                                productId: item.productId,
                                productName: item.productName,
                                quantity: item.quantity,
                                unitPrice: item.unitPrice,
                                originalPrice: item.originalPrice,
                                total: item.total,
                                warrantyDueDate: item.warrantyDueDate,
                            },
                        })];
                case 27:
                    _q.sent();
                    _q.label = 28;
                case 28:
                    _j++;
                    return [3 /*break*/, 26];
                case 29:
                    if (!payments) return [3 /*break*/, 33];
                    _k = 0, payments_1 = payments;
                    _q.label = 30;
                case 30:
                    if (!(_k < payments_1.length)) return [3 /*break*/, 33];
                    payment = payments_1[_k];
                    return [4 /*yield*/, prisma.invoicePayment.create({
                            data: {
                                invoiceId: invoice.id,
                                amount: payment.amount,
                                paymentMethod: payment.paymentMethod,
                                paymentDate: payment.paymentDate,
                                notes: payment.notes,
                                recordedById: ecotechUser.id, // Link to ecotech user
                            },
                        })];
                case 31:
                    _q.sent();
                    _q.label = 32;
                case 32:
                    _k++;
                    return [3 /*break*/, 30];
                case 33:
                    _h++;
                    return [3 /*break*/, 24];
                case 34:
                    console.log("\u2705 Created ".concat(invoiceData.length, " invoices with items and payments"));
                    console.log('');
                    console.log('🎉 Seed completed successfully!');
                    console.log('');
                    console.log('═══════════════════════════════════════════════════');
                    console.log('📊 SUMMARY');
                    console.log('═══════════════════════════════════════════════════');
                    console.log('');
                    console.log("\uD83C\uDFEA Shop: ".concat(ecotechShop.name));
                    console.log("   Slug: ".concat(ecotechShop.slug));
                    console.log("   Email: ".concat(ecotechShop.email));
                    console.log('');
                    console.log('📈 Data Created:');
                    console.log("   \u2022 Users: 3");
                    console.log("   \u2022 Categories: ".concat(Object.keys(categories).length));
                    console.log("   \u2022 Brands: ".concat(Object.keys(brands).length));
                    console.log("   \u2022 Customers: ".concat(customerData.length));
                    console.log("   \u2022 Products: ".concat(productData.length));
                    console.log("   \u2022 Invoices: ".concat(invoiceData.length));
                    console.log('');
                    console.log('═══════════════════════════════════════════════════');
                    console.log('🔑 LOGIN CREDENTIALS');
                    console.log('═══════════════════════════════════════════════════');
                    console.log('');
                    console.log('   Role      │ Email                │ Password');
                    console.log('   ──────────┼──────────────────────┼───────────');
                    console.log('   Admin     │ ecotech@ecotech.lk   │ ecotech123');
                    console.log('   Manager   │ manager@ecotech.lk   │ manager123');
                    console.log('   Staff     │ staff@ecotech.lk     │ staff123');
                    console.log('');
                    console.log('═══════════════════════════════════════════════════');
                    return [2 /*return*/];
            }
        });
    });
}
main()
    .catch(function (e) {
    console.error('❌ Seed failed:', e);
    process.exit(1);
})
    .finally(function () { return __awaiter(void 0, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, prisma.$disconnect()];
            case 1:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); });
