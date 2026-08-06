import { Router, Request, Response } from 'express';
import { store } from '../store';

export const campaignsRouter = Router();

campaignsRouter.get('/', (_req: Request, res: Response) => {
  res.json({ campaigns: store.campaigns.filter(c => c.active) });
});

campaignsRouter.get('/:id', (req: Request, res: Response) => {
  const campaign = store.campaigns.find(c => c.id === req.params.id);
  if (!campaign) {
    res.status(404).json({ error: 'Campaign not found' });
    return;
  }
  res.json({ campaign });
});
