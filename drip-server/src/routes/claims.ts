import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthPayload } from '../middleware/auth';
import { isValidSolanaAddress, transferDrip } from '../services/solana';

export const claimsRouter = Router();

const MIN_CLAIM = 0.01;

claimsRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const { amount } = req.body as { amount: number };
  const { userId } = (req as Request & { user: AuthPayload }).user;

  if (amount == null || amount < MIN_CLAIM) {
    res.status(400).json({ error: `Minimum claim is ${MIN_CLAIM} DRIP` });
    return;
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.walletAddress) {
    res.status(400).json({ error: 'Connect a Solana wallet before claiming' });
    return;
  }

  if (!isValidSolanaAddress(user.walletAddress)) {
    res.status(400).json({ error: 'Invalid wallet address on account' });
    return;
  }

  const vault = await prisma.vault.findUnique({ where: { userId } });
  if (!vault) { res.status(404).json({ error: 'Vault not found' }); return; }

  if (Number(vault.claimable) < amount) {
    res.status(400).json({
      error: `Insufficient balance. Available: ${Number(vault.claimable).toFixed(4)} DRIP`,
    });
    return;
  }

  // Optimistic deduction
  const updated = await prisma.vault.update({
    where: { userId },
    data: {
      claimable: { decrement: amount },
      balance:   { decrement: amount },
      fillPct:   Math.max(0, Number(vault.fillPct) - (amount / 2000) * 100),
    },
  });

  let txSignature: string;
  try {
    if (!process.env.DRIP_MINT_ADDRESS || !process.env.TREASURY_PRIVATE_KEY) {
      txSignature = `dev_${Date.now()}`;
    } else {
      txSignature = await transferDrip(user.walletAddress, amount);
    }

    // Record claim
    await prisma.claim.create({ data: { userId, amount, txSignature, status: 'confirmed' } });

    res.json({
      success: true,
      claimed: amount,
      txSignature,
      explorerUrl: `https://solscan.io/tx/${txSignature}`,
      vault: { balance: Number(updated.balance), claimable: Number(updated.claimable), fillPct: Number(updated.fillPct) },
    });
  } catch (err) {
    // Rollback on failure
    await prisma.vault.update({
      where: { userId },
      data: { claimable: { increment: amount }, balance: { increment: amount } },
    });
    await prisma.claim.create({ data: { userId, amount, status: 'failed' } });
    console.error('[Claims] Transfer failed:', err);
    res.status(500).json({ error: 'Transfer failed — please try again' });
  }
});
