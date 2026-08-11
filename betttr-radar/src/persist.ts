import fs from 'node:fs';
import path from 'node:path';
import type { LaunchRecord } from './fetchLaunches.js';
import type { SocialSpark } from './socialSpark.js';

export interface PersistedState {
  launches: LaunchRecord[];
  sparks: SocialSpark[];
  liveLaunches: number;
  savedAt: number;
}

const DATA_DIR = process.env.RADAR_DATA_DIR?.trim() || path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'live-state.json');

const DEBOUNCE_MS = 2_000;
const MAX_WAIT_MS = 10_000;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirtySince = 0;
let pending: PersistedState | null = null;

export function loadPersistedState(): PersistedState | null {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const data = JSON.parse(raw) as PersistedState;
    if (!Array.isArray(data.launches)) return null;
    console.log(`[persist] loaded ${data.launches.length} launches from ${STATE_FILE}`);
    return data;
  } catch {
    console.log(`[persist] no existing state at ${STATE_FILE}`);
    return null;
  }
}

function flush() {
  saveTimer = null;
  dirtySince = 0;
  if (!pending) return;
  const payload = pending;
  pending = null;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, STATE_FILE);
  } catch (err) {
    console.warn('[persist] save failed:', (err as Error).message);
  }
}

/** Debounced persist with a max wait so continuous live updates still flush. */
export function schedulePersist(
  launches: LaunchRecord[],
  sparks: SocialSpark[],
  liveLaunches: number,
) {
  const now = Date.now();
  pending = {
    launches: launches.slice(0, 5000),
    sparks: sparks.slice(0, 200),
    liveLaunches,
    savedAt: now,
  };
  if (!dirtySince) dirtySince = now;

  if (saveTimer) clearTimeout(saveTimer);
  const elapsed = now - dirtySince;
  const wait = elapsed >= MAX_WAIT_MS ? 0 : Math.min(DEBOUNCE_MS, MAX_WAIT_MS - elapsed);
  saveTimer = setTimeout(flush, wait);
}

/** Force a save now (e.g. interval backup / shutdown). */
export function flushPersist() {
  if (saveTimer) clearTimeout(saveTimer);
  flush();
}
