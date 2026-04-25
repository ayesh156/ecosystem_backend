/**
 * PDF Generation Service
 * Generates invoice and GRN PDFs using puppeteer-core + @sparticuz/chromium
 * MATCHES FRONTEND EXACTLY
 *
 * Render.com Optimization Notes:
 * - Uses `puppeteer-core` (no bundled Chromium — saves ~300MB disk).
 * - Uses `@sparticuz/chromium` in production (minimal Chromium binary ~50MB compressed).
 * - RAM usage: ~100-150MB per PDF generation (down from ~200-300MB with full puppeteer).
 * - Concurrency semaphore ensures only ONE PDF generates at a time to prevent OOM.
 * - Browser instance is created and destroyed per-request with try/finally safety.
 */

import puppeteer from 'puppeteer-core';

// ===================================
// Concurrency Control — Prevent OOM on Render Free Tier (512MB)
// ===================================

/**
 * Simple Semaphore to limit concurrent PDF generations.
 * On Render's 512MB free tier, even ONE Chromium instance uses ~100-150MB.
 * Two concurrent instances = instant OOM crash.
 */
class PdfSemaphore {
  private queue: Array<() => void> = [];
  private running = 0;

  constructor(private readonly maxConcurrent: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }
    // Wait in queue until a slot opens
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) {
      this.running++;
      next();
    }
  }

  /** Number of requests currently waiting */
  get pending(): number {
    return this.queue.length;
  }
}

// Only 1 concurrent PDF generation allowed (Render 512MB RAM safety)
const pdfSemaphore = new PdfSemaphore(1);

// ===================================
// Chromium Path Detection (Multi-Environment)
// ===================================

/**
 * Detect Chrome/Chromium executable path for the current environment.
 * Priority:
 *   1. PUPPETEER_EXECUTABLE_PATH env var (explicit override)
 *   2. @sparticuz/chromium (production — lightweight Chrome for containers)
 *   3. System Chrome / Chromium (fallback)
 *   4. Common Windows Chrome paths (development)
 */
async function getChromiumExecutable(): Promise<string> {
  // 1. Explicit env var override (Docker / custom Render setup)
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    console.log(`🔧 Using PUPPETEER_EXECUTABLE_PATH: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  // 2. Production: Use @sparticuz/chromium (minimal headless Chrome, ~50MB compressed)
  if (process.env.NODE_ENV === 'production') {
    try {
      const chromium = await import('@sparticuz/chromium');
      // Configure for minimal resource usage
      chromium.default.setHeadlessMode = true;
      chromium.default.setGraphicsMode = false;
      const execPath = await chromium.default.executablePath();
      console.log(`🔧 Using @sparticuz/chromium: ${execPath}`);
      return execPath;
    } catch (e) {
      console.warn('⚠️  @sparticuz/chromium not available, trying system Chrome...');
    }
  }

  // 3. System Chrome (Linux containers, CI/CD)
  const linuxPaths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];

  // 4. Windows paths (local development)
  const winPaths = [
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ].filter(Boolean) as string[];

  const candidates = process.platform === 'win32' ? winPaths : linuxPaths;

  try {
    const fs = await import('fs');
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        console.log(`🔧 Found system Chrome at: ${candidate}`);
        return candidate;
      }
    }
  } catch {
    // fs error — fall through
  }

  // 5. Last resort: try puppeteer's cache (if `puppeteer` devDependency installed Chrome)
  try {
    const fullPuppeteer = await import('puppeteer');
    const execPath = (fullPuppeteer as any).executablePath?.();
    if (execPath) {
      console.log(`🔧 Using puppeteer's bundled Chrome: ${execPath}`);
      return execPath;
    }
  } catch {
    // puppeteer not installed — that's fine in production
  }

  throw new Error(
    'No Chrome/Chromium found. Set PUPPETEER_EXECUTABLE_PATH env var, ' +
    'install @sparticuz/chromium, or install Chrome on the system.'
  );
}

/**
 * Launch args optimized for containerized cloud environments.
 * Aggressively disables features to minimize RAM on Render's 512MB tier.
 * 
 * Key savings:
 * - --single-process + --no-zygote: ~50MB savings (no child process overhead)
 * - --disable-dev-shm-usage: Prevents /dev/shm exhaustion in containers
 * - --disable-gpu + --disable-software-rasterizer: No GPU memory allocation
 * - --js-flags=--max-old-space-size=128: Cap V8 heap inside Chromium
 */
const PUPPETEER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--single-process',
  '--no-zygote',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-breakpad',
  '--disable-component-extensions-with-background-pages',
  '--disable-component-update',
  '--disable-default-apps',
  '--disable-domain-reliability',
  '--disable-features=TranslateUI',
  '--disable-hang-monitor',
  '--disable-ipc-flooding-protection',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-renderer-backgrounding',
  '--disable-sync',
  '--disable-translate',
  '--metrics-recording-only',
  '--no-first-run',
  '--safebrowsing-disable-auto-update',
  '--font-render-hinting=none',
  '--hide-scrollbars',
  '--mute-audio',
  '--js-flags=--max-old-space-size=128',
];

/** Max time to wait for page.setContent + page.pdf combined */
const PDF_GENERATION_TIMEOUT_MS = 30000; // 30s

// Invoice item interface
interface InvoiceItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  originalPrice?: number;
  total: number;
  warranty?: string; // Product warranty period (e.g., "1 year", "6 months")
}

// Invoice data interface for PDF generation
export interface InvoicePDFData {
  invoiceNumber: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  customerAddress?: string;
  date: string;
  dueDate: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paidAmount: number;
  dueAmount: number;
  status: string;
  notes?: string;
  // Shop branding
  shopName: string;
  shopSubName?: string;
  shopAddress?: string;
  shopPhone?: string;
  shopEmail?: string;
  shopLogo?: string; // Base64 encoded logo or URL
}

// GRN item interface
interface GRNItem {
  productName: string;
  category?: string;
  unitPrice: number;
  originalUnitPrice?: number;
  orderedQuantity: number;
  receivedQuantity: number;
  acceptedQuantity: number;
  rejectedQuantity: number;
  totalAmount: number;
  sellingPrice?: number;
  discountType?: 'fixed' | 'percentage';
  discountValue?: number;
}

