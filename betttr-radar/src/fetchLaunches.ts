import { Connection, PublicKey } from '@solana/web3.js';
import { config, getHeavyRpcUrl, getRpcUrl, PUMP_PROGRAM } from './config.js';
import { parsePumpCreateTx, type ParsedLaunch } from './parseCreate.js';
import { fetchLaunchesHelius } from './fetchHelius.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface LaunchRecord extends ParsedLaunch {
  name?: string;
  symbol?: string;
  description?: string;
  image?: string;
  marketCapUsd?: number;
  volumeUsd24h?: number;
  volumeUsd1h?: number;
  txns24h?: number;
  volumeUpdatedAt?: number;
  bonded?: boolean;
  holderCount?: number;
  bondingProgressPct?: number;
  marketUpdatedAt?: number;
  narratives: string[];
  primaryNarrative: string;
  narrativeScore: number;
}

export async function fetchRecentLaunches(opts: {
  days: number;
  maxPages: number;
  maxCreates?: number;
  onProgress?: (msg: string) => void;
}): Promise<ParsedLaunch[]> {
  if (config.heliusApiKey) {
    opts.onProgress?.('Using Helius enhanced transactions (CREATE filter)…');
    return fetchLaunchesHelius(opts);
  }

  return fetchRecentLaunchesRpc(opts);
}

async function fetchRecentLaunchesRpc(opts: {
  days: number;
  maxPages: number;
  onProgress?: (msg: string) => void;
}): Promise<ParsedLaunch[]> {
  const readConn = new Connection(getRpcUrl(), 'confirmed');
  const txConn = new Connection(getHeavyRpcUrl(), 'confirmed');
  const program = new PublicKey(PUMP_PROGRAM);
  const cutoff = Math.floor(Date.now() / 1000) - opts.days * 86400;

  const launches = new Map<string, ParsedLaunch>();
  let before: string | undefined;
  let page = 0;
  let scanned = 0;
  let oldestTime: number | null = null;

  while (page < opts.maxPages) {
    page++;
    opts.onProgress?.(`Fetching signatures page ${page}/${opts.maxPages}…`);

    const sigs = await readConn.getSignaturesForAddress(program, {
      limit: 1000,
      before,
    });
    if (sigs.length === 0) break;

    before = sigs[sigs.length - 1]?.signature;
    scanned += sigs.length;

    const inWindow = sigs.filter((s) => {
      if (s.blockTime == null) return true;
      if (oldestTime == null || s.blockTime < oldestTime) oldestTime = s.blockTime;
      return s.blockTime >= cutoff;
    });

    if (inWindow.length === 0 && oldestTime != null && oldestTime < cutoff) {
      opts.onProgress?.(`Reached ${opts.days}d cutoff at page ${page}`);
      break;
    }

    for (let i = 0; i < inWindow.length; i += 15) {
      const batch = inWindow.slice(i, i + 15);
      const txs = await txConn.getTransactions(
        batch.map((s) => s.signature),
        {
          maxSupportedTransactionVersion: 0,
          commitment: 'confirmed',
        },
      );

      for (let j = 0; j < txs.length; j++) {
        const tx = txs[j];
        const sigInfo = batch[j];
        if (!tx || !sigInfo) continue;

        const parsed = parsePumpCreateTx(tx);
        if (!parsed) continue;
        if (sigInfo.blockTime != null && sigInfo.blockTime < cutoff) continue;

        launches.set(parsed.mint, {
          ...parsed,
          blockTime: sigInfo.blockTime ?? null,
        });
      }

      await sleep(400);
    }

    opts.onProgress?.(
      `Page ${page}: ${launches.size} creates found (${scanned} sigs scanned)`,
    );

    if (oldestTime != null && oldestTime < cutoff) break;
    await sleep(200);
  }

  return [...launches.values()].sort(
    (a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0),
  );
}

export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]!);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}
