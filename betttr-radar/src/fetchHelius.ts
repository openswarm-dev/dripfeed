import { config, PUMP_PROGRAM } from './config.js';
import type { ParsedLaunch } from './parseCreate.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface HeliusTx {
  signature: string;
  slot: number;
  timestamp: number;
  type: string;
  source: string;
  feePayer: string;
  tokenTransfers?: Array<{ mint?: string }>;
  accountData?: Array<{ account: string }>;
  nativeTransfers?: Array<{ toUserAccount: string }>;
}

function extractMintFromHeliusTx(tx: HeliusTx): string | null {
  for (const t of tx.tokenTransfers ?? []) {
    if (t.mint?.endsWith('pump')) return t.mint;
  }
  for (const t of tx.nativeTransfers ?? []) {
    if (t.toUserAccount?.endsWith('pump')) return t.toUserAccount;
  }
  for (const a of tx.accountData ?? []) {
    if (a.account?.endsWith('pump')) return a.account;
  }
  return null;
}

/** Fast backfill via Helius — CREATE type + gte-time, paginated. */
export async function fetchLaunchesHelius(opts: {
  days: number;
  maxPages: number;
  maxCreates?: number;
  onProgress?: (msg: string) => void;
}): Promise<ParsedLaunch[]> {
  if (!config.heliusApiKey) {
    throw new Error('HELIUS_API_KEY required for Helius scan');
  }

  const maxCreates = opts.maxCreates ?? 800;
  const cutoff = Math.floor(Date.now() / 1000) - opts.days * 86400;
  const launches = new Map<string, ParsedLaunch>();
  let before: string | undefined;
  let page = 0;

  while (page < opts.maxPages && launches.size < maxCreates) {
    page++;
    opts.onProgress?.(`Helius CREATE page ${page}… (${launches.size} tokens)`);

    const url = new URL(
      `https://api.helius.xyz/v0/addresses/${PUMP_PROGRAM}/transactions`,
    );
    url.searchParams.set('api-key', config.heliusApiKey);
    url.searchParams.set('limit', '100');
    url.searchParams.set('type', 'CREATE');
    url.searchParams.set('gte-time', String(cutoff));
    if (before) url.searchParams.set('before', before);

    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Helius ${res.status}: ${text.slice(0, 200)}`);
    }

    const batch = (await res.json()) as HeliusTx[];
    if (!Array.isArray(batch) || batch.length === 0) break;

    before = batch[batch.length - 1]?.signature;
    const oldest = batch[batch.length - 1]?.timestamp ?? 0;

    for (const tx of batch) {
      if (tx.type !== 'CREATE' || tx.source !== 'PUMP_FUN') continue;
      const mint = extractMintFromHeliusTx(tx);
      if (!mint) continue;

      launches.set(mint, {
        signature: tx.signature,
        slot: tx.slot,
        blockTime: tx.timestamp,
        mint,
        creator: tx.feePayer,
        isCreateV2: false,
      });
    }

    if (page % 5 === 0 || batch.length < 5) {
      opts.onProgress?.(
        `Page ${page}: ${launches.size} creates · oldest ${new Date(oldest * 1000).toISOString().slice(0, 16)}`,
      );
    }

    if (oldest < cutoff) break;
    await sleep(180);
  }

  return [...launches.values()].sort(
    (a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0),
  );
}
