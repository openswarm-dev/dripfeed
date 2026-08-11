/**
 * Pump.fun create / buy / sell via Helius RPC + Turnkey signing.
 * Instruction builders mirror DEVSNIPER (@nirholas/pump-sdk).
 */
import BN from 'bn.js';
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
  OnlinePumpSdk,
  PUMP_SDK,
  getBuyTokenAmountFromSolAmount,
  newBondingCurve,
} from '@nirholas/pump-sdk';
import { subOrgTurnkeyClient } from './turnkey.js';
import type { BetttrWallet } from './authStore.js';

function heliusRpc(): string {
  const key = process.env.HELIUS_API_KEY?.trim();
  if (key) return `https://mainnet.helius-rpc.com/?api-key=${key}`;
  return (
    process.env.SOLANA_RPC_URL?.trim()
    || process.env.HELIUS_RPC_URL?.trim()
    || 'https://api.mainnet-beta.solana.com'
  );
}

export function tradeConnection() {
  return new Connection(heliusRpc(), 'confirmed');
}

const PRIORITY_MICROLAMPORTS = Number(process.env.PRIORITY_FEE_MICROLAMPORTS ?? 200_000);

/** Sign legacy tx with Turnkey fee-payer, optional local co-signers (mint). */
export async function signAndSendTurnkey(input: {
  wallet: BetttrWallet;
  tx: Transaction;
  extraSigners?: Keypair[];
}): Promise<string> {
  const conn = tradeConnection();
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
  input.tx.recentBlockhash = blockhash;
  input.tx.lastValidBlockHeight = lastValidBlockHeight;
  input.tx.feePayer = new PublicKey(input.wallet.address);

  const serialized = input.tx.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  });
  const unsignedHex = Buffer.from(serialized).toString('hex');

  const api = subOrgTurnkeyClient(input.wallet.turnkeySubOrgId);
  const signed = await api.signTransaction({
    organizationId: input.wallet.turnkeySubOrgId,
    signWith: input.wallet.address,
    unsignedTransaction: unsignedHex,
    type: 'TRANSACTION_TYPE_SOLANA',
  });
  const signedTxHex = signed.signedTransaction;
  if (!signedTxHex) throw new Error('Turnkey returned no signed transaction');

  const withUserSig = Transaction.from(Buffer.from(signedTxHex, 'hex'));
  if (input.extraSigners?.length) {
    withUserSig.partialSign(...input.extraSigners);
  }

  const sig = await conn.sendRawTransaction(withUserSig.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}

export async function quoteBuyTokens(buySol: number): Promise<{
  expectedTokens: string;
  expectedTokensUi: number;
  supplyPct: number;
}> {
  const conn = tradeConnection();
  const sdk = new OnlinePumpSdk(conn);
  const [global, feeConfig] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig()]);
  const fresh = newBondingCurve(global);
  const solAmount = new BN(Math.floor(buySol * LAMPORTS_PER_SOL));
  const expected = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: global.tokenTotalSupply,
    bondingCurve: fresh,
    amount: solAmount,
  });
  const ui = expected.toNumber() / 1e6; // pump token decimals = 6
  const supply = global.tokenTotalSupply.toNumber() / 1e6;
  return {
    expectedTokens: expected.toString(),
    expectedTokensUi: ui,
    supplyPct: supply > 0 ? (ui / supply) * 100 : 0,
  };
}

