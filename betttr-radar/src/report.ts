import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDataDir } from './config.js';
import { narrativeLabel, NARRATIVE_RULES } from './classify.js';
import type { LaunchRecord } from './fetchLaunches.js';
import type { AttentionPulse } from './attention.js';
import type { MetaDashboard } from './metaEngine.js';

export interface ScanReport {
  generatedAt: string;
  days: number;
  totalLaunches: number;
  narrativeSummary: Array<{ id: string; label: string; count: number; pct: number }>;
  topNarratives: Array<{ id: string; label: string; count: number }>;
  attention?: AttentionPulse;
  metas?: MetaDashboard;
  launches: LaunchRecord[];
}

export function buildReport(
  launches: LaunchRecord[],
  days: number,
  attention?: AttentionPulse,
  metas?: MetaDashboard,
): ScanReport {
  const counts = new Map<string, number>();
  for (const l of launches) {
    counts.set(l.primaryNarrative, (counts.get(l.primaryNarrative) ?? 0) + 1);
  }

  const narrativeSummary = [...counts.entries()]
    .map(([id, count]) => ({
      id,
      label: narrativeLabel(id),
      count,
      pct: launches.length ? Math.round((count / launches.length) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    generatedAt: new Date().toISOString(),
    days,
    totalLaunches: launches.length,
    narrativeSummary,
    topNarratives: narrativeSummary.slice(0, 8),
    attention,
    metas,
    launches,
  };
}

export function saveReport(report: ScanReport): string {
  ensureDataDir();
  const stamp = new Date().toISOString().slice(0, 10);
  const jsonPath = path.join(config.dataDir, `scan-${stamp}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(config.dataDir, 'latest.json'), JSON.stringify(report, null, 2));
  return jsonPath;
}

export function loadLatestReport(): ScanReport | null {
  const p = path.join(config.dataDir, 'latest.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as ScanReport;
}

export function printReportSummary(report: ScanReport) {
  console.log('\n═══════════════════════════════════════════');
  console.log(`  NARRA — Pump.fun launches (last ${report.days}d)`);
  console.log('═══════════════════════════════════════════\n');
  console.log(`Total creates found: ${report.totalLaunches}`);
  console.log(`Generated: ${report.generatedAt}\n`);
  console.log('Narrative breakdown:');
  for (const row of report.narrativeSummary) {
    const bar = '█'.repeat(Math.max(1, Math.round(row.pct / 5)));
    console.log(`  ${row.label.padEnd(28)} ${String(row.count).padStart(5)}  ${row.pct.toFixed(1)}%  ${bar}`);
  }

  console.log('\nSample tokens by top narrative:');
  for (const top of report.topNarratives.slice(0, 5)) {
    const samples = report.launches
      .filter((l) => l.primaryNarrative === top.id)
      .slice(0, 3);
    if (samples.length === 0) continue;
    console.log(`\n  ${top.label}:`);
    for (const s of samples) {
      const label = s.symbol || s.name || s.mint.slice(0, 8);
      console.log(`    · ${label} — ${s.mint}`);
    }
  }
  console.log('');
}

export function narrativeColors(): Record<string, string> {
  const palette = [
    '#14f195', '#5b8def', '#f5a623', '#ff4d6a', '#c084fc',
    '#22d3ee', '#fb7185', '#a3e635', '#f472b6', '#94a3b8', '#64748b',
  ];
  const map: Record<string, string> = { other: '#64748b' };
  NARRATIVE_RULES.forEach((r, i) => {
    map[r.id] = palette[i % palette.length]!;
  });
  return map;
}
