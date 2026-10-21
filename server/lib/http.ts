import type { NextFunction, Request, RequestHandler, Response } from 'express';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, 'validation_error', details);
export const unauthorized = (message = 'Please sign in to continue.') => new HttpError(401, message, 'unauthenticated');
export const forbidden = (message = 'You do not have permission to perform this action.') => new HttpError(403, message, 'forbidden');
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found.`, 'not_found');
export const conflict = (message: string, details?: unknown) => new HttpError(409, message, 'conflict', details);

/** Wraps a handler so thrown errors and rejected promises reach the error middleware. */
export function route(handler: (req: Request, res: Response) => unknown): RequestHandler {
  return (req, res, next) => {
    try {
      const out = handler(req, res);
      if (out && typeof (out as Promise<unknown>).then === 'function') {
        (out as Promise<unknown>).catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ success: false, error: err.code, message: err.message, details: err.details });
    return;
  }
  const anyErr = err as { type?: string; message?: string; code?: string };
  if (anyErr?.type === 'entity.parse.failed') {
    res.status(400).json({ success: false, error: 'invalid_json', message: 'Request body is not valid JSON.' });
    return;
  }
  if (anyErr?.type === 'entity.too.large') {
    res.status(413).json({ success: false, error: 'payload_too_large', message: 'Request body is too large.' });
    return;
  }
  // SQLite constraint failures are client-visible conflicts, not server crashes.
  if (typeof anyErr?.message === 'string' && /constraint failed/i.test(anyErr.message)) {
    const unique = /UNIQUE/i.test(anyErr.message);
    res.status(409).json({
      success: false,
      error: 'conflict',
      message: unique ? 'A record with these details already exists.' : 'The request violates a data integrity rule.',
    });
    return;
  }
  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ success: false, error: 'server_error', message: 'An unexpected server error occurred.' });
}

export function ok(res: Response, data: unknown, extra: Record<string, unknown> = {}) {
  res.json({ success: true, data, ...extra });
}

export function created(res: Response, data: unknown, message?: string) {
  res.status(201).json({ success: true, data, message });
}

export function paginate<T>(items: T[], req: Request, defaultLimit = 20) {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? defaultLimit), 10) || defaultLimit, 1), 500);
  const page = Math.max(parseInt(String(req.query.page ?? 1), 10) || 1, 1);
  const total = items.length;
  return {
    data: items.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
  };
}
