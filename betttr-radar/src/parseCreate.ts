import bs58 from 'bs58';
import { PUMP_PROGRAM } from './config.js';

export interface ParsedLaunch {
  signature: string;
  slot: number;
  blockTime: number | null;
  mint: string;
  creator: string;
  isCreateV2: boolean;
  name?: string;
  symbol?: string;
  metadataUri?: string;
  image?: string;
}

// Discriminators from pump.fun IDL (confirmed correct)
const CREATE_V1_DISC = Buffer.from([24, 30, 200, 40, 5, 28, 7, 119]);
const CREATE_V2_DISC = Buffer.from([214, 144, 76, 236, 95, 139, 49, 180]);

function toBase58(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  try {
    if (raw instanceof Uint8Array) return bs58.encode(raw);
    if (Buffer.isBuffer(raw)) return bs58.encode(new Uint8Array(raw));
    if (Array.isArray(raw)) return bs58.encode(Uint8Array.from(raw as number[]));
  } catch { /* ignore */ }
  return null;
}

function toBuffer(raw: unknown): Buffer | null {
  if (!raw) return null;
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof Uint8Array) return Buffer.from(raw);
  if (Array.isArray(raw)) return Buffer.from(Uint8Array.from(raw as number[]));
  return null;
}

function readString(buf: Buffer, offset: number): { value: string; next: number } | null {
  if (offset + 4 > buf.length) return null;
  const len = buf.readUInt32LE(offset);
  if (len === 0 || len > 512 || offset + 4 + len > buf.length) return null;
  return { value: buf.toString('utf8', offset + 4, offset + 4 + len).trim(), next: offset + 4 + len };
}

function decodeCreateArgs(data: Buffer): { name?: string; symbol?: string; metadataUri?: string } {
  let offset = 8; // skip 8-byte discriminator
  const name = readString(data, offset);
  if (!name) return {};
  offset = name.next;
  const symbol = readString(data, offset);
  if (!symbol) return {};
  offset = symbol.next;
  const uri = readString(data, offset);
  return {
    name: name.value || undefined,
    symbol: symbol.value || undefined,
    metadataUri: uri?.value || undefined,
  };
}

/**
 * Parse a Geyser transaction update for a pump.fun create.
 *
 * Field names confirmed by live ERPC meta key audit:
 *   message: { accountKeys, instructions, addressTableLookups, ... }
 *   meta:    { postTokenBalances, innerInstructions, loadedWritableAddresses,
 *              loadedReadonlyAddresses, logMessages, ... }
 *   ix:      { programIdIndex, accounts, data }
 *
 * Strategy:
 *  1. Find the create instruction by discriminator (raw bytes, no JSON encode).
 *  2. Decode name/symbol/uri from Borsh-serialised instruction data.
 *  3. Get mint from postTokenBalances[0].mint (Shyft approach, most reliable).
 *     Fall back to ix.accounts[0] → accountKeys lookup.
 *  4. Creator = accountKeys[0] (fee payer / wallet).
 */
export function parsePumpCreateGeyser(
  transactionUpdate: any,
): Omit<ParsedLaunch, 'blockTime'> | null {
  const slot = Number(transactionUpdate?.slot);
  if (!Number.isFinite(slot)) return null;

  const txInfo = transactionUpdate?.transaction;   // SubscribeUpdateTransactionInfo
  const tx = txInfo?.transaction;                  // Transaction
  const message = tx?.message;                     // Message
  const meta = txInfo?.meta;                       // TransactionStatusMeta

  if (!message) return null;

  // Build full account key list (static + ALT-resolved)
  const rawKeys: unknown[] = message.accountKeys ?? [];
  const accountKeys: string[] = rawKeys.map((k) => toBase58(k) ?? '').filter(Boolean);
  const loadedWritable: unknown[] = meta?.loadedWritableAddresses ?? [];
  const loadedReadonly: unknown[] = meta?.loadedReadonlyAddresses ?? [];
  for (const k of [...loadedWritable, ...loadedReadonly]) {
    const s = toBase58(k);
    if (s) accountKeys.push(s);
  }

  const creator = accountKeys[0] ?? '';

  const sigRaw = tx?.signatures?.[0];
  const signature = toBase58(sigRaw) ?? '';
  if (!signature) return null;

  // All instructions (top-level + inner)
  const innerGroups: any[] = meta?.innerInstructions ?? [];
  const allIxs: any[] = [
    ...(message.instructions ?? []),
    ...innerGroups.flatMap((g: any) => g.instructions ?? []),
  ];

  // Find the pump create instruction
  for (const ix of allIxs) {
    if (accountKeys[ix.programIdIndex] !== PUMP_PROGRAM) continue;

    const data = toBuffer(ix.data);
    if (!data || data.length < 8) continue;

    const disc = data.subarray(0, 8);
    const isV1 = disc.equals(CREATE_V1_DISC);
    const isV2 = disc.equals(CREATE_V2_DISC);
    if (!isV1 && !isV2) continue;

    // Decode name/symbol/uri from Borsh data
    const args = decodeCreateArgs(data);

    // Mint: prefer postTokenBalances[0].mint (most reliable per Shyft docs)
    const postBals: any[] = meta?.postTokenBalances ?? [];
    let mint: string | null = null;
    if (postBals.length > 0) {
      const m = postBals[0]?.mint;
      mint = typeof m === 'string' ? m : toBase58(m);
    }
    // Fallback: use ix.accounts[0] → accountKeys
    if (!mint) {
      const ixAccounts: number[] = Array.isArray(ix.accounts) ? ix.accounts : [];
      mint = accountKeys[ixAccounts[0]] ?? null;
    }
    // Last resort: find first key ending in 'pump'
    if (!mint) {
      mint = accountKeys.find((k) => k.endsWith('pump') && k !== creator) ?? null;
    }

    if (!mint) continue;

    return {
      signature,
      slot,
      mint,
      creator,
      isCreateV2: isV2,
      name: args.name,
      symbol: args.symbol,
      metadataUri: args.metadataUri,
    };
  }

  return null;
}

/** Parse a confirmed RPC transaction response for a Pump.fun create. */
export function parsePumpCreateTx(tx: any): Omit<ParsedLaunch, 'blockTime'> | null {
  if (!tx?.meta || tx.meta.err) return null;
  const logs: string[] = tx.meta.logMessages ?? [];
  const hasCreate = logs.some(
    (l) =>
      l.includes('Instruction: Create') ||
      l.includes('Instruction: CreateV2') ||
      l.includes('InitializeMint2'),
  );
  if (!hasCreate) return null;

  const msg = tx.transaction?.message;
  const keys: string[] = [];
  for (const k of msg?.accountKeys ?? msg?.staticAccountKeys ?? []) {
    const s = typeof k === 'string' ? k : toBase58(k);
    if (s) keys.push(s);
  }
  const loaded = tx.meta?.loadedAddresses;
  if (loaded) {
    for (const k of [...(loaded.writable ?? []), ...(loaded.readonly ?? [])]) {
      const s = typeof k === 'string' ? k : toBase58(k);
      if (s) keys.push(s);
    }
  }

  const creator = keys[0] ?? '';
  const mint = keys.find((k) => k.endsWith('pump') && k !== creator) ?? null;
  if (!mint) return null;

  const sigRaw = tx.transaction?.signatures?.[0];
  const signature = typeof sigRaw === 'string' ? sigRaw : (toBase58(sigRaw) ?? '');
  if (!signature) return null;

  const isCreateV2 = logs.some((l) => l.includes('Instruction: CreateV2'));
  return { signature, slot: Number(tx.slot ?? 0), mint, creator, isCreateV2 };
}
