import { randomUUID } from 'node:crypto';
import { getPool, ensureRadarSchema } from './db.js';

export type DeployedToken = {
  id: string;
  userId: string;
  mint: string;
  name: string;
  symbol: string;
  image?: string | null;
  metadataUri?: string | null;
  signature: string;
  buySol: number;
  mayhem: boolean;
  metaId?: string | null;
  metaTheme?: string | null;
  createdAt: string;
};

export async function ensureDeploySchema(): Promise<boolean> {
  const ok = await ensureRadarSchema();
  if (!ok) return false;
  const p = getPool();
  if (!p) return false;
  await p.query(`
    CREATE TABLE IF NOT EXISTS betttr_deploys (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES betttr_users(id) ON DELETE CASCADE,
      mint TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      symbol TEXT NOT NULL,
      image TEXT,
      metadata_uri TEXT,
      signature TEXT NOT NULL,
      buy_sol DOUBLE PRECISION NOT NULL DEFAULT 0,
      mayhem BOOLEAN NOT NULL DEFAULT FALSE,
      meta_id TEXT,
      meta_theme TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS betttr_deploys_user_idx ON betttr_deploys (user_id, created_at DESC);
  `);
  return true;
}

export async function recordDeploy(input: {
  userId: string;
  mint: string;
  name: string;
  symbol: string;
  image?: string | null;
  metadataUri?: string | null;
  signature: string;
  buySol: number;
  mayhem?: boolean;
  metaId?: string | null;
  metaTheme?: string | null;
}): Promise<DeployedToken> {
  const p = getPool();
  if (!p) throw new Error('Database unavailable');
  const id = randomUUID();
  const res = await p.query(
    `INSERT INTO betttr_deploys
      (id, user_id, mint, name, symbol, image, metadata_uri, signature, buy_sol, mayhem, meta_id, meta_theme)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING id, user_id, mint, name, symbol, image, metadata_uri, signature, buy_sol, mayhem, meta_id, meta_theme, created_at`,
    [
      id,
      input.userId,
      input.mint,
      input.name,
      input.symbol,
      input.image ?? null,
      input.metadataUri ?? null,
      input.signature,
      input.buySol,
      Boolean(input.mayhem),
      input.metaId ?? null,
      input.metaTheme ?? null,
    ],
  );
  const row = res.rows[0] as any;
  return mapRow(row);
}

export async function listDeploysForUser(userId: string): Promise<DeployedToken[]> {
  const p = getPool();
  if (!p) return [];
  const res = await p.query(
    `SELECT id, user_id, mint, name, symbol, image, metadata_uri, signature, buy_sol, mayhem, meta_id, meta_theme, created_at
     FROM betttr_deploys WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [userId],
  );
  return res.rows.map(mapRow);
}

function mapRow(row: any): DeployedToken {
  return {
    id: row.id,
    userId: row.user_id,
    mint: row.mint,
    name: row.name,
    symbol: row.symbol,
    image: row.image,
    metadataUri: row.metadata_uri,
    signature: row.signature,
    buySol: Number(row.buy_sol),
    mayhem: Boolean(row.mayhem),
    metaId: row.meta_id,
    metaTheme: row.meta_theme,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
