#!/usr/bin/env node
import { config, ensureDataDir, validateConfig } from './config.js';
import { fetchRecentLaunches } from './fetchLaunches.js';
import { enrichLaunches } from './enrich.js';
import { buildReport, printReportSummary, saveReport, loadLatestReport } from './report.js';
import { classifyFromMint } from './classify.js';
import { analyzeAttention, printAttentionPulse } from './attention.js';
import { analyzeMetas } from './metaEngine.js';
import { runGeyserLive } from './geyserLive.js';

function parseArgs() {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? 'scan';
  const get = (flag: string, fallback: string) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] ?? fallback : fallback;
  };
  return {
    cmd,
    days: parseInt(get('--days', String(config.scanDays)), 10),
    maxPages: parseInt(get('--pages', String(config.maxSignaturePages)), 10),
    maxCreates: parseInt(get('--max-creates', '800'), 10),
    windowMin: parseInt(get('--window', '60'), 10),
  };
}

async function runScan(days: number, maxPages: number, maxCreates: number) {
  console.log(`Scanning Pump.fun creates (last ${days} days, up to ${maxCreates} tokens)…`);
  if (config.heliusApiKey) {
    console.log('Using Helius enhanced tx API for historical creates.\n');
  } else {
    console.log('Note: Geyser gRPC is live-only — historical scan uses HTTP RPC.\n');
  }

  const raw = await fetchRecentLaunches({
    days,
    maxPages,
    maxCreates,
    onProgress: (msg) => console.log(msg),
  });

  console.log(`\nFound ${raw.length} creates. Enriching metadata + classifying narratives…`);

  const enriched = await enrichLaunches(
    raw.slice(0, 400),
    config.enrichConcurrency,
    (done, total) => {
      if (done % 25 === 0 || done === total) {
        process.stdout.write(`\r  Enriched ${done}/${total}`);
      }
    },
  );

  const classifiedRest = raw.slice(400).map((l) => ({
    ...l,
    name: undefined,
    symbol: undefined,
    narratives: classifyFromMint(l.mint).narratives,
    primaryNarrative: classifyFromMint(l.mint).primaryNarrative,
    narrativeScore: classifyFromMint(l.mint).narrativeScore,
  }));

  const allEnriched = [...enriched, ...classifiedRest];
  console.log('\n');

  const attention = analyzeAttention(allEnriched, 60);
  const metas = analyzeMetas(allEnriched, Math.max(days, 4));
  const report = buildReport(allEnriched, days, attention, metas);
  const path = saveReport(report);
  printReportSummary(report);
  printAttentionPulse(attention);
  console.log(`Saved: ${path}`);
  console.log(`View report: npm run dev → http://localhost:${config.port}\n`);
}

async function main() {
  validateConfig();
  ensureDataDir();
  const { cmd, days, maxPages, maxCreates, windowMin } = parseArgs();

  if (cmd === 'live') {
    await runGeyserLive();
    return;
  }

  if (cmd === 'pulse') {
    const report = loadLatestReport();
    if (!report) {
      console.error('No report yet — run: npm run scan');
      process.exit(1);
    }
    const pulse = analyzeAttention(report.launches, windowMin);
    printAttentionPulse(pulse);
    return;
  }

  if (cmd === 'report') {
    const report = loadLatestReport();
    if (!report) {
      console.error('No report yet — run: npm run scan');
      process.exit(1);
    }
    printReportSummary(report);
    return;
  }

  if (cmd === 'scan') {
    await runScan(days, maxPages, maxCreates);
    return;
  }

  console.log(`Usage:
  npm run scan [-- --days 3] [-- --pages 80]   Backfill last N days via RPC
  npm run live                                  Stream new creates via Geyser gRPC
  npm run pulse [-- --window 60]               Trader attention / psychology from latest scan
  npm run dev                                   Open HTML report UI`);
}

main().catch((err) => {
  console.error('Fatal:', err?.message ?? err);
  process.exit(1);
});
