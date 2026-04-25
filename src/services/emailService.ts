/**
 * Email Service for Password Reset OTP & GRN/Invoice emails
 * 
 * MULTI-PROVIDER EMAIL SYSTEM:
 * 1. PRIMARY: Resend HTTP API (works on ALL cloud platforms including Render.com)
 * 2. FALLBACK: Gmail SMTP (for local development)
 * 
 * WHY NOT SMTP ON RENDER?
 * Render.com (and most cloud providers) block outbound SMTP ports (465, 587).
 * HTTP-based email APIs use port 443 (HTTPS) which is NEVER blocked.
 * 
 * SETUP: Set RESEND_API_KEY env var on Render (free at resend.com)
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

// ===================================
// Email Configuration
// ===================================

interface EmailConfig {
  user: string;
  pass: string;
}

const getEmailConfig = (): EmailConfig => {
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';

  if (!user || !pass) {
    // Only warn if Resend is also not configured
    if (!process.env.RESEND_API_KEY) {
      console.warn('⚠️  WARNING: Neither SMTP credentials nor RESEND_API_KEY configured. Email sending will fail.');
    }
  }

  return { user, pass };
};

/**
 * Check if ANY email provider is available (Resend HTTP API or SMTP)
 */
const isEmailConfigured = (): boolean => {
  // Resend HTTP API is the primary provider
  if (process.env.RESEND_API_KEY) return true;
  // SMTP is the fallback
  const config = getEmailConfig();
  return !!(config.user && config.pass);
};

/**
 * Get the best "from" address for emails.
 * Uses SMTP_FROM_EMAIL/SMTP_FROM_NAME if set, otherwise falls back to defaults.
 * When using Resend, the from field gets overridden in sendViaResend anyway.
 */
const getFromField = (displayName: string): string => {
  const fromName = process.env.SMTP_FROM_NAME || displayName;
  const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'noreply@system.com';
  return `"${fromName}" <${fromEmail}>`;
};

// Create reusable transporter (SMTP fallback only)
let transporter: Transporter | null = null;

// ===================================
// Provider Detection
// ===================================

type EmailProvider = 'resend' | 'smtp';

const getEmailProvider = (): EmailProvider => {
  if (process.env.RESEND_API_KEY) {
    return 'resend';
  }
  return 'smtp';
};

// ===================================
// 🚀 PRIMARY: Resend HTTP API
// ===================================
// Resend uses HTTPS (port 443) — NEVER blocked by any cloud provider.
// Free tier: 100 emails/day, no domain verification needed.
// Sign up: https://resend.com → get API key → set RESEND_API_KEY env var.

interface ResendAttachment {
  filename: string;
  content: string; // base64 encoded
}

interface ResendPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: ResendAttachment[];
}

/**
 * Send email via Resend HTTP API.
 * This is the PRIMARY method for production/cloud environments.
 * Uses native fetch() — no extra packages needed.
 */
const sendViaResend = async (mailOptions: any): Promise<{ messageId: string }> => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY not set');
  }

  // Parse "from" field - extract email and name
  // Formats: '"Name" <email>' or 'Name <email>' or 'email'
  let fromField = mailOptions.from || '';
  
  // Resend free tier requires sending from 'onboarding@resend.dev'
  // unless you have a verified domain. We'll use the from name with Resend's email.
  // If RESEND_FROM is set (verified domain), use that instead.
  const resendFrom = process.env.RESEND_FROM || '';
  
  if (resendFrom) {
    // User has a verified domain on Resend
    // Keep the display name from original but use the verified email
    const nameMatch = fromField.match(/"([^"]+)"|^([^<]+)</);
    const displayName = nameMatch ? (nameMatch[1] || nameMatch[2])?.trim() : '';
    fromField = displayName ? `${displayName} <${resendFrom}>` : resendFrom;
  } else {
    // Free tier: must send from onboarding@resend.dev
    const nameMatch = fromField.match(/"([^"]+)"|^([^<]+)</);
    const displayName = nameMatch ? (nameMatch[1] || nameMatch[2])?.trim() : 'Eco System';
    fromField = `${displayName} <onboarding@resend.dev>`;
  }

  // Build Resend payload
  const payload: ResendPayload = {
    from: fromField,
    to: Array.isArray(mailOptions.to) ? mailOptions.to : [mailOptions.to],
    subject: mailOptions.subject,
    html: mailOptions.html,
  };

  if (mailOptions.text) {
    payload.text = mailOptions.text;
  }

  // Convert attachments (Buffer → base64)
  if (mailOptions.attachments && mailOptions.attachments.length > 0) {
    payload.attachments = mailOptions.attachments.map((att: any) => ({
      filename: att.filename,
      content: Buffer.isBuffer(att.content) 
        ? att.content.toString('base64') 
        : att.content, // already base64
    }));
  }

  console.log(`📧 [Resend] Sending to: ${payload.to.join(', ')} | Subject: ${payload.subject.substring(0, 50)}...`);
  console.log(`📧 [Resend] From: ${payload.from} | Attachments: ${payload.attachments?.length || 0}`);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    const errorMsg = (data as any)?.message || (data as any)?.error || JSON.stringify(data);
    console.error(`❌ [Resend] API Error (${response.status}): ${errorMsg}`);
    throw new Error(`Resend API error (${response.status}): ${errorMsg}`);
  }

  const messageId = (data as any).id || 'resend-' + Date.now();
  console.log(`✅ [Resend] Email sent successfully! ID: ${messageId}`);
  return { messageId };
};

// ===================================
// 📧 FALLBACK: Gmail SMTP
// ===================================
// Used for local development where SMTP ports are available.

const createGmailTransporter = (): Transporter => {
  const config = getEmailConfig();
  
  const transportOptions: any = {
    service: 'gmail',
    auth: {
      user: config.user,
      pass: config.pass,
    },
    family: 4,
    pool: false,
    connectionTimeout: 30000,
    greetingTimeout: 20000,
    socketTimeout: 60000,
    tls: {
      rejectUnauthorized: false,
      minVersion: 'TLSv1.2',
    },
    logger: process.env.SMTP_DEBUG === 'true',
    debug: process.env.SMTP_DEBUG === 'true',
  };

  console.log(`📧 Creating Gmail SMTP transporter (user: ${config.user || 'NOT SET'})`);
  return nodemailer.createTransport(transportOptions);
};

const getTransporter = (): Transporter => {
  if (!transporter) {
    transporter = createGmailTransporter();
  }
  return transporter;
};

const resetTransporter = () => {
  if (transporter) {
    try { (transporter as any).close?.(); } catch (_) {}
    transporter = null;
  }
};

/**
 * Send email via Gmail SMTP with retry.
 * Only used when Resend is not configured.
 */
