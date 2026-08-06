"use client";

import {
  motion, AnimatePresence, useSpring,
  useScroll, useTransform, useInView,
} from "motion/react";
import {
  useEffect, useRef, useState, useCallback,
  createContext, useContext,
} from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { api } from "@/lib/api";
import type { Campaign as APICampaign, Post as APIPost, Vault as APIVault } from "@/lib/api";

// ─── Design tokens ────────────────────────────────────────────────────────────
const T = {
  bg:      "#0F1113",
  surface: "#141618",
  el:      "#1E2022",
  border:  "#252729",
  fg:      "#F2F4F7",
  subtle:  "#8A8D95",
  faint:   "#52545A",
  drip:    "#6effa0",
} as const;

const ease = [0.22, 1, 0.36, 1] as const;
const DRIP_PRICE = 1.50;
const VAULT_W = 220;
const VAULT_H = 360;

// ─── Types ────────────────────────────────────────────────────────────────────
type Screen     = "landing" | "app";
type ClaimState = "idle" | "signing" | "submitting" | "confirmed";
interface Drop   { id: string; x: number; size: number; duration: number; score: number }
interface Ripple { id: string; x: number }
interface Campaign  { id: string; project: string; av: string; budgetTotal: number; budgetLeft: number; goal: number; verified: number; rateLabel: string; dripHr: number; participants: number }
interface FeedEntry { id: string; handle: string; amount: string; campaign: string; ts: number }
interface Post      { id: string; snippet: string; campaign: string; impressions: number; dripHr: number }

// ─── Mock data ────────────────────────────────────────────────────────────────
const CAMPAIGNS: Campaign[] = [
  { id:"c1", project:"Solana Foundation", av:"SF", budgetTotal:20000, budgetLeft:14230, goal:10_000_000, verified:6_421_000, rateLabel:"100K views → $1", dripHr:3.2, participants:847 },
  { id:"c2", project:"Jupiter Exchange",  av:"JX", budgetTotal:8000,  budgetLeft:7100,  goal:5_000_000,  verified:890_000,   rateLabel:"80K views → $1",  dripHr:0.9, participants:312 },
  { id:"c3", project:"Pyth Network",      av:"PY", budgetTotal:15000, budgetLeft:12800, goal:8_000_000,  verified:3_200_000, rateLabel:"120K views → $1", dripHr:1.8, participants:524 },
];
const HANDLES = ["@sol_builder","@defi_degen","@web3creator","@crypto_art","@buildoor","@nft_trader","@sol_maxi","@founder_vibes","@wagmi_dev","@wen_moon","@solana_dev","@pumping_eth"];
const CNAMES  = ["Solana Foundation","Jupiter Exchange","Pyth Network"];
const INIT_POSTS: Post[] = [
  { id:"p1", snippet:"Why Solana's validator count matters for decentralisation...", campaign:"Solana Foundation", impressions:24_300, dripHr:3.2 },
];

// Campaign visual gradients (portrait card "image" area)
const CGRADIENT: Record<string,string> = {
  c1: "linear-gradient(145deg, rgba(167,139,255,0.55) 0%, rgba(110,255,160,0.38) 100%)",
  c2: "linear-gradient(145deg, rgba(96,208,255,0.55) 0%, rgba(52,211,153,0.38) 100%)",
  c3: "linear-gradient(145deg, rgba(251,146,60,0.5) 0%, rgba(236,72,153,0.38) 100%)",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmt  = (n:number,d=2) => n.toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtK = (n:number) => n>=1_000_000?(n/1_000_000).toFixed(1)+"M":n>=1_000?Math.round(n/1_000)+"K":String(n);
const uid  = () => Math.random().toString(36).slice(2);
const rnd  = (lo:number,hi:number) => lo+Math.random()*(hi-lo);

// ─── Tooltip context ──────────────────────────────────────────────────────────
interface TipData { text: string; x: number; y: number }
const TipCtx = createContext<{
  show: (e: React.MouseEvent, text: string) => void;
  hide: () => void;
}>({ show:()=>{}, hide:()=>{} });

function TipProvider({ children }: { children: React.ReactNode }) {
  const [tip, setTip] = useState<TipData | null>(null);

  const show = useCallback((e: React.MouseEvent, text: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ text, x: rect.left + rect.width / 2, y: rect.top - 4 });
  }, []);
  const hide = useCallback(() => setTip(null), []);

  return (
    <TipCtx.Provider value={{ show, hide }}>
      {children}
      <AnimatePresence>
        {tip && (
          <motion.div key="tip"
            initial={{ opacity:0, y:4 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:4 }}
            transition={{ duration:0.14 }}
            style={{
              position:"fixed", left:tip.x, top:tip.y,
              transform:"translate(-50%, calc(-100% - 8px))",
              zIndex:9999,
              background:T.el,
              border:`1px solid ${T.border}`,
              borderRadius:8,
              padding:"6px 11px",
              fontSize:12,
              color:T.fg,
              fontFamily:"var(--font-geist-mono)",
              pointerEvents:"none",
              backdropFilter:"blur(16px)",
              whiteSpace:"nowrap",
              boxShadow:"0 8px 28px -4px rgba(0,0,0,0.7)",
            }}>
            {tip.text}
            <div style={{
              position:"absolute", bottom:-5, left:"50%",
              transform:"translateX(-50%) rotate(45deg)",
              width:8, height:8,
              background:T.el,
              borderRight:`1px solid ${T.border}`,
              borderBottom:`1px solid ${T.border}`,
            }}/>
          </motion.div>
        )}
      </AnimatePresence>
    </TipCtx.Provider>
  );
}

function useTip() { return useContext(TipCtx); }

// ─── Custom Select ────────────────────────────────────────────────────────────
interface SelectOption { value: string; label: string }

