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

/** Parse account list — Railway often strips commas from env vars. */
function parseAccountList(raw: string | undefined): string[] {
  const fallback = 'elonmusk,AutismCapital,realDonaldTrump,tier10k,lookonchain';
  return (raw || fallback)
    .split(/[,;\s]+/)
    .map((s) => s.trim().replace(/^@/, ''))
    .filter(Boolean)
    .slice(0, 5);
}

function resolveGeyserEndpoint(): string {
  const provider = process.env.GEYSER_PROVIDER?.trim().toLowerCase();
  if (provider === 'helius') {
    return process.env.HELIUS_GEYSER_ENDPOINT?.trim()
      || process.env.GEYSER_ENDPOINT?.trim()
      || 'https://laserstream-mainnet-fra.helius-rpc.com';
  }
  const explicit = process.env.GEYSER_ENDPOINT?.trim();
  if (explicit) return explicit;
  return 'http://grpc-fra1-burst.erpc.global';
}

/** ERPC gRPC often uses the same api-key as the HTTP RPC URL when X_TOKEN is unset. */
function resolveGeyserToken(endpoint: string): string | undefined {
  const explicit = process.env.X_TOKEN?.trim();
  if (explicit) return explicit;
  if (endpoint.includes('helius')) {
    return process.env.HELIUS_API_KEY?.trim() || undefined;
  }
  const rpc = process.env.SOLANA_RPC_URL?.trim() || '';
  const match = rpc.match(/[?&]api-key=([^&]+)/i);
  return match?.[1];
}

const geyserEndpoint = resolveGeyserEndpoint();

export const config = {
  rpcUrl: process.env.SOLANA_RPC_URL?.trim() || '',
  heliusApiKey: process.env.HELIUS_API_KEY?.trim() || '',
  geyserEndpoint,
  geyserToken: resolveGeyserToken(geyserEndpoint),
  scanDays: parseInt(process.env.SCAN_DAYS || '3', 10),
  maxSignaturePages: parseInt(process.env.MAX_SIGNATURE_PAGES || '80', 10),
  enrichConcurrency: parseInt(process.env.ENRICH_CONCURRENCY || '8', 10),
  port: parseInt(
    process.env.BETTTR_RADAR_PORT || process.env.NARRA_PORT || process.env.PORT || '3950',
    10,
  ),
  geyserEnabled: process.env.BETTTR_GEYSER === 'true' || process.env.NARRA_GEYSER === 'true' || process.env.GEYSER_ENABLED === 'true',
  /** Poll pump.fun creates over HTTP RPC — only when explicitly enabled. */
  rpcPollMode: (() => {
    const raw = process.env.GEYSER_RPC_POLL?.trim().toLowerCase();
    if (raw === 'true' || raw === 'only') return 'only' as const;
    if (raw === 'backup') return 'backup' as const;
    return 'off' as const;
  })(),
  tweetstreamApiKey: process.env.TWEETSTREAM_API_KEY?.trim() || '',
  tweetstreamWsUrl: process.env.TWEETSTREAM_WS_URL?.trim() || 'wss://ws-global.tweetstream.io/ws',
  tweetstreamAccounts: parseAccountList(process.env.TWEETSTREAM_ACCOUNTS),
  dataDir: path.join(ROOT, 'data'),
};

export function ensureDataDir() {
  if (!fs.existsSync(config.dataDir)) fs.mkdirSync(config.dataDir, { recursive: true });
}

export function validateConfig() {
  if (!config.rpcUrl && !config.heliusApiKey) {
    if (config.geyserEnabled || config.tweetstreamApiKey) {
      console.warn('  No RPC URL — historical scan disabled; live feeds only');
      return;
    }
    console.warn('  No RPC URL — serving cached report only');
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
