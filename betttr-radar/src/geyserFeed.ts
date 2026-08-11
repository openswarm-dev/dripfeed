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
} from './liveStore.js';

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

export async function startGeyserFeed() {
  const seen = new Set<string>();
  console.log(`  Geyser live: ${config.geyserEndpoint}`);

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

      console.log('  Geyser connected — streaming all pump.fun creates\n');
      setGeyserConnected(true);

      stream.on('data', (data: any) => {
        if (data?.ping != null) {
          stream.write(pingReply(data.ping.id ?? 1), () => {});
          return;
        }
        if (data?.pong != null) return;

        const txWrap = data?.transaction;
        if (!txWrap?.transaction) return;

        recordGeyserPumpTx();

        const parsed = parsePumpCreateGeyser(txWrap);
        if (!parsed) return;
        recordCreateParsed();
        if (seen.has(parsed.mint)) return;
        seen.add(parsed.mint);

        const blockTime = Math.floor(Date.now() / 1000);
        const launch = minimalLaunch({ ...parsed, blockTime });
        addLaunch(launch);

        console.log(
          `[live] ${launch.isCreateV2 ? 'V2' : 'V1'} ${launch.symbol ?? launch.name ?? launch.mint.slice(0, 8)}…`,
        );

        void enrichLaunchLive({ ...parsed, blockTime }, (partial) => {
          updateLaunch(partial);
        }).then((enriched) => {
          updateLaunch(enriched);
        }).catch(() => {});
      });

      stream.on('error', (err: Error) => {
        setGeyserConnected(false);
        const msg = err.message;
        if (msg.includes('PERMISSION_DENIED')) {
          console.error('Geyser stream error:', msg, '— Helius LaserStream requires a paid plan, or use ERPC with IP whitelist');
        } else if (msg.includes('ETIMEDOUT') || msg.includes('UNAVAILABLE')) {
          console.error('Geyser stream error:', msg, '— whitelist Railway egress IP in ERPC dashboard');
        } else {
          console.error('Geyser stream error:', msg);
        }
      });

      await new Promise<void>((resolve) => stream.on('close', resolve));
    } catch (err: any) {
      setGeyserConnected(false);
      console.error('Geyser reconnect in 3s:', err?.message ?? err);
      await sleep(3000);
    }
  }
}
