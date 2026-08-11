/**
 * Auth + Turnkey wallet HTTP handlers for Hetzner betttr-radar.
 * Mirror of vrsz wallet flows, adapted to username/password accounts.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  createAccountWithWallet,
  loginWithPassword,
  usernameAvailable,
  getUserById,
  getWalletForUser,
  getExportPasswordHash,
  setExportPasswordHash,
} from './authStore.js';
import { signToken, bearerUser } from './jwt.js';
import {
  hashPassword,
  verifyPassword,
  validatePassword,
} from './passwords.js';
import {
  exportWalletAccountBundle,
  turnkeyConfigured,
  SubOrgServerKeyMissingError,
} from './turnkey.js';
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { subOrgTurnkeyClient } from './turnkey.js';

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function requireUser(req: IncomingMessage, res: ServerResponse) {
  const user = bearerUser(req);
  if (!user) {
    json(res, 401, { error: 'Missing or invalid auth token' });
    return null;
  }
  return user;
}

/** Prefer Helius for wallet balance reads when HELIUS_API_KEY is set. */
function heliusOrRpcUrl(): string {
  const heliusKey = process.env.HELIUS_API_KEY?.trim();
  if (heliusKey) return `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;
  return rpcUrl();
}

function rpcUrl(): string {
  const heliusKey = process.env.HELIUS_API_KEY?.trim();
  return (
    process.env.SOLANA_RPC_URL?.trim()
    || process.env.HELIUS_RPC_URL?.trim()
    || (heliusKey ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}` : '')
    || 'https://api.mainnet-beta.solana.com'
  );
}

/** Fast balance via raw JSON-RPC — avoids flaky/slow @solana/web3.js Connection. */
const balanceCache = new Map<string, { lamports: number; at: number }>();
const walletCache = new Map<string, { wallet: Awaited<ReturnType<typeof getWalletForUser>>; at: number }>();
const BALANCE_TTL_MS = 30_000;
const WALLET_TTL_MS = 5 * 60_000;

async function cachedWallet(userId: string) {
  const hit = walletCache.get(userId);
  if (hit && Date.now() - hit.at < WALLET_TTL_MS) return hit.wallet;
  const wallet = await getWalletForUser(userId);
  walletCache.set(userId, { wallet, at: Date.now() });
  return wallet;
}

async function fetchSolBalanceLamports(address: string): Promise<number | null> {
  if (!address || address.startsWith('DEV')) return null;
  const cached = balanceCache.get(address);
  if (cached && Date.now() - cached.at < BALANCE_TTL_MS) return cached.lamports;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1800);
  try {
    const res = await fetch(heliusOrRpcUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBalance',
        params: [address],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return cached?.lamports ?? null;
    const data = (await res.json()) as { result?: { value?: number } };
    const value = data.result?.value;
    if (typeof value !== 'number') return cached?.lamports ?? null;
    balanceCache.set(address, { lamports: value, at: Date.now() });
    return value;
  } catch {
    return cached?.lamports ?? null;
  } finally {
    clearTimeout(timer);
  }
}

export async function handleAuthApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
): Promise<boolean> {
  // GET /api/auth/username-available?u=
  if (url.startsWith('/api/auth/username-available') && req.method === 'GET') {
    try {
      const q = new URL(url, 'http://local').searchParams.get('u') ?? '';
      const available = q.trim() ? await usernameAvailable(q) : false;
      json(res, 200, { available, username: q.trim() });
    } catch (err) {
      json(res, 500, { error: (err as Error).message });
    }
    return true;
  }

  // POST /api/auth/register  { username, password }
  if (url === '/api/auth/register' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const created = await createAccountWithWallet({
        username: body.username,
        password: body.password,
      });
      const token = signToken({
        userId: created.user.id,
        username: created.user.username,
      });
      json(res, 201, {
        token,
        user: created.user,
        wallet: { address: created.wallet.address, createdAt: created.wallet.createdAt },
        turnkeyConfigured: turnkeyConfigured() && !created.devMode,
        devMode: created.devMode,
      });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return true;
  }

  // POST /api/auth/login  { username, password }
  if (url === '/api/auth/login' && req.method === 'POST') {
    try {
      const body = await readJson(req);
      const result = await loginWithPassword({
        username: body.username,
        password: body.password,
      });
      const token = signToken({
        userId: result.user.id,
        username: result.user.username,
      });
      json(res, 200, {
        token,
        user: result.user,
        wallet: result.wallet
          ? { address: result.wallet.address, createdAt: result.wallet.createdAt }
          : null,
        turnkeyConfigured: turnkeyConfigured(),
      });
    } catch (err) {
      json(res, 401, { error: (err as Error).message });
    }
    return true;
  }

  // GET /api/auth/me
  if (url === '/api/auth/me' && req.method === 'GET') {
    const auth = requireUser(req, res);
    if (!auth) return true;
    const user = await getUserById(auth.userId);
    const wallet = await cachedWallet(auth.userId);
    if (!user) {
      json(res, 404, { error: 'User not found' });
      return true;
    }
    const balanceLamports = wallet ? await fetchSolBalanceLamports(wallet.address) : null;
    json(res, 200, {
      user,
      wallet: wallet
        ? { address: wallet.address, createdAt: wallet.createdAt }
        : null,
      balanceLamports,
      balanceSol: balanceLamports != null ? balanceLamports / LAMPORTS_PER_SOL : null,
      turnkeyConfigured: turnkeyConfigured(),
    });
    return true;
  }

  return false;
}