function Select({ options, value, onChange, placeholder="Select..." }: {
  options: SelectOption[]; value: string; onChange:(v:string)=>void; placeholder?:string;
}) {
  const [open, setOpen] = useState(false);
  const [pos,  setPos]  = useState({ top:0, left:0, width:0 });
  const btnRef  = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = options.find(o => o.value === value);

  const handleToggle = () => {
    if (!open) {
      const rect = btnRef.current!.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left, width: rect.width });
    }
    setOpen(p => !p);
  };

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!btnRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <>
      <button ref={btnRef} onClick={handleToggle} data-cursor-hover
        style={{
          width:"100%", height:44, padding:"0 14px",
          background:T.el,
          border:`1px solid ${open ? T.subtle : T.border}`,
          borderRadius:11, cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"space-between",
          fontSize:13, color: selected ? T.fg : T.faint,
          transition:"border-color 0.2s", fontFamily:"inherit",
        }}>
        <span>{selected?.label ?? placeholder}</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration:0.18 }}
          style={{ fontSize:10, color:T.faint, display:"inline-block", lineHeight:1 }}>▾</motion.span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div ref={menuRef}
            initial={{ opacity:0, y:-6, scale:0.97 }}
            animate={{ opacity:1, y:0, scale:1 }}
            exit={{ opacity:0, y:-6, scale:0.97 }}
            transition={{ duration:0.15 }}
            style={{
              position:"fixed",
              top:pos.top, left:pos.left, width:pos.width,
              zIndex:8000,
              background:T.el,
              border:`1px solid ${T.border}`,
              borderRadius:12,
              overflow:"hidden",
              boxShadow:"0 20px 50px -10px rgba(0,0,0,0.75)",
            }}>
            {options.map((opt, i) => (
              <button key={opt.value} data-cursor-hover
                onClick={() => { onChange(opt.value); setOpen(false); }}
                style={{
                  display:"block", width:"100%",
                  padding:"11px 14px", textAlign:"left",
                  background: opt.value===value ? "rgba(110,255,160,0.07)" : "transparent",
                  color: opt.value===value ? T.drip : T.fg,
                  fontSize:13, border:"none", cursor:"pointer",
                  borderBottom: i < options.length-1 ? `1px solid ${T.border}` : "none",
                  fontFamily:"inherit", transition:"background 0.12s",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = opt.value===value ? "rgba(110,255,160,0.12)" : "rgba(255,255,255,0.04)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = opt.value===value ? "rgba(110,255,160,0.07)" : "transparent"; }}>
                {opt.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ─── Wave surface — fill + glowing stroke on ONE path so they're perfectly unified
function WaveSurface() {
  const paths = [
    "M0,8 C45,16 95,0 140,8 C180,16 210,4 220,8 L220,22 L0,22 Z",
    "M0,8 C50,0 100,16 140,8 C178,0 208,14 220,8 L220,22 L0,22 Z",
    "M0,8 C45,16 95,0 140,8 C180,16 210,4 220,8 L220,22 L0,22 Z",
  ];
  return (
    <svg viewBox="0 0 220 22" preserveAspectRatio="none"
      style={{ position:"absolute", top:-14, left:0, width:"100%", height:22, overflow:"visible", pointerEvents:"none" }}>
      <defs>
        <filter id="waveGlow" x="-5%" y="-300%" width="110%" height="700%">
          <feGaussianBlur stdDeviation="1.8" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      {/* Single path: fill gives the wave body, stroke gives the glowing top edge */}
      <motion.path
        fill="rgba(255,255,255,0.13)"
        stroke="rgba(255,255,255,0.82)"
        strokeWidth="1.6"
        filter="url(#waveGlow)"
        animate={{ d: paths }}
        transition={{ duration:3.6, repeat:Infinity, ease:"easeInOut" }}/>
    </svg>
  );
}

// ─── Drop particle — teardrop + score label fall together ─────────────────────
function DropParticle({ drop, fillPct, onEnd }: { drop:Drop; fillPct:number; onEnd:()=>void }) {
  // Text area sits above the teardrop in the container.
  // The container starts TEXT_OFFSET above the vault (clipped).
  // As it falls, the "+N" text slides in from the top first, then the drop follows.
  const TEXT_OFFSET = 26; // px above vault top where container starts
  const GAP = 6;
  const liquidY = VAULT_H * ((100 - fillPct) / 100);
  const fallTo  = liquidY - GAP;
  const W = 48;

  return (
    <motion.div
      style={{
        position:"absolute",
        top: -TEXT_OFFSET,
        left: drop.x - W/2,
        width: W,
        display:"flex", flexDirection:"column", alignItems:"center",
        gap: GAP,
        pointerEvents:"none",
        zIndex:4,
      }}
      initial={{ y:0, opacity:1 }}
      animate={{ y:fallTo, opacity:[1, 1, 1, 0] }}
      transition={{ duration:drop.duration, ease:[0.25,0.46,0.45,0.94] }}
      onAnimationComplete={onEnd}>

      {/* Score label — appears first as it slides into vault from top */}
      <span style={{
        fontSize:17,
        fontFamily:"var(--font-geist-mono)",
        fontWeight:800,
        color:"rgba(255,255,255,0.95)",
        textShadow:"0 0 10px rgba(255,255,255,0.9), 0 0 22px rgba(255,255,255,0.4)",
        lineHeight:1,
        letterSpacing:"-0.02em",
        userSelect:"none",
      }}>
        +{drop.score}
      </span>

      {/* Teardrop */}
      <div style={{
        width:drop.size,
        height:drop.size * 1.75,
        borderRadius:"50% 50% 50% 50% / 65% 65% 35% 35%",
        background:"linear-gradient(175deg, rgba(255,255,255,0.95) 0%, rgba(180,190,200,0.85) 100%)",
        boxShadow:`0 0 ${drop.size + 4}px rgba(255,255,255,0.7), 0 2px ${drop.size * 2 + 2}px rgba(255,255,255,0.25)`,
        flexShrink:0,
      }}/>
    </motion.div>
  );
}

// ─── Ripple effect (multi-ring water impact) ─────────────────────────────────
function RippleEffect({ ripple, fillPct }: { ripple:Ripple; fillPct:number }) {
  const y = VAULT_H * ((100 - fillPct) / 100) - 3;
  const rings = [
    { delay:0,    scaleX:14,  scaleY:5,  opacity:0.85, stroke:2,   dur:0.65 },
    { delay:0.1,  scaleX:22,  scaleY:7,  opacity:0.55, stroke:1.5, dur:0.85 },
    { delay:0.22, scaleX:30,  scaleY:9,  opacity:0.28, stroke:1,   dur:1.1  },
  ] as const;
  return (
    <>
      {rings.map((r,i)=>(
        <motion.div key={i} style={{
          position:"absolute", left:ripple.x, top:y,
          width:8, height:4,
          borderRadius:"50%",
          border:`${r.stroke}px solid rgba(255,255,255,${r.opacity})`,
          marginLeft:-4, marginTop:-2,
          pointerEvents:"none",
          boxShadow: i===0 ? "0 0 8px 1px rgba(255,255,255,0.3)" : "none",
        }}
          initial={{ scaleX:1, scaleY:1, opacity:r.opacity }}
          animate={{ scaleX:r.scaleX, scaleY:r.scaleY, opacity:0 }}
          transition={{ duration:r.dur, ease:"easeOut", delay:r.delay }}/>
      ))}
      {/* Central flash on impact */}
      <motion.div style={{
        position:"absolute", left:ripple.x, top:y,
        width:10, height:10, borderRadius:"50%",
        background:"rgba(255,255,255,0.85)",
        marginLeft:-5, marginTop:-5, pointerEvents:"none",
        filter:"blur(2px)",
      }}
        initial={{ scale:1, opacity:0.9 }}
        animate={{ scale:0, opacity:0 }}
        transition={{ duration:0.25, ease:"easeOut" }}/>
    </>
  );
}

// ─── Vault ────────────────────────────────────────────────────────────────────
function Vault({ fillPct, drops, ripples, onDropEnd, active }: {
  fillPct:number; drops:Drop[]; ripples:Ripple[];
  onDropEnd:(id:string)=>void; active:boolean;
}) {
  return (
    <div style={{
      position:"relative", width:VAULT_W, height:VAULT_H, borderRadius:28,
      border:`1px solid rgba(255,255,255,${active?0.22:0.07})`,
      background:"rgba(255,255,255,0.012)",
      overflow:"hidden",
      boxShadow: active
        ? "0 0 100px -20px rgba(255,255,255,0.25), 0 0 40px -10px rgba(255,255,255,0.1), inset 0 0 50px -20px rgba(255,255,255,0.04)"
        : "0 0 50px -20px rgba(255,255,255,0.07)",
      transition:"box-shadow 1.2s ease, border-color 1.2s ease",
    }}>
      <div style={{ position:"absolute", inset:0, backgroundImage:"radial-gradient(circle at 1px 1px,rgba(255,255,255,0.055) 1px,transparent 0)", backgroundSize:"18px 18px" }}/>
      {[20,40,60,80].map(p=>(
        <div key={p} style={{ position:"absolute", right:0, bottom:`${p}%`, display:"flex", alignItems:"center" }}>
          <span style={{ fontSize:7, color:"rgba(255,255,255,0.18)", fontFamily:"var(--font-geist-mono)", paddingRight:6 }}>{p}</span>
          <div style={{ width:10, height:1, background:"rgba(255,255,255,0.1)" }}/>
        </div>
      ))}
      <motion.div style={{ position:"absolute", bottom:0, left:0, right:0, overflow:"visible" }}
        animate={{ height:`${fillPct}%` }} transition={{ duration:2.6, ease:[0.22,1,0.36,1] }}>
        <WaveSurface/>
        {/* Liquid body */}
        <div style={{ position:"absolute", top:8, bottom:0, left:0, right:0, background:"linear-gradient(to top,rgba(255,255,255,0.1) 0%,rgba(255,255,255,0.03) 100%)" }}/>
        {/* Subtle subsurface glow just below the wave line */}
        <div style={{ position:"absolute", top:8, height:32, left:0, right:0, background:"linear-gradient(to bottom,rgba(255,255,255,0.1) 0%,transparent 100%)" }}/>
      </motion.div>
      {drops.map(d=><DropParticle key={d.id} drop={d} fillPct={fillPct} onEnd={()=>onDropEnd(d.id)}/>)}
      {ripples.map(r=><RippleEffect key={r.id} ripple={r} fillPct={fillPct}/>)}
      <div style={{ position:"absolute", inset:0, borderRadius:28, background:"linear-gradient(135deg,rgba(255,255,255,0.04) 0%,rgba(255,255,255,0) 40%,rgba(255,255,255,0.01) 100%)", pointerEvents:"none" }}/>
    </div>
  );
}

// ─── Animated number ──────────────────────────────────────────────────────────
function AnimNum({ value, d=2 }: { value:number; d?:number }) {
  const sp = useSpring(value, { stiffness:38, damping:12 });
  const [disp, setDisp] = useState(value);
  useEffect(()=>{ sp.set(value); },[value,sp]);
  useEffect(()=>{ const u=sp.on("change",v=>setDisp(v)); return u; },[sp]);
  return <>{fmt(disp,d)}</>;
}

// ─── InView reveal wrapper ────────────────────────────────────────────────────
function Reveal({ children, delay=0, className }: { children:React.ReactNode; delay?:number; className?:string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once:true, margin:"-50px" });
  return (
    <motion.div ref={ref} className={className}
      initial={{ opacity:0, y:22 }}
      animate={inView ? { opacity:1, y:0 } : {}}
      transition={{ duration:0.65, ease, delay }}>
      {children}
    </motion.div>
  );
}

// ─── Ticker marquee ───────────────────────────────────────────────────────────
function Ticker() {
  const doubled = [...CNAMES,...CNAMES,...CNAMES,...CNAMES,...CNAMES,...CNAMES,...CNAMES,...CNAMES];
  return (
    <div style={{ display:"flex", alignItems:"center", height:"100%", overflow:"hidden", paddingLeft:28 }}>
      <div className="ticker-track" style={{ display:"flex", gap:56, whiteSpace:"nowrap", flexShrink:0 }}>
        {doubled.map((item,i)=>(
          <span key={i} style={{ display:"inline-flex", alignItems:"center", gap:10, fontSize:10, color:T.faint, fontFamily:"var(--font-geist-mono)", letterSpacing:"0.14em", textTransform:"uppercase" }}>
            <span className="rainbow-bg" style={{ display:"inline-flex", width:4, height:4, borderRadius:"50%", flexShrink:0 }}/>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Stats strip ──────────────────────────────────────────────────────────────
function StatsStrip() {
  const { show:showTip, hide:hideTip } = useTip();
  const stats = [
    { lbl:"Creators earning",    val:"847+",  tip:"Active creators currently earning across all campaigns" },
    { lbl:"Active campaigns",    val:"3",     tip:"Projects funding creator campaigns right now" },
    { lbl:"Verified impressions",val:"14.2M", tip:"Total impressions verified across all submitted posts" },
    { lbl:"DRIP price",          val:"$1.50", tip:"Current market price of $DRIP token on Solana" },
  ];
  return (
    <div style={{ background:T.surface, borderTop:`1px solid ${T.border}`, borderBottom:`1px solid ${T.border}` }}>
      <div className="stats-grid" style={{ maxWidth:1200, margin:"0 auto" }}>
        {stats.map((s,i)=>(
          <div key={s.lbl} className={i<stats.length-1?"stat-border stat-item":"stat-item"}
            style={{ padding:"28px 32px", cursor:"help" }}
            onMouseEnter={e=>showTip(e,s.tip)} onMouseLeave={hideTip}>
            <p style={{ fontSize:9, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.18em", color:T.faint, marginBottom:10 }}>{s.lbl}</p>
            <p className="rainbow-text" style={{ fontSize:"clamp(1.8rem,3vw,2.6rem)", fontWeight:800, fontFamily:"var(--font-geist-mono)", letterSpacing:"-0.03em", lineHeight:1 }}>{s.val}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Campaign card ────────────────────────────────────────────────────────────
function CampaignCard({ c, joined, onToggle, earning, index }: {
  c:Campaign; joined:boolean; onToggle:()=>void; earning:boolean; index:number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once:true, margin:"-60px" });
  const { show:showTip, hide:hideTip } = useTip();
  const pct = Math.round((c.verified/c.goal)*100);

  return (
    <motion.div ref={ref}
      initial={{ opacity:0, y:32 }}
      animate={inView ? { opacity:1, y:0 } : {}}
      transition={{ duration:0.65, ease, delay:(index%3)*0.1 }}
      style={{
        borderRadius:20, overflow:"hidden",
        background:T.surface,
        border:`1px solid ${joined?"rgba(110,255,160,0.22)":T.border}`,
        boxShadow: joined
          ? "0 8px 40px -12px rgba(110,255,160,0.18), 0 0 0 1px rgba(110,255,160,0.06)"
          : "0 4px 24px -8px rgba(0,0,0,0.5)",
        transition:"border-color 0.4s, box-shadow 0.4s",
        display:"flex", flexDirection:"column",
      }}>

      {/* Visual area */}
      <div style={{ height:190, position:"relative", flexShrink:0, background:CGRADIENT[c.id]??CGRADIENT.c1, overflow:"hidden" }}>
        <div style={{ position:"absolute", inset:0, backgroundImage:"radial-gradient(circle at 1px 1px,rgba(255,255,255,0.07) 1px,transparent 0)", backgroundSize:"18px 18px" }}/>
        <div className="noise-overlay-dark" style={{ position:"absolute", inset:0, opacity:0.4 }}/>

        {/* Corner labels */}
        <div style={{ position:"absolute", top:16, left:18, right:18, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:11, fontFamily:"var(--font-geist-mono)", color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em" }}>
            {String(index+1).padStart(2,"0")}
          </span>
          <span style={{
            fontSize:9, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.12em",
            padding:"3px 9px", borderRadius:5,
            background: joined?"rgba(110,255,160,0.22)":"rgba(0,0,0,0.28)",
            border:`1px solid ${joined?"rgba(110,255,160,0.38)":"rgba(255,255,255,0.15)"}`,
            color: joined?T.drip:"rgba(255,255,255,0.6)",
            transition:"all 0.4s",
          }}>
            {joined?"Joined":"Active"}
          </span>
        </div>

        {/* Bottom text */}
        <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"44px 18px 18px", background:"linear-gradient(to top,rgba(0,0,0,0.68) 0%,transparent 100%)" }}>
          <p style={{ fontSize:18, fontWeight:800, color:"#fff", letterSpacing:"-0.025em", marginBottom:3, lineHeight:1.15 }}>{c.project}</p>
          <p style={{ fontSize:11, color:"rgba(255,255,255,0.5)", fontFamily:"var(--font-geist-mono)" }}>{c.rateLabel}</p>
        </div>
      </div>

      {/* Content area */}
      <div style={{ padding:"16px 18px 18px", flex:1, display:"flex", flexDirection:"column" }}>

        {/* Stats row */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, marginBottom:14 }}>
          {[
            { lbl:"Budget left",  val:`$${fmtK(c.budgetLeft)}`, tip:`$${fmtK(c.budgetLeft)} of $${fmtK(c.budgetTotal)} remaining` },
            { lbl:"Creators",     val:c.participants.toLocaleString(), tip:`${c.participants} creators earning on this campaign` },
            { lbl:"Rate",         val:`${c.dripHr}/hr`, tip:`You earn ${c.dripHr} DRIP per hour from posts in this campaign`, hi:joined },
          ].map(s=>(
            <div key={s.lbl}
              style={{ padding:"8px 10px", background:T.el, borderRadius:10, border:`1px solid ${s.hi?"rgba(110,255,160,0.12)":T.border}`, cursor:"help" }}
              onMouseEnter={e=>showTip(e,s.tip)} onMouseLeave={hideTip}>
              <p style={{ fontSize:9, color:T.faint, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:3 }}>{s.lbl}</p>
              <p style={{ fontSize:13, fontWeight:700, color:s.hi?T.drip:T.fg, fontFamily:"var(--font-geist-mono)" }}>{s.val}</p>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div style={{ marginBottom:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
            <span style={{ fontSize:9, color:T.faint, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.1em" }}>Campaign goal</span>
            <span style={{ fontSize:11, color:T.subtle, fontFamily:"var(--font-geist-mono)", fontWeight:600 }}>{pct}%</span>
          </div>
          <div style={{ height:4, background:T.el, borderRadius:2, overflow:"hidden" }}>
            <motion.div className="rainbow-bg" style={{ height:"100%", borderRadius:2 }}
              initial={{ width:0 }} animate={{ width:`${pct}%` }} transition={{ duration:1.3, ease, delay:0.4 }}/>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:5 }}>
            <span style={{ fontSize:9, color:T.faint, fontFamily:"var(--font-geist-mono)" }}>{fmtK(c.verified)} verified</span>
            <span style={{ fontSize:9, color:T.faint, fontFamily:"var(--font-geist-mono)" }}>of {fmtK(c.goal)}</span>
          </div>
        </div>

        <div style={{ flex:1 }}/>

        {/* Earning badge */}
        {joined&&earning&&(
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10, paddingBottom:10, borderBottom:`1px solid rgba(110,255,160,0.08)` }}>
            <span style={{ position:"relative", display:"inline-flex", width:6, height:6 }}>
              <span className="rainbow-bg animate-ping" style={{ position:"absolute", inset:0, borderRadius:"50%", opacity:0.5 }}/>
              <span className="rainbow-bg" style={{ position:"relative", display:"inline-flex", width:6, height:6, borderRadius:"50%" }}/>
            </span>
            <span className="rainbow-text" style={{ fontSize:11, fontFamily:"var(--font-geist-mono)", fontWeight:600 }}>Earning {c.dripHr} DRIP/hr</span>
          </div>
        )}

        {/* Join / Leave */}
        <button onClick={onToggle} data-cursor-hover
          style={{
            width:"100%", height:42, borderRadius:11,
            background: joined?"rgba(110,255,160,0.07)":T.el,
            border:`1px solid ${joined?"rgba(110,255,160,0.22)":T.border}`,
            color: joined?T.drip:T.fg,
            fontWeight:700, fontSize:13, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", gap:6,
            transition:"all 0.25s ease", letterSpacing:"0.01em", fontFamily:"inherit",
          }}>
          {joined?"✓ Joined":"+ Join Campaign"}
        </button>
      </div>
    </motion.div>
  );
}

// ─── Post card ────────────────────────────────────────────────────────────────
function PostCard({ post }: { post:Post }) {
  return (
    <div style={{ background:T.el, border:`1px solid rgba(110,255,160,0.12)`, borderRadius:14, padding:"14px 18px", display:"flex", alignItems:"center", gap:14 }}>
      <div style={{ width:38, height:38, borderRadius:10, background:"rgba(110,255,160,0.08)", border:"1px solid rgba(110,255,160,0.15)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
        <span className="rainbow-text" style={{ fontSize:16, lineHeight:1 }}>↑</span>
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <p style={{ fontSize:13, color:T.fg, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:3, lineHeight:1.4 }}>{post.snippet}</p>
        <p style={{ fontSize:11, color:T.faint, fontFamily:"var(--font-geist-mono)" }}>{fmtK(post.impressions)} impressions · {post.campaign}</p>
      </div>
      <div style={{ textAlign:"right", flexShrink:0 }}>
        <p className="rainbow-text" style={{ fontSize:16, fontFamily:"var(--font-geist-mono)", fontWeight:700, lineHeight:1, marginBottom:2 }}>+{post.dripHr}</p>
        <p style={{ fontSize:9, color:T.faint, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.1em" }}>DRIP/hr</p>
      </div>
    </div>
  );
}

// ─── Community feed ───────────────────────────────────────────────────────────
function CommunityFeed() {
  const [items, setItems] = useState<FeedEntry[]>(()=>
    Array.from({length:8},(_,i)=>({ id:String(i), ts:Date.now()-i*11000, handle:HANDLES[i%HANDLES.length], amount:rnd(0.05,2.8).toFixed(2), campaign:CNAMES[i%3] }))
  );
  useEffect(()=>{
    let t: ReturnType<typeof setTimeout>;
    function next() {
      t = setTimeout(()=>{
        setItems(prev=>[{
          id:uid(), ts:Date.now(),
          handle:HANDLES[Math.floor(Math.random()*HANDLES.length)],
          amount:rnd(0.04,2.6).toFixed(2),
          campaign:CNAMES[Math.floor(Math.random()*3)],
        },...prev.slice(0,9)]);
        next();
      }, rnd(2200,5200));
    }
    next(); return ()=>clearTimeout(t);
  },[]);

  const age = (ts:number) => { const s=Math.floor((Date.now()-ts)/1000); return s<60?`${s}s`:`${Math.floor(s/60)}m`; };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
      <AnimatePresence mode="popLayout">
        {items.slice(0,10).map(item=>(
          <motion.div key={item.id} layout
            initial={{ opacity:0, y:-14 }} animate={{ opacity:1, y:0 }}
            exit={{ opacity:0, height:0 }} transition={{ duration:0.3, ease }}
            style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 16px", borderRadius:11, background:T.el, border:`1px solid ${T.border}`, overflow:"hidden" }}>
            <div style={{ width:5, height:5, borderRadius:"50%", background:T.faint, flexShrink:0 }}/>
            <span className="rainbow-text" style={{ fontFamily:"var(--font-geist-mono)", fontWeight:700, flexShrink:0, fontSize:12 }}>{item.handle}</span>
            <span style={{ color:T.fg, fontFamily:"var(--font-geist-mono)", fontWeight:600, fontSize:12 }}>+{item.amount}</span>
            <span style={{ color:T.faint, fontSize:11, flexShrink:0 }}>DRIP</span>
            <span style={{ color:T.faint, fontSize:11, flex:1, textOverflow:"ellipsis", overflow:"hidden", whiteSpace:"nowrap" }}>{item.campaign}</span>
            <span style={{ color:T.faint, fontSize:10, fontFamily:"var(--font-geist-mono)", flexShrink:0 }}>{age(item.ts)}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ─── Submit modal ─────────────────────────────────────────────────────────────
function SubmitModal({ joined, campaigns, walletAddress, twitterHandle, onClose, onSuccess }: {
  joined:string[]; campaigns:Campaign[];
  walletAddress:string; twitterHandle:string;
  onClose:()=>void; onSuccess:(p:Post)=>void;
}) {
  const [url,      setUrl]      = useState("");
  const [campaign, setCampaign] = useState(joined[0]??"");
  const [state,    setState]    = useState<"idle"|"verifying"|"done"|"error">("idle");
  const [errMsg,   setErrMsg]   = useState("");

  const options = joined.map(id=>{
    const c = campaigns.find(c=>c.id===id);
    return c ? { value:id, label:c.project } : null;
  }).filter(Boolean) as SelectOption[];

  async function submit() {
    if (!url.trim()||!campaign) return;
    setState("verifying");
    setErrMsg("");
    try {
      const res = await api.submitPost({ walletAddress, twitterHandle, tweetUrl: url.trim(), campaignId: campaign });
      const c = campaigns.find(c=>c.id===campaign);
      onSuccess({
        id: res.post.id,
        snippet: url.trim(),
        campaign: c?.project ?? campaign,
        impressions: res.tweet.viewCount,
        dripHr: c ? +(c.dripHr ?? 0) : 0,
      });
      setState("done");
      await new Promise(r=>setTimeout(r,1200));
      onClose();
    } catch (err) {
      setErrMsg((err as Error).message);
      setState("error");
    }
  }

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center"
      initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      style={{ background:"rgba(15,17,19,0.92)", backdropFilter:"blur(20px)", padding:"0 16px" }}
      onClick={e=>e.target===e.currentTarget&&state==="idle"&&onClose()}>
      <motion.div initial={{ opacity:0, scale:0.95, y:16 }} animate={{ opacity:1, scale:1, y:0 }}
        exit={{ opacity:0, scale:0.95, y:16 }} transition={{ duration:0.3, ease }}
        style={{ width:"100%", maxWidth:420, background:T.surface, border:`1px solid ${T.border}`, borderRadius:22, overflow:"hidden", boxShadow:"0 40px 80px -20px rgba(0,0,0,0.7)" }}>
        <div className="rainbow-bg" style={{ height:2 }}/>
        <div style={{ padding:26 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:22 }}>
            <p style={{ fontSize:10, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.15em", color:T.faint }}>Submit Post</p>
            {state==="idle"&&<button onClick={onClose} data-cursor-hover style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:20, lineHeight:1, padding:4 }}>×</button>}
          </div>

          {state==="done"?(
            <div style={{ textAlign:"center", padding:"24px 0" }}>
              <motion.p initial={{ scale:0 }} animate={{ scale:1 }} transition={{ type:"spring", stiffness:220, damping:14 }}
                className="rainbow-text" style={{ fontSize:48, marginBottom:12 }}>✓</motion.p>
              <p style={{ fontWeight:700, fontSize:17, color:T.fg, marginBottom:4 }}>Post verified</p>
              <p style={{ fontSize:13, color:T.subtle }}>Earning DRIP now</p>
            </div>
          ):(
            <>
              {state==="error"&&errMsg&&(
                <motion.div initial={{ opacity:0, y:-6 }} animate={{ opacity:1, y:0 }}
                  style={{ background:"rgba(255,80,80,0.08)", border:"1px solid rgba(255,80,80,0.2)", borderRadius:10, padding:"10px 14px", marginBottom:14 }}>
                  <p style={{ fontSize:12, color:"#ff7070", lineHeight:1.5 }}>{errMsg}</p>
                </motion.div>
              )}
              <div style={{ marginBottom:14 }}>
                <label style={{ fontSize:10, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.12em", color:T.faint, display:"block", marginBottom:7 }}>Tweet URL</label>
                <input value={url} onChange={e=>{setUrl(e.target.value);if(state==="error")setState("idle");}} placeholder="https://x.com/handle/status/..."
                  style={{ width:"100%", height:44, background:T.el, border:`1px solid ${state==="error"?"rgba(255,80,80,0.35)":T.border}`, borderRadius:11, padding:"0 14px", fontSize:13, color:T.fg, outline:"none", transition:"border-color 0.2s", fontFamily:"inherit" }}
                  onFocus={e=>(e.target.style.borderColor="rgba(110,255,160,0.3)")}
                  onBlur={e=>(e.target.style.borderColor=state==="error"?"rgba(255,80,80,0.35)":T.border)}/>
              </div>
              <div style={{ marginBottom:22 }}>
                <label style={{ fontSize:10, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.12em", color:T.faint, display:"block", marginBottom:7 }}>Campaign</label>
                <Select options={options} value={campaign} onChange={setCampaign} placeholder="Select campaign..."/>
              </div>
              <button onClick={submit} disabled={!url.trim()||state==="verifying"} data-cursor-hover
                className={url.trim()&&state!=="verifying"?"rainbow-bg":""}
                style={{ width:"100%", height:48, borderRadius:12, border:"none", background:(!url.trim()||state==="verifying")?"rgba(255,255,255,0.05)":undefined, color:url.trim()&&state!=="verifying"?"#0A0A0B":T.faint, fontWeight:700, fontSize:14, cursor:url.trim()&&state!=="verifying"?"pointer":"not-allowed", display:"flex", alignItems:"center", justifyContent:"center", gap:8, fontFamily:"inherit" }}>
                {state==="verifying"?(<><motion.span animate={{ rotate:360 }} transition={{ duration:1, repeat:Infinity, ease:"linear" }} style={{ display:"inline-block" }}>⟳</motion.span>Verifying on X…</>):state==="error"?"Try Again":"Verify & Submit"}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Claim modal ──────────────────────────────────────────────────────────────
function ClaimModal({ claimable, onClose, onConfirm }: { claimable:number; onClose:()=>void; onConfirm:()=>void }) {
  const [state, setState] = useState<ClaimState>("idle");

  async function sign() {
    setState("signing");    await new Promise(r=>setTimeout(r,1600));
    setState("submitting"); await new Promise(r=>setTimeout(r,1100));
    setState("confirmed");  await new Promise(r=>setTimeout(r,1600));
    onConfirm(); onClose();
  }

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center"
      initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      style={{ background:"rgba(15,17,19,0.92)", backdropFilter:"blur(20px)", padding:"0 16px" }}
      onClick={e=>e.target===e.currentTarget&&state==="idle"&&onClose()}>
      <motion.div initial={{ opacity:0, scale:0.95, y:16 }} animate={{ opacity:1, scale:1, y:0 }}
        exit={{ opacity:0, scale:0.95, y:16 }} transition={{ duration:0.3, ease }}
        style={{ width:"100%", maxWidth:390, background:T.surface, border:`1px solid ${T.border}`, borderRadius:24, overflow:"hidden", boxShadow:"0 40px 80px -20px rgba(0,0,0,0.7)" }}>
        <div className="rainbow-bg" style={{ height:2 }}/>
        <div style={{ padding:28 }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:22 }}>
            <p style={{ fontSize:10, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.15em", color:T.faint }}>Claim Rewards</p>
            {state==="idle"&&<button onClick={onClose} data-cursor-hover style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", fontSize:20, lineHeight:1, padding:4 }}>×</button>}
          </div>

          {state==="confirmed"?(
            <div style={{ textAlign:"center", padding:"28px 0" }}>
              <motion.p initial={{ scale:0 }} animate={{ scale:1 }} transition={{ type:"spring", stiffness:220, damping:14 }}
                className="rainbow-text" style={{ fontSize:52, marginBottom:14 }}>✓</motion.p>
              <p style={{ fontWeight:700, fontSize:20, color:T.fg, marginBottom:6 }}>Claimed!</p>
              <p style={{ fontSize:13, color:T.subtle }}>{fmt(claimable)} DRIP sent to your wallet</p>
            </div>
          ):(
            <>
              <div style={{ background:T.el, border:`1px solid ${T.border}`, borderRadius:16, padding:"20px 22px", marginBottom:16 }}>
                <p style={{ fontSize:11, color:T.subtle, marginBottom:6 }}>Claiming</p>
                <p className="rainbow-text" style={{ fontSize:44, fontWeight:700, lineHeight:1, fontFamily:"var(--font-geist-mono)", letterSpacing:"-0.02em" }}>{fmt(claimable)}</p>
                <p style={{ fontSize:13, color:T.faint, marginTop:6, fontFamily:"var(--font-geist-mono)" }}>DRIP · ≈ ${fmt(claimable*DRIP_PRICE)} USD</p>
              </div>
              <div style={{ background:T.el, borderRadius:12, padding:"12px 16px", marginBottom:20 }}>
                {[["Network","Solana"],["Fee","< $0.01"],["Settlement","~2 sec"]].map(([l,v],i)=>(
                  <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:i>0?10:0, marginTop:i>0?10:0, borderTop:i>0?`1px solid ${T.border}`:"none" }}>
                    <span style={{ fontSize:12, color:T.subtle }}>{l}</span>
                    <span style={{ fontSize:12, color:T.fg, fontFamily:"var(--font-geist-mono)", fontWeight:600 }}>{v}</span>
                  </div>
                ))}
              </div>
              <button onClick={sign} disabled={state!=="idle"} data-cursor-hover
                className={state==="idle"?"rainbow-bg":""}
                style={{ width:"100%", height:50, borderRadius:13, border:"none", background:state!=="idle"?"rgba(255,255,255,0.05)":undefined, color:state==="idle"?"#0A0A0B":T.subtle, fontWeight:700, fontSize:15, cursor:state==="idle"?"pointer":"not-allowed", display:"flex", alignItems:"center", justifyContent:"center", gap:8, boxShadow:state==="idle"?"0 0 50px -10px rgba(110,255,160,0.3)":"none", fontFamily:"inherit" }}>
                {state==="idle"&&"Sign & Claim"}
                {state==="signing"&&<><motion.span animate={{ rotate:360 }} transition={{ duration:1, repeat:Infinity, ease:"linear" }} style={{ display:"inline-block" }}>⟳</motion.span>Signing...</>}
                {state==="submitting"&&<><motion.span animate={{ rotate:360 }} transition={{ duration:1, repeat:Infinity, ease:"linear" }} style={{ display:"inline-block" }}>⟳</motion.span>Submitting to Solana...</>}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
function Nav({ claimable, fillPct, onClaim, onSubmit, walletAddress, twitterHandle }: {
  claimable:number; fillPct:number; onClaim:()=>void; onSubmit:()=>void;
  walletAddress:string; twitterHandle:string;
}) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(()=>{
    const h = () => setScrolled(window.scrollY > 30);
    window.addEventListener("scroll", h, { passive:true });
    return ()=>window.removeEventListener("scroll", h);
  },[]);

  return (
    <>
      {/* Vault fill progress bar */}
      <motion.div className="rainbow-bg" style={{ position:"fixed", top:0, left:0, right:0, zIndex:60, height:2, scaleX:fillPct/100, transformOrigin:"left" }}/>

      <header style={{
        position:"fixed", top:2, left:0, right:0, zIndex:50, height:58,
        background: scrolled ? `${T.bg}f0` : "transparent",
        backdropFilter: scrolled ? "blur(24px)" : "none",
        borderBottom:`1px solid ${scrolled?T.border:"transparent"}`,
        transition:"background 0.35s, backdrop-filter 0.35s, border-color 0.35s",
        display:"flex", alignItems:"center",
      }}>
        <div style={{ width:"100%", maxWidth:1200, margin:"0 auto", padding:"0 24px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>

          {/* Logo */}
          <a href="#vault" data-cursor-hover style={{ display:"flex", alignItems:"center", gap:8, textDecoration:"none" }}>
            <span className="rainbow-text" style={{ fontSize:20, fontWeight:800, letterSpacing:"-0.04em" }}>DRIP</span>
            <span style={{ fontSize:9, fontFamily:"var(--font-geist-mono)", color:T.faint, background:T.el, border:`1px solid ${T.border}`, borderRadius:4, padding:"2px 6px", letterSpacing:"0.1em", textTransform:"uppercase" }}>beta</span>
          </a>

          {/* Nav links */}
          <nav className="nav-links" style={{ display:"flex", alignItems:"center", gap:2 }}>
            {[["#campaigns","Campaigns"],["#feed","Feed"]].map(([href,label])=>(
              <a key={href} href={href} data-cursor-hover
                style={{ padding:"6px 12px", borderRadius:8, fontSize:13, color:T.subtle, textDecoration:"none", transition:"color 0.2s", fontWeight:500 }}
                onMouseEnter={e=>(e.currentTarget.style.color=T.fg)}
                onMouseLeave={e=>(e.currentTarget.style.color=T.subtle)}>
                {label}
              </a>
            ))}
          </nav>

          {/* Right side */}
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {/* Account pills */}
            <div className="nav-account" style={{ display:"flex", alignItems:"center", gap:8 }}>
              {twitterHandle && (
                <div style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 11px", background:T.el, border:`1px solid ${T.border}`, borderRadius:9, fontSize:12, color:T.subtle }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill={T.subtle}><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  <span style={{ fontFamily:"var(--font-geist-mono)", fontWeight:600 }}>@{twitterHandle}</span>
                </div>
              )}
              {walletAddress && (
                <div style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 11px", background:T.el, border:`1px solid ${T.border}`, borderRadius:9, fontSize:12, color:T.subtle, fontFamily:"var(--font-geist-mono)" }}>
                  <span className="rainbow-bg" style={{ display:"inline-flex", width:6, height:6, borderRadius:"50%", flexShrink:0 }}/>
                  {walletAddress.slice(0,6)}…{walletAddress.slice(-4)}
                </div>
              )}
            </div>

            <button onClick={onSubmit} data-cursor-hover
              style={{ height:34, padding:"0 13px", borderRadius:8, cursor:"pointer", border:`1px solid ${T.border}`, background:T.el, color:T.subtle, fontSize:12, fontWeight:600, display:"flex", alignItems:"center", gap:4, transition:"color 0.2s, border-color 0.2s", fontFamily:"inherit" }}
              onMouseEnter={e=>{ (e.currentTarget as HTMLElement).style.color=T.fg; (e.currentTarget as HTMLElement).style.borderColor=T.faint; }}
              onMouseLeave={e=>{ (e.currentTarget as HTMLElement).style.color=T.subtle; (e.currentTarget as HTMLElement).style.borderColor=T.border; }}>
              <span style={{ fontSize:15, lineHeight:1 }}>+</span> Post
            </button>

            <AnimatePresence>
              {claimable>0.1&&(
                <motion.button key="claim" onClick={onClaim} data-cursor-hover
                  initial={{ opacity:0, scale:0.88 }} animate={{ opacity:1, scale:1 }} exit={{ opacity:0, scale:0.88 }}
                  whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }}
                  className="rainbow-bg"
                  style={{ height:34, padding:"0 14px", borderRadius:8, border:"none", color:"#0A0A0B", fontWeight:700, fontSize:12, cursor:"pointer", boxShadow:"0 0 30px -6px rgba(110,255,160,0.4)", display:"flex", alignItems:"center", gap:5, fontFamily:"inherit" }}>
                  Claim {fmt(claimable,0)} DRIP
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>
    </>
  );
}

// ─── Landing ──────────────────────────────────────────────────────────────────
function Landing({ onDone }: { onDone: (handle: string) => void }) {
  const { connect, publicKey, connected, connecting } = useWallet();
  const { setVisible } = useWalletModal();
  const [handle,    setHandle]    = useState("");
  const [handleSet, setHandleSet] = useState(false);
  const [xErr,      setXErr]      = useState("");

  // When wallet connects after user confirmed their handle, enter the app
  useEffect(() => {
    if (connected && publicKey && handleSet) {
      const clean = handle.replace(/^@/, "").trim();
      setTimeout(() => onDone(clean), 500);
    }
  }, [connected, publicKey, handleSet, handle, onDone]);

  function confirmHandle() {
    const clean = handle.replace(/^@/, "").trim();
    if (!clean) { setXErr("Enter your X handle to continue"); return; }
    if (!/^[A-Za-z0-9_]{1,15}$/.test(clean)) { setXErr("Invalid X handle — letters, numbers and underscores only"); return; }
    setXErr("");
    setHandleSet(true);
  }

  function connectWallet() {
    if (!handleSet) return;
    setVisible(true);
  }

  const xDone  = handleSet;
  const wDone  = connected && !!publicKey;

  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      style={{ position:"fixed", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:T.bg }}>
      {/* Ambient orbs */}
      <div style={{ position:"absolute", left:"-20%", top:"8%", width:640, height:640, borderRadius:"50%", background:"rgba(110,255,160,0.1)", filter:"blur(160px)", animation:"drift 22s ease-in-out infinite", pointerEvents:"none" }}/>
      <div style={{ position:"absolute", right:"-15%", top:"12%", width:560, height:560, borderRadius:"50%", background:"rgba(167,139,255,0.1)", filter:"blur(150px)", animation:"drift 26s ease-in-out infinite", animationDelay:"-9s", pointerEvents:"none" }}/>
      <div style={{ position:"absolute", bottom:"-10%", left:"30%", width:500, height:500, borderRadius:"50%", background:"rgba(96,208,255,0.08)", filter:"blur(130px)", animation:"drift 30s ease-in-out infinite", pointerEvents:"none" }}/>
      <div style={{ position:"absolute", inset:0, backgroundImage:"radial-gradient(circle at 1px 1px,rgba(255,255,255,0.07) 1px,transparent 0)", backgroundSize:"24px 24px", pointerEvents:"none" }}/>

      <div style={{ position:"relative", width:"100%", maxWidth:440, padding:"0 24px", textAlign:"center" }}>
        <motion.div initial={{ opacity:0, y:-20 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.7, ease }}>
          <p className="rainbow-text" style={{ fontSize:"clamp(4rem,15vw,6rem)", fontWeight:800, letterSpacing:"-0.045em", lineHeight:0.9 }}>DRIP</p>
          <p style={{ fontSize:15, color:T.subtle, marginTop:16, marginBottom:48, lineHeight:1.7 }}>
            Earn $DRIP for the attention<br/>you generate on X.
          </p>
        </motion.div>

        <motion.div initial={{ opacity:0, y:24 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.7, ease, delay:0.15 }}
          style={{ background:T.surface, border:`1px solid ${T.border}`, borderRadius:22, overflow:"hidden", boxShadow:"0 40px 80px -20px rgba(0,0,0,0.55)", marginBottom:18 }}>
          <div className="rainbow-bg" style={{ height:2 }}/>
          <div style={{ padding:22, display:"flex", flexDirection:"column", gap:8 }}>

            {/* Step 1: X handle */}
            <div style={{ background:T.el, borderRadius:12, border:`1px solid ${xDone?"rgba(110,255,160,0.2)":xErr?"rgba(255,80,80,0.3)":T.border}`, overflow:"hidden", transition:"border-color 0.4s" }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:11 }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill={xDone?"#6effa0":T.subtle}><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  <span style={{ fontSize:14, fontWeight:600, color:xDone?T.fg:T.subtle }}>Your X Handle</span>
                </div>
                {xDone
                  ? <span className="rainbow-text" style={{ fontSize:12, fontWeight:700 }}>✓ @{handle.replace(/^@/,"")}</span>
                  : <button data-cursor-hover onClick={confirmHandle} className="rainbow-bg" style={{ height:30, padding:"0 14px", borderRadius:7, border:"none", color:"#0A0A0B", fontWeight:700, fontSize:11, cursor:"pointer", fontFamily:"inherit" }}>Confirm</button>
                }
              </div>
              {!xDone&&(
                <div style={{ padding:"0 16px 14px" }}>
                  <input
                    value={handle}
                    onChange={e=>{ setHandle(e.target.value); setXErr(""); }}
                    onKeyDown={e=>e.key==="Enter"&&confirmHandle()}
                    placeholder="@yourhandle"
                    autoFocus
                    style={{ width:"100%", height:38, background:"rgba(255,255,255,0.04)", border:`1px solid ${xErr?"rgba(255,80,80,0.4)":T.border}`, borderRadius:9, padding:"0 12px", fontSize:13, color:T.fg, outline:"none", fontFamily:"var(--font-geist-mono)", letterSpacing:"0.01em" }}
                  />
                  {xErr&&<p style={{ fontSize:11, color:"#ff7070", marginTop:6, textAlign:"left" }}>{xErr}</p>}
                </div>
              )}
            </div>

            {/* Step 2: Phantom wallet */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px", background:T.el, borderRadius:12, border:`1px solid ${wDone?"rgba(110,255,160,0.2)":T.border}`, opacity:xDone?1:0.4, transition:"opacity 0.4s, border-color 0.4s", pointerEvents:xDone?"auto":"none" }}>
              <div style={{ display:"flex", alignItems:"center", gap:11 }}>
                <div style={{ width:15, height:15, borderRadius:4, background:wDone?"#6effa0":T.faint, transition:"background 0.4s" }}/>
                <span style={{ fontSize:14, fontWeight:600, color:wDone?T.fg:T.subtle }}>Connect Phantom Wallet</span>
              </div>
              {!xDone&&<span style={{ fontSize:11, color:T.faint }}>Confirm handle first</span>}
              {xDone&&!wDone&&(
                <button data-cursor-hover onClick={connectWallet} className="rainbow-bg"
                  style={{ height:30, padding:"0 14px", borderRadius:7, border:"none", color:"#0A0A0B", fontWeight:700, fontSize:11, cursor:"pointer", fontFamily:"inherit", opacity:connecting?0.6:1 }}>
                  {connecting?"Connecting…":"Connect"}
                </button>
              )}
              {wDone&&<span className="rainbow-text" style={{ fontSize:12, fontWeight:700 }}>✓ {publicKey!.toString().slice(0,6)}…{publicKey!.toString().slice(-4)}</span>}
            </div>
          </div>
        </motion.div>

        <motion.p initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:0.4 }}
          style={{ fontSize:11, color:T.faint, fontFamily:"var(--font-geist-mono)" }}>
          Your keys. Your vault. Non-custodial.
        </motion.p>
      </div>
    </motion.div>
  );
}

// ─── Custom cursor ────────────────────────────────────────────────────────────
function Cursor() {
  const dotRef  = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const [vis,   setVis]   = useState(false);
  const [click, setClick] = useState(false);
  const [hover, setHover] = useState(false);
  useEffect(()=>{
    if (window.matchMedia("(pointer:coarse)").matches) return;
    let rx=0,ry=0,dx=0,dy=0,raf=0;
    const mv=(e:MouseEvent)=>{ dx=e.clientX;dy=e.clientY;if(!vis)setVis(true);setHover(!!(e.target as HTMLElement).closest("a,button,[data-cursor-hover]")); };
    const md=()=>setClick(true); const mu=()=>setClick(false);
    const loop=()=>{rx+=(dx-rx)*0.1;ry+=(dy-ry)*0.1;dotRef.current&&(dotRef.current.style.transform=`translate(${dx}px,${dy}px)`);ringRef.current&&(ringRef.current.style.transform=`translate(${rx}px,${ry}px)`);raf=requestAnimationFrame(loop);};
    document.addEventListener("mousemove",mv);document.addEventListener("mousedown",md);document.addEventListener("mouseup",mu);
    raf=requestAnimationFrame(loop);
    return()=>{ document.removeEventListener("mousemove",mv);document.removeEventListener("mousedown",md);document.removeEventListener("mouseup",mu);cancelAnimationFrame(raf); };
  },[vis]);
  if(!vis) return null;
  const rs=hover?44:click?20:32, ds=hover?3:click?10:5;
  return (
    <>
      <div ref={ringRef} className="fixed top-0 left-0 pointer-events-none z-[9998] rounded-full transition-[width,height] duration-200"
        style={{ width:rs, height:rs, marginLeft:-(rs/2), marginTop:-(rs/2), border:"1px solid rgba(255,255,255,0.25)" }}/>
      <div ref={dotRef} className="rainbow-bg fixed top-0 left-0 pointer-events-none z-[9999] rounded-full transition-[width,height] duration-150"
        style={{ width:ds, height:ds, marginLeft:-(ds/2), marginTop:-(ds/2) }}/>
    </>
  );
}

// ─── Main app ─────────────────────────────────────────────────────────────────
function DripApp({ walletAddress, twitterHandle }: { walletAddress: string; twitterHandle: string }) {
  const [balance,   setBalance]   = useState(0);
  const [claimable, setClaimable] = useState(0);
  const [fillPct,   setFillPct]   = useState(0);
  const [drops,     setDrops]     = useState<Drop[]>([]);
  const [ripples,   setRipples]   = useState<Ripple[]>([]);
  const [joined,    setJoined]    = useState(new Set(["c1"]));
  const [posts,     setPosts]     = useState<Post[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>(CAMPAIGNS);
  const [showClaim, setShowClaim] = useState(false);
  const [showPost,  setShowPost]  = useState(false);

  // Load real vault + campaigns from API on mount
  useEffect(() => {
    async function load() {
      try {
        const [camRes, vaultRes] = await Promise.all([
          api.getCampaigns(),
          walletAddress ? api.getVault(walletAddress) : null,
        ]);
        // Map API campaigns to local Campaign shape
        const mapped: Campaign[] = camRes.campaigns.map(c => ({
          id: c.id, project: c.project, av: c.logo,
          budgetTotal: c.budgetTotal, budgetLeft: c.budgetLeft,
          goal: c.goal, verified: c.verified,
          rateLabel: c.rateLabel, dripHr: c.dripPerKViews * 100,
          participants: c.participants,
        }));
        setCampaigns(mapped);

        if (vaultRes) {
          setBalance(vaultRes.vault.balance);
          setClaimable(vaultRes.vault.claimable);
          setFillPct(vaultRes.vault.fillPct);
        }
      } catch {
        // API unavailable — fall back to mock data silently
      }
    }
    load();
  }, [walletAddress]);

  // Load tracked posts
  useEffect(() => {
    if (!walletAddress) return;
    api.getVaultPosts(walletAddress).then(res => {
      const mapped: Post[] = res.posts.map(p => ({
        id: p.id,
        snippet: p.tweetUrl,
        campaign: p.campaignName ?? p.campaignId,
        impressions: p.impressions,
        dripHr: p.dripHr ?? 0,
      }));
      if (mapped.length) setPosts(mapped);
    }).catch(() => {});
  }, [walletAddress]);

  const totalRate = Array.from(joined).reduce((s,id)=>s+(campaigns.find(c=>c.id===id)?.dripHr??0),0);
  const active    = totalRate > 0;

  // Parallax on hero scroll-out
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target:heroRef, offset:["start start","end start"] });
  const heroY       = useTransform(scrollYProgress,[0,1],[0,-110]);
  const heroOpacity = useTransform(scrollYProgress,[0,0.55],[1,0]);

  // Drip engine
  useEffect(()=>{
    if(!active) return;
    let tid: ReturnType<typeof setTimeout>;
    function sched(){
      const delay=rnd(1400,4000);
      tid=setTimeout(()=>{
        const amount=(totalRate/3600)*(delay/1000)*rnd(0.65,1.35);
        setBalance(p=>p+amount);
        setClaimable(p=>p+amount*0.65);
        setFillPct(p=>Math.min(93,p+rnd(0.05,0.13)));
        const scoreVal = Math.max(1, Math.round(totalRate * rnd(0.4, 1.8)));
        const drop:Drop={ id:uid(), x:rnd(28,192), size:rnd(7,12), duration:rnd(0.7,1.2), score:scoreVal };
        setDrops(p=>[...p,drop]);
        setTimeout(()=>{
          const rp:Ripple={ id:uid(), x:drop.x };
          setRipples(p=>[...p,rp]);
          setTimeout(()=>setRipples(p=>p.filter(r=>r.id!==rp.id)),1100);
        }, drop.duration*1000-70);
        sched();
      },delay);
    }
    sched(); return()=>clearTimeout(tid);
  },[active,totalRate]);

  const removeDropById = useCallback((id:string)=>setDrops(p=>p.filter(d=>d.id!==id)),[]);

  const handleClaim = useCallback(async (amount: number) => {
    // Optimistic UI update
    setBalance(p=>p-amount);
    setClaimable(0);
    setFillPct(p=>Math.max(4,p-amount/20));
    if (walletAddress) {
      api.claimRewards(walletAddress, amount).catch(console.error);
    }
  },[claimable, walletAddress]);

  const handleSubmit = useCallback((post:Post)=>setPosts(p=>[post,...p]),[]);
  const toggleCampaign = (id:string)=>setJoined(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n; });

  return (
    <>
      <Nav claimable={claimable} fillPct={fillPct} onClaim={()=>setShowClaim(true)} onSubmit={()=>setShowPost(true)} walletAddress={walletAddress} twitterHandle={twitterHandle}/>

      {/* ════ HERO ════ */}
      <section ref={heroRef} id="vault" style={{ minHeight:"100vh", position:"relative", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", paddingTop:60, paddingBottom:44, overflow:"hidden" }}>

        {/* Ambient bg */}
        <div style={{ position:"absolute", inset:0, pointerEvents:"none" }}>
          <div className="animate-drift"       style={{ position:"absolute", left:"-18%", top:"5%",   width:700, height:700, borderRadius:"50%", background:"rgba(255,255,255,0.04)", filter:"blur(160px)" }}/>
          <div className="animate-drift-delay" style={{ position:"absolute", right:"-14%",top:"15%",  width:600, height:600, borderRadius:"50%", background:"rgba(180,180,200,0.04)", filter:"blur(140px)" }}/>
          <div className="animate-drift-slow"  style={{ position:"absolute", bottom:"-5%",left:"35%", width:480, height:480, borderRadius:"50%", background:"rgba(200,200,220,0.03)",  filter:"blur(130px)" }}/>
          <div className="grid-dots-dark"       style={{ position:"absolute", inset:0 }}/>
          <div className="noise-overlay-dark"   style={{ position:"absolute", inset:0, opacity:0.35 }}/>
        </div>

        {/* Parallax content */}
        <motion.div style={{ y:heroY, opacity:heroOpacity, position:"relative", zIndex:1, display:"flex", flexDirection:"column", alignItems:"center", textAlign:"center", padding:"0 24px", flex:1, justifyContent:"center" }}>

          {/* Live badge */}
          <motion.div initial={{ opacity:0, y:-12 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.6, ease, delay:0.1 }} style={{ marginBottom:32 }}>
            <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"7px 16px", borderRadius:9999, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", backdropFilter:"blur(8px)" }}>
              <span style={{ position:"relative", display:"inline-flex", width:6, height:6 }}>
                <span className="rainbow-bg animate-ping" style={{ position:"absolute", inset:0, borderRadius:"50%", opacity:0.5 }}/>
                <span className="rainbow-bg" style={{ position:"relative", display:"inline-flex", width:6, height:6, borderRadius:"50%" }}/>
              </span>
              <span style={{ fontSize:12, color:T.subtle, fontFamily:"var(--font-geist-mono)" }}>{campaigns.length} campaigns live</span>
            </div>
          </motion.div>

          {/* Vault */}
          <motion.div initial={{ opacity:0, scale:0.93 }} animate={{ opacity:1, scale:1 }} transition={{ duration:0.8, ease, delay:0.15 }} style={{ marginBottom:32, position:"relative" }}>
            <div className="animate-drift-slow" style={{
              position:"absolute", width:400, height:400, borderRadius:"50%",
              background:`rgba(255,255,255,${active?0.07:0.025})`,
              filter:"blur(90px)", left:"50%", top:"50%",
              transform:"translate(-50%,-50%)",
              pointerEvents:"none", transition:"background 1.5s ease",
            }}/>
              <div className="vault-scale-wrapper">
              <Vault fillPct={fillPct} drops={drops} ripples={ripples} onDropEnd={removeDropById} active={active}/>
            </div>
          </motion.div>

          {/* Balance */}
          <motion.div initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.6, ease, delay:0.3 }} style={{ marginBottom:10 }}>
            <div style={{ lineHeight:1, marginBottom:6 }}>
              <span className="rainbow-text" style={{ fontSize:"clamp(3.4rem,8vw,5.5rem)", fontWeight:800, fontFamily:"var(--font-geist-mono)", letterSpacing:"-0.04em" }}>
                <AnimNum value={balance} d={2}/>
              </span>
              <span style={{ fontSize:18, color:T.faint, fontFamily:"var(--font-geist-mono)", marginLeft:12 }}>DRIP</span>
            </div>
            <p style={{ fontSize:14, color:T.subtle }}>≈ ${fmt(balance*DRIP_PRICE)} USD</p>
          </motion.div>

          {/* Rate badge */}
          <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ duration:0.6, ease, delay:0.4 }} style={{ marginBottom:28 }}>
            <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"7px 18px", borderRadius:9999, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.1)", backdropFilter:"blur(8px)" }}>
              {active?(
                <>
                  <span style={{ position:"relative", display:"inline-flex", width:6, height:6 }}>
                    <span className="rainbow-bg animate-ping" style={{ position:"absolute", inset:0, borderRadius:"50%", opacity:0.55 }}/>
                    <span className="rainbow-bg" style={{ position:"relative", display:"inline-flex", width:6, height:6, borderRadius:"50%" }}/>
                  </span>
                  <span className="rainbow-text" style={{ fontSize:13, fontFamily:"var(--font-geist-mono)", fontWeight:600 }}>
                    +{fmt(totalRate,1)} DRIP/hr — {joined.size} {joined.size===1?"campaign":"campaigns"} active
                  </span>
                </>
              ):(
                <span style={{ fontSize:13, fontFamily:"var(--font-geist-mono)", color:T.faint }}>Join a campaign below to start earning</span>
              )}
            </div>
          </motion.div>

          {/* CTAs */}
          <motion.div initial={{ opacity:0, y:14 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.6, ease, delay:0.5 }}
            style={{ display:"flex", gap:10, flexWrap:"wrap", justifyContent:"center" }}>
            <motion.button
              onClick={()=>claimable>0.1&&setShowClaim(true)}
              disabled={claimable<=0.1}
              whileHover={claimable>0.1?{ scale:1.03 }:{}}
              whileTap={claimable>0.1?{ scale:0.97 }:{}}
              data-cursor-hover
              className={claimable>0.1?"rainbow-bg":""}
              style={{ height:52, padding:"0 28px", borderRadius:13, border:"none", background:claimable<=0.1?"rgba(255,255,255,0.06)":undefined, color:claimable>0.1?"#0A0A0B":T.faint, fontWeight:700, fontSize:15, cursor:claimable>0.1?"pointer":"not-allowed", boxShadow:claimable>0.1?"0 0 60px -12px rgba(255,255,255,0.15)":"none", transition:"box-shadow 0.4s", fontFamily:"inherit" }}>
              {claimable>0.1?`Claim ${fmt(claimable)} DRIP`:"Nothing to claim yet"}
            </motion.button>
            <motion.button
              onClick={()=>setShowPost(true)}
              whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }}
              data-cursor-hover
              style={{ height:52, padding:"0 26px", borderRadius:13, border:`1px solid ${T.border}`, background:T.el, color:T.fg, fontWeight:600, fontSize:14, cursor:"pointer", display:"flex", alignItems:"center", gap:8, fontFamily:"inherit", transition:"border-color 0.2s" }}
              onMouseEnter={e=>{ (e.currentTarget as HTMLElement).style.borderColor=T.faint; }}
              onMouseLeave={e=>{ (e.currentTarget as HTMLElement).style.borderColor=T.border; }}>
              <span style={{ fontSize:18, lineHeight:1 }}>+</span> Submit Post
            </motion.button>
          </motion.div>
        </motion.div>

        {/* Ticker */}
        <div style={{ position:"absolute", bottom:0, left:0, right:0, height:44, overflow:"hidden", borderTop:`1px solid ${T.border}`, background:`${T.bg}cc`, backdropFilter:"blur(8px)", zIndex:1 }}>
          <Ticker/>
        </div>
      </section>

      {/* ════ STATS STRIP ════ */}
      <StatsStrip/>

      {/* ════ CAMPAIGNS ════ */}
      <section id="campaigns" style={{ padding:"96px 0 80px", background:T.bg }}>
        <div style={{ maxWidth:1200, margin:"0 auto", padding:"0 24px" }}>
          <Reveal>
            <div style={{ marginBottom:52 }}>
              <p style={{ fontSize:10, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.18em", color:T.faint, marginBottom:14 }}>01 — Campaigns</p>
              <h2 style={{ fontSize:"clamp(2.4rem,5vw,4rem)", fontWeight:800, textTransform:"uppercase", letterSpacing:"-0.04em", lineHeight:0.92, margin:0 }}>
                Join a<br/><span className="rainbow-text">Campaign</span>
              </h2>
            </div>
          </Reveal>
          <div className="campaign-grid">
            {campaigns.map((c,i)=>(
              <CampaignCard key={c.id} c={c} joined={joined.has(c.id)} onToggle={()=>toggleCampaign(c.id)} earning={joined.has(c.id)&&active} index={i}/>
            ))}
          </div>
        </div>
      </section>

      {/* ════ FEED ════ */}
      <section id="feed" style={{ padding:"80px 0 96px", background:T.surface, borderTop:`1px solid ${T.border}` }}>
        <div style={{ maxWidth:1200, margin:"0 auto", padding:"0 24px" }}>

          {/* Your Posts */}
          <Reveal>
            <div style={{ marginBottom:40 }}>
              <p style={{ fontSize:10, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.18em", color:T.faint, marginBottom:14 }}>02 — Your posts</p>
              <h2 style={{ fontSize:"clamp(2.4rem,5vw,4rem)", fontWeight:800, textTransform:"uppercase", letterSpacing:"-0.04em", lineHeight:0.92, margin:0 }}>
                Your<br/><span className="rainbow-text">Earnings</span>
              </h2>
            </div>
          </Reveal>

          <Reveal delay={0.1}>
            {posts.length>0?(
              <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:64 }}>
                {posts.map(p=><PostCard key={p.id} post={p}/>)}
              </div>
            ):(
              <div style={{ marginBottom:64, padding:"40px 24px", borderRadius:16, border:`1px dashed ${T.border}`, textAlign:"center" }}>
                <p style={{ fontSize:13, color:T.faint, marginBottom:16 }}>No posts yet — join a campaign and submit your tweet to start earning.</p>
                <button onClick={()=>setShowPost(true)} data-cursor-hover
                  style={{ height:38, padding:"0 18px", borderRadius:9, border:`1px solid ${T.border}`, background:T.el, color:T.subtle, fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"inherit" }}>
                  Submit Post
                </button>
              </div>
            )}
          </Reveal>

          {/* Live feed */}
          <Reveal delay={0.15}>
            <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:12 }}>
              <div>
                <p style={{ fontSize:10, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.18em", color:T.faint, marginBottom:14 }}>03 — Community</p>
                <h3 style={{ fontSize:"clamp(2rem,4vw,3.2rem)", fontWeight:800, textTransform:"uppercase", letterSpacing:"-0.04em", lineHeight:0.92, margin:0 }}>
                  Live <span className="rainbow-text">Feed</span>
                </h3>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:7, paddingBottom:4 }}>
                <span style={{ position:"relative", display:"inline-flex", width:6, height:6 }}>
                  <span className="rainbow-bg animate-ping" style={{ position:"absolute", inset:0, borderRadius:"50%", opacity:0.6 }}/>
                  <span className="rainbow-bg" style={{ position:"relative", display:"inline-flex", width:6, height:6, borderRadius:"50%" }}/>
                </span>
                <span className="rainbow-text" style={{ fontSize:11, fontFamily:"var(--font-geist-mono)", fontWeight:600, letterSpacing:"0.08em" }}>LIVE</span>
              </div>
            </div>
            <CommunityFeed/>
          </Reveal>
        </div>
      </section>

      {/* ════ FOOTER ════ */}
      <footer style={{ background:T.bg, borderTop:`1px solid ${T.border}`, padding:"24px 24px" }}>
        <div style={{ maxWidth:1200, margin:"0 auto", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:12 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span className="rainbow-text" style={{ fontSize:15, fontWeight:800, letterSpacing:"-0.04em" }}>DRIP</span>
            <span style={{ fontSize:12, color:T.faint }}>Web3 creator rewards on Solana.</span>
          </div>
          <p style={{ fontSize:11, color:T.faint, fontFamily:"var(--font-geist-mono)" }}>Non-custodial · Your keys · Your vault</p>
        </div>
      </footer>

      {/* Modals */}
      <AnimatePresence>
        {showClaim&&<ClaimModal key="claim" claimable={claimable} onClose={()=>setShowClaim(false)} onConfirm={()=>handleClaim(claimable)}/>}
        {showPost &&<SubmitModal key="submit" joined={Array.from(joined)} campaigns={campaigns} walletAddress={walletAddress} twitterHandle={twitterHandle} onClose={()=>setShowPost(false)} onSuccess={handleSubmit}/>}
      </AnimatePresence>
    </>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function Page() {
  const { publicKey } = useWallet();
  const [screen,        setScreen]        = useState<Screen>("landing");
  const [twitterHandle, setTwitterHandle] = useState("");

  function handleLandingDone(handle: string) {
    setTwitterHandle(handle);
    setScreen("app");
  }

  return (
    <TipProvider>
      <div style={{ background:T.bg, color:T.fg, minHeight:"100vh" }}>
        <Cursor/>
        <AnimatePresence mode="wait">
          {screen==="landing"
            ? <Landing key="landing" onDone={handleLandingDone}/>
            : <motion.div key="app" initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ duration:0.5 }}>
                <DripApp walletAddress={publicKey?.toString() ?? ""} twitterHandle={twitterHandle}/>
              </motion.div>
          }
        </AnimatePresence>
      </div>
    </TipProvider>
  );
}
