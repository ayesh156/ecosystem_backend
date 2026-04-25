/**
 * Route-Level Timeout Middleware
 * 
 * Prevents long-running PDF generation or email sending from hanging
 * the entire server. Returns 504 Gateway Timeout if the route handler
 * doesn't respond within the specified time.
 * 
 * Usage:
 *   router.post('/pdf', routeTimeout(60000), generatePDF);
 *   router.post('/send-email', routeTimeout(120000), sendEmail);
 */

import { Request, Response, NextFunction } from 'express';

/**
 * Creates a middleware that sets a timeout for the route.
 * If the handler doesn't send a response within `ms` milliseconds,
 * a 504 response is sent automatically.
 * 
 * @param ms - Timeout in milliseconds
 * @param message - Optional custom timeout message
 */
export const routeTimeout = (ms: number, message?: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // Set the socket timeout (prevents Node.js from closing the connection early)
    req.setTimeout(ms + 5000); // Give socket a bit more than the route timeout

    const timer = setTimeout(() => {
      if (!res.headersSent) {
        console.error(`⏰ Route timeout after ${ms / 1000}s: ${req.method} ${req.originalUrl}`);
        res.status(504).json({
          success: false,
          message: message || `Request timed out after ${ms / 1000} seconds. The operation took too long.`,
        });
      }
    }, ms);

    // Clean up the timer when the response finishes
    const originalEnd = res.end.bind(res);
    (res as any).end = function (...args: any[]) {
      clearTimeout(timer);
      return originalEnd(...args);
    };

    // Also clean up on response close/finish events
    res.on('finish', () => clearTimeout(timer));
    res.on('close', () => clearTimeout(timer));

    next();
  };
};