export async function handleWalletApi(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
): Promise<boolean> {
  // GET /api/wallet/balance  (Helius raw RPC — ~50–100ms)
  if ((url === '/api/wallet/balance' || url === '/api/wallet/deposit') && req.method === 'GET') {
    const auth = requireUser(req, res);
    if (!auth) return true;
    const wallet = await cachedWallet(auth.userId);
    if (!wallet) {
      json(res, 404, { error: 'No wallet for this account' });
      return true;
    }
    const balanceLamports = await fetchSolBalanceLamports(wallet.address);
    json(res, 200, {
      address: wallet.address,
      balanceLamports,
      balanceSol: balanceLamports != null ? balanceLamports / LAMPORTS_PER_SOL : null,
      rpc: 'helius',
    });
    return true;
  }

  // GET /api/wallet/export-password
  if (url === '/api/wallet/export-password' && req.method === 'GET') {
    const auth = requireUser(req, res);
    if (!auth) return true;
    const hash = await getExportPasswordHash(auth.userId);
    json(res, 200, { configured: Boolean(hash) });
    return true;
  }

  // POST /api/wallet/export-password  { password }
  if (url === '/api/wallet/export-password' && req.method === 'POST') {
    const auth = requireUser(req, res);
    if (!auth) return true;
    try {
      const body = await readJson(req);
      const err = validatePassword(body.password ?? '');
      if (err) {
        json(res, 400, { error: err });
        return true;
      }
      const hash = await hashPassword(body.password);
      await setExportPasswordHash(auth.userId, hash);
      json(res, 200, { ok: true });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return true;
  }

  // POST /api/wallet/export  { password, targetPublicKey }
  if (url === '/api/wallet/export' && req.method === 'POST') {
    const auth = requireUser(req, res);
    if (!auth) return true;
    try {
      const body = await readJson(req);
      const stored = await getExportPasswordHash(auth.userId);
      const ok = await verifyPassword(body.password ?? '', stored);
      if (!ok) {
        json(res, 401, { error: 'Invalid export password' });
        return true;
      }
      const wallet = await getWalletForUser(auth.userId);
      if (!wallet) {
        json(res, 404, { error: 'No wallet' });
        return true;
      }
      if (!body.targetPublicKey) {
        json(res, 400, { error: 'targetPublicKey required (from Turnkey iframe)' });
        return true;
      }
      const bundle = await exportWalletAccountBundle({
        subOrgId: wallet.turnkeySubOrgId,
        walletId: wallet.turnkeyWalletId,
        address: wallet.address,
        targetPublicKey: body.targetPublicKey,
      });
      json(res, 200, {
        exportBundle: bundle.exportBundle,
        organizationId: bundle.organizationId,
        address: wallet.address,
      });
    } catch (err) {
      const status = err instanceof SubOrgServerKeyMissingError ? 409 : 400;
      json(res, status, { error: (err as Error).message });
    }
    return true;
  }

  // POST /api/wallet/withdraw  { to, amountSol }
  if (url === '/api/wallet/withdraw' && req.method === 'POST') {
    const auth = requireUser(req, res);
    if (!auth) return true;
    try {
      const body = await readJson(req);
      const wallet = await getWalletForUser(auth.userId);
      if (!wallet) {
        json(res, 404, { error: 'No wallet' });
        return true;
      }
      if (wallet.address.startsWith('DEV')) {
        json(res, 400, { error: 'Dev wallet cannot withdraw — configure TURNKEY_* on Hetzner' });
        return true;
      }

      const to = String(body.to ?? '').trim();
      const amountSol = Number(body.amountSol);
      if (!to || !Number.isFinite(amountSol) || amountSol <= 0) {
        json(res, 400, { error: 'Provide to (address) and amountSol > 0' });
        return true;
      }

      const conn = new Connection(rpcUrl(), 'confirmed');
      const fromPk = new PublicKey(wallet.address);
      const toPk = new PublicKey(to);
      const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
      const tx = new Transaction({
        feePayer: fromPk,
        blockhash,
        lastValidBlockHeight,
      }).add(
        SystemProgram.transfer({
          fromPubkey: fromPk,
          toPubkey: toPk,
          lamports,
        }),
      );

      const serialized = tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      const unsignedHex = Buffer.from(serialized).toString('hex');

      const api = subOrgTurnkeyClient(wallet.turnkeySubOrgId);
      const signed = await api.signTransaction({
        organizationId: wallet.turnkeySubOrgId,
        signWith: wallet.address,
        unsignedTransaction: unsignedHex,
        type: 'TRANSACTION_TYPE_SOLANA',
      });

      const signedTx = signed.signedTransaction;
      if (!signedTx) throw new Error('Turnkey returned no signed transaction');

      // Turnkey returns hex-encoded signed tx for Solana
      const raw = Buffer.from(signedTx, 'hex');
      const sig = await conn.sendRawTransaction(raw, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');

      json(res, 200, { signature: sig, amountSol, to });
    } catch (err) {
      json(res, 400, { error: (err as Error).message });
    }
    return true;
  }

  return false;
}
