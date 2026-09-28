import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import config from './config/index.js';
import { requireAuth } from './middleware/auth.js';
import * as auth from './controllers/auth.controller.js';
import * as users from './controllers/users.controller.js';
import * as messages from './controllers/messages.controller.js';

const staticDir = path.join(config.root, '..', 'frontend', 'dist');

export function createApp(overrides = {}) {
  const cfg = { ...config, ...overrides };
  const app = express();
  app.disable('x-powered-by');

  const cspDirectives = {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    fontSrc: ["'self'"],
    imgSrc: ["'self'", 'data:', 'https:'],
    connectSrc: ["'self'", 'ws:', 'wss:'],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'none'"]
  };
  app.use(helmet({ contentSecurityPolicy: { directives: cspDirectives } }));

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || origin === cfg.frontendUrl) return callback(null, true);
        return callback(null, false);
      },
      methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization']
    })
  );

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => cfg.isTest && !cfg.testRatelimit
  });
  const authLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: cfg.testRatelimit ? 6 : 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => cfg.isTest && !cfg.testRatelimit
  });
  app.use('/api/', apiLimiter);
  app.use('/api/auth', authLimiter);

  app.use(express.json({ limit: cfg.bodyLimitBytes, type: ['application/json'] }));
  app.use(express.urlencoded({ extended: false }));

  app.get('/health', (_req, res) =>
    res.json({ ok: true, uptime: process.uptime(), version: 'cipher/1.0.0' })
  );

  const api = express.Router();
  api.post('/auth/signup', auth.signup);
  api.post('/auth/login', auth.login);
  api.post('/auth/google', auth.googleLogin);

  api.get('/auth/me', requireAuth, auth.me);
  api.put('/auth/keys', requireAuth, auth.storeKey);

  api.get('/users', requireAuth, users.searchUsers);
  api.get('/users/:id', requireAuth, users.getUser);
  api.patch('/account', requireAuth, users.updateAccount);

  api.get('/conversations', requireAuth, messages.listConversations);
  api.get('/messages/:userId', requireAuth, messages.getThread);
  api.post('/messages/:userId', requireAuth, messages.send);
  api.post('/messages/:id/read', requireAuth, messages.markRead);

  app.use('/api', api);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir, { index: 'index.html', maxAge: '1h' }));
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use((err, _req, res, _next) => {
    const status = err.type === 'entity.too.large' ? 413 : 500;
    const message =
      status === 413
        ? 'Payload too large'
        : cfg.isProduction
          ? 'Something went wrong'
          : err.message;
    if (status >= 500 && !cfg.isTest) console.error(err);
    res.status(status).json({ error: message });
  });

  return app;
}