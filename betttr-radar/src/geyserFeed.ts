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


/** If no pump txs at all for this long, the stream is dead — reconnect. */
const SILENCE_MS = 60_000;
/** If pump txs flow but zero creates for this long, something is wrong — reconnect. */
const STALE_CREATE_MS = 120_000;
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

// CREATE discriminators from pump.fun IDL
const CREATE_V1_DISC = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);
const CREATE_V2_DISC = Buffer.from([214, 144, 76, 236, 95, 139, 49, 180]);

/**
 * Pre-filter: check for create discriminator in raw instruction bytes.
 * This is cheap (no JSON serialisation) and eliminates >95% of buys/sells.
 * We deliberately do NOT gate on postTokenBalances here — some creates may
 * have it empty at PROCESSED commitment before token accounts are updated.
 */
function looksLikeCreate(txWrap: any): boolean {
  const message = txWrap?.transaction?.transaction?.message;
  if (!message) return false;
  const meta = txWrap?.transaction?.meta;
  const innerGroups: any[] = meta?.innerInstructions ?? meta?.inner_instructions ?? [];
  const allIxs = [
    ...(message.instructions ?? []),
    ...innerGroups.flatMap((g: any) => g.instructions ?? []),
  ];
  for (const ix of allIxs) {
    if (!ix.data) continue;
    const buf = ix.data instanceof Uint8Array ? ix.data
      : Buffer.isBuffer(ix.data) ? ix.data
      : Array.isArray(ix.data) ? Uint8Array.from(ix.data as number[])
      : null;
    if (!buf || buf.length < 8) continue;
    const disc = Buffer.from(buf.subarray(0, 8));
    if (disc.equals(CREATE_V1_DISC) || disc.equals(CREATE_V2_DISC)) return true;
  }
  return false;
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

      console.log('  ERPC Geyser connected ÔÇö streaming pump.fun creates\n');
      setGeyserConnected(true);

      let forceReconnect: (() => void) | null = null;
      const watchdog = setInterval(() => {
        if (closed) return;
        const silentPump = Date.now() - lastPumpTxAt;
        const silentCreates = Date.now() - lastCreateAt;
        if (silentPump >= SILENCE_MS) {
          console.warn(`[geyser] ${Math.round(silentPump / 1000)}s no pump txs — stream dead, reconnecting`);
          try { stream?.destroy?.(); } catch { /* ignore */ }
          forceReconnect?.();
          return;
        }
        if (silentCreates >= STALE_CREATE_MS && pumpTxSinceCreate >= 40) {
          console.warn(
            `[geyser] ERPC stale: ${Math.round(silentCreates / 1000)}s without creates ` +
              `(${pumpTxSinceCreate} pump txs) — forcing reconnect`,
          );
          try { stream?.destroy?.(); } catch { /* ignore */ }
          forceReconnect?.();
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

        // Fast pre-filter: skip txs that definitely aren't creates
        if (!looksLikeCreate(txWrap)) return;

        const parsed = parsePumpCreateGeyser(txWrap);
        if (!parsed) return;
        recordCreateParsed();
        lastCreateAt = Date.now();
        pumpTxSinceCreate = 0;

        if (seen.has(parsed.mint)) return;
        seen.add(parsed.mint);
        if (seen.size > 20_000) {
          const drop = [...seen].slice(0, 5_000);
          for (const m of drop) seen.delete(m);
        }

        const blockTime = Math.floor(Date.now() / 1000);
        const launch = minimalLaunch({ ...parsed, blockTime });
        addLaunch(launch);

        console.log(
          `[live] ${launch.isCreateV2 ? 'V2' : 'V1'} ${launch.symbol ?? launch.name ?? launch.mint.slice(0, 8)}ÔÇª`,
        );

        void enrichLaunchLive({ ...parsed, blockTime }, (partial) => {
          updateLaunch(partial, { soft: true });
        }).then((enriched) => {
          updateLaunch(enriched);
        }).catch(() => {});
      });

      await new Promise<void>((resolve) => {
        const done = () => {
          if (closed) return;
          closed = true;
          clearInterval(watchdog);
          resolve();
        };
        forceReconnect = done;

        stream.on('error', (err: Error) => {
          setGeyserConnected(false);
          const msg = err.message;
          if (msg.includes('PERMISSION_DENIED')) {
            console.error('ERPC Geyser error:', msg, '— check X_TOKEN / IP whitelist on erpc.global');
          } else if (msg.includes('ETIMEDOUT') || msg.includes('UNAVAILABLE') || msg.includes('DATA_LOSS')) {
            console.error('ERPC Geyser error:', msg, '— reconnecting');
          } else {
            console.error('ERPC Geyser error:', msg);
          }
          done();
        });

        stream.on('close', done);
        stream.on('end', done);
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
      `[geyser] resubscribing ERPC (seen ${stats.pumpTxSeen} pump txs, ${stats.createsStored} creates)ÔÇª`,
    );
    await sleep(1500);
  }
}
