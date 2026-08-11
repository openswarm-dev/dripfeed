export interface NarrativeRule {
  id: string;
  label: string;
  keywords: string[];
}

export const NARRATIVE_RULES: NarrativeRule[] = [
  {
    id: 'ai',
    label: 'AI / Agents',
    keywords: [
      'ai', 'gpt', 'agent', 'robot', 'neural', 'llm', 'openai', 'claude', 'deepseek',
      'artificial', 'autonomous', 'bot', 'machine', 'model', 'agi',
    ],
  },
  {
    id: 'animal',
    label: 'Animals / Pepe',
    keywords: [
      'dog', 'cat', 'frog', 'pepe', 'monkey', 'ape', 'bird', 'duck', 'bear', 'bull',
      'shiba', 'inu', 'wojak', 'penguin', 'hamster', 'mouse', 'rat', 'whale', 'fish',
      'lion', 'tiger', 'cow', 'pig', 'goat', 'sheep', 'bee', 'snake', 'dragon',
    ],
  },
  {
    id: 'political',
    label: 'Political',
    keywords: [
      'trump', 'maga', 'biden', 'election', 'president', 'politic', 'vote', 'democrat',
      'republican', 'congress', 'senate', 'liberty', 'freedom', 'patriot',
    ],
  },
  {
    id: 'celebrity',
    label: 'Celebrity / Influencer',
    keywords: [
      'elon', 'musk', 'kanye', 'drake', 'celebrity', 'influencer', 'streamer',
      'youtube', 'twitch', 'mrbeast', 'kai', 'ishowspeed',
    ],
  },
  {
    id: 'gaming',
    label: 'Gaming',
    keywords: [
      'game', 'gaming', 'play', 'player', 'minecraft', 'fortnite', 'roblox', 'pixel',
      'arcade', 'quest', 'level', 'boss', 'nintendo', 'xbox', 'ps5',
    ],
  },
  {
    id: 'defi',
    label: 'DeFi / Finance',
    keywords: [
      'defi', 'stake', 'yield', 'swap', 'dex', 'lend', 'vault', 'fund', 'bank',
      'capital', 'finance', 'money', 'cash', 'gold', 'silver', 'btc', 'bitcoin',
    ],
  },
  {
    id: 'food',
    label: 'Food / Drink',
    keywords: [
      'pizza', 'burger', 'coffee', 'beer', 'wine', 'taco', 'sushi', 'food', 'eat',
      'milk', 'cheese', 'banana', 'apple', 'fruit', 'candy', 'cookie',
    ],
  },
  {
    id: 'culture',
    label: 'Internet Culture / Viral',
    keywords: [
      'meme', 'viral', 'tiktok', 'trend', 'based', 'sigma', 'chad', 'gigachad',
      'degen', 'vibe', 'culture', 'brainrot', 'skibidi', 'rizz', 'fanum',
    ],
  },
  {
    id: 'meta',
    label: 'Meta / Pump Culture',
    keywords: [
      'pump', 'solana', 'sol', 'trenches', 'bundle', 'dev', 'cto', 'community',
      'fair', 'launch', 'sniper', 'bonding', 'graduat', 'raydium',
    ],
  },
  {
    id: 'tech',
    label: 'Tech / Crypto Infra',
    keywords: [
      'chain', 'layer', 'bridge', 'oracle', 'infra', 'protocol', 'network', 'web3',
      'crypto', 'token', 'blockchain', 'zk', 'rollup',
    ],
  },
  {
    id: 'absurd',
    label: 'Absurdist / Random',
    keywords: [
      'wtf', 'lol', 'cursed', 'weird', 'random', 'gibberish', 'nonsense', 'shit',
      'fart', 'poop', 'toilet', 'sus', 'among',
    ],
  },
];

export interface Classification {
  narratives: string[];
  primaryNarrative: string;
  narrativeScore: number;
  scores: Record<string, number>;
}

function tokenize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
}

export function classifyFromMint(mint: string) {
  return classifyNarratives({ mint });
}

export function classifyNarratives(input: {
  name?: string;
  symbol?: string;
  description?: string;
  mint?: string;
}): Classification {
  const blob = tokenize(
    [input.name, input.symbol, input.description, input.mint?.replace(/pump$/i, '')]
      .filter(Boolean)
      .join(' '),
  );

  const scores: Record<string, number> = {};
  let bestId = 'other';
  let bestScore = 0;

  for (const rule of NARRATIVE_RULES) {
    let score = 0;
    for (const kw of rule.keywords) {
      if (blob.includes(kw)) score += kw.length >= 5 ? 2 : 1;
    }
    if (score > 0) scores[rule.id] = score;
    if (score > bestScore) {
      bestScore = score;
      bestId = rule.id;
    }
  }

  const narratives = Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);

  if (narratives.length === 0) narratives.push('other');

  return {
    narratives,
    primaryNarrative: bestScore > 0 ? bestId : 'other',
    narrativeScore: bestScore,
    scores,
  };
}

export function narrativeLabel(id: string): string {
  if (id === 'other') return 'Other / Uncategorized';
  return NARRATIVE_RULES.find((r) => r.id === id)?.label ?? id;
}
