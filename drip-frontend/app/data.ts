// ─────────────────────────────────────────────────────────────────────────────
// TEMPLATE DATA — edit this file to personalise your portfolio
// ─────────────────────────────────────────────────────────────────────────────

export const BRAND = {
  /** Short initials shown in nav + footer */
  initials:  "YS",
  /** Full name (not currently displayed — add where needed) */
  name:      "Your Name",
  /** Tagline shown in meta */
  tagline:   "Full-Stack Engineer · Design · AI",
  /** Bio paragraphs shown in the About section */
  bio: [
    "Results-driven developer with a passion for building beautiful, production-grade software. 5+ years turning ideas into reality through clean code and exceptional design.",
    "Specialising in AI-native products, Web3 ecosystems, and scalable cloud infrastructure. Open to freelance projects, full-time roles, and interesting collaborations.",
  ],
  /** Shown in the Contact section */
  location:  "Based in Your City",
  /** Whether to show the "Available for work" badge in the nav */
  available: true,
  /** Contact email — appears in Contact section and footer */
  email:     "hello@yourstudio.com",
  /** Shown in the live-projects hero badge */
  liveProjects: "Project 01 & Project 02",
};

/** Words that animate in the hero headline — make them yours */
export const HEADLINE_WORDS = ["Design.", "Build.", "Launch."];

/** Scrolling ticker items in the hero */
export const MARQUEE_ITEMS = [
  "Project 01", "Project 02", "Project 03", "Project 04",
  "Project 05", "Project 06", "Project 07", "Project 08",
  "Project 01", "Project 02", "Project 03", "Project 04",
  "Project 05", "Project 06", "Project 07", "Project 08",
];

export interface Project {
  id:          string;
  name:        string;
  tagline:     string;
  description: string;
  url:         string;
  /** "live" shows rainbow badge + makes card clickable. "inactive" shows muted badge. */
  status:      "live" | "inactive";
  tags:        string[];
  highlights:  string[];
  /** Path relative to /public. Set to null to show a solid-colour placeholder. */
  screenshot:  string | null;
}

export const projects: Project[] = [
  {
    id:          "project-01",
    name:        "Project 01",
    tagline:     "AI-Powered SaaS Platform",
    description: "A containerised platform enabling users to instantly generate and deploy full-stack applications with automated infrastructure provisioning.",
    url:         "https://example.com",
    status:      "live",
    tags:        ["AI", "DevOps", "Full-Stack", "SaaS"],
    highlights: [
      "Instant full-stack deploy with database, auth, and subdomain routing",
      "Dynamic AI model selection for in-environment code generation",
      "Production-ready containerised infrastructure",
      "Integrated SEO optimisation and live hosting",
    ],
    screenshot:  "/screenshots/project-01.png",
  },
  {
    id:          "project-02",
    name:        "Project 02",
    tagline:     "On-Chain DeFi Trading Platform",
    description: "A blockchain-based trading terminal combining on-chain data, real-time AI insights, and interactive user decision flows.",
    url:         "https://example.com",
    status:      "live",
    tags:        ["Blockchain", "AI", "DeFi", "Web3"],
    highlights: [
      "Prediction markets for real-world events",
      "AI assistant with voice and chat interaction",
      "Real-time market data and context-aware responses",
      "On-chain execution with integrated AI insights",
    ],
    screenshot:  "/screenshots/project-02.png",
  },
  {
    id:          "project-03",
    name:        "Project 03",
    tagline:     "Community-Powered Social Platform",
    description: "A community-driven platform where users collaborate, report, and earn token rewards for keeping the ecosystem clean and verified.",
    url:         "#",
    status:      "inactive",
    tags:        ["Web3", "Community", "Tokens", "Social"],
    highlights: [
      "Crowdsourced reporting system with community verification",
      "Token-incentivised moderation with reward bounties",
      "Public directory with one-click action flows",
    ],
    screenshot:  "/screenshots/project-03.png",
  },
  {
    id:          "project-04",
    name:        "Project 04",
    tagline:     "High-Frequency Crypto Trading Terminal",
    description: "A real-time HFT platform built for volatile emerging crypto assets — low-latency dashboards and event-driven architecture.",
    url:         "#",
    status:      "inactive",
    tags:        ["HFT", "Crypto", "Real-Time", "Trading"],
    highlights: [
      "Low-latency dashboards and real-time data pipelines",
      "Event-driven architecture for rapid execution",
      "Custom UIs for speed-critical decision-making",
    ],
    screenshot:  "/screenshots/project-04.png",
  },
  {
    id:          "project-05",
    name:        "Project 05",
    tagline:     "Creator & Investor Launch Platform",
    description: "Idea → brand → app → launch. Creators build in public, grow a community, and lock a timed token launch.",
    url:         "#",
    status:      "inactive",
    tags:        ["Solana", "Web3", "SaaS", "Launch"],
    highlights: [
      "Creator studio — build in public, lock a timed token launch",
      "Investor dashboard — find real builders early",
      "Full-stack with wallet auth and AI assistance",
    ],
    screenshot:  "/screenshots/project-05.png",
  },
  {
    id:          "project-06",
    name:        "Project 06",
    tagline:     "Procedurally Generated Open-World Game",
    description: "An open world of AI-generated creatures, built from a custom SDF blend-shell vertex shader — entire crowds rendered in just 2 draw calls.",
    url:         "#",
    status:      "inactive",
    tags:        ["WebGL", "Three.js", "Procedural", "Game"],
    highlights: [
      "Custom SDF blend-shell vertex shader for seamless joints",
      "Fully procedural animation with IK legs and verlet tails",
      "Entire crowd batched into 2 draw calls",
    ],
    screenshot:  "/screenshots/project-06.png",
  },
  {
    id:          "project-07",
    name:        "Project 07",
    tagline:     "Token-Gated WebGL Space Explorer",
    description: "A galaxy explorer — 100,000 procedurally generated worlds across 10,000 galaxies, with hidden reward caches.",
    url:         "#",
    status:      "inactive",
    tags:        ["Solana", "WebGL", "Game", "Web3"],
    highlights: [
      "100,000 fully deterministic, infinitely explorable worlds",
      "Token-gated access with wallet connect and progression",
      "Hidden reward caches funded by creator fees",
    ],
    screenshot:  "/screenshots/project-07.png",
  },
  {
    id:          "project-08",
    name:        "Project 08",
    tagline:     "On-Chain Upgradable NFT Collection",
    description: "3,500 unique NFTs with ERC-6551 token-bound accounts — equipped traits live inside the NFT's wallet.",
    url:         "#",
    status:      "inactive",
    tags:        ["NFT", "ERC-6551", "Web3", "Art"],
    highlights: [
      "ERC-6551 token-bound accounts — traits transfer with the NFT",
      "AI-generated trait pipeline across 9 wearable slots",
      "Gas sponsored via paymaster — no ETH needed",
    ],
    screenshot:  "/screenshots/project-08.png",
  },
];

