import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PARENT_ENV = path.resolve(ROOT, '..', '.env');

if (fs.existsSync(PARENT_ENV)) dotenv.config({ path: PARENT_ENV });
dotenv.config({ path: path.join(ROOT, '.env') });
// Local dev fallback: pick up RPC / Geyser keys from DEVSNIPER if not set here
const DEVSNIPER_ENV = path.resolve(ROOT, '..', '..', 'DEVSNIPER', '.env');
if (fs.existsSync(DEVSNIPER_ENV)) dotenv.config({ path: DEVSNIPER_ENV });

export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';

/** ERPC gRPC often uses the same api-key as the HTTP RPC URL when X_TOKEN is unset. */
function resolveGeyserToken(): string | undefined {
  const explicit = process.env.X_TOKEN?.trim();
  if (explicit) return explicit;
  const rpc = process.env.SOLANA_RPC_URL?.trim() || '';
  const match = rpc.match(/[?&]api-key=([^&]+)/i);
  return match?.[1];
}

export const config = {
  rpcUrl: process.env.SOLANA_RPC_URL?.trim() || '',
  heliusApiKey: process.env.HELIUS_API_KEY?.trim() || '',
  geyserEndpoint: process.env.GEYSER_ENDPOINT?.trim() || 'http://grpc-fra1-burst.erpc.global',
  geyserToken: resolveGeyserToken(),
  scanDays: parseInt(process.env.SCAN_DAYS || '3', 10),
  maxSignaturePages: parseInt(process.env.MAX_SIGNATURE_PAGES || '80', 10),
  enrichConcurrency: parseInt(process.env.ENRICH_CONCURRENCY || '8', 10),
  port: parseInt(
    process.env.BETTTR_RADAR_PORT || process.env.NARRA_PORT || process.env.PORT || '3950',
    10,
  ),
  geyserEnabled: process.env.BETTTR_GEYSER === 'true' || process.env.NARRA_GEYSER === 'true' || process.env.GEYSER_ENABLED === 'true',
  tweetstreamApiKey: process.env.TWEETSTREAM_API_KEY?.trim() || '',
  tweetstreamWsUrl: process.env.TWEETSTREAM_WS_URL?.trim() || 'wss://ws-global.tweetstream.io/ws',
  tweetstreamAccounts: (process.env.TWEETSTREAM_ACCOUNTS || 'elonmusk,AutismCapital,realDonaldTrump,tier10k,lookonchain')
    .split(',')
    .map((s) => s.trim().replace(/^@/, ''))
    .filter(Boolean)
    .slice(0, 5),
  dataDir: path.join(ROOT, 'data'),
};

export function ensureDataDir() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
}

export function validateConfig() {
  if (!config.rpcUrl && !config.heliusApiKey) {
    if (config.geyserEnabled) {
      throw new Error('Set SOLANA_RPC_URL or HELIUS_API_KEY for live Geyser feed');
    }
    console.warn('  No RPC URL — historical scan disabled; serving cached report only');
  }
}

export function getRpcUrl(): string {
  if (config.rpcUrl) return config.rpcUrl;
  return `https://mainnet.helius-rpc.com/?api-key=${config.heliusApiKey}`;
}

export function getHeavyRpcUrl(): string {
  if (config.heliusApiKey) {
    return `https://mainnet.helius-rpc.com/?api-key=${config.heliusApiKey}`;
  }
  return getRpcUrl();
}