const sendViaSMTP = async (mailOptions: any): Promise<{ messageId: string }> => {
  const SEND_TIMEOUT = 45000;
  const config = getEmailConfig();

  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt > 1) {
      const delay = attempt * 2000;
      console.log(`📧 [SMTP Attempt ${attempt}/3] Waiting ${delay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      resetTransporter();
    }

    try {
      console.log(`📧 [SMTP Attempt ${attempt}/3] Sending via Gmail...`);
      const transport = getTransporter();
      
      const result = await new Promise<{ messageId: string }>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`SMTP timed out after ${SEND_TIMEOUT / 1000}s`));
        }, SEND_TIMEOUT);
        
        transport.sendMail(mailOptions)
          .then((r: any) => { clearTimeout(timer); resolve(r); })
          .catch((e: any) => { clearTimeout(timer); reject(e); });
      });
      
      console.log(`✅ [SMTP Attempt ${attempt}/3] Sent! messageId: ${result.messageId}`);
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      console.warn(`⚠️ [SMTP Attempt ${attempt}/3] Failed: ${msg}`);
    }
  }

  resetTransporter();
  throw new Error(`SMTP: All 3 attempts failed. User: ${config.user || 'NOT SET'}`);
};

// ===================================
// 🔀 Unified Email Sender
// ===================================

/**
 * Send email using the best available provider:
 * 1. Resend HTTP API (if RESEND_API_KEY is set) — works on ALL platforms
 * 2. Gmail SMTP (fallback) — works on local dev, blocked on most cloud hosts
 * 
 * This is the ONLY function that all email-sending functions should call.
 */
const sendMailWithRetry = async (mailOptions: any): Promise<{ messageId: string }> => {
  const provider = getEmailProvider();
  
  console.log(`📧 Email provider: ${provider.toUpperCase()}`);
  
  // ── PRIMARY: Resend HTTP API ──────────────────────────────────────
  if (provider === 'resend') {
    try {
      return await sendViaResend(mailOptions);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown';
      console.error(`❌ [Resend] Failed: ${msg}`);
      
      // If Resend fails AND SMTP is configured, try SMTP as last resort
      const config = getEmailConfig();
      if (config.user && config.pass) {
        console.log(`📧 Resend failed, attempting SMTP fallback...`);
        try {
          return await sendViaSMTP(mailOptions);
        } catch (smtpError) {
          const smtpMsg = smtpError instanceof Error ? smtpError.message : 'Unknown';
          console.error(`❌ [SMTP Fallback] Also failed: ${smtpMsg}`);
        }
      }
      
      throw new Error(`Failed to send email via Resend: ${msg}. Configure RESEND_API_KEY correctly.`);
    }
  }
  
  // ── FALLBACK: Gmail SMTP ──────────────────────────────────────────
  try {
    return await sendViaSMTP(mailOptions);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown';
    console.error(`❌ [SMTP] All attempts failed: ${msg}`);
    console.error(`🚨 ════════════════════════════════════════════════════`);
    console.error(`🚨 SMTP is blocked on this platform!`);
    console.error(`🚨 SOLUTION: Use Resend (free HTTP email API)`);
    console.error(`🚨 1. Sign up at https://resend.com (free)`);
    console.error(`🚨 2. Get your API key`);
    console.error(`🚨 3. Add RESEND_API_KEY env var on Render`);
    console.error(`🚨 4. (Optional) Add RESEND_FROM for custom sender`);
    console.error(`🚨 ════════════════════════════════════════════════════`);
    throw new Error(`Failed to send email: SMTP connection timeout. Set RESEND_API_KEY for cloud deployment.`);
  }
};

// ===================================
// Email Templates
// ===================================

interface OTPEmailData {
  email: string;
  otp: string;
  userName?: string;
}

// Invoice Email Data Interface
interface InvoiceEmailData {
  email: string;
  customerName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  items: Array<{
    productName: string;
    quantity: number;
    unitPrice: number;
    total: number;
    warranty?: string; // Product warranty (e.g., "1 year", "6 months")
  }>;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  paidAmount: number;
  dueAmount: number;
  status: string;
  shopName: string;
  shopSubName?: string;
  shopPhone?: string;
  shopEmail?: string;
  shopAddress?: string;
  shopWebsite?: string;
  shopLogo?: string;
  notes?: string;
}

// Format warranty into short code (e.g., "1 year" -> "[1Y]", "6 months" -> "[6M]")
const formatWarrantyCode = (warranty?: string): string => {
  if (!warranty) return '';
  const w = warranty.toLowerCase().trim();
  if (w.includes('lifetime') || w.includes('life time')) return '[L/W]';
  if (w.includes('no warranty') || w === 'n/w' || w === 'none') return '[N/W]';
  const yearMatch = w.match(/(\d+)\s*y(ear)?s?/i);
  if (yearMatch) return `[${yearMatch[1]}Y]`;
  const monthMatch = w.match(/(\d+)\s*m(onth)?s?/i);
  if (monthMatch) return `[${monthMatch[1]}M]`;
  const weekMatch = w.match(/(\d+)\s*w(eek)?s?/i);
  if (weekMatch) return `[${weekMatch[1]}W]`;
  const dayMatch = w.match(/(\d+)\s*d(ay)?s?/i);
  if (dayMatch) return `[${dayMatch[1]}D]`;
  return warranty.length > 5 ? `[${warranty.substring(0, 5)}]` : `[${warranty}]`;
};