// GRN data interface for PDF generation
export interface GRNPDFData {
  grnNumber: string;
  supplierName: string;
  supplierEmail?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  orderDate: string;
  expectedDeliveryDate: string;
  receivedDate: string;
  deliveryNote?: string;
  receivedBy?: string;
  vehicleNumber?: string;
  status: 'completed' | 'partial' | 'pending' | 'rejected';
  paymentStatus: 'paid' | 'unpaid' | 'partial';
  paymentMethod?: string;
  items: GRNItem[];
  totalOrderedQuantity: number;
  totalReceivedQuantity: number;
  totalAcceptedQuantity: number;
  totalRejectedQuantity: number;
  subtotal: number;
  totalDiscount?: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount?: number;
  notes?: string;
  // Shop branding
  shopName: string;
  shopSubName?: string;
  shopAddress?: string;
  shopPhone?: string;
  shopEmail?: string;
  shopLogo?: string; // Base64 encoded logo or URL
}

// Format currency for Sri Lanka
const formatCurrency = (amount: number): string => {
  return `LKR ${amount.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`;
};

// Format date to YYYY-MM-DD
const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString('en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).split('/').reverse().join('-');
};

// Format warranty into short code (e.g., "1 year" -> "[1Y]", "6 months" -> "[6M]")
const formatWarrantyCode = (warranty?: string): string => {
  if (!warranty) return '[N/W]';
  const w = warranty.toLowerCase().trim();
  if (w.includes('lifetime') || w.includes('life time')) return '[L/W]';
  if (w.includes('no warranty') || w === 'n/w' || w === 'none') return '[N/W]';
  // Match patterns like "1 year", "2 years", "6 months", "3 month"
  const yearMatch = w.match(/(\d+)\s*y(ear)?s?/i);
  if (yearMatch) return `[${yearMatch[1]}Y]`;
  const monthMatch = w.match(/(\d+)\s*m(onth)?s?/i);
  if (monthMatch) return `[${monthMatch[1]}M]`;
  const weekMatch = w.match(/(\d+)\s*w(eek)?s?/i);
  if (weekMatch) return `[${weekMatch[1]}W]`;
  const dayMatch = w.match(/(\d+)\s*d(ay)?s?/i);
  if (dayMatch) return `[${dayMatch[1]}D]`;
  // If can't parse, return abbreviated version
  return warranty.length > 5 ? `[${warranty.substring(0, 5)}]` : `[${warranty}]`;
};

// Default building icon SVG for shops without logo
const getDefaultLogoSVG = (): string => {
  return `
    <div style="width: 70px; height: 70px; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #10b981 0%, #3b82f6 100%); border-radius: 12px;">
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect>
        <path d="M9 22v-4h6v4"></path>
        <path d="M8 6h.01"></path>
        <path d="M16 6h.01"></path>
        <path d="M12 6h.01"></path>
        <path d="M12 10h.01"></path>
        <path d="M12 14h.01"></path>
        <path d="M16 10h.01"></path>
        <path d="M16 14h.01"></path>
        <path d="M8 10h.01"></path>
        <path d="M8 14h.01"></path>
      </svg>
    </div>
  `;
};