/** Upload metadata JSON (+ image) to pump.fun IPFS gateway. */
export async function uploadPumpMetadata(input: {
  name: string;
  symbol: string;
  description?: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  imageUrl?: string;
  imageBase64?: string;
  imageFilename?: string;
}): Promise<{ metadataUri: string }> {
  const form = new FormData();
  form.append('name', input.name);
  form.append('symbol', input.symbol);
  form.append('description', input.description ?? '');
  form.append('twitter', input.twitter ?? '');
  form.append('telegram', input.telegram ?? '');
  form.append('website', input.website ?? '');
  form.append('showName', 'true');

  let imageBlob: Blob | null = null;
  let filename = input.imageFilename ?? 'image.png';

  if (input.imageBase64) {
    const raw = input.imageBase64.replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(raw, 'base64');
    imageBlob = new Blob([buf], { type: 'image/png' });
  } else if (input.imageUrl) {
    const imgRes = await fetch(input.imageUrl, { signal: AbortSignal.timeout(12_000) });
    if (!imgRes.ok) throw new Error(`Could not fetch image (${imgRes.status})`);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const ct = imgRes.headers.get('content-type') || 'image/png';
    imageBlob = new Blob([buf], { type: ct });
    if (ct.includes('jpeg') || ct.includes('jpg')) filename = 'image.jpg';
    else if (ct.includes('webp')) filename = 'image.webp';
    else if (ct.includes('gif')) filename = 'image.gif';
  }

  if (!imageBlob) throw new Error('Provide imageUrl or imageBase64');
  form.append('file', imageBlob, filename);

  const res = await fetch('https://pump.fun/api/ipfs', {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Metadata upload failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { metadataUri?: string; uri?: string };
  const metadataUri = data.metadataUri || data.uri;
  if (!metadataUri) throw new Error('pump.fun IPFS returned no metadataUri');
  return { metadataUri };
}

export async function deployPumpToken(input: {
  wallet: BetttrWallet;
  name: string;
  symbol: string;
  metadataUri: string;
  buySol: number;
  mayhem?: boolean;
  cashback?: boolean;
  metaId?: string;
  metaTheme?: string;
}): Promise<{
  mint: string;
  signature: string;
  createSignature: string;
  buySol: number;
  expectedTokensUi: number;
  supplyPct: number;
}> {
  if (input.wallet.address.startsWith('DEV')) {
    throw new Error('Dev wallet cannot deploy — configure TURNKEY_* on Hetzner');
  }
  const name = input.name.trim().slice(0, 32);
  const symbol = input.symbol.trim().slice(0, 10).toUpperCase();
  if (name.length < 1) throw new Error('Name required');
  if (symbol.length < 1) throw new Error('Ticker required');
  if (!(input.buySol > 0)) throw new Error('buySol must be > 0');

  const conn = tradeConnection();
  const sdk = new OnlinePumpSdk(conn);
  const user = new PublicKey(input.wallet.address);
  const mintKp = Keypair.generate();

  const [global, feeConfig] = await Promise.all([sdk.fetchGlobal(), sdk.fetchFeeConfig()]);
  const fresh = newBondingCurve(global);
  const solAmount = new BN(Math.floor(input.buySol * LAMPORTS_PER_SOL));
  const expectedTokens = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: global.tokenTotalSupply,
    bondingCurve: fresh,
    amount: solAmount,
  });

  // create+buy in one tx exceeds Solana's 1232-byte packet limit (often ~1264).
  // Split: (1) createV2 + extendAccount  (2) ATA + buy
  const allIxs = await PUMP_SDK.createV2AndBuyInstructions({
    global,
    mint: mintKp.publicKey,
    name,
    symbol,
    uri: input.metadataUri,
    creator: user,
    user,
    amount: expectedTokens,
    solAmount,
    mayhemMode: Boolean(input.mayhem),
    cashback: Boolean(input.cashback),
  });

  if (allIxs.length < 2) {
    throw new Error('Pump SDK returned unexpected create instruction set');
  }

  const createIxs = allIxs.slice(0, Math.min(2, allIxs.length)); // create (+ extend)
  const buyIxs = allIxs.slice(createIxs.length); // ata + buy

  const createTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
    ...createIxs,
  );

  let createSignature: string;
  try {
    createSignature = await signAndSendTurnkey({
      wallet: input.wallet,
      tx: createTx,
      extraSigners: [mintKp],
    });
  } catch (err) {
    const msg = (err as Error).message || String(err);
    if (/too large|1232/i.test(msg)) {
      throw new Error(
        'Create transaction still too large — try a shorter name/ticker, or redeploy. ' + msg,
      );
    }
    throw err;
  }

  // Buy in a second tx once the curve exists
  const buyTx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
    ...buyIxs,
  );

  let buySignature: string;
  try {
    buySignature = await signAndSendTurnkey({
      wallet: input.wallet,
      tx: buyTx,
    });
  } catch (err) {
    // Token exists — surface create mint so user can buy manually
    throw new Error(
      `Token created (${mintKp.publicKey.toBase58()}) but initial buy failed: ${(err as Error).message}. Create tx: ${createSignature}`,
    );
  }

  const ui = expectedTokens.toNumber() / 1e6;
  const supply = global.tokenTotalSupply.toNumber() / 1e6;

  return {
    mint: mintKp.publicKey.toBase58(),
    signature: buySignature,
    createSignature,
    buySol: input.buySol,
    expectedTokensUi: ui,
    supplyPct: supply > 0 ? (ui / supply) * 100 : 0,
  };
}

