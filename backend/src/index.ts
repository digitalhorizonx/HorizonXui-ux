import express from 'express';
import { env } from './config/env';
import { prisma } from './db';

const app = express();
app.use(express.json());

// Health check (spec Phase 5 requires /healthz; wired from day one).
app.get('/healthz', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: 'up' });
  } catch {
    res.status(503).json({ ok: false, db: 'down' });
  }
});

app.listen(env.port, () => {
  // English is fine in logs (Hard rule 6).
  console.log(`HorizonX Agentic OS backend listening on port ${env.port}`);
});
