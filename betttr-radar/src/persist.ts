import fs from 'node:fs';
import path from 'node:path';
import type { LaunchRecord } from './fetchLaunches.js';
import type { SocialSpark } from './socialSpark.js';
import { ensureRadarSchema, getPool } from './db.js';

export interface PersistedState {
  launches: LaunchRecord[];
  sparks: SocialSpark[];
  liveLaunches: number;
  savedAt: number;
}

const DATA_DIR = process.env.RADAR_DATA_DIR?.trim() || path.join(process.cwd(), 'data');
const STATE_FILE = path.join(DATA_DIR, 'live-state.json');

const DEBOUNCE_MS = 5_000;
const MAX_WAIT_MS = 20_000;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirtySince = 0;
let pending: PersistedState | null = null;
let dbEnabled = false;
let dbSaving = false;
/** After postgres timeouts, cool down so create ingest stays hot. */
let dbCooldownUntil = 0;

export async function initPersist(): Promise<void> {
  dbEnabled = await ensureRadarSchema();
}

function loadFromFile(): PersistedState | null {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const data = JSON.parse(raw) as PersistedState;
    if (!Array.isArray(data.launches)) return null;
    console.log(`[persist] loaded ${data.launches.length} launches from ${STATE_FILE}`);
    return data;
  } catch {
    return null;
  }
}

export function loadPersistedState(): PersistedState | null {
  const file = loadFromFile();
  if (file) return file;
  console.log(`[persist] no existing state at ${STATE_FILE}`);
  return null;
}

/** Load latest snapshot from Railway Postgres (preferred when available). */
export async function hydrateFromDb(): Promise<PersistedState | null> {
  await ensureRadarSchema();
  const pool = getPool();
  if (!pool) return null;
  try {
    const [launchesRes, sparksRes, kvRes] = await Promise.all([
      pool.query<{ data: LaunchRecord }>(
        `SELECT data FROM radar_launches ORDER BY block_time DESC NULLS LAST LIMIT 5000`,
      ),
      pool.query<{ data: SocialSpark }>(
        `SELECT data FROM radar_sparks ORDER BY received_at DESC NULLS LAST LIMIT 200`,
      ),
      pool.query<{ value: { liveLaunches?: number; savedAt?: number } }>(
        `SELECT value FROM radar_kv WHERE key = 'live_meta' LIMIT 1`,
      ),
    ]);
    const launches = launchesRes.rows.map((r) => r.data).filter(Boolean);
    if (!launches.length) {
      console.log('[persist] postgres empty — keeping file/report seed');
      return null;
    }
    const sparks = sparksRes.rows.map((r) => r.data).filter(Boolean);
    const meta = kvRes.rows[0]?.value ?? {};
    console.log(`[persist] hydrated ${launches.length} launches + ${sparks.length} sparks from Postgres`);
    return {
      launches,
      sparks,
      liveLaunches: meta.liveLaunches ?? launches.length,
      savedAt: meta.savedAt ?? Date.now(),
    };
  } catch (err) {
    console.warn('[persist] postgres load failed:', (err as Error).message);
    return null;
  }
}

function saveToFile(payload: PersistedState) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    // Cap file snapshot — sync stringify of 5k rows blocked the event loop for seconds.
    const slim: PersistedState = {
      ...payload,
      launches: payload.launches.slice(0, 800),
      sparks: payload.sparks.slice(0, 100),
    };
    void fs.promises
      .writeFile(tmp, JSON.stringify(slim))
      .then(() => fs.promises.rename(tmp, STATE_FILE))
      .catch((err) => console.warn('[persist] file save failed:', (err as Error).message));
  } catch (err) {
    console.warn('[persist] file save failed:', (err as Error).message);
  }
}

async function saveToDb(payload: PersistedState) {
  if (!dbEnabled || dbSaving) return;
  if (Date.now() < dbCooldownUntil) return;
  const pool = getPool();
  if (!pool) return;
  dbSaving = true;
  try {
    // Upsert newest launches only (keep writes light over the public proxy).
    const launches = payload.launches.slice(0, 400);
    for (let i = 0; i < launches.length; i += 50) {
      const chunk = launches.slice(i, i + 50);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      chunk.forEach((l, idx) => {
        const o = idx * 3;
        placeholders.push(`($${o + 1}, $${o + 2}::jsonb, $${o + 3})`);
        values.push(l.mint, JSON.stringify(l), l.blockTime ?? null);
      });
      await pool.query(
        `INSERT INTO radar_launches (mint, data, block_time)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (mint) DO UPDATE SET
           data = EXCLUDED.data,
           block_time = CASE
             WHEN radar_launches.block_time IS NULL THEN EXCLUDED.block_time
             WHEN EXCLUDED.block_time IS NULL THEN radar_launches.block_time
             ELSE LEAST(radar_launches.block_time, EXCLUDED.block_time)
           END,
           updated_at = NOW()`,
        values,
      );
    }

    const sparks = payload.sparks.slice(0, 100);
    if (sparks.length) {
      const values: unknown[] = [];
      const placeholders: string[] = [];
      sparks.forEach((s, idx) => {
        const o = idx * 3;
        placeholders.push(`($${o + 1}, $${o + 2}::jsonb, $${o + 3})`);
        values.push(s.id, JSON.stringify(s), s.receivedAt ?? null);
      });
      await pool.query(
        `INSERT INTO radar_sparks (id, data, received_at)
         VALUES ${placeholders.join(',')}
         ON CONFLICT (id) DO UPDATE SET
           data = EXCLUDED.data,
           received_at = EXCLUDED.received_at,
           updated_at = NOW()`,
        values,
      );
    }

    await pool.query(
      `INSERT INTO radar_kv (key, value, updated_at)
       VALUES ('live_meta', $1::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify({ liveLaunches: payload.liveLaunches, savedAt: payload.savedAt })],
    );
  } catch (err) {
    dbCooldownUntil = Date.now() + 90_000;
    console.warn('[persist] postgres save failed (cooldown 90s):', (err as Error).message);
  } finally {
    dbSaving = false;
  }
}

function flush() {
  saveTimer = null;
  dirtySince = 0;
  if (!pending) return;
  const payload = pending;
  pending = null;
  saveToFile(payload);
  void saveToDb(payload).catch((err) => {
    console.warn('[persist] postgres save rejected:', (err as Error).message);
  });
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
