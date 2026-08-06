import { Router, Request, Response } from 'express';
import { isValidSolanaAddress, transferDrip } from '../services/solana';
import { store } from '../store';

export const claimsRouter = Router();

const MIN_CLAIM = 0.01; // Minimum DRIP per claim

/** POST /api/claims — claim DRIP from vault */
claimsRouter.post('/', async (req: Request, res: Response) => {
  const { walletAddress, amount } = req.body as {
    walletAddress: string;
    amount: number;
  };

  if (!walletAddress || amount == null) {
    res.status(400).json({ error: 'Missing walletAddress or amount' });
    return;
  }

  if (!isValidSolanaAddress(walletAddress)) {
    res.status(400).json({ error: 'Invalid Solana wallet address' });
    return;
  }

  if (amount < MIN_CLAIM) {
    res.status(400).json({ error: `Minimum claim is ${MIN_CLAIM} DRIP` });
    return;
  }

  const vault = store.vaults.get(walletAddress);
  if (!vault) {
    res.status(404).json({ error: 'Vault not found — connect your wallet and earn DRIP first' });
    return;
  }

  if (vault.claimable < amount) {
    res.status(400).json({
      error: `Insufficient claimable balance. Available: ${vault.claimable.toFixed(4)} DRIP`,
    });
    return;
  }

  try {
    // Deduct from vault optimistically before the on-chain transfer
    vault.claimable -= amount;
    vault.balance   -= amount;
    vault.fillPct    = Math.min(95, (vault.balance / 2_000) * 100);
    vault.lastUpdated = new Date().toISOString();

    let txSignature: string;

    if (!process.env.DRIP_MINT_ADDRESS || !process.env.TREASURY_PRIVATE_KEY) {
      // Dev mode: return a mock signature
      console.warn('[Claims] Solana env vars not set — returning mock tx signature');
      txSignature = `mock_${Date.now()}`;
    } else {
      txSignature = await transferDrip(walletAddress, amount);
    }

    res.json({
      success:      true,
      claimed:      amount,
      txSignature,
      explorerUrl:  `https://solscan.io/tx/${txSignature}`,
      vault: {
        balance:   vault.balance,
        claimable: vault.claimable,
        fillPct:   vault.fillPct,
      },
    });
  } catch (err) {
    // Rollback on failure
    vault.claimable += amount;
    vault.balance   += amount;
    console.error('[Claims] Transfer failed:', err);
    res.status(500).json({ error: 'On-chain transfer failed — please try again' });
  }
});
