import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { campaignsRouter } from './routes/campaigns';
import { postsRouter }     from './routes/posts';
import { vaultRouter }     from './routes/vault';
import { claimsRouter }    from './routes/claims';
import { startRewardEngine } from './services/rewards';

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'OPTIONS'],
}));

// Global rate limit: 200 req/min per IP
app.use(rateLimit({ windowMs: 60_000, max: 200, standardHeaders: true, legacyHeaders: false }));

app.use(express.json({ limit: '50kb' }));

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

// ── API routes ────────────────────────────────────────────────────────────────
app.use('/api/campaigns', campaignsRouter);
app.use('/api/posts',     postsRouter);
app.use('/api/vault',     vaultRouter);
app.use('/api/claims',    claimsRouter);

// ── 404 fallback ──────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 drip-server running on http://localhost:${PORT}`);
  console.log(`   Twitter API key: ${process.env.TWITTER_API_KEY ? '✓ set' : '✗ MISSING'}`);
  console.log(`   Solana RPC:      ${process.env.SOLANA_RPC_URL  ? '✓ set' : '⚠ using mainnet default'}`);
  console.log(`   DRIP mint:       ${process.env.DRIP_MINT_ADDRESS ? '✓ set' : '⚠ not set — claims in dev mode'}\n`);
  startRewardEngine();
});
