import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { authRouter }      from './routes/auth';
import { campaignsRouter } from './routes/campaigns';
import { postsRouter }     from './routes/posts';
import { vaultRouter }     from './routes/vault';
import { claimsRouter }    from './routes/claims';
import { startRewardEngine } from './services/rewards';
import { seedCampaigns }   from './lib/seed';
import { prisma }          from './lib/prisma';

const app  = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'OPTIONS'],
}));
app.use(rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false }));
app.use(express.json({ limit: '50kb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.use('/api/auth',      authRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/posts',     postsRouter);
app.use('/api/vault',     vaultRouter);
app.use('/api/claims',    claimsRouter);

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
