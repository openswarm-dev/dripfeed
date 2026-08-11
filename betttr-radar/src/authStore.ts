import { randomUUID } from 'node:crypto';
import { getPool, ensureRadarSchema } from './db.js';
import {
  hashPassword,
  verifyPassword,
  validateUsername,
  validatePassword,
} from './passwords.js';
import { provisionCustodialWallet } from './turnkey.js';

export type BetttrUser = {
  id: string;
  username: string;
  createdAt: string;
};

export type BetttrWallet = {
  address: string;
  turnkeySubOrgId: string;
  turnkeyWalletId: string;
  createdAt: string;
};

export async function ensureAuthSchema(): Promise<boolean> {
  const ok = await ensureRadarSchema();
  if (!ok) return false;
  const p = getPool();
  if (!p) return false;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS betttr_users (
        id UUID PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        export_password_hash TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS betttr_users_username_lower_idx
        ON betttr_users (LOWER(username));

      CREATE TABLE IF NOT EXISTS betttr_wallets (
        user_id UUID PRIMARY KEY REFERENCES betttr_users(id) ON DELETE CASCADE,
        turnkey_sub_org_id TEXT NOT NULL,
        turnkey_wallet_id TEXT NOT NULL,
        address TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    console.log('[db] Betttr auth tables ready (betttr_users / betttr_wallets)');
    return true;
  } catch (err) {
    console.warn('[db] auth schema init failed:', (err as Error).message);
    return false;
  }
}

export async function usernameAvailable(username: string): Promise<boolean> {
  const p = getPool();
  if (!p) throw new Error('Database not configured');
  const res = await p.query(
    `SELECT 1 FROM betttr_users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
    [username.trim()],
  );
  return res.rowCount === 0;
}

export async function createAccountWithWallet(input: {
  username: string;
  password: string;
}): Promise<{ user: BetttrUser; wallet: BetttrWallet; devMode: boolean }> {
  const userErr = validateUsername(input.username);
  if (userErr) throw new Error(userErr);
  const passErr = validatePassword(input.password);
  if (passErr) throw new Error(passErr);

  const username = input.username.trim();
  if (!(await usernameAvailable(username))) {
    throw new Error('Username is already taken');
  }

  const p = getPool();
  if (!p) throw new Error('Database not configured');

  const id = randomUUID();
  const passwordHash = await hashPassword(input.password);
  // Same password unlocks key export initially (vrsz-style export password).
  const exportHash = passwordHash;

  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO betttr_users (id, username, password_hash, export_password_hash)
       VALUES ($1, $2, $3, $4)`,
      [id, username, passwordHash, exportHash],
    );

    const provisioned = await provisionCustodialWallet(id, username);
    await client.query(
      `INSERT INTO betttr_wallets (user_id, turnkey_sub_org_id, turnkey_wallet_id, address)
       VALUES ($1, $2, $3, $4)`,
      [id, provisioned.turnkeySubOrgId, provisioned.turnkeyWalletId, provisioned.address],
    );
    await client.query('COMMIT');

    return {
      user: { id, username, createdAt: new Date().toISOString() },
      wallet: {
        address: provisioned.address,
        turnkeySubOrgId: provisioned.turnkeySubOrgId,
        turnkeyWalletId: provisioned.turnkeyWalletId,
        createdAt: new Date().toISOString(),
      },
      devMode: provisioned.devMode,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function loginWithPassword(input: {
  username: string;
  password: string;
}): Promise<{ user: BetttrUser; wallet: BetttrWallet | null }> {
  const p = getPool();
  if (!p) throw new Error('Database not configured');

  const res = await p.query(
    `SELECT id, username, password_hash, created_at
     FROM betttr_users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
    [input.username.trim()],
  );
  const row = res.rows[0] as
    | { id: string; username: string; password_hash: string; created_at: Date }
    | undefined;
  if (!row) throw new Error('Invalid username or password');

  const ok = await verifyPassword(input.password, row.password_hash);
  if (!ok) throw new Error('Invalid username or password');

  const wallet = await getWalletForUser(row.id);
  return {
    user: {
      id: row.id,
      username: row.username,
      createdAt: new Date(row.created_at).toISOString(),
    },
    wallet,
  };
}

export async function getWalletForUser(userId: string): Promise<BetttrWallet | null> {
  const p = getPool();
  if (!p) return null;
  const res = await p.query(
    `SELECT address, turnkey_sub_org_id, turnkey_wallet_id, created_at
     FROM betttr_wallets WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  const row = res.rows[0] as
    | {
        address: string;
        turnkey_sub_org_id: string;
        turnkey_wallet_id: string;
        created_at: Date;
      }
    | undefined;
  if (!row) return null;
  return {
    address: row.address,
    turnkeySubOrgId: row.turnkey_sub_org_id,
    turnkeyWalletId: row.turnkey_wallet_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function getUserById(userId: string): Promise<BetttrUser | null> {
  const p = getPool();
  if (!p) return null;
  const res = await p.query(
    `SELECT id, username, created_at FROM betttr_users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const row = res.rows[0] as { id: string; username: string; created_at: Date } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function getExportPasswordHash(userId: string): Promise<string | null> {
  const p = getPool();
  if (!p) return null;
  const res = await p.query(
    `SELECT export_password_hash FROM betttr_users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  return (res.rows[0] as { export_password_hash: string | null } | undefined)?.export_password_hash
    ?? null;
}

export async function setExportPasswordHash(userId: string, hash: string): Promise<void> {
  const p = getPool();
  if (!p) throw new Error('Database not configured');
  await p.query(
    `UPDATE betttr_users SET export_password_hash = $2, updated_at = NOW() WHERE id = $1`,
    [userId, hash],
  );
}
