import bs58 from 'bs58';
import { txEncode } from '@triton-one/yellowstone-grpc';
import { PUMP_PROGRAM } from './config.js';

const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

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

const CREATE_MARKERS = [
  'Instruction: Create',
  'Instruction: CreateV2',
  'Program log: Instruction: Create',
];

function encodeKey(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (raw instanceof Uint8Array || Array.isArray(raw)) {
    return bs58.encode(Uint8Array.from(raw as Iterable<number>));
  }
  return null;
}

function isPumpCreate(logs: string[]): boolean {
  return logs.some(
    (line) =>
      CREATE_MARKERS.some((m) => line.includes(m)) ||
      line.includes('InitializeMint2'),
  );
}

function isCreateV2(logs: string[]): boolean {
  return logs.some((line) => line.includes('Instruction: CreateV2'));
}

function extractMint(keys: string[], creator: string): string | null {
  const pumpMint = keys.find((k) => typeof k === 'string' && k.endsWith('pump') && k !== creator);
  if (pumpMint) return pumpMint;

  const skip = new Set([
    creator,
    PUMP_PROGRAM,
    '11111111111111111111111111111111',
    TOKEN_PROGRAM_ID,
    TOKEN_2022_PROGRAM_ID,
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
    'SysvarRent111111111111111111111111111111111',
    'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',
    'Ce6TQqeHC9p8KetsN6JsjHK7Uxc7n1kf1cBHZMW4GsLL',
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rG5H9iBE8tyRWNh',
  ]);

  for (const key of keys) {
    if (!skip.has(key) && key.length >= 32) return key;
  }
  return null;
}

function parseEncodedGeyserTx(txInfo: any): {
  signature: string;
  keys: string[];
  logs: string[];
  creator: string;
} | null {
  try {
    const parsed = txEncode.encode(txInfo, txEncode.encoding.Json, 0, false) as any;
    const signature = parsed?.transaction?.signatures?.[0];
    if (!signature) return null;

    const message = parsed.transaction?.message;
    const keys: string[] = (message?.accountKeys ?? []).map((k: unknown) =>
      typeof k === 'string' ? k : (k as { pubkey?: string })?.pubkey ?? String(k),
    );

    const loaded = message?.loadedAddresses;
    if (loaded) {
      keys.push(...(loaded.writable ?? []), ...(loaded.readonly ?? []));
    }

    const logs: string[] = parsed.meta?.logMessages ?? [];
    return { signature, keys, logs, creator: keys[0] ?? '' };
  } catch {
    return null;
  }
}

function parseRawGeyserTx(transactionUpdate: any): {
  signature: string;
  keys: string[];
  logs: string[];
  creator: string;
} | null {
  const txInfo = transactionUpdate?.transaction;
  if (!txInfo) return null;

  const meta = txInfo?.meta ?? txInfo?.transaction?.meta;
  const logs: string[] = meta?.logMessages ?? meta?.log_messages ?? [];

  const message = txInfo?.transaction?.message ?? txInfo?.message;
  const keys: string[] = [];
  const rawKeys = message?.accountKeys ?? message?.staticAccountKeys ?? [];
  for (const key of rawKeys) {
    const normalized = normalizeKey(key);
    if (normalized) keys.push(normalized);
  }

  const loaded = meta?.loadedAddresses;
  if (loaded) {
    for (const key of [...(loaded.writable ?? []), ...(loaded.readonly ?? [])]) {
      const normalized = normalizeKey(key);
      if (normalized) keys.push(normalized);
    }
  }

  const signature =
    encodeKey(txInfo?.signature ?? transactionUpdate?.signature) ?? '';
  if (!signature) return null;

  return { signature, keys, logs, creator: keys[0] ?? '' };
}

const CREATE_V2_DISC = Buffer.from([0xd6, 0x90, 0x4c, 0xec, 0x5f, 0x8b, 0x31, 0xb4]);
const CREATE_V1_DISC = Buffer.from([0x18, 0x1e, 0xc8, 0x28, 0x05, 0x1c, 0x07, 0x77]);

function decodeIxData(raw: unknown): Buffer | null {
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      const buf = Buffer.from(bs58.decode(raw));
      if (buf.length >= 8) return buf;
    } catch {
      /* fall through */
    }
    try {
      return Buffer.from(raw, 'base64');
    } catch {
      return null;
    }
  }
  if (raw instanceof Uint8Array) {
    return Buffer.from(raw);
  }
  if (Array.isArray(raw)) {
    return Buffer.from(raw as number[]);
  }
  return null;
}

function readAnchorString(buf: Buffer, offset: number): { value: string; offset: number } | null {
  if (offset + 4 > buf.length) return null;
  const len = buf.readUInt32LE(offset);
  offset += 4;
  if (len <= 0 || len > 512 || offset + len > buf.length) return null;
  return { value: buf.toString('utf8', offset, offset + len), offset: offset + len };
}

function parsePumpMetadataFromInstruction(
  ix: any,
  accountKeys: string[],
): { name?: string; symbol?: string; metadataUri?: string } {
  const programId = accountKeys[ix.programIdIndex];
  if (programId !== PUMP_PROGRAM) return {};

  const data = decodeIxData(ix.data);
  if (!data || data.length < 12) return {};

  const disc = data.subarray(0, 8);
  if (!disc.equals(CREATE_V2_DISC) && !disc.equals(CREATE_V1_DISC)) return {};

  let offset = 8;
  const name = readAnchorString(data, offset);
  if (!name) return {};
  offset = name.offset;
  const symbol = readAnchorString(data, offset);
  if (!symbol) return {};
  offset = symbol.offset;
  const uri = readAnchorString(data, offset);

  return {
    name: name.value.trim() || undefined,
    symbol: symbol.value.trim() || undefined,
    metadataUri: uri?.value.trim() || undefined,
  };
}