export async function buyPumpToken(input: {
  wallet: BetttrWallet;
  mint: string;
  buySol: number;
  slippagePercent?: number;
}): Promise<{ signature: string; expectedTokensUi: number }> {
  if (input.wallet.address.startsWith('DEV')) {
    throw new Error('Dev wallet cannot trade');
  }
  if (!(input.buySol > 0)) throw new Error('buySol must be > 0');

  const conn = tradeConnection();
  const sdk = new OnlinePumpSdk(conn);
  const user = new PublicKey(input.wallet.address);
  const mint = new PublicKey(input.mint);
  const solAmount = new BN(Math.floor(input.buySol * LAMPORTS_PER_SOL));
  const slippage = input.slippagePercent ?? 15;

  // Detect token program from mint owner
  const mintInfo = await conn.getAccountInfo(mint, 'confirmed');
  if (!mintInfo) throw new Error('Mint not found');
  const tokenProgram = mintInfo.owner;

  const [buyState, global, feeConfig] = await Promise.all([
    sdk.fetchBuyState(mint, user, tokenProgram),
    sdk.fetchGlobal(),
    sdk.fetchFeeConfig(),
  ]);

  if (buyState.bondingCurve.complete) {
    throw new Error('Token already graduated — bonding-curve buy unavailable');
  }

  const expectedTokens = getBuyTokenAmountFromSolAmount({
    global,
    feeConfig,
    mintSupply: buyState.bondingCurve.tokenTotalSupply,
    bondingCurve: buyState.bondingCurve,
    amount: solAmount,
  });

  const buyIxs = await PUMP_SDK.buyInstructions({
    global,
    bondingCurveAccountInfo: buyState.bondingCurveAccountInfo,
    bondingCurve: buyState.bondingCurve,
    associatedUserAccountInfo: buyState.associatedUserAccountInfo,
    mint,
    user,
    amount: expectedTokens,
    solAmount,
    slippage,
    tokenProgram,
  });

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 250_000 }),
    ...buyIxs,
  );

  const signature = await signAndSendTurnkey({ wallet: input.wallet, tx });
  return { signature, expectedTokensUi: expectedTokens.toNumber() / 1e6 };
}

export async function sellPumpToken(input: {
  wallet: BetttrWallet;
  mint: string;
  percent: number;
  slippagePercent?: number;
}): Promise<{ signature: string }> {
  if (input.wallet.address.startsWith('DEV')) {
    throw new Error('Dev wallet cannot trade');
  }
  const percent = Math.min(100, Math.max(1, Number(input.percent) || 0));
  const conn = tradeConnection();
  const sdk = new OnlinePumpSdk(conn);
  const user = new PublicKey(input.wallet.address);
  const mint = new PublicKey(input.mint);
  const slippage = input.slippagePercent ?? 15;

  const sellState = await sdk.fetchSellState(mint, user);
  const balance = await sdk.getTokenBalance(mint, user, sellState.tokenProgram);
  if (balance.isZero()) {
    throw new Error('No token balance — wait a few seconds after deploy/buy and retry');
  }

  const bps = Math.round(percent * 100);
  const amount = balance.muln(bps).divn(10_000);
  if (amount.isZero()) throw new Error('Sell amount too small');

  const cashback = Boolean(sellState.bondingCurve.isCashbackCoin);
  const preIxs = [];
  if (cashback) {
    const existing = await sdk.fetchUserVolumeAccumulator(user);
    if (!existing) {
      preIxs.push(await PUMP_SDK.initUserVolumeAccumulator({ payer: user, user }));
    }
  }

  const sellIxs = sellState.bondingCurve.complete
    ? await sdk.routedSellInstructions({
        mint,
        user,
        baseAmountIn: amount,
        slippage,
        tokenProgram: sellState.tokenProgram,
        cashback,
      })
    : await sdk.sellByPercentage({
        mint,
        user,
        percent,
        slippage,
        tokenProgram: sellState.tokenProgram,
        cashback,
      });

  if (!sellIxs?.length) throw new Error('Could not build sell transaction');

  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }),
    ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }),
    ...preIxs,
    ...sellIxs,
  );

  const signature = await signAndSendTurnkey({ wallet: input.wallet, tx });
  return { signature };
}
