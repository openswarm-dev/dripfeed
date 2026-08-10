import 'dotenv/config';

// BigInt can't be serialized by JSON.stringify natively — convert to string
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { authRouter }      from './routes/auth';
import { campaignsRouter } from './routes/campaigns';
import { postsRouter }     from './routes/posts';
import { vaultRouter }     from './routes/vault';
import { claimsRouter }    from './routes/claims';
import { feedRouter }      from './routes/feed';
import { startRewardEngine } from './services/rewards';
import { seedCampaigns }   from './lib/seed';
import { prisma }          from './lib/prisma';

const app  = express();
const PORT = process.env.PORT || 4000;

// Railway (and most PaaS) sits behind a reverse proxy that sets X-Forwarded-For.
// Without this, express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR and
// crashes every request before CORS headers are written.
app.set('trust proxy', 1);
app.use(helmet());
// Reflect every origin back — safe because all sensitive routes require JWT auth.
// CORS is not a meaningful security boundary for token-authenticated APIs.
app.use(cors({ origin: true, methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], credentials: true }));
app.use(rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false }));
app.use(express.json({ limit: '8mb' }));  // allows base64-encoded images up to ~6MB source

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    auth: {
      xKeys: !!(process.env.X_CONSUMER_KEY && process.env.X_CONSUMER_SECRET),
      jwt: !!process.env.JWT_SECRET,
      serverUrl: process.env.SERVER_URL?.trim() || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'auto'),
    },
  });
});

app.use('/api/auth',      authRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/posts',     postsRouter);
app.use('/api/vault',     vaultRouter);
app.use('/api/claims',    claimsRouter);
app.use('/api/feed',      feedRouter);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Start listening immediately — don't block on DB
app.listen(PORT, () => {
  console.log(`\n drip-server on http://localhost:${PORT}`);
  console.log(`   X Consumer Key: ${process.env.X_CONSUMER_KEY ? '✓' : '✗ MISSING'}`);
  console.log(`   JWT Secret:     ${process.env.JWT_SECRET ? '✓' : '✗ MISSING'}`);
  console.log(`   Database:       ${process.env.DATABASE_URL ? '✓' : '✗ MISSING'}\n`);
});

// Connect DB and seed in background so healthcheck passes immediately
async function initDb() {
  try {
    await prisma.$connect();
    console.log('[DB] Connected to PostgreSQL');
    await seedCampaigns();
    startRewardEngine();
  } catch (err) {
    console.error('[DB] Connection failed — retrying in 5s:', err);
    setTimeout(initDb, 5_000);
  }
}

initDb();
