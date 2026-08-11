import { Connection, PublicKey } from '@solana/web3.js';
import { config, getHeavyRpcUrl, getRpcUrl, PUMP_PROGRAM } from './config.js';
import { parsePumpCreateTx } from './parseCreate.js';
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

/** HTTP RPC polling fallback when Geyser gRPC is unavailable (e.g. Railway egress not IP-whitelisted). */
export async function startRpcPollFeed() {
  const readConn = new Connection(getRpcUrl(), 'confirmed');
  const txConn = new Connection(getHeavyRpcUrl(), 'confirmed');
  const program = new PublicKey(PUMP_PROGRAM);
  const seenSigs = new Set<string>();
  const seenMints = new Set<string>();
  let bootstrapped = false;

  console.log('  RPC poll: watching pump.fun creates (Geyser fallback)\n');
  setGeyserConnected(true);

  while (true) {
    try {
      const sigs = await readConn.getSignaturesForAddress(program, { limit: 25 });
      if (!bootstrapped) {
        for (const s of sigs) seenSigs.add(s.signature);
        bootstrapped = true;
        await sleep(2500);
        continue;
      }

      const fresh = [];
      for (const s of sigs) {
        if (seenSigs.has(s.signature)) break;
        fresh.push(s);
        seenSigs.add(s.signature);
      }

      if (fresh.length) {
        const txs = await txConn.getTransactions(
          fresh.map((s) => s.signature),
          { maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
        );

        for (let i = 0; i < txs.length; i++) {
          const tx = txs[i];
          const sigInfo = fresh[i];
          if (!tx || !sigInfo) continue;

          recordGeyserPumpTx();
          const parsed = parsePumpCreateTx(tx);
          if (!parsed) continue;
          recordCreateParsed();
          if (seenMints.has(parsed.mint)) continue;
          seenMints.add(parsed.mint);

          const blockTime = sigInfo.blockTime ?? Math.floor(Date.now() / 1000);
          const launch = minimalLaunch({ ...parsed, blockTime });
          addLaunch(launch);

          console.log(
            `[poll] ${launch.isCreateV2 ? 'V2' : 'V1'} ${launch.symbol ?? launch.name ?? launch.mint.slice(0, 8)}…`,
          );

          void enrichLaunchLive({ ...parsed, blockTime }, (partial) => {
            updateLaunch(partial);
          }).then((enriched) => {
            updateLaunch(enriched);
          }).catch(() => {});
        }
      }
    } catch (err: any) {
      setGeyserConnected(false);
      console.error('RPC poll error:', err?.message ?? err);
    }

    await sleep(2500);
  }
}