// Generate the HTML template for the invoice (MATCHES FRONTEND PrintableInvoice EXACTLY)
const generateInvoiceHTML = (data: InvoicePDFData): string => {
  const isWalkIn = data.customerName?.toLowerCase().includes('walk-in') || 
                   data.customerName?.toLowerCase().includes('walkin');

  // Generate items rows
  const itemRows = data.items.map((item) => {
    const warrantyBadge = item.warranty 
      ? `<span style="margin-left: 8px; font-size: 7pt; font-weight: 600; color: #333; background: #f0f0f0; padding: 1px 4px; border-radius: 3px;">${formatWarrantyCode(item.warranty)}</span>`
      : '';
    
    const priceCell = item.originalPrice && item.originalPrice !== item.unitPrice
      ? `<div style="display: flex; flex-direction: column; align-items: flex-end;">
           <span style="text-decoration: line-through; font-size: 7pt;">${formatCurrency(item.originalPrice)}</span>
           <span style="font-weight: 600;">${formatCurrency(item.unitPrice)}</span>
         </div>`
      : formatCurrency(item.unitPrice);
    
    return `
      <tr>
        <td>
          <div class="product-name">${item.productName}${warrantyBadge}</div>
        </td>
        <td style="text-align: center; font-weight: 600;">${item.quantity}</td>
        <td style="text-align: right; font-family: 'Consolas', monospace; font-size: 8pt;">${priceCell}</td>
        <td style="text-align: right; font-weight: 700; font-family: 'Consolas', monospace; font-size: 8pt;">${formatCurrency(item.total)}</td>
      </tr>
    `;
  }).join('');

  // Shop logo section
  const logoSection = data.shopLogo
    ? `<img src="${data.shopLogo}" alt="Shop Logo" style="max-width: 120px; max-height: 80px; object-fit: contain;" />`
    : getDefaultLogoSVG();

  // Address formatted with line breaks
  const formattedAddress = data.shopAddress 
    ? data.shopAddress.split(',').map(line => line.trim()).join('<br>')
    : 'N/A';

  // First word of shop name for invoice title
  const shopFirstWord = data.shopName.split(' ')[0];

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${data.invoiceNumber}</title>
  <style>
    /* ═══════════════════════════════════════════════════════════════
       INK-EFFICIENT B&W PRINT OPTIMIZED - MATCHES FRONTEND EXACTLY
       ═══════════════════════════════════════════════════════════════ */
    
    @page {
      size: A4 portrait;
      margin: 10mm 12mm;
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Segoe UI', 'Arial', sans-serif;
      font-size: 10pt;
      line-height: 1.4;
      color: #000;
      background: white;
      padding: 12mm 15mm;
    }

    /* HEADER - Company Info */
    .invoice-header {
      display: flex;
      justify-content: space-between;
      align-items: stretch;
      margin-bottom: 8px;
      padding-bottom: 15px;
      border-bottom: 2px solid #000;
    }

    .company-section {
      display: flex;
      align-items: stretch;
      gap: 12px;
    }

    .company-logo {
      width: auto;
      height: auto;
      max-width: 120px;
      max-height: 80px;
      align-self: center;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .company-info h1 {
      font-size: 16pt;
      font-weight: 700;
      color: #000;
      margin: 0 0 1px 0;
    }

    .company-info .sub-name {
      font-size: 9pt;
      font-weight: 600;
      color: #000;
      margin-bottom: 6px;
    }

    .company-info .details {
      font-size: 8pt;
      color: #000;
      line-height: 1.4;
    }

    .contact-box {
      text-align: right;
    }

    .contact-box h3 {
      font-size: 9pt;
      font-weight: 600;
      color: #000;
      margin: 0 0 4px 0;
      text-decoration: underline;
    }

    .contact-box .info {
      font-size: 8pt;
      color: #000;
      line-height: 1.5;
    }

    /* TITLE SECTION */
    .invoice-title-section {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 15px 18px;
      margin-bottom: 15px;
      background: white;
      border: 2px solid #000;
    }

    .invoice-title h2 {
      font-size: 18pt;
      font-weight: 700;
      color: #000;
      margin: 0 0 2px 0;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .invoice-title .company-label {
      font-size: 8pt;
      color: #000;
      font-weight: 500;
      text-transform: uppercase;
    }

    .amount-due {
      text-align: right;
    }

    .amount-due label {
      font-size: 8pt;
      color: #000;
      font-weight: 600;
      text-decoration: underline;
    }

    .amount-due .amount {
      font-size: 20pt;
      font-weight: 700;
      color: #000;
      font-family: 'Consolas', 'Monaco', monospace;
    }

    /* INVOICE META */
    .invoice-meta {
      display: flex;
      justify-content: space-between;
      margin-bottom: 18px;
      gap: 20px;
    }

    .bill-to {
      flex: 1;
      padding: 10px;
      border: 1px solid #000;
    }

    .bill-to label {
      font-size: 7pt;
      color: #000;
      display: block;
      margin-bottom: 2px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .bill-to .name {
      font-size: 11pt;
      font-weight: 700;
      color: #000;
      margin-bottom: 2px;
    }

    .bill-to .info {
      font-size: 8pt;
      color: #000;
      line-height: 1.4;
    }

    .invoice-details {
      text-align: right;
    }

    .invoice-details .row {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-bottom: 4px;
      font-size: 8pt;
    }

    .invoice-details .row label {
      color: #000;
      font-weight: 500;
    }

    .invoice-details .row .value {
      color: #000;
      font-weight: 600;
      min-width: 90px;
      text-align: right;
    }

    /* ITEMS TABLE */
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 15px;
    }

    .items-table thead th {
      background: white;
      color: #000;
      font-size: 8pt;
      font-weight: 700;
      padding: 8px 10px;
      text-align: left;
      border: 1px solid #000;
      border-bottom: 2px solid #000;
      text-transform: uppercase;
    }

    .items-table thead th:first-child { width: 50%; }
    .items-table thead th:nth-child(2) { width: 10%; text-align: center; }
    .items-table thead th:nth-child(3),
    .items-table thead th:nth-child(4) { width: 20%; text-align: right; }

    .items-table tbody tr {
      border-bottom: 1px solid #000;
    }

    .items-table tbody td {
      padding: 10px;
      font-size: 9pt;
      color: #000;
      vertical-align: top;
      border-left: 1px solid #000;
      border-right: 1px solid #000;
    }

    .items-table tbody td .product-name {
      font-weight: 600;
      color: #000;
    }

    /* TOTALS SECTION */
    .totals-section {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 18px;
      gap: 25px;
    }

    .payment-info {
      flex: 1;
    }

    .payment-info h4 {
      font-size: 8pt;
      font-weight: 700;
      color: #000;
      margin: 0 0 4px 0;
      text-decoration: underline;
    }

    .payment-info p {
      font-size: 8pt;
      color: #000;
      margin: 0;
    }

    .totals-box {
      width: 220px;
      border: 1px solid #000;
      padding: 10px;
    }

    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 5px 0;
      font-size: 8pt;
      border-bottom: 1px dotted #000;
    }

    .totals-row .label { color: #000; }
    .totals-row .value {
      font-family: 'Consolas', 'Monaco', monospace;
      color: #000;
      font-weight: 500;
    }

    .totals-row.total {
      border-bottom: none;
      padding-top: 8px;
      margin-top: 4px;
      border-top: 2px solid #000;
    }

    .totals-row.total .label {
      font-weight: 700;
      color: #000;
      text-transform: uppercase;
    }

    .totals-row.total .value {
      font-size: 11pt;
      font-weight: 700;
      color: #000;
    }

    /* BALANCE DUE BOX - INK EFFICIENT STYLING */
    .balance-due-box {
      background: #fff;
      border: 2px solid #000;
      padding: 12px 15px;
      margin-top: 12px;
      margin-bottom: 15px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .balance-due-box .label {
      font-size: 10pt;
      font-weight: 800;
      color: #000;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .balance-due-box .value {
      font-size: 13pt;
      font-weight: 900;
      color: #000;
      font-family: 'Consolas', 'Monaco', monospace;
    }

    .balance-due-note {
      text-align: center;
      font-size: 7pt;
      color: #666;
      margin-bottom: 12px;
      font-style: italic;
    }

    /* NOTES SECTION */
    .notes-section {
      background: white;
      border: 1px solid #000;
      padding: 10px 12px;
      margin-bottom: 15px;
    }

    .notes-section h4 {
      font-size: 8pt;
      font-weight: 700;
      color: #000;
      margin: 0 0 6px 0;
      text-transform: uppercase;
      border-bottom: 1px solid #000;
      padding-bottom: 4px;
    }

    .notes-section p {
      font-size: 7pt;
      color: #000;
      margin: 0;
      line-height: 1.5;
    }

    /* FOOTER */
    .footer-section {
      border-top: 2px solid #000;
      padding-top: 12px;
    }

    .footer-section h4 {
      font-size: 7pt;
      font-weight: 700;
      color: #000;
      margin: 0 0 3px 0;
    }

    .footer-section p {
      font-size: 7pt;
      color: #000;
      margin: 0;
      line-height: 1.5;
    }

    .footer-thank-you {
      text-align: center;
      margin-top: 15px;
      padding-top: 12px;
      border-top: 1px dashed #000;
      font-size: 9pt;
      font-weight: 600;
      color: #000;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="invoice-header">
    <div class="company-section">
      <div class="company-logo">
        ${logoSection}
      </div>
      <div class="company-info">
        <h1>${data.shopName}</h1>
        ${data.shopSubName ? `<div class="sub-name">${data.shopSubName}</div>` : ''}
        <div class="details">${formattedAddress}</div>
      </div>
    </div>
    <div class="contact-box">
      <h3>Contact information</h3>
      <div class="info">
        ${data.shopEmail || ''}<br>
        ${data.shopPhone || ''}
      </div>
    </div>
  </div>

  <!-- Invoice Title Section -->
  <div class="invoice-title-section">
    <div class="invoice-title">
      <h2>${shopFirstWord} INVOICE</h2>
      <div class="company-label">${data.shopName} ${data.shopSubName || ''}</div>
    </div>
    <div class="amount-due">
      <label>Amount Due (LKR)</label>
      <div class="amount">${data.dueAmount.toLocaleString('en-LK', { minimumFractionDigits: 2 })}</div>
    </div>
  </div>

  <!-- Bill To & Invoice Details -->
  <div class="invoice-meta">
    <div class="bill-to">
      <label>Bill to:</label>
      ${isWalkIn ? `
        <div class="name">Walk-in Customer</div>
        <div class="info" style="font-style: italic; color: #666;">Cash Sale</div>
      ` : `
        <div class="name">${data.customerName}</div>
        ${data.customerEmail || data.customerPhone ? `
          <div class="info">
            ${data.customerEmail ? `Email: ${data.customerEmail}<br>` : ''}
            ${data.customerPhone ? `Phone: ${data.customerPhone}` : ''}
          </div>
        ` : ''}
      `}
    </div>
    <div class="invoice-details">
      <div class="row">
        <label>Invoice Number:</label>
        <span class="value">${data.invoiceNumber}</span>
      </div>
      <div class="row">
        <label>Invoice Date:</label>
        <span class="value">${formatDate(data.date)}</span>
      </div>
      <div class="row">
        <label>Payment Due:</label>
        <span class="value">${formatDate(data.dueDate)}</span>
      </div>
    </div>
  </div>

  <!-- Items Table -->
  <table class="items-table">
    <thead>
      <tr>
        <th>Items</th>
        <th>Qty</th>
        <th>Price</th>
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <!-- Payment Info & Totals -->
  <div class="totals-section">
    <div class="payment-info">
      <h4>Payment Instruction</h4>
      <p>Payment</p>
    </div>
    <div class="totals-box">
      <div class="totals-row">
        <span class="label">Sub Total:</span>
        <span class="value">${formatCurrency(data.subtotal)}</span>
      </div>
      ${data.tax > 0 ? `
        <div class="totals-row">
          <span class="label">Total tax:</span>
          <span class="value">${formatCurrency(data.tax)}</span>
        </div>
      ` : ''}
      ${data.discount > 0 ? `
        <div class="totals-row">
          <span class="label">Discount:</span>
          <span class="value">-${formatCurrency(data.discount)}</span>
        </div>
      ` : ''}
      <div class="totals-row total">
        <span class="label">Grand total:</span>
        <span class="value">${formatCurrency(data.total)}</span>
      </div>
      ${data.paidAmount > 0 && data.paidAmount < data.total ? `
        <div class="totals-row" style="border-bottom: none; padding-top: 6px;">
          <span class="label">Paid Amount:</span>
          <span class="value" style="color: #000000; font-weight: 600;">${formatCurrency(data.paidAmount)}</span>
        </div>
      ` : ''}
    </div>
  </div>

  <!-- Balance Due Box - Only show if there's a balance -->
  ${data.dueAmount > 0 ? `
    <div class="balance-due-box">
      <span class="label">⚠ BALANCE DUE:</span>
      <span class="value">${formatCurrency(data.dueAmount)}</span>
    </div>
    <p class="balance-due-note">Please settle the outstanding balance at your earliest convenience</p>
  ` : ''}

  <!-- Notes / Terms -->
  <div class="notes-section">
    <h4>Notes / Terms</h4>
    <p>
      PLEASE PRODUCE THE INVOICE FOR WARRANTY. NO WARRANTY FOR CHIP BURNS, PHYSICAL DAMAGE OR CORROSION. 
      Warranty covers only manufacturer's defects. Damage or defect due to other causes such as negligence, 
      misuses, improper operation, power fluctuation, lightening, or other natural disasters, sabotage, or accident etc. 
      (01M) = 30 Days, (03M) = 90 Days, (06M) = 180 Days, (01Y) = 350 Days, (02Y) = 700 Days, (03Y) = 1050 Days, 
      (05Y) = 1750 Days, (10Y) = 3500 Days, (L/W) = Lifetime Warranty. (N/W) = No Warranty).
    </p>
    ${data.notes ? `<p style="margin-top: 8px; padding-top: 4px; border-top: 1px dotted #000;">${data.notes}</p>` : ''}
  </div>

  <!-- Footer -->
  <div class="footer-section">
    <p>We know the world is full of choices. Thank you for selecting us.</p>
  </div>

  <div class="footer-thank-you">
    Thank you for your business!
  </div>
</body>
</html>
  `;
};

/**
 * Generate PDF from invoice data
 * Returns a Buffer containing the PDF
 * 
 * Concurrency: Only 1 PDF generates at a time (semaphore-controlled)
 * Memory: Browser is created & destroyed per request with aggressive cleanup
 */
export const generateInvoicePDF = async (data: InvoicePDFData): Promise<Buffer> => {
  if (pdfSemaphore.pending > 0) {
    console.log(`⏳ PDF queue: ${pdfSemaphore.pending} requests waiting...`);
  }

  // Acquire semaphore — blocks if another PDF is being generated
  await pdfSemaphore.acquire();

  let browser = null;
  
  try {
    const executablePath = await getChromiumExecutable();
    console.log('📄 Launching Chromium for Invoice PDF...');
    
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: PUPPETEER_ARGS,
      timeout: PDF_GENERATION_TIMEOUT_MS,
      protocolTimeout: PDF_GENERATION_TIMEOUT_MS,
    });
    
    const page = await browser.newPage();

    // Disable images/CSS we don't need to reduce memory
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      if (['image', 'media', 'font'].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });
    
    // Set the HTML content — use 'load' instead of 'networkidle0' for reliability
    // on cloud environments. 'networkidle0' waits for zero network activity for
    // 500ms which can hang if there are background requests or slow DNS.
    const html = generateInvoiceHTML(data);
    await page.setContent(html, {
      waitUntil: 'load',
      timeout: PDF_GENERATION_TIMEOUT_MS,
    });
    
    // Brief pause for CSS rendering to complete
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '12mm',
        bottom: '10mm',
        left: '12mm',
      },
      timeout: PDF_GENERATION_TIMEOUT_MS,
    });
    
    const result = Buffer.from(pdfBuffer);
    console.log(`✅ Invoice PDF generated (${result.length} bytes)`);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ Invoice PDF generation failed: ${message}`);
    throw new Error(`PDF generation failed: ${message}`);
  } finally {
    // CRITICAL: Always close browser AND release semaphore
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Browser may already be closed on error
      }
      browser = null;
    }

    pdfSemaphore.release();

    // Hint GC to reclaim Chromium memory before next operation (email sending)
    if (global.gc) {
      try { global.gc(); } catch {}
    }
  }
};

