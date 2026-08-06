import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export const campaignsRouter = Router();

campaignsRouter.get('/', async (_req: Request, res: Response) => {
  const campaigns = await prisma.campaign.findMany({ where: { active: true } });
  res.json({ campaigns });
});

campaignsRouter.get('/:id', async (req: Request, res: Response) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id as string } });
  if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }
  res.json({ campaign });
});
