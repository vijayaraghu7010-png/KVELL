import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { errorHandler, notFound } from './lib/http';
import { loadSession, originGuard, requireAuth } from './lib/auth';
import authRoutes from './routes/auth';
import commonRoutes from './routes/common';
import studentRoutes from './routes/student';
import wardenRoutes from './routes/warden';
import securityRoutes from './routes/security';
import adviserRoutes from './routes/adviser';
import hodRoutes from './routes/hod';
import aoRoutes from './routes/ao';
import messRoutes from './routes/mess';
import deanRoutes from './routes/dean';
import workRoutes from './routes/work';
import academicRoutes from './routes/academics';
import adminRoutes from './routes/admin';
import operationsRoutes from './routes/operations';
import parentRoutes from './routes/parent';
import workerRoutes from './routes/worker';
import { db } from './db/database';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

  app.use(express.json({ limit: '8mb' }));

  // Basic hardening headers (no external dependency).
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });

  if (process.env.LOG_REQUESTS !== 'false' && process.env.NODE_ENV !== 'test') {
    app.use('/api', (req, _res, next) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl.split('?')[0]}`);
      next();
    });
  }

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', loadSession, originGuard);

  app.get('/api/health', (_req, res) => {
    let database = 'ok';
    try {
      db().get('SELECT 1');
    } catch {
      database = 'unavailable';
    }
    res.status(database === 'ok' ? 200 : 503).json({ status: database === 'ok' ? 'ok' : 'degraded', database, timestamp: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  // Parent/guardian approval links carry their own single-use token and must work
  // without an account, so they are mounted before the session guard.
  app.use('/api/parent', parentRoutes);
  // A hostel worker has no account either: their job link carries its own token.
  app.use('/api/worker', workerRoutes);
  app.use('/api', requireAuth);
  app.use('/api', commonRoutes);
  app.use('/api/student', studentRoutes);
  app.use('/api/warden', wardenRoutes);
  app.use('/api/security', securityRoutes);
  app.use('/api/adviser', adviserRoutes);
  app.use('/api/hod', hodRoutes);
  app.use('/api/ao', aoRoutes);
  app.use('/api/mess', messRoutes);
  app.use('/api/dean', deanRoutes);
  app.use('/api/work', workRoutes);
  app.use('/api/academics', academicRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api', operationsRoutes);
  app.use('/api', (_req, _res, next) => next(notFound('API endpoint')));

  // Production: serve the built SPA from /dist.
  const distPath = path.resolve(process.cwd(), 'dist');
  if (fs.existsSync(path.join(distPath, 'index.html'))) {
    app.use(express.static(distPath, { index: false }));
    app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
