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

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function loadPersistedState(): PersistedState | null {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const data = JSON.parse(raw) as PersistedState;
    if (!Array.isArray(data.launches)) return null;
    return data;
  } catch {
    return null;
  }
}

export function schedulePersist(
  launches: LaunchRecord[],
  sparks: SocialSpark[],
  liveLaunches: number,
) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const payload: PersistedState = {
        launches: launches.slice(0, 5000),
        sparks: sparks.slice(0, 200),
        liveLaunches,
        savedAt: Date.now(),
      };
      const tmp = `${STATE_FILE}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, STATE_FILE);
    } catch (err) {
      console.warn('[persist] save failed:', (err as Error).message);
    }
  }, 1500);
}
