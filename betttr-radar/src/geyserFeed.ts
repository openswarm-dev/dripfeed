import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import { config, PUMP_PROGRAM } from './config.js';
import { parsePumpCreateGeyser } from './parseCreate.js';
import { enrichLaunchLive } from './enrich.js';
import { classifyNarratives } from './classify.js';
import type { LaunchRecord } from './fetchLaunches.js';
import {
  setGeyserConnected,
  addLaunch,
  updateLaunch,
  recordGeyserPumpTx,
  recordCreateParsed,
  getState,
} from './liveStore.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** If pump txs keep flowing but no create parses for this long, force ERPC reconnect. */
const STALE_CREATE_MS = 90_000;
const WATCHDOG_MS = 15_000;

function pingReply(id = 1) {
  return {
    accounts: {},
    slots: {},
    transactions: {},
    transactionsStatus: {},
    blocks: {},
    blocksMeta: {},
    entry: {},
    accountsDataSlice: [],
    ping: { id },
  };
}

function minimalLaunch(parsed: {
  signature: string;
  slot: number;
  mint: string;
  creator: string;
  isCreateV2: boolean;
  blockTime: number;
  name?: string;
  symbol?: string;
  metadataUri?: string;
  image?: string;
}): LaunchRecord {
  const cls = classifyNarratives({
    name: parsed.name,
    symbol: parsed.symbol,
    mint: parsed.mint,
  });
  return {
    ...parsed,
    narratives: cls.narratives,
    primaryNarrative: cls.primaryNarrative,
    narrativeScore: cls.narrativeScore,
  };
}

function cheapLogs(txWrap: any): string[] {
  const meta =
    txWrap?.transaction?.meta
    ?? txWrap?.meta
    ?? null;
  const logs = meta?.logMessages ?? meta?.log_messages ?? [];
  return Array.isArray(logs) ? logs : [];
}

const CREATE_V2_DISC = Buffer.from([0xd6, 0x90, 0x4c, 0xec, 0x5f, 0x8b, 0x31, 0xb4]);
const CREATE_V1_DISC = Buffer.from([0x18, 0x1e, 0xc8, 0x28, 0x05, 0x1c, 0x07, 0x77]);

function decodeIxDataCheap(raw: unknown): Buffer | null {
  if (!raw) return null;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  if (Array.isArray(raw)) return Buffer.from(raw as number[]);
  if (typeof raw === 'string') {
    try {
      return Buffer.from(raw, 'base64');
    } catch {
      return null;
    }
  }
  return null;
}

/** Scan compiled ix bytes for pump create discriminators (works when logs are truncated). */
function rawHasCreateDisc(txWrap: any): boolean {
  const message =
    txWrap?.transaction?.transaction?.message
    ?? txWrap?.transaction?.message
    ?? txWrap?.message;
  const ixs = message?.instructions ?? message?.compiledInstructions ?? [];
  if (!Array.isArray(ixs)) return false;
  for (const ix of ixs) {
    const data = decodeIxDataCheap(ix?.data);
    if (!data || data.length < 8) continue;
    const disc = data.subarray(0, 8);
    if (disc.equals(CREATE_V2_DISC) || disc.equals(CREATE_V1_DISC)) return true;
  }
  return false;
}

let geyserRejects = 0;
let geyserFullParses = 0;
let geyserCreates = 0;
let geyserParseNull = 0;
setInterval(() => {
  if (!geyserRejects && !geyserFullParses) return;
  console.log(
    `[geyser] 10s: reject=${geyserRejects} parse=${geyserFullParses} null=${geyserParseNull} creates=${geyserCreates}`,
  );
  geyserRejects = 0;
  geyserFullParses = 0;
  geyserParseNull = 0;
  geyserCreates = 0;
}, 10_000);

function shouldFullParse(txWrap: any): boolean {
  const logs = cheapLogs(txWrap);
  if (!logs.length) return true;
  if (logs.some((l) => l.includes('Instruction: CreateV2'))) return true;
  if (
    logs.some(
      (l) =>
        l.includes('Instruction: Create')
        && !l.includes('CreateV2')
        && !l.includes('CreateIdempotent')
        && !l.includes('CreateMetadataAccount'),
    )
  ) {
    return true;
  }
  // Only scan raw discs when logs look empty of trade noise — avoids expensive
  // false full-parses on buys that stall the create stream.
  const looksLikeTrade = logs.some(
    (l) =>
      l.includes('Instruction: Buy')
      || l.includes('Instruction: Sell')
      || l.includes('Instruction: GetFees'),
  );
  if (looksLikeTrade) return false;
  return rawHasCreateDisc(txWrap);
}