export interface Experience {
  period:  string;
  company: string;
  role:    string;
  bullets: string[];
}

export const experiences: Experience[] = [
  {
    period:  "2022 – Present",
    company: "Freelance / Independent",
    role:    "Full-Stack Engineer & Product Builder",
    bullets: [
      "Built multiple production-grade software products and AI-driven platforms",
      "Deployed 8 products across AI, Web3, gaming, and DeFi verticals",
      "Leveraged agentic AI workflows for rapid prototyping and product iteration",
      "Served 1,000+ active users across platforms",
    ],
  },
  {
    period:  "2020 – 2022",
    company: "Previous Company",
    role:    "Senior Software Engineer",
    bullets: [
      "Led development of customer-facing web applications using React and TypeScript",
      "Architected and deployed scalable microservices on AWS",
      "Mentored junior engineers and established engineering best practices",
    ],
  },
  {
    period:  "2018 – 2020",
    company: "Earlier Company",
    role:    "Software Engineer",
    bullets: [
      "Built and maintained REST APIs serving 50,000+ daily active users",
      "Contributed to core product redesign improving user retention by 30%",
      "Collaborated cross-functionally with design and product teams",
    ],
  },
];

export interface Skill {
  category: string;
  items:    string[];
}

export const skills: Skill[] = [
  { category: "Frontend",      items: ["React", "Next.js", "TypeScript", "Tailwind CSS", "Framer Motion"] },
  { category: "Backend",       items: ["Node.js", "Go", "PostgreSQL", "Redis", "REST APIs"] },
  { category: "Infrastructure",items: ["Docker", "AWS", "Vercel", "Northflank", "Supabase"] },
  { category: "AI & Web3",     items: ["Agentic AI", "OpenAI", "Claude", "Solana", "EVM Smart Contracts"] },
];

export const STATS = [
  { value: "8",  suffix: "",  label: "Products Shipped" },
  { value: "5",  suffix: "+", label: "Years Building"   },
  { value: "2",  suffix: "",  label: "Live Platforms"   },
  { value: "1k", suffix: "+", label: "Users Served"     },
];
