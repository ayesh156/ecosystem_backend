import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  statusCode: number;
  status: string;
  isOperational: boolean;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

interface ErrorResponse {
  success: false;
  message: string;
  error?: string;
  stack?: string;
}

export const errorHandler = (
  err: Error | AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
) => {
  let statusCode = 500;
  let message = 'Internal Server Error';

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    message = err.message;
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = err.message;
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token. Please log in again.';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Your token has expired. Please log in again.';
  } else if (err.name === 'PrismaClientKnownRequestError') {
    // Handle Prisma-specific errors
    const prismaError = err as any;
    if (prismaError.code === 'P2024') {
      statusCode = 503;
      message = 'Database connection pool timeout. The service is temporarily busy. Please try again in a moment.';
      console.error('🚨 Connection Pool Timeout (P2024):', err.message?.substring(0, 200));
    } else if (prismaError.code === 'P2025') {
      statusCode = 404;
      message = 'Record not found. The requested resource does not exist.';
    } else if (prismaError.code === 'P2002') {
      statusCode = 409;
      message = 'A record with this unique value already exists.';
    } else if (prismaError.code === 'P2003') {
      statusCode = 400;
      message = 'Foreign key constraint failed. Referenced record does not exist.';
    }
  } else if (err.name === 'PrismaClientValidationError') {
    statusCode = 400;
    message = 'Invalid data format. Please check your request data.';
  } else if (err.name === 'PrismaClientInitializationError') {
    statusCode = 503;
    message = 'Database connection failed. The service is temporarily unavailable. Please try again in a moment.';
    console.error('🚨 Prisma Initialization Error:', err.message);
  } else if (err.name === 'PrismaClientRustPanicError') {
    statusCode = 503;
    message = 'A critical database error occurred. Please try again.';
    console.error('🚨 Prisma Rust Panic:', err.message);
  } else if (
    err.message?.includes('Can\'t reach database') ||
    err.message?.includes('Connection refused') ||
    err.message?.includes('ECONNREFUSED') ||
    err.message?.includes('ECONNRESET') ||
    err.message?.includes('ETIMEDOUT') ||
    err.message?.includes('Connection terminated') ||
    err.message?.includes('server closed the connection') ||
    err.message?.includes('Server has closed the connection') ||
    err.message?.includes('connect ETIMEDOUT') ||
    err.message?.includes('connection pool') ||
    err.message?.includes('Timed out fetching a new connection') ||
    (err.message?.includes('connect') && err.message?.includes('database'))
  ) {
    statusCode = 503;
    message = 'Database connection failed. Please try again in a moment.';
    console.error('🚨 DB Connection Error:', err.message?.substring(0, 300));
  }

  const response: ErrorResponse = {
    success: false,
    message,
  };

  // Include error details in development
  if (process.env.NODE_ENV === 'development') {
    response.error = err.message;
    response.stack = err.stack;
  }

  console.error(`❌ Error: ${message}`, err);

  res.status(statusCode).json(response);
};
