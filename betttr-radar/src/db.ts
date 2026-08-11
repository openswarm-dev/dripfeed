import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let ready: Promise<boolean> | null = null;

export function databaseUrl(): string | null {
  const url =
    process.env.DATABASE_PUBLIC_URL?.trim()
    || process.env.DATABASE_URL?.trim()
    || null;
  if (!url) return null;
  // Prefer public proxy from Hetzner — skip railway.internal unless we're on Railway.
  if (url.includes('railway.internal') && !process.env.RAILWAY_ENVIRONMENT) {
    return process.env.DATABASE_PUBLIC_URL?.trim() || null;
  }
  return url;
}

export function getPool(): pg.Pool | null {
  const url = databaseUrl();
  if (!url) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: url,
      ssl: url.includes('localhost') || url.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false },
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 12_000,
    });
    pool.on('error', (err) => {
      console.warn('[db] pool error:', err.message);
    });
  }
  return pool;
}

export async function ensureRadarSchema(): Promise<boolean> {
  if (ready) return ready;
  ready = (async () => {
    const p = getPool();
    if (!p) {
      console.log('[db] no DATABASE_URL / DATABASE_PUBLIC_URL — file persist only');
      return false;
    }
    try {
      await p.query(`
        CREATE TABLE IF NOT EXISTS radar_launches (
          mint TEXT PRIMARY KEY,
          data JSONB NOT NULL,
          block_time BIGINT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS radar_launches_block_time_idx
          ON radar_launches (block_time DESC NULLS LAST);

        CREATE TABLE IF NOT EXISTS radar_sparks (
          id TEXT PRIMARY KEY,
          data JSONB NOT NULL,
          received_at BIGINT,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS radar_kv (
          key TEXT PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      console.log('[db] Railway Postgres ready (radar_* tables)');
      return true;
    } catch (err) {
      console.warn('[db] schema init failed:', (err as Error).message);
      return false;
    }
  })();
  return ready;
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    ready = null;
  }
}
