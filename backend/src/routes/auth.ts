import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { env } from '../config/env';

/**
 * Single-user auth (Hard rule 9): one user (Abdulla), bcrypt password from
 * ADMIN_PASSWORD_HASH, signed session cookie, rate-limited login, no signup.
 */
export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true, // only failed attempts count — a legit login never locks Abdulla out
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', messageAr: 'محاولات كثيرة — حاول مجدداً بعد ١٥ دقيقة' },
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  if (!env.adminPasswordHash) {
    res.status(503).json({ error: 'not_configured', messageAr: 'كلمة مرور المشرف غير مهيأة على الخادم' });
    return;
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const ok = password.length > 0 && (await bcrypt.compare(password, env.adminPasswordHash));
  if (!ok) {
    res.status(401).json({ error: 'invalid_credentials', messageAr: 'كلمة المرور غير صحيحة' });
    return;
  }
  req.session = { authed: true, loginAt: Date.now() };
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  res.json({ authed: req.session?.authed === true });
});
