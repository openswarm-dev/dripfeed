import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDataDir, PUMP_PROGRAM } from './config.js';
import { parsePumpCreateGeyser } from './parseCreate.js';
import { enrichLaunch } from './enrich.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** Live Geyser stream — collects new creates going forward (no historical backfill). */
export async function runGeyserLive() {
  ensureDataDir();
  const outPath = path.join(config.dataDir, 'live-launches.jsonl');
  const seen = new Set<string>();

  console.log(`Geyser live: ${config.geyserEndpoint}`);
  console.log(`Watching Pump.fun creates → ${outPath}`);
  console.log('(Geyser is real-time only — run `npm run scan` for 2-4 day history)\n');

  const client = new Client(config.geyserEndpoint, config.geyserToken, {
    'grpc.keepalive_time_ms': 15_000,
    'grpc.keepalive_timeout_ms': 5_000,
    'grpc.keepalive_permit_without_calls': 1,
  });

  while (true) {
    try {
      const stream = await client.subscribeOnce(
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

      console.log('Connected to Geyser\n');

      stream.on('data', async (data: any) => {
        if (data?.ping != null) {
          stream.write(pingReply(data.ping.id ?? 1), () => {});
          return;
        }
        if (data?.pong != null) return;

        const txWrap = data?.transaction;
        if (!txWrap?.transaction) return;

        const parsed = parsePumpCreateGeyser(txWrap);
        if (!parsed) return;
        if (seen.has(parsed.mint)) return;
        seen.add(parsed.mint);

        const enriched = await enrichLaunch({
          ...parsed,
          blockTime: Math.floor(Date.now() / 1000),
        });

        const line = JSON.stringify(enriched);
        fs.appendFileSync(outPath, line + '\n');
        console.log(
          `[${new Date().toISOString()}] ${enriched.symbol ?? '?'} · ${enriched.primaryNarrative} · ${enriched.mint}`,
        );
      });

      stream.on('error', (err: Error) => {
        console.error('Geyser stream error:', err.message);
      });

      await new Promise<void>((resolve) => stream.on('close', resolve));
    } catch (err: any) {
      console.error('Geyser reconnect in 3s:', err?.message ?? err);
      await sleep(3000);
    }
  }
}