function parsePumpMetadataFromInstructions(
  message: any,
  accountKeys: string[],
): { name?: string; symbol?: string; metadataUri?: string } {
  const instructions: any[] = message?.instructions ?? message?.compiledInstructions ?? [];
  for (const ix of instructions) {
    const meta = parsePumpMetadataFromInstruction(ix, accountKeys);
    if (meta.name || meta.symbol) return meta;
  }
  return {};
}

function parsePumpMetadataFromTx(txInfo: any): { name?: string; symbol?: string; metadataUri?: string } {
  try {
    const parsed = txEncode.encode(txInfo, txEncode.encoding.Json, 0, false) as any;
    const message = parsed?.transaction?.message;
    if (!message) return {};

    const accountKeys: string[] = (message.accountKeys ?? []).map((k: unknown) =>
      typeof k === 'string' ? k : (k as { pubkey?: string })?.pubkey ?? String(k),
    );
    const loaded = message.loadedAddresses;
    if (loaded) {
      accountKeys.push(...(loaded.writable ?? []), ...(loaded.readonly ?? []));
    }

    const top = parsePumpMetadataFromInstructions(message, accountKeys);
    if (top.name || top.symbol) return top;

    const innerGroups: any[] = parsed.meta?.innerInstructions ?? [];
    for (const group of innerGroups) {
      for (const ix of group.instructions ?? []) {
        const meta = parsePumpMetadataFromInstruction(ix, accountKeys);
        if (meta.name || meta.symbol) return meta;
      }
    }

    return {};
  } catch {
    return {};
  }
}

function normalizeKey(key: unknown): string | null {
  if (typeof key === 'string') return key;
  if (key && typeof key === 'object' && 'toBase58' in key && typeof (key as any).toBase58 === 'function') {
    return (key as { toBase58: () => string }).toBase58();
  }
  if (key && typeof key === 'object' && 'pubkey' in key) {
    return String((key as { pubkey: unknown }).pubkey);
  }
  return encodeKey(key);
}

function accountKeysFromTx(tx: any): string[] {
  const message = tx.transaction?.message;
  if (!message) return [];

  if (typeof message.getAccountKeys === 'function') {
    try {
      const loaded = tx.meta?.loadedAddresses;
      const keyMeta = loaded
        ? message.getAccountKeys({
            accountKeysFromLookups: {
              writable: (loaded.writable ?? []).map((k: unknown) =>
                typeof k === 'string' ? k : normalizeKey(k),
              ).filter(Boolean),
              readonly: (loaded.readonly ?? []).map((k: unknown) =>
                typeof k === 'string' ? k : normalizeKey(k),
              ).filter(Boolean),
            },
          })
        : message.getAccountKeys();

      const segments = keyMeta.keySegments?.() ?? [
        keyMeta.staticAccountKeys ?? [],
        ...(keyMeta.accountKeysFromLookups
          ? [keyMeta.accountKeysFromLookups.writable, keyMeta.accountKeysFromLookups.readonly]
          : []),
      ];

      const keys: string[] = [];
      for (const segment of segments) {
        for (const key of segment) {
          const normalized = normalizeKey(key);
          if (normalized) keys.push(normalized);
        }
      }
      if (keys.length > 0) return keys;
    } catch {
      /* fall back to manual parse */
    }
  }

  const keys: string[] = [];
  const raw = message.accountKeys ?? message.staticAccountKeys ?? [];
  for (const key of raw) {
    const normalized = normalizeKey(key);
    if (normalized) keys.push(normalized);
  }

  const loaded = tx.meta?.loadedAddresses;
  if (loaded) {
    for (const key of [...(loaded.writable ?? []), ...(loaded.readonly ?? [])]) {
      const normalized = normalizeKey(key);
      if (normalized) keys.push(normalized);
    }
  }
  return keys;
}

/** Parse a Geyser transaction update for any Pump.fun create. */
export function parsePumpCreateGeyser(transactionUpdate: any): Omit<ParsedLaunch, 'blockTime'> | null {
  const slot = Number(transactionUpdate?.slot);
  if (!Number.isFinite(slot)) return null;

  const txInfo = transactionUpdate?.transaction;
  if (!txInfo) return null;

  const parsed =
    parseEncodedGeyserTx(txInfo) ?? parseRawGeyserTx(transactionUpdate);
  if (!parsed) return null;
  if (!isPumpCreate(parsed.logs)) return null;

  const mint = extractMint(parsed.keys, parsed.creator);
  if (!mint) return null;

  const meta = parsePumpMetadataFromTx(txInfo);

  return {
    signature: parsed.signature,
    slot,
    mint,
    creator: parsed.creator,
    isCreateV2: isCreateV2(parsed.logs),
    name: meta.name,
    symbol: meta.symbol,
    metadataUri: meta.metadataUri,
  };
}
/** Parse a confirmed RPC transaction response for a Pump.fun create. */
export function parsePumpCreateTx(tx: any): Omit<ParsedLaunch, 'blockTime'> | null {
  if (!tx?.meta || tx.meta.err) return null;

  const logs: string[] = tx.meta.logMessages ?? [];
  if (!isPumpCreate(logs)) return null;

  const keys = accountKeysFromTx(tx);
  const creator = keys[0] ?? '';
  const mint = extractMint(keys, creator);
  if (!mint) return null;

  const sigRaw = tx.transaction?.signatures?.[0];
  const signature =
    typeof sigRaw === 'string' ? sigRaw : encodeKey(sigRaw) ?? '';
  if (!signature) return null;

  const slot = Number(tx.slot ?? 0);

  return {
    signature,
    slot,
    mint,
    creator,
    isCreateV2: isCreateV2(logs),
  };
}
