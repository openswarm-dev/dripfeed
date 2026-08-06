import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getOrCreateAssociatedTokenAccount,
  createTransferInstruction,
  getMint,
} from '@solana/spl-token';
import bs58 from 'bs58';

let connection: Connection | null = null;

export function getConnection(): Connection {
  if (!connection) {
    const rpc = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
    connection = new Connection(rpc, 'confirmed');
  }
  return connection;
}

export function getTreasuryKeypair(): Keypair {
  const pk = process.env.TREASURY_PRIVATE_KEY;
  if (!pk) throw new Error('TREASURY_PRIVATE_KEY not set');
  return Keypair.fromSecretKey(bs58.decode(pk));
}

export function isValidSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

/**
 * Transfer DRIP SPL tokens from the treasury wallet to a creator's wallet.
 * Returns the transaction signature.
 */
export async function transferDrip(
  recipientAddress: string,
  amount: number,
): Promise<string> {
  const mintAddress = process.env.DRIP_MINT_ADDRESS;
  if (!mintAddress) throw new Error('DRIP_MINT_ADDRESS not set');

  const conn      = getConnection();
  const treasury  = getTreasuryKeypair();
  const mint      = new PublicKey(mintAddress);
  const recipient = new PublicKey(recipientAddress);

  // Get mint decimals
  const mintInfo = await getMint(conn, mint);
  const decimals = mintInfo.decimals;
  const rawAmount = BigInt(Math.round(amount * 10 ** decimals));

  // Get / create associated token accounts
  const fromATA = await getOrCreateAssociatedTokenAccount(conn, treasury, mint, treasury.publicKey);
  const toATA   = await getOrCreateAssociatedTokenAccount(conn, treasury, mint, recipient);

  const tx = new Transaction().add(
    createTransferInstruction(fromATA.address, toATA.address, treasury.publicKey, rawAmount),
  );

  const sig = await sendAndConfirmTransaction(conn, tx, [treasury]);
  return sig;
}

/**
 * Verify that a wallet signed a specific message.
 * Proves ownership without an on-chain transaction.
 */
export async function verifyWalletSignature(
  walletAddress: string,
  message: string,
  signatureBase58: string,
): Promise<boolean> {
  try {
    const { sign } = await import('tweetnacl');
    const pubKey  = new PublicKey(walletAddress);
    const msgBytes = new TextEncoder().encode(message);
    const sigBytes = bs58.decode(signatureBase58);
    return sign.detached.verify(msgBytes, sigBytes, pubKey.toBytes());
  } catch {
    return false;
  }
}