// Generate modern invoice email HTML - styled like forgot password theme with shop branding
const generateInvoiceEmailHTML = (data: InvoiceEmailData): string => {
  const currentYear = new Date().getFullYear();
  const statusColor = data.status === 'FULLPAID' ? '#10b981' : data.status === 'HALFPAY' ? '#f59e0b' : '#ef4444';
  const statusText = data.status === 'FULLPAID' ? 'Paid' : data.status === 'HALFPAY' ? 'Partially Paid' : 'Unpaid';
  const shopInitial = data.shopName.charAt(0).toUpperCase();
  
  const itemRows = data.items.map(item => {
    const warrantyBadge = item.warranty ? `<span style="margin-left: 6px; font-size: 11px; font-weight: 700; color: #10b981; background: rgba(16, 185, 129, 0.1); padding: 2px 6px; border-radius: 4px;">${formatWarrantyCode(item.warranty)}</span>` : '';
    return `
    <tr>
      <td style="padding: 14px 16px; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 14px;">${item.productName}${warrantyBadge}</td>
      <td style="padding: 14px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 14px; text-align: center;">${item.quantity}</td>
      <td style="padding: 14px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 14px; text-align: right;">Rs. ${item.unitPrice.toLocaleString()}</td>
      <td style="padding: 14px 16px; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 14px; text-align: right; font-weight: 600;">Rs. ${item.total.toLocaleString()}</td>
    </tr>
  `;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice #${data.invoiceNumber} - ${data.shopName}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto;">
          
          <!-- Shop Logo & Name Section (Like Forgot Password Theme) -->
          <tr>
            <td style="text-align: center; padding-bottom: 32px;">
              ${data.shopLogo 
                ? `<img src="${data.shopLogo}" alt="${data.shopName}" style="max-width: 100px; max-height: 80px; margin-bottom: 16px;" />`
                : `<div style="display: inline-block; width: 72px; height: 72px; background: linear-gradient(135deg, #10b981 0%, #3b82f6 100%); border-radius: 18px; line-height: 72px; font-size: 32px; font-weight: bold; color: white; box-shadow: 0 12px 35px rgba(16, 185, 129, 0.25);">
                    ${shopInitial}
                  </div>`
              }
              <h1 style="margin: 16px 0 4px 0; color: #1e293b; font-size: 26px; font-weight: 700;">
                ${data.shopName}
              </h1>
              ${data.shopSubName ? `<p style="margin: 0 0 8px 0; color: #64748b; font-size: 15px; font-weight: 500;">${data.shopSubName}</p>` : ''}
              ${data.shopAddress ? `<p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 13px;">📍 ${data.shopAddress}</p>` : ''}
              <div style="margin-top: 8px; color: #64748b; font-size: 13px;">
                ${data.shopPhone ? `<span style="margin-right: 16px;">📞 ${data.shopPhone}</span>` : ''}
                ${data.shopEmail ? `<span>✉️ ${data.shopEmail}</span>` : ''}
              </div>
            </td>
          </tr>
          
          <!-- Main Card (Like Forgot Password Theme) -->
          <tr>
            <td>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: linear-gradient(145deg, #ffffff 0%, #f1f5f9 100%); border: 2px solid #e2e8f0; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);">
                
                <!-- Gradient Header Line -->
                <tr>
                  <td style="height: 5px; background: linear-gradient(90deg, #10b981 0%, #3b82f6 100%);"></td>
                </tr>
                
                <!-- Invoice Header -->
                <tr>
                  <td style="padding: 32px 32px 24px 32px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td>
                          <div style="display: inline-block; width: 56px; height: 56px; background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(59, 130, 246, 0.15) 100%); border-radius: 50%; line-height: 56px; text-align: center; margin-bottom: 12px;">
                            <span style="font-size: 26px;">📄</span>
                          </div>
                          <h2 style="margin: 0; color: #1e293b; font-size: 26px; font-weight: 700;">
                            Invoice
                          </h2>
                          <p style="margin: 6px 0 0 0; color: #64748b; font-size: 15px; font-weight: 500;">
                            #${data.invoiceNumber}
                          </p>
                        </td>
                        <td style="text-align: right; vertical-align: top;">
                          <div style="display: inline-block; background: ${statusColor}15; color: ${statusColor}; padding: 10px 20px; border-radius: 25px; font-size: 14px; font-weight: 700; border: 2px solid ${statusColor}30;">
                            ${statusText}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- Customer & Date Info Box (Styled like OTP box) -->
                <tr>
                  <td style="padding: 0 32px 24px 32px;">
                    <div style="background: linear-gradient(145deg, #f0fdf4 0%, #f0f9ff 100%); border: 2px solid rgba(16, 185, 129, 0.2); border-radius: 16px; padding: 20px;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        <tr>
                          <td style="width: 50%; vertical-align: top;">
                            <p style="margin: 0 0 4px 0; color: #10b981; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700;">Bill To</p>
                            <p style="margin: 0; color: #1e293b; font-size: 18px; font-weight: 700;">${data.customerName}</p>
                          </td>
                          <td style="width: 50%; vertical-align: top; text-align: right;">
                            <p style="margin: 0 0 6px 0; color: #64748b; font-size: 13px;">
                              📅 Invoice: <strong style="color: #334155;">${data.invoiceDate}</strong>
                            </p>
                            <p style="margin: 0; color: #64748b; font-size: 13px;">
                              ⏰ Due: <strong style="color: #334155;">${data.dueDate}</strong>
                            </p>
                          </td>
                        </tr>
                      </table>
                    </div>
                  </td>
                </tr>
                
                <!-- Items Table -->
                <tr>
                  <td style="padding: 0 32px 24px 32px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                      <thead>
                        <tr style="background: linear-gradient(145deg, #f8fafc 0%, #f1f5f9 100%);">
                          <th style="padding: 14px 16px; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; text-align: left; border-bottom: 2px solid #e2e8f0; font-weight: 700;">Item</th>
                          <th style="padding: 14px 16px; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; text-align: center; border-bottom: 2px solid #e2e8f0; font-weight: 700;">Qty</th>
                          <th style="padding: 14px 16px; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; text-align: right; border-bottom: 2px solid #e2e8f0; font-weight: 700;">Price</th>
                          <th style="padding: 14px 16px; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; text-align: right; border-bottom: 2px solid #e2e8f0; font-weight: 700;">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${itemRows}
                      </tbody>
                    </table>
                  </td>
                </tr>
                
                <!-- Totals (Styled like amount display) -->
                <tr>
                  <td style="padding: 0 32px 32px 32px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td style="width: 50%;"></td>
                        <td style="width: 50%;">
                          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: #f8fafc; border-radius: 12px; padding: 4px;">
                            <tr>
                              <td style="padding: 10px 16px; color: #64748b; font-size: 14px;">Subtotal</td>
                              <td style="padding: 10px 16px; color: #334155; font-size: 14px; text-align: right; font-weight: 600;">Rs. ${data.subtotal.toLocaleString()}</td>
                            </tr>
                            ${data.tax > 0 ? `
                            <tr>
                              <td style="padding: 10px 16px; color: #64748b; font-size: 14px;">Tax</td>
                              <td style="padding: 10px 16px; color: #334155; font-size: 14px; text-align: right; font-weight: 600;">Rs. ${data.tax.toLocaleString()}</td>
                            </tr>
                            ` : ''}
                            ${data.discount > 0 ? `
                            <tr>
                              <td style="padding: 10px 16px; color: #10b981; font-size: 14px;">Discount</td>
                              <td style="padding: 10px 16px; color: #10b981; font-size: 14px; text-align: right; font-weight: 600;">- Rs. ${data.discount.toLocaleString()}</td>
                            </tr>
                            ` : ''}
                            <tr>
                              <td colspan="2" style="padding: 0;"><div style="height: 2px; background: linear-gradient(90deg, #10b981 0%, #3b82f6 100%); margin: 8px 0;"></div></td>
                            </tr>
                            <tr>
                              <td style="padding: 12px 16px; color: #1e293b; font-size: 18px; font-weight: 800;">Total</td>
                              <td style="padding: 12px 16px; color: #1e293b; font-size: 18px; font-weight: 800; text-align: right;">Rs. ${data.total.toLocaleString()}</td>
                            </tr>
                            ${data.paidAmount > 0 ? `
                            <tr>
                              <td style="padding: 10px 16px; color: #10b981; font-size: 14px;">✓ Paid</td>
                              <td style="padding: 10px 16px; color: #10b981; font-size: 14px; text-align: right; font-weight: 600;">Rs. ${data.paidAmount.toLocaleString()}</td>
                            </tr>
                            ` : ''}
                            ${data.dueAmount > 0 ? `
                            <tr>
                              <td colspan="2" style="padding: 0;">
                                <div style="margin-top: 8px; background: linear-gradient(145deg, #fef2f2 0%, #fee2e2 100%); border: 2px solid rgba(239, 68, 68, 0.2); border-radius: 10px; padding: 14px 16px; text-align: center;">
                                  <span style="color: #ef4444; font-size: 13px; font-weight: 600;">Balance Due: </span>
                                  <span style="color: #ef4444; font-size: 20px; font-weight: 800;">Rs. ${data.dueAmount.toLocaleString()}</span>
                                </div>
                              </td>
                            </tr>
                            ` : ''}
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                ${data.notes ? `
                <!-- Notes Section -->
                <tr>
                  <td style="padding: 0 32px 32px 32px;">
                    <div style="background: linear-gradient(145deg, rgba(245, 158, 11, 0.05) 0%, rgba(251, 191, 36, 0.05) 100%); border: 2px solid rgba(245, 158, 11, 0.2); border-radius: 12px; padding: 16px;">
                      <p style="margin: 0 0 6px 0; color: #b45309; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">📝 Notes</p>
                      <p style="margin: 0; color: #78350f; font-size: 14px; line-height: 1.6;">${data.notes}</p>
                    </div>
                  </td>
                </tr>
                ` : ''}
                
                <!-- Thank You Message -->
                <tr>
                  <td style="padding: 0 32px 32px 32px; text-align: center;">
                    <div style="background: linear-gradient(145deg, rgba(16, 185, 129, 0.08) 0%, rgba(59, 130, 246, 0.08) 100%); border-radius: 16px; padding: 28px;">
                      <p style="margin: 0; color: #10b981; font-size: 20px; font-weight: 700;">
                        🙏 Thank you for your business!
                      </p>
                      <p style="margin: 10px 0 0 0; color: #64748b; font-size: 14px;">
                        We appreciate your trust in ${data.shopName}.
                      </p>
                      <p style="margin: 6px 0 0 0; color: #94a3b8; font-size: 12px;">
                        For any queries, please contact us at ${data.shopPhone || data.shopEmail || 'our store'}.
                      </p>
                    </div>
                  </td>
                </tr>
                
                <!-- PDF Attachment Notice -->
                <tr>
                  <td style="padding: 0 32px 32px 32px; text-align: center;">
                    <div style="background: #f1f5f9; border-radius: 10px; padding: 14px;">
                      <p style="margin: 0; color: #64748b; font-size: 13px;">
                        📎 <strong>Invoice PDF attached</strong> - Please keep for your records and warranty claims.
                      </p>
                    </div>
                  </td>
                </tr>
                
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 32px 20px; text-align: center;">
              <p style="margin: 0 0 8px 0; color: #64748b; font-size: 13px; font-weight: 600;">
                ${data.shopName}${data.shopSubName ? ' ' + data.shopSubName : ''}
              </p>
              ${data.shopAddress ? `<p style="margin: 4px 0; color: #94a3b8; font-size: 12px;">📍 ${data.shopAddress}</p>` : ''}
              ${data.shopWebsite ? `<p style="margin: 4px 0; color: #64748b; font-size: 12px;">🌐 ${data.shopWebsite}</p>` : ''}
              <p style="margin: 12px 0 0 0; color: #94a3b8; font-size: 11px;">
                © ${currentYear} ${data.shopName}. All rights reserved.
              </p>
              <p style="margin: 4px 0 0 0; color: #cbd5e1; font-size: 11px;">
                This is an automated invoice email from our billing system.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
};

// Generate plain text version of invoice email
const generateInvoiceEmailText = (data: InvoiceEmailData): string => {
  const itemLines = data.items.map(item => 
    `  - ${item.productName} x${item.quantity} @ Rs.${item.unitPrice.toLocaleString()} = Rs.${item.total.toLocaleString()}`
  ).join('\n');

  return `
=====================================
INVOICE #${data.invoiceNumber}
=====================================

${data.shopName}
${data.shopAddress || ''}
${data.shopPhone ? 'Phone: ' + data.shopPhone : ''}

-------------------------------------
Bill To: ${data.customerName}
Invoice Date: ${data.invoiceDate}
Due Date: ${data.dueDate}
Status: ${data.status === 'FULLPAID' ? 'Paid' : data.status === 'HALFPAY' ? 'Partially Paid' : 'Unpaid'}
-------------------------------------

ITEMS:
${itemLines}

-------------------------------------
Subtotal:     Rs. ${data.subtotal.toLocaleString()}
${data.tax > 0 ? 'Tax:          Rs. ' + data.tax.toLocaleString() : ''}
${data.discount > 0 ? 'Discount:     -Rs. ' + data.discount.toLocaleString() : ''}
-------------------------------------
TOTAL:        Rs. ${data.total.toLocaleString()}
${data.paidAmount > 0 ? 'Paid:         Rs. ' + data.paidAmount.toLocaleString() : ''}
${data.dueAmount > 0 ? 'BALANCE DUE:  Rs. ' + data.dueAmount.toLocaleString() : ''}
-------------------------------------

${data.notes ? 'Notes: ' + data.notes : ''}

Thank you for your business!

© ${new Date().getFullYear()} ${data.shopName}
${data.shopWebsite || ''}
  `.trim();
};

/**
 * Send Invoice Email
 */
export const sendInvoiceEmail = async (data: InvoiceEmailData): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  try {
    // Check if ANY email provider is configured (Resend OR SMTP)
    if (!isEmailConfigured()) {
      console.error('❌ No email provider configured. Cannot send invoice email.');
      if (process.env.NODE_ENV !== 'production') {
        console.log('📧 [DEV MODE] Invoice email would be sent to:', data.email);
        return { success: true, messageId: 'dev-mode-no-email-sent' };
      }
      return { success: false, error: 'Email service not configured. Set RESEND_API_KEY or SMTP credentials.' };
    }

    const fromName = process.env.SMTP_FROM_NAME || data.shopName;
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'noreply@system.com';

    console.log(`📤 Sending invoice email to: ${data.email}`);

    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to: data.email,
      subject: `📄 Invoice #${data.invoiceNumber} from ${data.shopName}`,
      text: generateInvoiceEmailText(data),
      html: generateInvoiceEmailHTML(data),
    };

    const result = await sendMailWithRetry(mailOptions);
    console.log('✅ Invoice email sent successfully to:', data.email);
    
    return { success: true, messageId: result.messageId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown email error';
    console.error('❌ Failed to send invoice email:', errorMessage);
    resetTransporter();
    return { success: false, error: errorMessage };
  }
};

/**
 * Send Invoice Email with PDF Attachment
 */
export const sendInvoiceWithPDF = async (
  data: InvoiceEmailData,
  pdfBufferOrBase64?: Buffer | string
): Promise<{ success: boolean; messageId?: string; error?: string; hasPdfAttachment?: boolean }> => {
  try {
    // Check if ANY email provider is configured (Resend OR SMTP)
    if (!isEmailConfigured()) {
      console.error('❌ No email provider configured. Cannot send invoice email with PDF.');
      if (process.env.NODE_ENV !== 'production') {
        console.log('📧 [DEV MODE] Invoice email with PDF would be sent to:', data.email);
        return { success: true, messageId: 'dev-mode-no-email-sent', hasPdfAttachment: !!pdfBufferOrBase64 };
      }
      return { success: false, error: 'Email service not configured. Set RESEND_API_KEY or SMTP credentials.' };
    }

    const fromName = process.env.SMTP_FROM_NAME || data.shopName;
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'noreply@system.com';

    console.log(`📤 Sending invoice email to: ${data.email} (with${pdfBufferOrBase64 ? '' : 'out'} PDF)`);

    const hasPdfAttachment = !!pdfBufferOrBase64;

    const mailOptions: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
      attachments?: Array<{
        filename: string;
        content: Buffer;
        contentType: string;
      }>;
    } = {
      from: `"${fromName}" <${fromEmail}>`,
      to: data.email,
      subject: `📄 Invoice #${data.invoiceNumber} from ${data.shopName}`,
      text: generateInvoiceEmailText(data),
      html: generateInvoiceEmailHTML(data),
    };

    // Add PDF attachment if provided (accepts Buffer or base64 string)
    if (pdfBufferOrBase64) {
      let pdfBuffer: Buffer;
      if (typeof pdfBufferOrBase64 === 'string') {
        // base64 string from client - remove data URL prefix if present
        const base64Data = pdfBufferOrBase64.replace(/^data:application\/pdf;base64,/, '');
        pdfBuffer = Buffer.from(base64Data, 'base64');
      } else {
        pdfBuffer = pdfBufferOrBase64;
      }

      mailOptions.attachments = [
        {
          filename: `Invoice-${data.invoiceNumber}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ];
    }

    const result = await sendMailWithRetry(mailOptions);
    console.log('✅ Invoice email sent successfully to:', data.email);
    
    return { success: true, messageId: result.messageId, hasPdfAttachment };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown email error';
    console.error('❌ Failed to send invoice email with PDF:', errorMessage);
    resetTransporter();
    return { success: false, error: errorMessage };
  }
};

const generateOTPEmailHTML = (data: OTPEmailData): string => {
  const { otp, userName } = data;
  const otpDigits = otp.split('');
  const currentYear = new Date().getFullYear();

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset OTP - Eco System</title>
  <style>
    @media (prefers-color-scheme: light) {
      body { background-color: #f8fafc !important; }
      .main-bg { background: linear-gradient(145deg, #ffffff 0%, #f1f5f9 100%) !important; border-color: #e2e8f0 !important; }
      .gradient-top { background: linear-gradient(90deg, #10b981 0%, #06b6d4 100%); }
      .text-heading { color: #1e293b !important; }
      .text-body { color: #64748b !important; }
      .otp-box { background: linear-gradient(145deg, #f0fdf4 0%, #f0f9ff 100%) !important; border-color: rgba(16, 185, 129, 0.3) !important; }
      .otp-digit { background: linear-gradient(145deg, #ffffff 0%, #f8fafc 100%) !important; border-color: rgba(16, 185, 129, 0.4) !important; color: #10b981 !important; }
      .warning-box { background: linear-gradient(145deg, rgba(245, 158, 11, 0.05) 0%, rgba(251, 191, 36, 0.05) 100%) !important; border-color: rgba(245, 158, 11, 0.3) !important; }
      .warning-text { color: #ca8a04 !important; }
      .footer-text { color: #94a3b8 !important; }
      .footer-link-text { color: #64748b !important; }
    }
    
    @media (prefers-color-scheme: dark) {
      body { background-color: #0f172a !important; }
      .main-bg { background: linear-gradient(145deg, rgba(30, 41, 59, 0.8) 0%, rgba(15, 23, 42, 0.9) 100%) !important; border-color: rgba(51, 65, 85, 0.5) !important; }
      .gradient-top { background: linear-gradient(90deg, #10b981 0%, #06b6d4 100%); }
      .text-heading { color: #ffffff !important; }
      .text-body { color: #cbd5e1 !important; }
      .otp-box { background: linear-gradient(145deg, rgba(16, 185, 129, 0.1) 0%, rgba(59, 130, 246, 0.1) 100%) !important; border-color: rgba(16, 185, 129, 0.3) !important; }
      .otp-digit { background: linear-gradient(145deg, #1e293b 0%, #0f172a 100%) !important; border-color: rgba(16, 185, 129, 0.4) !important; color: #10b981 !important; }
      .warning-box { background: linear-gradient(145deg, rgba(245, 158, 11, 0.1) 0%, rgba(234, 179, 8, 0.05) 100%) !important; border-color: rgba(245, 158, 11, 0.2) !important; }
      .warning-text { color: #fbbf24 !important; }
      .footer-text { color: #64748b !important; }
      .footer-link-text { color: #94a3b8 !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 480px; margin: 0 auto;">
          
          <!-- Logo Section -->
          <tr>
            <td style="text-align: center; padding-bottom: 32px;">
              <div style="display: inline-block; width: 64px; height: 64px; background: linear-gradient(135deg, #10b981 0%, #3b82f6 100%); border-radius: 16px; line-height: 64px; font-size: 28px; font-weight: bold; color: white; box-shadow: 0 10px 30px rgba(16, 185, 129, 0.2);">
                E
              </div>
              <h1 style="margin: 16px 0 0 0; color: #1e293b; font-size: 24px; font-weight: 600;" class="text-heading">
                Eco System
              </h1>
            </td>
          </tr>
          
          <!-- Main Card -->
          <tr>
            <td>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: linear-gradient(145deg, #ffffff 0%, #f1f5f9 100%); border: 2px solid #e2e8f0; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);" class="main-bg">
                
                <!-- Decorative gradient overlay -->
                <tr>
                  <td style="height: 4px; background: linear-gradient(90deg, #10b981 0%, #3b82f6 100%);"></td>
                </tr>
                
                <!-- Content -->
                <tr>
                  <td style="padding: 40px 32px;">
                    
                    <!-- Icon -->
                    <div style="text-align: center; margin-bottom: 24px;">
                      <div style="display: inline-block; width: 56px; height: 56px; background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(59, 130, 246, 0.15) 100%); border-radius: 50%; line-height: 56px;">
                        <span style="font-size: 28px;">🔐</span>
                      </div>
                    </div>
                    
                    <!-- Greeting -->
                    <h2 style="margin: 0 0 8px 0; color: #1e293b; font-size: 22px; font-weight: 600; text-align: center;" class="text-heading">
                      Password Reset Request
                    </h2>
                    <p style="margin: 0 0 32px 0; color: #64748b; font-size: 15px; line-height: 1.6; text-align: center;" class="text-body">
                      ${userName ? `Hi ${userName}, we` : 'We'} received a request to reset your password. Use the OTP code below to proceed.
                    </p>
                    
                    <!-- OTP Code -->
                    <div style="text-align: center; margin-bottom: 32px;">
                      <p style="margin: 0 0 12px 0; color: #7c8fa0; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;" class="text-body">
                        Your Verification Code
                      </p>
                      <div style="display: inline-block; background: linear-gradient(145deg, #f0fdf4 0%, #f0f9ff 100%); border: 2px solid rgba(16, 185, 129, 0.3); border-radius: 16px; padding: 20px 32px;" class="otp-box">
                        <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin: 0 auto;">
                          <tr>
                            ${otpDigits.map(digit => `
                              <td style="padding: 0 6px;">
                                <div style="width: 44px; height: 56px; background: linear-gradient(145deg, #ffffff 0%, #f8fafc 100%); border: 2px solid rgba(16, 185, 129, 0.4); border-radius: 12px; line-height: 56px; text-align: center;" class="otp-digit">
                                  <span style="font-size: 28px; font-weight: 700; color: #10b981; font-family: 'Courier New', monospace;">${digit}</span>
                                </div>
                              </td>
                            `).join('')}
                          </tr>
                        </table>
                      </div>
                    </div>
                    
                    <!-- Expiry Warning -->
                    <div style="background: linear-gradient(145deg, rgba(245, 158, 11, 0.05) 0%, rgba(251, 191, 36, 0.05) 100%); border: 2px solid rgba(245, 158, 11, 0.3); border-radius: 12px; padding: 16px; margin-bottom: 24px;" class="warning-box">
                      <p style="margin: 0; color: #ca8a04; font-size: 14px; text-align: center; font-weight: 600;" class="warning-text">
                        ⏰ This code expires in <strong>10 minutes</strong>
                      </p>
                    </div>
                    
                    <!-- Security Notice -->
                    <div style="border-top: 2px solid #e2e8f0; padding-top: 24px;">
                      <p style="margin: 0 0 12px 0; color: #64748b; font-size: 13px; text-align: center; font-weight: 600;" class="text-body">
                        🛡️ Security Tips
                      </p>
                      <ul style="margin: 0; padding: 0 0 0 20px; color: #64748b; font-size: 13px; line-height: 1.8;" class="text-body">
                        <li>Never share this code with anyone</li>
                        <li>Eco System will never ask for your password</li>
                        <li>If you didn't request this, ignore this email</li>
                      </ul>
                    </div>
                    
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 32px 20px; text-align: center;">
              <p style="margin: 0 0 8px 0; color: #94a3b8; font-size: 13px;" class="footer-text">
                © ${currentYear} Eco System. All rights reserved.
              </p>
              <p style="margin: 0; color: #cbd5e1; font-size: 12px;" class="footer-link-text">
                This is an automated email. Please do not reply.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
};

const generateOTPEmailText = (data: OTPEmailData): string => {
  const { otp, userName } = data;
  return `
Eco System - Password Reset

${userName ? `Hi ${userName},` : 'Hello,'}

We received a request to reset your password.

Your verification code is: ${otp}

This code will expire in 10 minutes.

Security Tips:
- Never share this code with anyone
- Eco System will never ask for your password
- If you didn't request this, please ignore this email

© ${new Date().getFullYear()} Eco System. All rights reserved.
  `.trim();
};

// ===================================
// Email Service Functions
// ===================================

interface SendOTPResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send OTP email for password reset
 */
export const sendPasswordResetOTP = async (data: OTPEmailData): Promise<SendOTPResult> => {
  try {
    // Check if ANY email provider is configured (Resend OR SMTP)
    if (!isEmailConfigured()) {
      console.error('❌ No email provider configured. Cannot send email.');
      // In development, log the OTP to console
      if (process.env.NODE_ENV !== 'production') {
        console.log('📧 [DEV MODE] Password Reset OTP for', data.email, ':', data.otp);
        return { success: true, messageId: 'dev-mode-no-email-sent' };
      }
      return { success: false, error: 'Email service not configured. Set RESEND_API_KEY or SMTP credentials.' };
    }

    const fromName = process.env.SMTP_FROM_NAME || 'Eco System';
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'noreply@system.com';

    console.log(`📤 Attempting to send OTP email to: ${data.email}`);

    const mailOptions = {
      from: `"${fromName}" <${fromEmail}>`,
      to: data.email,
      subject: '🔐 Password Reset Code - Eco System',
      text: generateOTPEmailText(data),
      html: generateOTPEmailHTML(data),
    };

    const result = await sendMailWithRetry(mailOptions);
    console.log('✅ OTP email sent successfully to:', data.email);
    
    return { success: true, messageId: result.messageId };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown email error';
    console.error('❌ Failed to send OTP email:', errorMessage);
    resetTransporter();
    return { success: false, error: errorMessage };
  }
};

/**
 * Generate a random 6-digit OTP
 */
export const generateOTP = (): string => {
  const otp = Math.floor(100000 + Math.random() * 900000);
  return otp.toString();
};

/**
 * Verify SMTP connection
 */
export const verifyEmailConnection = async (): Promise<boolean> => {
  try {
    // If Resend is configured, we're good (no SMTP verification needed)
    if (process.env.RESEND_API_KEY) {
      console.log('✅ Email service: Resend API key configured');
      return true;
    }

    const config = getEmailConfig();
    if (!config.user || !config.pass) {
      console.warn('⚠️  No email provider configured. Set RESEND_API_KEY or SMTP credentials.');
      return false;
    }

    const transport = getTransporter();
    await transport.verify();
    console.log('✅ Email service: SMTP connected successfully');
    return true;
  } catch (error) {
    console.error('❌ Email service connection failed:', error);
    return false;
  }
};

// ===================================
// GRN EMAIL FUNCTIONS
// ===================================

export interface GRNEmailData {
  email: string;
  supplierName: string;
  grnNumber: string;
  date: string;
  items: Array<{
    productName: string;
    quantity: number;
    costPrice: number;
    total: number;
  }>;
  subtotal: number;
  tax: number;
  discount: number;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;
  paymentStatus: string;
  shopName: string;
  shopSubName?: string;
  shopAddress?: string;
  shopPhone?: string;
  shopEmail?: string;
  shopWebsite?: string;
  shopLogo?: string;
  notes?: string;
}

/**
 * Generate GRN Email HTML - Clean B&W Professional Design
 * Matches the PrintableGRN frontend component design
 * @param data - GRN email data
 * @param includePdfAttachment - Whether PDF is attached (shows notice if true)
 */
const generateGRNEmailHTML = (data: GRNEmailData, includePdfAttachment: boolean = false): string => {
  const currentYear = new Date().getFullYear();
  const statusColor = data.paymentStatus === 'PAID' ? '#10b981' : data.paymentStatus === 'PARTIAL' ? '#f59e0b' : '#ef4444';
  const statusText = data.paymentStatus === 'PAID' ? 'Paid' : data.paymentStatus === 'PARTIAL' ? 'Partially Paid' : 'Unpaid';
  const shopInitial = data.shopName.charAt(0).toUpperCase();
  
  const itemRows = data.items.map(item => `
    <tr>
      <td style="padding: 14px 16px; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 14px;">
        <div style="font-weight: 600;">${item.productName}</div>
      </td>
      <td style="padding: 14px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 14px; text-align: center;">${item.quantity}</td>
      <td style="padding: 14px 16px; border-bottom: 1px solid #e2e8f0; color: #64748b; font-size: 14px; text-align: right;">Rs. ${item.costPrice.toLocaleString()}</td>
      <td style="padding: 14px 16px; border-bottom: 1px solid #e2e8f0; color: #334155; font-size: 14px; text-align: right; font-weight: 600;">Rs. ${item.total.toLocaleString()}</td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GRN #${data.grnNumber} - ${data.shopName}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
  <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: linear-gradient(180deg, #f8fafc 0%, #ffffff 100%);">
    <tr>
      <td style="padding: 40px 20px;">
        <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="max-width: 600px; margin: 0 auto;">
          
          <!-- Shop Logo & Name Section -->
          <tr>
            <td style="text-align: center; padding-bottom: 32px;">
              ${data.shopLogo 
                ? `<img src="${data.shopLogo}" alt="${data.shopName}" style="max-width: 100px; max-height: 80px; margin-bottom: 16px;" />`
                : `<div style="display: inline-block; width: 72px; height: 72px; background: linear-gradient(135deg, #10b981 0%, #3b82f6 100%); border-radius: 18px; line-height: 72px; font-size: 32px; font-weight: bold; color: white; box-shadow: 0 12px 35px rgba(16, 185, 129, 0.25);">
                    ${shopInitial}
                  </div>`
              }
              <h1 style="margin: 16px 0 4px 0; color: #1e293b; font-size: 26px; font-weight: 700;">
                ${data.shopName}
              </h1>
              ${data.shopSubName ? `<p style="margin: 0 0 8px 0; color: #64748b; font-size: 15px; font-weight: 500;">${data.shopSubName}</p>` : ''}
              ${data.shopAddress ? `<p style="margin: 4px 0 0 0; color: #94a3b8; font-size: 13px;">📍 ${data.shopAddress}</p>` : ''}
              <div style="margin-top: 8px; color: #64748b; font-size: 13px;">
                ${data.shopPhone ? `<span style="margin-right: 16px;">📞 ${data.shopPhone}</span>` : ''}
                ${data.shopEmail ? `<span>✉️ ${data.shopEmail}</span>` : ''}
              </div>
            </td>
          </tr>
          
          <!-- Main Card -->
          <tr>
            <td>
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: linear-gradient(145deg, #ffffff 0%, #f1f5f9 100%); border: 2px solid #e2e8f0; border-radius: 24px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);">
                
                <!-- Gradient Header Line -->
                <tr>
                  <td style="height: 5px; background: linear-gradient(90deg, #10b981 0%, #3b82f6 100%);"></td>
                </tr>
                
                <!-- GRN Header -->
                <tr>
                  <td style="padding: 32px 32px 24px 32px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td>
                          <div style="display: inline-block; width: 56px; height: 56px; background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(59, 130, 246, 0.15) 100%); border-radius: 50%; line-height: 56px; text-align: center; margin-bottom: 12px;">
                            <span style="font-size: 26px;">📦</span>
                          </div>
                          <h2 style="margin: 0; color: #1e293b; font-size: 26px; font-weight: 700;">
                            Goods Received Note
                          </h2>
                          <p style="margin: 6px 0 0 0; color: #64748b; font-size: 15px; font-weight: 500;">
                            #${data.grnNumber}
                          </p>
                        </td>
                        <td style="text-align: right; vertical-align: top;">
                          <div style="display: inline-block; background: ${statusColor}15; color: ${statusColor}; padding: 10px 20px; border-radius: 25px; font-size: 14px; font-weight: 700; border: 2px solid ${statusColor}30;">
                            ${statusText}
                          </div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- Supplier & Date Info Box -->
                <tr>
                  <td style="padding: 0 32px 24px 32px;">
                    <div style="background: linear-gradient(145deg, #f0fdf4 0%, #f0f9ff 100%); border: 2px solid rgba(16, 185, 129, 0.2); border-radius: 16px; padding: 20px;">
                      <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                        <tr>
                          <td style="width: 50%; vertical-align: top;">
                            <p style="margin: 0 0 4px 0; color: #10b981; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 700;">Supplier</p>
                            <p style="margin: 0; color: #1e293b; font-size: 18px; font-weight: 700;">🏭 ${data.supplierName}</p>
                          </td>
                          <td style="width: 50%; vertical-align: top; text-align: right;">
                            <p style="margin: 0 0 6px 0; color: #64748b; font-size: 13px;">
                              📅 Date: <strong style="color: #334155;">${data.date}</strong>
                            </p>
                            <p style="margin: 0; color: #64748b; font-size: 13px;">
                              📋 GRN: <strong style="color: #334155;">${data.grnNumber}</strong>
                            </p>
                          </td>
                        </tr>
                      </table>
                    </div>
                  </td>
                </tr>
                
                <!-- Items Table -->
                <tr>
                  <td style="padding: 0 32px 24px 32px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                      <thead>
                        <tr style="background: linear-gradient(145deg, #f8fafc 0%, #f1f5f9 100%);">
                          <th style="padding: 14px 16px; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; text-align: left; border-bottom: 2px solid #e2e8f0; font-weight: 700;">Item</th>
                          <th style="padding: 14px 16px; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; text-align: center; border-bottom: 2px solid #e2e8f0; font-weight: 700;">Qty</th>
                          <th style="padding: 14px 16px; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; text-align: right; border-bottom: 2px solid #e2e8f0; font-weight: 700;">Price</th>
                          <th style="padding: 14px 16px; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: 0.8px; text-align: right; border-bottom: 2px solid #e2e8f0; font-weight: 700;">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${itemRows}
                      </tbody>
                    </table>
                  </td>
                </tr>
                
                <!-- Totals Section -->
                <tr>
                  <td style="padding: 0 32px 32px 32px;">
                    <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%">
                      <tr>
                        <td style="width: 50%;"></td>
                        <td style="width: 50%;">
                          <table role="presentation" cellspacing="0" cellpadding="0" border="0" width="100%" style="background: #f8fafc; border-radius: 12px; padding: 4px;">
                            <tr>
                              <td style="padding: 10px 16px; color: #64748b; font-size: 14px;">Subtotal</td>
                              <td style="padding: 10px 16px; color: #334155; font-size: 14px; text-align: right; font-weight: 600;">Rs. ${data.subtotal.toLocaleString()}</td>
                            </tr>
                            ${data.tax > 0 ? `
                            <tr>
                              <td style="padding: 10px 16px; color: #64748b; font-size: 14px;">Tax</td>
                              <td style="padding: 10px 16px; color: #334155; font-size: 14px; text-align: right; font-weight: 600;">Rs. ${data.tax.toLocaleString()}</td>
                            </tr>
                            ` : ''}
                            ${data.discount > 0 ? `
                            <tr>
                              <td style="padding: 10px 16px; color: #10b981; font-size: 14px;">Discount</td>
                              <td style="padding: 10px 16px; color: #10b981; font-size: 14px; text-align: right; font-weight: 600;">- Rs. ${data.discount.toLocaleString()}</td>
                            </tr>
                            ` : ''}
                            <tr>
                              <td colspan="2" style="padding: 0;"><div style="height: 2px; background: linear-gradient(90deg, #10b981 0%, #3b82f6 100%); margin: 8px 0;"></div></td>
                            </tr>
                            <tr>
                              <td style="padding: 12px 16px; color: #1e293b; font-size: 18px; font-weight: 800;">Total</td>
                              <td style="padding: 12px 16px; color: #1e293b; font-size: 18px; font-weight: 800; text-align: right;">Rs. ${data.totalAmount.toLocaleString()}</td>
                            </tr>
                            ${data.paidAmount > 0 ? `
                            <tr>
                              <td style="padding: 10px 16px; color: #10b981; font-size: 14px;">✓ Paid</td>
                              <td style="padding: 10px 16px; color: #10b981; font-size: 14px; text-align: right; font-weight: 600;">Rs. ${data.paidAmount.toLocaleString()}</td>
                            </tr>
                            ` : ''}
                            ${data.balanceDue > 0 ? `
                            <tr>
                              <td colspan="2" style="padding: 0;">
                                <div style="margin-top: 8px; background: linear-gradient(145deg, #fef3c7 0%, #fef08a 100%); border: 2px solid rgba(245, 158, 11, 0.3); border-radius: 10px; padding: 14px 16px; text-align: center;">
                                  <span style="color: #b45309; font-size: 13px; font-weight: 600;">⚠️ Balance Due: </span>
                                  <span style="color: #b45309; font-size: 20px; font-weight: 800;">Rs. ${data.balanceDue.toLocaleString()}</span>
                                </div>
                              </td>
                            </tr>
                            ` : ''}
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                ${data.notes ? `
                <!-- Notes Section -->
                <tr>
                  <td style="padding: 0 32px 32px 32px;">
                    <div style="background: linear-gradient(145deg, rgba(245, 158, 11, 0.05) 0%, rgba(251, 191, 36, 0.05) 100%); border: 2px solid rgba(245, 158, 11, 0.2); border-radius: 12px; padding: 16px;">
                      <p style="margin: 0 0 6px 0; color: #b45309; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700;">📝 Notes</p>
                      <p style="margin: 0; color: #78350f; font-size: 14px; line-height: 1.6;">${data.notes}</p>
                    </div>
                  </td>
                </tr>
                ` : ''}
                
                <!-- Thank You Message -->
                <tr>
                  <td style="padding: 0 32px 32px 32px; text-align: center;">
                    <div style="background: linear-gradient(145deg, rgba(16, 185, 129, 0.08) 0%, rgba(59, 130, 246, 0.08) 100%); border-radius: 16px; padding: 28px;">
                      <p style="margin: 0; color: #10b981; font-size: 20px; font-weight: 700;">
                        🙏 Thank you for your service!
                      </p>
                      <p style="margin: 10px 0 0 0; color: #64748b; font-size: 14px;">
                        We appreciate your partnership with ${data.shopName}.
                      </p>
                      <p style="margin: 6px 0 0 0; color: #94a3b8; font-size: 12px;">
                        For any queries, please contact us at ${data.shopPhone || data.shopEmail || 'our store'}.
                      </p>
                    </div>
                  </td>
                </tr>
                
                <!-- PDF Attachment Notice (conditional) -->
                ${includePdfAttachment ? `
                <tr>
                  <td style="padding: 0 32px 32px 32px; text-align: center;">
                    <div style="background: #f1f5f9; border-radius: 10px; padding: 14px;">
                      <p style="margin: 0; color: #64748b; font-size: 13px;">
                        📎 <strong>GRN PDF attached</strong> - Please keep for your records.
                      </p>
                    </div>
                  </td>
                </tr>
                ` : ''}
                
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="text-align: center; padding: 32px 20px;">
              <p style="margin: 0 0 8px 0; color: #94a3b8; font-size: 12px;">
                This is an automated email from ${data.shopName}
              </p>
              <p style="margin: 0; color: #cbd5e1; font-size: 11px;">
                © ${currentYear} ${data.shopName}. All rights reserved.
              </p>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
};

/**
 * Generate GRN Email Plain Text
 */
const generateGRNEmailText = (data: GRNEmailData): string => {
  const itemsList = data.items.map(item => 
    `• ${item.productName} - Qty: ${item.quantity} x Rs.${item.costPrice.toLocaleString()} = Rs.${item.total.toLocaleString()}`
  ).join('\n');

  return `
GOODS RECEIVED NOTE - ${data.grnNumber}
==========================================

From: ${data.shopName}
${data.shopAddress || ''}
${data.shopPhone ? 'Phone: ' + data.shopPhone : ''}

Supplier: ${data.supplierName}
Date: ${data.date}
Payment Status: ${data.paymentStatus}

ITEMS
-----
${itemsList}

-------------------------------------
Subtotal:     Rs. ${data.subtotal.toLocaleString()}
${data.tax > 0 ? 'Tax:          Rs. ' + data.tax.toLocaleString() : ''}
${data.discount > 0 ? 'Discount:     -Rs. ' + data.discount.toLocaleString() : ''}
-------------------------------------
TOTAL:        Rs. ${data.totalAmount.toLocaleString()}
${data.paidAmount > 0 ? 'Paid:         Rs. ' + data.paidAmount.toLocaleString() : ''}
${data.balanceDue > 0 ? 'Balance Due:  Rs. ' + data.balanceDue.toLocaleString() : ''}
-------------------------------------

${data.notes ? 'Notes: ' + data.notes : ''}

Thank you for your service!

© ${new Date().getFullYear()} ${data.shopName}
  `.trim();
};

/**
 * Send GRN Email with PDF attachment
 */
export const sendGRNWithPDF = async (
  data: GRNEmailData,
  pdfBase64?: string
): Promise<{ success: boolean; messageId?: string; error?: string; hasPdfAttachment?: boolean }> => {
  try {
    // Check if ANY email provider is configured (Resend OR SMTP)
    if (!isEmailConfigured()) {
      console.error('❌ No email provider configured. Cannot send GRN email.');
      if (process.env.NODE_ENV !== 'production') {
        console.log('📧 [DEV MODE] GRN email would be sent to:', data.email);
        return { success: true, messageId: 'dev-mode-no-email-sent', hasPdfAttachment: !!pdfBase64 };
      }
      return { success: false, error: 'Email service not configured. Set RESEND_API_KEY or SMTP credentials.' };
    }

    const fromName = process.env.SMTP_FROM_NAME || data.shopName;
    const fromEmail = process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || 'noreply@system.com';

    console.log(`📤 Sending GRN email to: ${data.email}`);

    const hasPdfAttachment = !!pdfBase64;

    const mailOptions: {
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
      attachments?: Array<{
        filename: string;
        content: Buffer;
        contentType: string;
      }>;
    } = {
      from: `"${fromName}" <${fromEmail}>`,
      to: data.email,
      subject: `📦 GRN #${data.grnNumber} from ${data.shopName}`,
      text: generateGRNEmailText(data),
      html: generateGRNEmailHTML(data, hasPdfAttachment),
    };

    // Add PDF attachment if provided
    if (pdfBase64) {
      // Remove data URL prefix if present
      const base64Data = pdfBase64.replace(/^data:application\/pdf;base64,/, '');
      const pdfBuffer = Buffer.from(base64Data, 'base64');
      
      mailOptions.attachments = [
        {
          filename: `GRN-${data.grnNumber}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ];
    }

    const result = await sendMailWithRetry(mailOptions);
    console.log('✅ GRN email sent successfully to:', data.email);
    
    return { success: true, messageId: result.messageId, hasPdfAttachment: !!pdfBase64 };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown email error';
    console.error('❌ Failed to send GRN email:', errorMessage);
    resetTransporter();
    return { success: false, error: errorMessage };
  }
};

export default {
  sendPasswordResetOTP,
  generateOTP,
  verifyEmailConnection,
  sendGRNWithPDF,
};
