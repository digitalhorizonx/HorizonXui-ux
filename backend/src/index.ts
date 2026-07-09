import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import express from 'express';
import cookieSession from 'cookie-session';
import { env } from './config/env';
import { prisma } from './db';
import { authRouter } from './routes/auth';
import { apiRouter } from './routes/api';
import { startScheduler } from './services/scheduler';

const app = express();
app.set('trust proxy', 1); // behind Nginx in production
app.use(express.json());

if (!env.sessionSecret) {
  // Boot must not fail in early phases, but an unsigned session would be
  // insecure — use an ephemeral key and warn loudly (sessions reset on restart).
  console.warn('WARNING: SESSION_SECRET is not set — using an ephemeral session key');
}
app.use(
  cookieSession({
    name: 'hx_session',
    keys: [env.sessionSecret || crypto.randomBytes(32).toString('hex')],
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
);

// Health check (Phase 5 requires /healthz; wired from day one).
app.get('/healthz', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: 'up' });
  } catch {
    res.status(503).json({ ok: false, db: 'down' });
  }
});

app.use('/api/auth', authRouter);
app.use('/api', apiRouter);

// Serve the built frontend when present (single-process deployment: Nginx
// terminates TLS and proxies everything here).
const frontendDist = path.resolve(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get(/^\/(?!api\/|healthz).*/, (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.listen(env.port, () => {
  // English is fine in logs (Hard rule 6).
  console.log(`HorizonX Agentic OS backend listening on port ${env.port}`);
  startScheduler();
});