/**
 * Generate PDF and save to file
 */
export const generateInvoicePDFToFile = async (data: InvoicePDFData, filePath: string): Promise<string> => {
  const fs = await import('fs').then(m => m.promises);
  const pdfBuffer = await generateInvoicePDF(data);
  await fs.writeFile(filePath, pdfBuffer);
  return filePath;
};

// ═════════════════════════════════════════════════════════════════
// GRN PDF GENERATION
// ═════════════════════════════════════════════════════════════════

// Get status label for GRN
const getGRNStatusLabel = (status: string): string => {
  switch (status) {
    case 'completed': return 'COMPLETED';
    case 'partial': return 'PARTIAL RECEIVED';
    case 'pending': return 'PENDING';
    case 'rejected': return 'REJECTED';
    default: return status.toUpperCase();
  }
};

// Generate the HTML template for GRN (MATCHES FRONTEND PrintableGRN EXACTLY)
const generateGRNHTML = (data: GRNPDFData): string => {
  // Generate items rows
  const itemRows = data.items.map((item) => {
    const hasDiscount = (item.discountValue || 0) > 0;
    const originalPrice = item.originalUnitPrice || item.unitPrice;
    
    const priceCell = hasDiscount
      ? `<div>
           <span style="text-decoration: line-through; font-size: 7pt; display: block;">${formatCurrency(originalPrice)}</span>
           <span style="font-weight: 600; display: block;">${formatCurrency(item.unitPrice)}</span>
           <span style="display: inline-block; font-size: 7pt; background: #f0f0f0; padding: 1px 4px; border-radius: 2px; margin-top: 2px;">
             -${item.discountType === 'percentage' ? `${item.discountValue}%` : formatCurrency(item.discountValue || 0)}
           </span>
         </div>`
      : formatCurrency(item.unitPrice);
    
    return `
      <tr>
        <td>
          <div style="font-weight: 600; color: #000;">${item.productName}</div>
          ${item.category ? `<div style="font-size: 7pt; color: #666; margin-top: 2px;">${item.category}</div>` : ''}
          ${item.sellingPrice ? `<div style="font-size: 7pt; color: #000; margin-top: 4px; padding: 2px 4px; background: #f5f5f5; border-left: 2px solid #000; display: inline-block;">Sell @ ${formatCurrency(item.sellingPrice)}</div>` : ''}
        </td>
        <td style="text-align: right; font-family: 'Consolas', monospace; font-size: 8pt;">${priceCell}</td>
        <td style="text-align: center; font-weight: 600;">${item.orderedQuantity}</td>
        <td style="text-align: center; font-weight: 600;">${item.receivedQuantity}</td>
        <td style="text-align: center; font-weight: 700; color: #059669;">${item.acceptedQuantity}</td>
        <td style="text-align: center; font-weight: 700; color: #dc2626;">${item.rejectedQuantity}</td>
        <td style="text-align: right; font-weight: 700; font-family: 'Consolas', monospace; font-size: 8pt;">${formatCurrency(item.totalAmount)}</td>
      </tr>
    `;
  }).join('');

  // Shop logo section
  const logoSection = data.shopLogo
    ? `<img src="${data.shopLogo}" alt="Shop Logo" style="max-width: 120px; max-height: 80px; object-fit: contain;" />`
    : getDefaultLogoSVG();

  // Address formatted with line breaks
  const formattedAddress = data.shopAddress 
    ? data.shopAddress.split(',').map(line => line.trim()).join('<br>')
    : 'N/A';

  // Balance due calculation
  const balanceDue = data.totalAmount - (data.paidAmount || 0);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GRN ${data.grnNumber}</title>
  <style>
    /* ═══════════════════════════════════════════════════════════════
       INK-EFFICIENT B&W PRINT OPTIMIZED - MATCHES FRONTEND EXACTLY
       ═══════════════════════════════════════════════════════════════ */
    
    @page {
      size: A4 portrait;
      margin: 10mm 12mm;
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Segoe UI', 'Arial', sans-serif;
      font-size: 10pt;
      line-height: 1.4;
      color: #000;
      background: white;
      padding: 12mm 15mm;
    }

    /* HEADER - Company Info - INK EFFICIENT */
    .grn-header {
      display: flex;
      justify-content: space-between;
      align-items: stretch;
      margin-bottom: 8px;
      padding-bottom: 15px;
      border-bottom: 2px solid #000;
    }

    .company-section {
      display: flex;
      align-items: stretch;
      gap: 12px;
    }

    .company-logo {
      width: auto;
      height: auto;
      max-width: 120px;
      max-height: 80px;
      align-self: center;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .company-info h1 {
      font-size: 16pt;
      font-weight: 700;
      color: #000;
      margin: 0 0 1px 0;
    }

    .company-info .sub-name {
      font-size: 9pt;
      font-weight: 600;
      color: #000;
      margin-bottom: 6px;
    }

    .company-info .details {
      font-size: 8pt;
      color: #000;
      line-height: 1.4;
    }

    .contact-box {
      text-align: right;
    }

    .contact-box h3 {
      font-size: 9pt;
      font-weight: 600;
      color: #000;
      margin: 0 0 4px 0;
      text-decoration: underline;
    }

    .contact-box .info {
      font-size: 8pt;
      color: #000;
      line-height: 1.5;
    }

    /* TITLE SECTION */
    .grn-title-section {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 15px 18px;
      margin-bottom: 15px;
      background: white;
      border: 2px solid #000;
    }

    .grn-title h2 {
      font-size: 16pt;
      font-weight: 700;
      color: #000;
      margin: 0 0 2px 0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .grn-title .company-label {
      font-size: 8pt;
      color: #000;
      font-weight: 500;
      text-transform: uppercase;
    }

    .grn-status {
      text-align: right;
    }

    .status-badges {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }

    .status-badge {
      display: inline-block;
      padding: 6px 12px;
      border: 2px solid #000;
      border-radius: 4px;
      font-size: 9pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background: white;
      color: #000;
    }

    .status-badge.partial,
    .status-badge.pending {
      border: 2px dashed #000;
    }

    /* Payment Status Badges - INK EFFICIENT */
    .payment-badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 9pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      background: white;
      color: #000;
      border: 2px solid #000;
    }

    .payment-badge.unpaid {
      border: 2px dashed #000;
    }

    .grn-status .total-amount {
      margin-top: 8px;
      font-size: 18pt;
      font-weight: 700;
      color: #000;
      font-family: 'Consolas', 'Monaco', monospace;
    }

    /* GRN META */
    .grn-meta {
      display: flex;
      justify-content: space-between;
      margin-bottom: 18px;
      gap: 20px;
    }

    .supplier-info {
      flex: 1;
      padding: 10px;
      border: 1px solid #000;
    }

    .supplier-info label {
      font-size: 7pt;
      color: #000;
      display: block;
      margin-bottom: 2px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .supplier-info .name {
      font-size: 11pt;
      font-weight: 700;
      color: #000;
      margin-bottom: 4px;
    }

    .supplier-info .info {
      font-size: 8pt;
      color: #000;
      line-height: 1.4;
    }

    .grn-details {
      text-align: right;
    }

    .grn-details .row {
      display: flex;
      justify-content: flex-end;
      gap: 12px;
      margin-bottom: 4px;
      font-size: 8pt;
    }

    .grn-details .row label {
      color: #000;
      font-weight: 500;
    }

    .grn-details .row .value {
      color: #000;
      font-weight: 600;
      min-width: 90px;
      text-align: right;
    }

    .grn-details .row .value.highlight {
      font-weight: 700;
      font-size: 9pt;
    }

    /* ITEMS TABLE */
    .items-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 15px;
    }

    .items-table thead th {
      background: white;
      color: #000;
      font-size: 8pt;
      font-weight: 700;
      padding: 8px 10px;
      text-align: left;
      border: 1px solid #000;
      border-bottom: 2px solid #000;
      text-transform: uppercase;
    }

    .items-table tbody tr {
      border-bottom: 1px solid #000;
    }

    .items-table tbody td {
      padding: 10px;
      font-size: 9pt;
      color: #000;
      vertical-align: top;
      border-left: 1px solid #000;
      border-right: 1px solid #000;
    }

    /* SUMMARY SECTION */
    .summary-section {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 18px;
      gap: 25px;
    }

    .quantity-summary {
      flex: 1;
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }

    .qty-box {
      flex: 1;
      min-width: 100px;
      text-align: center;
      padding: 12px 8px;
      border: 2px solid #000;
      background: white;
    }

    .qty-box .label {
      font-size: 7pt;
      font-weight: 600;
      color: #000;
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .qty-box .value {
      font-size: 16pt;
      font-weight: 700;
      color: #000;
    }

    .qty-box.accepted .value {
      color: #059669;
    }

    .qty-box.rejected .value {
      color: #dc2626;
    }

    .totals-box {
      width: 220px;
      border: 1px solid #000;
      padding: 10px;
    }

    .totals-row {
      display: flex;
      justify-content: space-between;
      padding: 5px 0;
      font-size: 8pt;
      border-bottom: 1px dotted #000;
    }

    .totals-row .label { color: #000; }
    .totals-row .value {
      font-family: 'Consolas', 'Monaco', monospace;
      color: #000;
      font-weight: 500;
    }

    .totals-row.total {
      border-bottom: none;
      padding-top: 8px;
      margin-top: 4px;
      border-top: 2px solid #000;
    }

    .totals-row.total .label {
      font-weight: 700;
      color: #000;
      text-transform: uppercase;
    }

    .totals-row.total .value {
      font-size: 11pt;
      font-weight: 700;
      color: #000;
    }

    .payment-info {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid #000;
    }

    .payment-info .payment-label {
      font-size: 7pt;
      font-weight: 600;
      color: #000;
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .payment-info .payment-detail {
      font-size: 8pt;
      color: #000;
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .payment-info .payment-status {
      font-size: 7pt;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 3px;
      background: white;
      border: 1px solid #000;
    }

    /* BALANCE DUE BOX - INK EFFICIENT */
    .balance-due-box {
      background: #fff;
      border: 2px solid #000;
      padding: 12px 15px;
      margin-bottom: 15px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .balance-due-box .balance-label {
      font-size: 10pt;
      font-weight: 800;
      color: #000;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .balance-due-box .balance-amount {
      font-size: 13pt;
      font-weight: 900;
      color: #000;
      font-family: 'Consolas', 'Monaco', monospace;
    }

    /* FULLY PAID BOX */
    .fully-paid-box {
      text-align: center;
      font-weight: 700;
      margin-bottom: 15px;
      padding: 10px 16px;
      border: 2px solid #000;
      border-radius: 0;
      background: white;
    }

    .fully-paid-box .paid-label {
      font-size: 12pt;
      font-weight: 700;
      color: #000;
      letter-spacing: 1px;
    }

    /* NOTES SECTION */
    .notes-section {
      background: white;
      border: 1px solid #000;
      padding: 10px 12px;
      margin-bottom: 15px;
    }

    .notes-section h4 {
      font-size: 8pt;
      font-weight: 700;
      color: #000;
      margin: 0 0 6px 0;
      text-transform: uppercase;
      border-bottom: 1px solid #000;
      padding-bottom: 4px;
    }

    .notes-section p {
      font-size: 7pt;
      color: #000;
      margin: 0;
      line-height: 1.5;
    }

    /* SIGNATURES */
    .signatures-section {
      display: flex;
      gap: 30px;
      justify-content: space-between;
      margin-bottom: 15px;
      padding-top: 12px;
    }

    .signature-box {
      flex: 1;
      text-align: center;
    }

    .signature-box .line {
      height: 40px;
      border-bottom: 1px solid #000;
      margin-bottom: 6px;
    }

    .signature-box .label {
      font-size: 8pt;
      color: #000;
      font-weight: 600;
    }

    /* FOOTER */
    .footer-section {
      border-top: 2px solid #000;
      padding-top: 12px;
      margin-bottom: 8px;
    }

    .footer-section h4 {
      font-size: 7pt;
      font-weight: 700;
      color: #000;
      margin: 0 0 3px 0;
    }

    .footer-section p {
      font-size: 7pt;
      color: #000;
      margin: 0;
      line-height: 1.5;
    }

    .footer-thank-you {
      text-align: center;
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px dashed #000;
      font-size: 9pt;
      font-weight: 600;
      color: #000;
    }
  </style>
</head>
<body>
  <!-- Header -->
  <div class="grn-header">
    <div class="company-section">
      <div class="company-logo">
        ${logoSection}
      </div>
      <div class="company-info">
        <h1>${data.shopName}</h1>
        ${data.shopSubName ? `<div class="sub-name">${data.shopSubName}</div>` : ''}
        <div class="details">${formattedAddress}</div>
      </div>
    </div>
    <div class="contact-box">
      <h3>Contact information</h3>
      <div class="info">
        ${data.shopEmail || ''}<br>
        ${data.shopPhone || ''}
      </div>
    </div>
  </div>

  <!-- GRN Title Section -->
  <div class="grn-title-section">
    <div class="grn-title">
      <h2>GOODS RECEIVED NOTE</h2>
      <div class="company-label">${data.shopName} ${data.shopSubName || ''}</div>
    </div>
    <div class="grn-status">
      <div class="status-badges">
        <span class="status-badge ${data.status}">
          ${getGRNStatusLabel(data.status)}
        </span>
        <span class="payment-badge ${data.paymentStatus}">
          ${data.paymentStatus === 'paid' ? '✓ PAID' : data.paymentStatus === 'partial' ? '◐ PARTIAL' : '○ UNPAID'}
        </span>
      </div>
      <div class="total-amount">${formatCurrency(data.totalAmount)}</div>
    </div>
  </div>

  <!-- Supplier Info & GRN Details -->
  <div class="grn-meta">
    <div class="supplier-info">
      <label>Supplier:</label>
      <div class="name">${data.supplierName}</div>
      ${data.supplierEmail || data.supplierPhone || data.supplierAddress ? `
        <div class="info">
          ${data.supplierEmail ? `Email: ${data.supplierEmail}<br>` : ''}
          ${data.supplierPhone ? `Phone: ${data.supplierPhone}<br>` : ''}
          ${data.supplierAddress ? `Address: ${data.supplierAddress}` : ''}
        </div>
      ` : ''}
    </div>
    <div class="grn-details">
      <div class="row">
        <label>GRN Number:</label>
        <span class="value highlight">${data.grnNumber}</span>
      </div>
      <div class="row">
        <label>Delivery Note:</label>
        <span class="value">${data.deliveryNote || '-'}</span>
      </div>
      <div class="row">
        <label>Order Date:</label>
        <span class="value">${formatDate(data.orderDate)}</span>
      </div>
      <div class="row">
        <label>Expected Delivery:</label>
        <span class="value">${formatDate(data.expectedDeliveryDate)}</span>
      </div>
      <div class="row">
        <label>Received Date:</label>
        <span class="value">${formatDate(data.receivedDate)}</span>
      </div>
      <div class="row">
        <label>Received By:</label>
        <span class="value">${data.receivedBy || '-'}</span>
      </div>
      ${data.vehicleNumber ? `
        <div class="row">
          <label>Vehicle No:</label>
          <span class="value">${data.vehicleNumber}</span>
        </div>
      ` : ''}
    </div>
  </div>

  <!-- Items Table -->
  <table class="items-table">
    <thead>
      <tr>
        <th style="width: 30%;">Product</th>
        <th style="width: 12%; text-align: right;">Unit Price</th>
        <th style="width: 10%; text-align: center;">Ordered</th>
        <th style="width: 10%; text-align: center;">Received</th>
        <th style="width: 10%; text-align: center;">Accepted</th>
        <th style="width: 10%; text-align: center;">Rejected</th>
        <th style="width: 18%; text-align: right;">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows}
    </tbody>
  </table>

  <!-- Summary Section -->
  <div class="summary-section">
    <div class="quantity-summary">
      <div class="qty-box ordered">
        <div class="label">Ordered</div>
        <div class="value">${data.totalOrderedQuantity}</div>
      </div>
      <div class="qty-box received">
        <div class="label">Received</div>
        <div class="value">${data.totalReceivedQuantity}</div>
      </div>
      <div class="qty-box accepted">
        <div class="label">Accepted</div>
        <div class="value">${data.totalAcceptedQuantity}</div>
      </div>
      <div class="qty-box rejected">
        <div class="label">Rejected</div>
        <div class="value">${data.totalRejectedQuantity}</div>
      </div>
    </div>
    <div class="totals-box">
      <div class="totals-row">
        <span class="label">Sub Total:</span>
        <span class="value">${formatCurrency(data.subtotal)}</span>
      </div>
      ${(data.totalDiscount || 0) > 0 ? `
        <div class="totals-row">
          <span class="label">Total Discount:</span>
          <span class="value">-${formatCurrency(data.totalDiscount || 0)}</span>
        </div>
      ` : ''}
      ${data.discountAmount > 0 && !(data.totalDiscount) ? `
        <div class="totals-row">
          <span class="label">Discount:</span>
          <span class="value">-${formatCurrency(data.discountAmount)}</span>
        </div>
      ` : ''}
      ${data.taxAmount > 0 ? `
        <div class="totals-row">
          <span class="label">Tax:</span>
          <span class="value">${formatCurrency(data.taxAmount)}</span>
        </div>
      ` : ''}
      <div class="totals-row total">
        <span class="label">Grand Total:</span>
        <span class="value">${formatCurrency(data.totalAmount)}</span>
      </div>
      
      ${(data.paidAmount || 0) > 0 && data.paymentStatus !== 'paid' ? `
        <div class="totals-row">
          <span class="label">Paid Amount:</span>
          <span class="value" style="color: #059669;">${formatCurrency(data.paidAmount || 0)}</span>
        </div>
      ` : ''}
      
      ${data.paymentMethod ? `
        <div class="payment-info">
          <div class="payment-label">Payment Details</div>
          <div class="payment-detail">
            ${data.paymentMethod.charAt(0).toUpperCase() + data.paymentMethod.slice(1)}
            <span class="payment-status ${data.paymentStatus || 'unpaid'}">
              ${data.paymentStatus === 'paid' ? 'PAID' : data.paymentStatus === 'partial' ? 'PARTIAL' : 'UNPAID'}
            </span>
          </div>
        </div>
      ` : ''}
    </div>
  </div>

  ${data.paymentStatus !== 'paid' && balanceDue > 0 ? `
    <div class="balance-due-box">
      <span class="balance-label">⚠️ BALANCE DUE :</span>
      <span class="balance-amount">${formatCurrency(balanceDue)}</span>
    </div>
  ` : ''}

  ${data.paymentStatus === 'paid' ? `
    <div class="fully-paid-box">
      <span class="paid-label">✓ FULLY PAID</span>
    </div>
  ` : ''}

  ${data.notes ? `
    <div class="notes-section">
      <h4>Notes / Remarks</h4>
      <p>${data.notes}</p>
    </div>
  ` : ''}

  <!-- Signatures -->
  <div class="signatures-section">
    <div class="signature-box">
      <div class="line"></div>
      <div class="label">Received By</div>
    </div>
    <div class="signature-box">
      <div class="line"></div>
      <div class="label">Inspected By</div>
    </div>
    <div class="signature-box">
      <div class="line"></div>
      <div class="label">Approved By</div>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer-section">
    <h4>Terms & Conditions:</h4>
    <p>
      All goods received are subject to quality inspection. Rejected items will be returned to the supplier. 
      Any discrepancy must be reported within 24 hours of receipt. This document serves as proof of goods received 
      and must be retained for records and future reference.
    </p>
  </div>

  <div class="footer-thank-you">
    Thank you for your business partnership!
  </div>
</body>
</html>
  `;
};

/**
 * Generate PDF from GRN data
 * Returns a Buffer containing the PDF
 * 
 * Concurrency: Only 1 PDF generates at a time (semaphore-controlled)
 * Memory: Browser is created & destroyed per request with aggressive cleanup
 */
export const generateGRNPDF = async (data: GRNPDFData): Promise<Buffer> => {
  if (pdfSemaphore.pending > 0) {
    console.log(`⏳ PDF queue: ${pdfSemaphore.pending} requests waiting...`);
  }

  // Acquire semaphore — blocks if another PDF is being generated
  await pdfSemaphore.acquire();

  let browser = null;
  
  try {
    const executablePath = await getChromiumExecutable();
    console.log('📄 Launching Chromium for GRN PDF...');
    
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: PUPPETEER_ARGS,
      timeout: PDF_GENERATION_TIMEOUT_MS,
      protocolTimeout: PDF_GENERATION_TIMEOUT_MS,
    });
    
    const page = await browser.newPage();

    // Disable unnecessary resource loading to reduce memory
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      if (['image', 'media', 'font'].includes(resourceType)) {
        request.abort();
      } else {
        request.continue();
      }
    });
    
    // Set the HTML content — use 'load' instead of 'networkidle0'
    const html = generateGRNHTML(data);
    await page.setContent(html, {
      waitUntil: 'load',
      timeout: PDF_GENERATION_TIMEOUT_MS,
    });
    
    // Brief pause for CSS rendering to complete
    await new Promise(resolve => setTimeout(resolve, 150));
    
    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '12mm',
        bottom: '10mm',
        left: '12mm',
      },
      timeout: PDF_GENERATION_TIMEOUT_MS,
    });
    
    const result = Buffer.from(pdfBuffer);
    console.log(`✅ GRN PDF generated (${result.length} bytes)`);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ GRN PDF generation failed: ${message}`);
    throw new Error(`PDF generation failed: ${message}`);
  } finally {
    // CRITICAL: Always close browser AND release semaphore
    if (browser) {
      try {
        await browser.close();
      } catch {
        // Browser may already be closed on error
      }
      browser = null;
    }

    pdfSemaphore.release();

    // Hint GC to reclaim Chromium memory before next operation
    if (global.gc) {
      try { global.gc(); } catch {}
    }
  }
};

/**
 * Generate GRN PDF and save to file
 */
export const generateGRNPDFToFile = async (data: GRNPDFData, filePath: string): Promise<string> => {
  const fs = await import('fs').then(m => m.promises);
  const pdfBuffer = await generateGRNPDF(data);
  await fs.writeFile(filePath, pdfBuffer);
  return filePath;
};
