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

let geyserRejects = 0;
let geyserFullParses = 0;
let geyserCreates = 0;
setInterval(() => {
  if (!geyserRejects && !geyserFullParses) return;
  console.log(
    `[geyser] 10s: reject=${geyserRejects} parse=${geyserFullParses} creates=${geyserCreates}`,
  );
  geyserRejects = 0;
  geyserFullParses = 0;
  geyserCreates = 0;
}, 10_000);

function shouldFullParse(logs: string[]): boolean {
  // No logs → may need discriminator fallback.
  if (!logs.length) return true;
  // Only spend CPU when logs look like a create.
  return logs.some(
    (l) =>
      l.includes('Instruction: Create')
      || l.includes('Instruction: CreateV2')
      || l.includes('InitializeMint2'),
  );
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

        // Cheap reject: only full-parse creates (or txs with no logs).
        const logs = cheapLogs(txWrap);
        if (!shouldFullParse(logs)) {
          geyserRejects += 1;
          return;
        }

        geyserFullParses += 1;
        const parsed = parsePumpCreateGeyser(txWrap);
        if (!parsed) return;
        recordCreateParsed();
        geyserCreates += 1;
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
          `[live] ${launch.isCreateV2 ? 'V2' : 'V1'} ${launch.symbol ?? launch.name ?? launch.mint.slice(0, 8)}…`,
        );

        void enrichLaunchLive({ ...parsed, blockTime }, (partial) => {
          updateLaunch(partial, { soft: true });
        }).then((enriched) => {
          updateLaunch(enriched);
        }).catch(() => {});
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