export async function startGeyserFeed() {
  const seen = new Set<string>();
  console.log(`  Geyser live (ERPC): ${config.geyserEndpoint}`);

  while (true) {
    let stream: any = null;
    let lastCreateAt = Date.now();
    let lastPumpTxAt = Date.now();
    let pumpTxSinceCreate = 0;
    let closed = false;

    try {
      const client = new Client(config.geyserEndpoint, config.geyserToken, {
        'grpc.keepalive_time_ms': 10_000,
        'grpc.keepalive_timeout_ms': 5_000,
        'grpc.keepalive_permit_without_calls': 1,
        'grpc.http2.min_time_between_pings_ms': 10_000,
      });

      stream = await client.subscribeOnce(
        {},
        {},
        {
          pump_creates: {
            vote: false,
            failed: false,
            accountInclude: [PUMP_PROGRAM],
            accountExclude: [],
            accountRequired: [],
          },
        },
        {},
        {},
        {},
        {},
        CommitmentLevel.PROCESSED,
        [],
      );

      console.log('  ERPC Geyser connected — streaming pump.fun creates\n');
      setGeyserConnected(true);

      const watchdog = setInterval(() => {
        if (closed) return;
        const silentCreates = Date.now() - lastCreateAt;
        const recentPump = Date.now() - lastPumpTxAt < 30_000;
        if (recentPump && silentCreates >= STALE_CREATE_MS && pumpTxSinceCreate >= 40) {
          console.warn(
            `[geyser] ERPC stale: ${Math.round(silentCreates / 1000)}s without creates ` +
              `(${pumpTxSinceCreate} pump txs) — forcing reconnect`,
          );
          try {
            stream?.destroy?.() || stream?.end?.() || stream?.cancel?.();
          } catch {
            /* ignore */
          }
        }
      }, WATCHDOG_MS);

      stream.on('data', (data: any) => {
        if (data?.ping != null) {
          stream.write(pingReply(data.ping.id ?? 1), () => {});
          return;
        }
        if (data?.pong != null) return;

        const txWrap = data?.transaction;
        if (!txWrap?.transaction) return;

        recordGeyserPumpTx();
        lastPumpTxAt = Date.now();
        pumpTxSinceCreate += 1;

        // Cheap reject: only full-parse creates (logs or raw create discriminator).
        if (!shouldFullParse(txWrap)) {
          geyserRejects += 1;
          return;
        }

        geyserFullParses += 1;
        const parsed = parsePumpCreateGeyser(txWrap);
        if (!parsed) {
          geyserParseNull += 1;
          return;
        }
        recordCreateParsed();
        geyserCreates += 1;
        lastCreateAt = Date.now();
        pumpTxSinceCreate = 0;

        const already = seen.has(parsed.mint);
        if (!already) {
          seen.add(parsed.mint);
          if (seen.size > 20_000) {
            const drop = [...seen].slice(0, 5_000);
            for (const m of drop) seen.delete(m);
          }

          const slot = Number(txWrap?.slot ?? parsed.slot ?? 0);
          const rawBt =
            txWrap?.blockTime
            ?? txWrap?.block_time
            ?? txWrap?.transaction?.blockTime
            ?? txWrap?.transaction?.block_time
            ?? null;
          let blockTime = Math.floor(Date.now() / 1000);
          if (typeof rawBt === 'number' && Number.isFinite(rawBt) && rawBt > 1_000_000_000) {
            blockTime = rawBt > 1e12 ? Math.floor(rawBt / 1000) : Math.floor(rawBt);
          }
          const launch = minimalLaunch({
            ...parsed,
            slot: Number.isFinite(slot) ? slot : parsed.slot,
            blockTime,
          });
          // Skip if store already has it (gap-fill may have landed first).
          if (getState().launches.some((l) => l.mint === parsed.mint)) {
            void enrichLaunchLive({ ...parsed, blockTime }, (partial) => {
              updateLaunch(partial, { soft: true });
            }).then((enriched) => {
              updateLaunch(enriched, { soft: true });
            }).catch(() => {});
            return;
          }
          addLaunch(launch);

          console.log(
            `[live] ${launch.isCreateV2 ? 'V2' : 'V1'} ${launch.symbol ?? launch.name ?? launch.mint.slice(0, 8)}…`,
          );

          void enrichLaunchLive({ ...parsed, blockTime }, (partial) => {
            updateLaunch(partial, { soft: true });
          }).then((enriched) => {
            updateLaunch(enriched, { soft: true });
          }).catch(() => {});
          return;
        }

        // Already stored (possibly as a blank false-positive earlier): patch name/image if we have them.
        if (parsed.name || parsed.symbol || parsed.metadataUri) {
          const blockTime = Math.floor(Date.now() / 1000);
          void enrichLaunchLive({ ...parsed, blockTime }, (partial) => {
            updateLaunch(partial, { soft: true });
          }).then((enriched) => {
            updateLaunch(enriched, { soft: true });
          }).catch(() => {});
        }
      });

      stream.on('error', (err: Error) => {
        setGeyserConnected(false);
        const msg = err.message;
        if (msg.includes('PERMISSION_DENIED')) {
          console.error('ERPC Geyser error:', msg, '— check X_TOKEN / IP whitelist on erpc.global');
        } else if (msg.includes('ETIMEDOUT') || msg.includes('UNAVAILABLE')) {
          console.error('ERPC Geyser error:', msg, '— endpoint unreachable, retrying');
        } else {
          console.error('ERPC Geyser error:', msg);
        }
      });

      await new Promise<void>((resolve) => {
        stream.on('close', () => {
          closed = true;
          clearInterval(watchdog);
          resolve();
        });
      });
    } catch (err: any) {
      setGeyserConnected(false);
      console.error('ERPC Geyser reconnect in 3s:', err?.message ?? err);
      await sleep(3000);
    } finally {
      setGeyserConnected(false);
      try {
        stream?.destroy?.() || stream?.end?.();
      } catch {
        /* ignore */
      }
    }

    // Brief pause before resubscribe so we don't spin.
    const stats = getState().geyserStats;
    console.log(
      `[geyser] resubscribing ERPC (seen ${stats.pumpTxSeen} pump txs, ${stats.createsStored} creates)…`,
    );
    await sleep(1500);
  }
}
