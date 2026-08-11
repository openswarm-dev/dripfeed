import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth, AuthPayload } from '../middleware/auth';
import { v4 as uuidv4 } from 'uuid';

export const campaignsRouter = Router();

/** GET /api/campaigns — list all active campaigns */
campaignsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { active: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ campaigns });
  } catch (err) {
    console.error('[Campaigns] Error:', err);
    res.status(503).json({ error: 'Database unavailable' });
  }
});

/** GET /api/campaigns/:id — single campaign */
campaignsRouter.get('/:id', async (req: Request, res: Response) => {
  const campaign = await prisma.campaign.findUnique({ where: { id: req.params.id as string } });
  if (!campaign) { res.status(404).json({ error: 'Campaign not found' }); return; }
  res.json({ campaign });
});

/** POST /api/campaigns — create a campaign (authenticated users) */
campaignsRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  const { project, logo, imageUrl, budgetTotal, goal, dripPerKViews } = req.body as {
    project: string;
    logo: string;
    imageUrl?: string;
    budgetTotal: number;
    goal: number;
    dripPerKViews: number;
  };
  const _auth = (req as Request & { user: AuthPayload }).user;

  if (!project?.trim() || !logo?.trim() || !budgetTotal || !goal || !dripPerKViews) {
    res.status(400).json({ error: 'project, logo, budgetTotal, goal and dripPerKViews are required' });
    return;
  }
  if (budgetTotal <= 0 || goal <= 0 || dripPerKViews <= 0) {
    res.status(400).json({ error: 'Budget, goal, and rate must all be positive' });
    return;
  }

  const kPerDrip = Math.round(1 / dripPerKViews);
  const rateLabel = `${kPerDrip}K views → 1 DRIP`;

  const campaign = await prisma.campaign.create({
    data: {
      id:           uuidv4(),
      project:      project.trim(),
      logo:         logo.trim().toUpperCase().slice(0, 6),
      imageUrl:     imageUrl?.trim() || null,
      budgetTotal,
      budgetLeft:   budgetTotal,
      goal,
      rateLabel,
      dripPerKViews,
    },
  });

  res.status(201).json({ campaign });
});
