"use client";

import {
  motion, AnimatePresence, useSpring,
  useInView,
} from "motion/react";
import {
  useEffect, useRef, useState, useCallback,
  createContext, useContext,
} from "react";
import { createPortal } from "react-dom";
import type { CSSProperties } from "react"; // used by HoloCard
import { useWallet } from "@solana/wallet-adapter-react";
import WalletSelectModal from "@/components/WalletSelectModal";
import { api } from "@/lib/api";
import type { Campaign as APICampaign, Post as APIPost, Vault as APIVault } from "@/lib/api";
import Image from "next/image";

// â”€â”€â”€ Design tokens â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const T = {
  bg:      "#111114",
  surface: "#18181C",
  el:      "rgba(255,255,255,0.05)",
  border:  "rgba(255,255,255,0.09)",
  fg:      "#F4F4F8",
  subtle:  "#8888A0",
  faint:   "#44445A",
  drip:    "#E8E8FF",
} as const;

const ease = [0.22, 1, 0.36, 1] as const;
const DRIP_PRICE = 1.50;
const VAULT_W = 300;
const VAULT_H = 630;
const NAV_H   = 60; // matches header height

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
type Screen     = "landing" | "app";
type ClaimState = "idle" | "signing" | "submitting" | "confirmed";
interface Drop   { id: string; x: number; size: number; duration: number; score: number }
interface Ripple { id: string; x: number }
interface Campaign  { id: string; project: string; av: string; budgetTotal: number; budgetLeft: number; goal: number; verified: number; rateLabel: string; dripHr: number; participants: number }
interface FeedEntry { id: string; handle: string; pfp: string; campaign: string; earned: string; impressions: number; tweetUrl: string; submittedAt: string }
interface Post      { id: string; snippet: string; campaign: string; impressions: number; dripHr: number }


// Campaign visual gradients (portrait card "image" area)
const CGRADIENT: Record<string,string> = {
  c1: "linear-gradient(145deg, rgba(255,255,255,0.12) 0%, rgba(200,185,255,0.08) 50%, rgba(5,5,8,0.95) 100%)",
  c2: "linear-gradient(145deg, rgba(200,220,255,0.12) 0%, rgba(180,200,255,0.08) 50%, rgba(5,5,8,0.95) 100%)",
  c3: "linear-gradient(145deg, rgba(180,240,255,0.12) 0%, rgba(200,230,255,0.08) 50%, rgba(5,5,8,0.95) 100%)",
  c4: "linear-gradient(145deg, rgba(220,200,255,0.12) 0%, rgba(200,210,255,0.08) 50%, rgba(5,5,8,0.95) 100%)",
};

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const fmt  = (n:number,d=2) => n.toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtK = (n:number) => n>=1_000_000?(n/1_000_000).toFixed(1)+"M":n>=1_000?Math.round(n/1_000)+"K":String(n);
const uid  = () => Math.random().toString(36).slice(2);
const rnd  = (lo:number,hi:number) => lo+Math.random()*(hi-lo);

// â”€â”€â”€ Tooltip context â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
              fontSize:14,
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

// â”€â”€â”€ Custom Select â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface SelectOption { value: string; label: string }

function Select({ options, value, onChange, placeholder="Select..." }: {
  options: SelectOption[]; value: string; onChange:(v:string)=>void; placeholder?:string;
}) {
  const [open, setOpen] = useState(false);
  const [pos,  setPos]  = useState({ top:0, left:0, width:0, above:false });
  const btnRef  = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [portalEl, setPortalEl] = useState<Element|null>(null);
  const selected = options.find(o => o.value === value);

  useEffect(() => {
    setPortalEl(document.getElementById("dropdown-portal") ?? document.body);
  }, []);

  const ITEM_H = 46;
  const handleToggle = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      const menuH = Math.min(options.length * ITEM_H, 240) + 8;
      const spaceBelow = window.innerHeight - rect.bottom;
      const above = spaceBelow < menuH + 12 && rect.top > menuH + 12;
      setPos({
        top:   above ? rect.top - menuH - 6 : rect.bottom + 6,
        left:  rect.left,
        width: rect.width,
        above,
      });
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

  // Chevron SVG — avoids encoding corruption issues
  const Chevron = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink:0, color:T.faint, transition:"transform 0.18s", transform: open ? "rotate(180deg)" : "rotate(0deg)" }}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  );

  const menu = (
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
            zIndex:99999,
            background:"#1a1b1f",
            border:`1px solid ${T.border}`,
            borderRadius:12,
            overflow:"hidden",
            boxShadow:"0 20px 60px -10px rgba(0,0,0,0.9), 0 0 0 1px rgba(255,255,255,0.04)",
          }}>
          {options.map((opt, i) => (
            <button key={opt.value} data-cursor-hover
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                display:"block", width:"100%",
                padding:"12px 16px", textAlign:"left",
                background: opt.value===value ? "rgba(255,255,255,0.07)" : "transparent",
                color: opt.value===value ? T.drip : T.fg,
                fontSize:15, border:"none", cursor:"pointer",
                borderBottom: i < options.length-1 ? `1px solid ${T.border}` : "none",
                fontFamily:"inherit", transition:"background 0.12s",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = opt.value===value ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.05)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = opt.value===value ? "rgba(255,255,255,0.07)" : "transparent"; }}>
              {opt.label}
            </button>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <button ref={btnRef} onClick={handleToggle} data-cursor-hover
        style={{
          width:"100%", height:48, padding:"0 14px 0 16px",
          background:T.el,
          border:`1px solid ${open ? "rgba(255,255,255,0.25)" : T.border}`,
          borderRadius:11, cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"space-between", gap:8,
          fontSize:15, color: selected ? T.fg : T.faint,
          transition:"border-color 0.2s", fontFamily:"inherit",
        }}>
        <span style={{ flex:1, textAlign:"left", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
          {selected?.label ?? placeholder}
        </span>
        <Chevron/>
      </button>
      {portalEl && createPortal(menu, portalEl)}
    </>
  );
}

// ─── Custom number input with +/- buttons ───────────────────────────────────
function NumInput({ value, onChange, min=0, max=Infinity, step=1 }: {
  value:number; onChange:(v:number)=>void; min?:number; max?:number; step?:number;
}) {
  const adjust = (delta: number) => {
    const next = +(value + delta).toFixed(10);
    onChange(Math.max(min, Math.min(max, next)));
  };
  const btnBase: React.CSSProperties = {
    width:48, height:"100%", border:"none", background:"none",
    color:T.subtle, fontSize:22, fontWeight:300, cursor:"pointer",
    display:"flex", alignItems:"center", justifyContent:"center",
    flexShrink:0, transition:"color 0.15s", lineHeight:1,
    fontFamily:"var(--font-geist-mono)",
  };
  return (
    <div style={{ display:"flex", alignItems:"stretch", background:T.el, border:`1px solid ${T.border}`, borderRadius:11, overflow:"hidden", height:48 }}>
      <button style={{ ...btnBase, borderRight:`1px solid ${T.border}` }} onClick={() => adjust(-step)}
        onMouseEnter={e=>(e.currentTarget.style.color=T.fg)} onMouseLeave={e=>(e.currentTarget.style.color=T.subtle)}>−</button>
      <input type="number" value={value}
        onChange={e => { const v=parseFloat(e.target.value); if(!isNaN(v)) onChange(Math.max(min,Math.min(max,v))); }}
        style={{ flex:1, height:"100%", background:"none", border:"none", textAlign:"center",
          fontSize:16, color:T.fg, fontFamily:"var(--font-geist-mono)", fontWeight:600, outline:"none", minWidth:0 }}/>
      <button style={{ ...btnBase, borderLeft:`1px solid ${T.border}` }} onClick={() => adjust(step)}
        onMouseEnter={e=>(e.currentTarget.style.color=T.fg)} onMouseLeave={e=>(e.currentTarget.style.color=T.subtle)}>+</button>
    </div>
  );
}


// â”€â”€â”€ Wave surface — fill + glowing stroke on ONE path so they're perfectly unified
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
        fill="rgba(255,255,255,0.15)"
        stroke="rgba(255,255,255,0.85)"
        strokeWidth="1.6"
        filter="url(#waveGlow)"
        animate={{ d: paths }}
        transition={{ duration:3.6, repeat:Infinity, ease:"easeInOut" }}/>
    </svg>
  );
}

// â”€â”€â”€ Drop particle — teardrop + score label fall together â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        color:"rgba(255,255,255,0.96)",
        textShadow:"0 0 10px rgba(255,255,255,0.9), 0 0 24px rgba(220,210,255,0.5)",
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
        background:"linear-gradient(175deg, rgba(255,255,255,0.95) 0%, rgba(210,200,255,0.8) 100%)",
        boxShadow:`0 0 ${drop.size + 4}px rgba(255,255,255,0.7), 0 2px ${drop.size * 2 + 2}px rgba(220,210,255,0.3)`,
        flexShrink:0,
      }}/>
    </motion.div>
  );
}

// â”€â”€â”€ Ripple effect (multi-ring water impact) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
          boxShadow: i===0 ? "0 0 8px 1px rgba(255,255,255,0.35)" : "none",
        }}
          initial={{ scaleX:1, scaleY:1, opacity:r.opacity }}
          animate={{ scaleX:r.scaleX, scaleY:r.scaleY, opacity:0 }}
          transition={{ duration:r.dur, ease:"easeOut", delay:r.delay }}/>
      ))}
      {/* Central flash on impact */}
      <motion.div style={{
        position:"absolute", left:ripple.x, top:y,
        width:10, height:10, borderRadius:"50%",
        background:"rgba(255,255,255,0.9)",
        marginLeft:-5, marginTop:-5, pointerEvents:"none",
        filter:"blur(2px)",
      }}
        initial={{ scale:1, opacity:0.9 }}
        animate={{ scale:0, opacity:0 }}
        transition={{ duration:0.25, ease:"easeOut" }}/>
    </>
  );
}

// â”€â”€â”€ Vault â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function Vault({ fillPct, drops, ripples, onDropEnd, active }: {
  fillPct:number; drops:Drop[]; ripples:Ripple[];
  onDropEnd:(id:string)=>void; active:boolean;
}) {
  return (
    <div style={{
      position:"relative", width:VAULT_W, height:VAULT_H,
      background:"rgba(255,255,255,0.015)",
      overflow:"hidden",
      boxShadow: active
        ? "inset 0 0 80px -20px rgba(255,255,255,0.06)"
        : "none",
      transition:"box-shadow 1.2s ease",
    }}>
      {[20,40,60,80].map(p=>(
        <div key={p} style={{ position:"absolute", right:0, bottom:`${p}%`, display:"flex", alignItems:"center" }}>
          <span style={{ fontSize:7, color:"rgba(255,255,255,0.18)", fontFamily:"var(--font-geist-mono)", paddingRight:6 }}>{p}</span>
          <div style={{ width:12, height:1, background:"rgba(255,255,255,0.1)" }}/>
        </div>
      ))}
      <motion.div style={{ position:"absolute", bottom:0, left:0, right:0, overflow:"visible" }}
        animate={{ height:`${fillPct}%` }} transition={{ duration:2.6, ease:[0.22,1,0.36,1] }}>
        <WaveSurface/>
        <div style={{ position:"absolute", top:8, bottom:0, left:0, right:0, background:"linear-gradient(to top,rgba(255,255,255,0.1) 0%,rgba(255,255,255,0.03) 100%)" }}/>
        <div style={{ position:"absolute", top:8, height:36, left:0, right:0, background:"linear-gradient(to bottom,rgba(255,255,255,0.12) 0%,transparent 100%)" }}/>
      </motion.div>
      {drops.map(d=><DropParticle key={d.id} drop={d} fillPct={fillPct} onEnd={()=>onDropEnd(d.id)}/>)}
      {ripples.map(r=><RippleEffect key={r.id} ripple={r} fillPct={fillPct}/>)}
      {/* Glass sheen */}
      <div style={{ position:"absolute", inset:0, background:"linear-gradient(135deg,rgba(255,255,255,0.06) 0%,rgba(255,255,255,0) 50%)", pointerEvents:"none" }}/>
    </div>
  );
}

// â”€â”€â”€ Animated number â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function AnimNum({ value, d=2 }: { value:number; d?:number }) {
  const sp = useSpring(value, { stiffness:38, damping:12 });
  const [disp, setDisp] = useState(value);
  useEffect(()=>{ sp.set(value); },[value,sp]);
  useEffect(()=>{ const u=sp.on("change",v=>setDisp(v)); return u; },[sp]);
  return <>{fmt(disp,d)}</>;
}

// â”€â”€â”€ InView reveal wrapper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Ticker marquee â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const TICKER_ITEMS = ["DRIP","Earn","Post","Claim","Grow","Web3","Creators","Solana"];
function Ticker() {
  const doubled = [...TICKER_ITEMS,...TICKER_ITEMS,...TICKER_ITEMS,...TICKER_ITEMS,...TICKER_ITEMS,...TICKER_ITEMS,...TICKER_ITEMS,...TICKER_ITEMS];
  return (
    <div style={{ display:"flex", alignItems:"center", height:"100%", overflow:"hidden", paddingLeft:28 }}>
      <div className="ticker-track" style={{ display:"flex", gap:56, whiteSpace:"nowrap", flexShrink:0 }}>
        {doubled.map((item,i)=>(
          <span key={i} style={{ display:"inline-flex", alignItems:"center", gap:10, fontSize:14, color:T.faint, fontFamily:"var(--font-geist-mono)", letterSpacing:"0.14em", textTransform:"uppercase" }}>
            <span className="rainbow-bg" style={{ display:"inline-flex", width:4, height:4, borderRadius:"50%", flexShrink:0 }}/>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

// â”€â”€â”€ Stats strip â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function StatsStrip() {
  const { show:showTip, hide:hideTip } = useTip();
  const stats = [
    { lbl:"Creators earning",    val:"—",  tip:"Active creators currently earning across all campaigns" },
    { lbl:"Active campaigns",    val:"—",  tip:"Projects funding creator campaigns right now" },
    { lbl:"Verified impressions",val:"—",  tip:"Total impressions verified across all submitted posts" },
    { lbl:"DRIP price",          val:"$1.50", tip:"Current market price of $DRIP token on Solana" },
  ];
  return (
    <div style={{ background:T.surface, borderTop:`1px solid ${T.border}`, borderBottom:`1px solid ${T.border}` }}>
      <div className="stats-grid" style={{ maxWidth:1200, margin:"0 auto" }}>
        {stats.map((s,i)=>(
          <div key={s.lbl} className={i<stats.length-1?"stat-border stat-item":"stat-item"}
            style={{ padding:"28px 32px", cursor:"help" }}
            onMouseEnter={e=>showTip(e,s.tip)} onMouseLeave={hideTip}>
            <p style={{ fontSize:11, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.18em", color:T.faint, marginBottom:10 }}>{s.lbl}</p>
            <p className="rainbow-text" style={{ fontSize:"clamp(1.8rem,3vw,2.6rem)", fontWeight:800, fontFamily:"var(--font-geist-mono)", letterSpacing:"-0.03em", lineHeight:1 }}>{s.val}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// â”€â”€â”€ HoloCard — glass panel with iridescent neon border â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function HoloCard({ children, style, className, borderRadius = 20 }: {
  children: React.ReactNode;
  style?: CSSProperties;
  className?: string;
  borderRadius?: number;
}) {
  return (
    <div className={`neon-border ${className ?? ""}`} style={{ borderRadius, position:"relative", ...style }}>
      {children}
      {/* Static corner sheen */}
      <div style={{
        position:"absolute", inset:0, borderRadius,
        background:"linear-gradient(135deg, rgba(255,255,255,0.06) 0%, transparent 45%)",
        pointerEvents:"none",
      }}/>
    </div>
  );
}

// â”€â”€â”€ Campaign card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      transition={{ duration:0.65, ease, delay:(index%3)*0.1 }}>
    <HoloCard borderRadius={20} style={{
        overflow:"hidden",
        background:T.surface,
        boxShadow: joined
          ? "0 8px 40px -12px rgba(255,255,255,0.15), 0 20px 60px rgba(0,0,0,0.5)"
          : "0 4px 24px -8px rgba(0,0,0,0.6), 0 20px 60px rgba(0,0,0,0.4)",
        display:"flex", flexDirection:"column",
      }}>

      {/* Visual area */}
      <div style={{ height:190, position:"relative", flexShrink:0, background:CGRADIENT[c.id]??CGRADIENT.c1, overflow:"hidden" }}>
        <div className="noise-overlay-dark" style={{ position:"absolute", inset:0, opacity:0.4 }}/>

        {/* Corner labels */}
        <div style={{ position:"absolute", top:16, left:18, right:18, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:15, fontFamily:"var(--font-geist-mono)", color:"rgba(255,255,255,0.35)", letterSpacing:"0.08em" }}>
            {String(index+1).padStart(2,"0")}
          </span>
          <span style={{
            fontSize:11, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.12em",
            padding:"3px 9px", borderRadius:5,
            background: joined?"rgba(255,255,255,0.14)":"rgba(0,0,0,0.28)",
            border:`1px solid ${joined?"rgba(255,255,255,0.35)":"rgba(255,255,255,0.15)"}`,
            color: joined?T.drip:"rgba(255,255,255,0.6)",
            transition:"all 0.4s",
          }}>
            {joined?"Joined":"Active"}
          </span>
        </div>

        {/* Bottom text */}
        <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"44px 18px 18px", background:"linear-gradient(to top,rgba(0,0,0,0.68) 0%,transparent 100%)" }}>
          <p style={{ fontSize:18, fontWeight:800, color:"#fff", letterSpacing:"-0.025em", marginBottom:3, lineHeight:1.15 }}>{c.project}</p>
          <p style={{ fontSize:15, color:"rgba(255,255,255,0.5)", fontFamily:"var(--font-geist-mono)" }}>{c.rateLabel}</p>
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
              style={{ padding:"8px 10px", background:T.el, borderRadius:10, border:`1px solid ${s.hi?"rgba(255,255,255,0.2)":T.border}`, cursor:"help" }}
              onMouseEnter={e=>showTip(e,s.tip)} onMouseLeave={hideTip}>
              <p style={{ fontSize:11, color:T.faint, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.1em", marginBottom:3 }}>{s.lbl}</p>
              <p style={{ fontSize:15, fontWeight:700, color:s.hi?T.drip:T.fg, fontFamily:"var(--font-geist-mono)" }}>{s.val}</p>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        <div style={{ marginBottom:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:6 }}>
            <span style={{ fontSize:11, color:T.faint, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.1em" }}>Campaign goal</span>
            <span style={{ fontSize:15, color:T.subtle, fontFamily:"var(--font-geist-mono)", fontWeight:600 }}>{pct}%</span>
          </div>
          <div style={{ height:4, background:T.el, borderRadius:2, overflow:"hidden" }}>
            <motion.div className="rainbow-bg" style={{ height:"100%", borderRadius:2 }}
              initial={{ width:0 }} animate={{ width:`${pct}%` }} transition={{ duration:1.3, ease, delay:0.4 }}/>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:5 }}>
            <span style={{ fontSize:11, color:T.faint, fontFamily:"var(--font-geist-mono)" }}>{fmtK(c.verified)} verified</span>
            <span style={{ fontSize:11, color:T.faint, fontFamily:"var(--font-geist-mono)" }}>of {fmtK(c.goal)}</span>
          </div>
        </div>

        <div style={{ flex:1 }}/>

        {/* Earning badge */}
        {joined&&earning&&(
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10, paddingBottom:10, borderBottom:`1px solid rgba(255,255,255,0.08)` }}>
            <span style={{ position:"relative", display:"inline-flex", width:6, height:6 }}>
              <span className="rainbow-bg animate-ping" style={{ position:"absolute", inset:0, borderRadius:"50%", opacity:0.5 }}/>
              <span className="rainbow-bg" style={{ position:"relative", display:"inline-flex", width:6, height:6, borderRadius:"50%" }}/>
            </span>
            <span className="rainbow-text" style={{ fontSize:15, fontFamily:"var(--font-geist-mono)", fontWeight:600 }}>Earning {c.dripHr} DRIP/hr</span>
          </div>
        )}

        {/* Join / Leave */}
        <button onClick={onToggle} data-cursor-hover
          style={{
            width:"100%", height:48, borderRadius:11,
            background: joined?"rgba(255,255,255,0.08)":T.el,
            border:`1px solid ${joined?"rgba(255,255,255,0.22)":T.border}`,
            color: joined?T.drip:T.fg,
            fontWeight:700, fontSize:15, cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", gap:6,
            transition:"all 0.25s ease", letterSpacing:"0.01em", fontFamily:"inherit",
          }}>
          {joined?"✓ Joined":"+ Join Campaign"}
        </button>
      </div>
    </HoloCard>
    </motion.div>
  );
}

// â”€â”€â”€ Post card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function PostCard({ post }: { post:Post }) {
  return (
    <div style={{ background:T.el, border:`1px solid rgba(255,255,255,0.1)`, borderRadius:14, padding:"14px 18px", display:"flex", alignItems:"center", gap:14 }}>
      <div style={{ width:38, height:38, borderRadius:10, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.12)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
        <span className="rainbow-text" style={{ fontSize:16, lineHeight:1 }}>â†‘</span>
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <p style={{ fontSize:15, color:T.fg, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", marginBottom:3, lineHeight:1.4 }}>{post.snippet}</p>
        <p style={{ fontSize:15, color:T.faint, fontFamily:"var(--font-geist-mono)" }}>{fmtK(post.impressions)} impressions Â· {post.campaign}</p>
      </div>
      <div style={{ textAlign:"right", flexShrink:0 }}>
        <p className="rainbow-text" style={{ fontSize:16, fontFamily:"var(--font-geist-mono)", fontWeight:700, lineHeight:1, marginBottom:2 }}>+{post.dripHr}</p>
        <p style={{ fontSize:11, color:T.faint, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.1em" }}>DRIP/hr</p>
      </div>
    </div>
  );
}

// â”€â”€â”€ Community feed â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function CommunityFeed({ compact = false }: { compact?: boolean }) {
  const [items, setItems] = useState<FeedEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const BASE = process.env.NEXT_PUBLIC_API_URL ?? "";
    async function load() {
      try {
        const res = await fetch(`${BASE}/api/feed`);
        if (!res.ok) throw new Error();
        const data = await res.json() as { feed: FeedEntry[] };
        setItems(data.feed ?? []);
      } catch { /* stay empty */ }
      finally { setLoading(false); }
    }
    load();
    const interval = setInterval(load, 30_000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const age = (iso: string) => {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s/60)}m` : `${Math.floor(s/3600)}h`;
  };

  if (loading) return (
    <div style={{ textAlign:"center", padding:"24px 16px", color:T.faint, fontSize:15 }}>Loading…</div>
  );

  if (items.length === 0) return (
    <div style={{ textAlign:"center", padding:"24px 16px", color:T.faint, fontSize:14, lineHeight:1.6 }}>
      No activity yet.<br/>Be the first to post.
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column" }}>
      <AnimatePresence mode="popLayout">
        {items.slice(0, compact ? 30 : 10).map(item=>(
          <motion.div key={item.id} layout
            initial={{ opacity:0, y:-10 }} animate={{ opacity:1, y:0 }}
            exit={{ opacity:0, height:0 }} transition={{ duration:0.25, ease }}
            style={{ display:"flex", alignItems:"center", gap:10, padding: compact ? "10px 20px" : "10px 16px", borderBottom:`1px solid ${T.border}`, overflow:"hidden" }}>
            <div style={{ width:5, height:5, borderRadius:"50%", background:T.faint, flexShrink:0 }}/>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:2 }}>
                <a href={item.tweetUrl} target="_blank" rel="noopener noreferrer"
                  className="rainbow-text"
                  style={{ fontFamily:"var(--font-geist-mono)", fontWeight:700, fontSize:14, textDecoration:"none", flexShrink:0 }}>
                  @{item.handle}
                </a>
                <span style={{ color:T.faint, fontSize:14, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{item.campaign}</span>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:4 }}>
                <span style={{ color:T.fg, fontFamily:"var(--font-geist-mono)", fontWeight:600, fontSize:15 }}>+{Number(item.earned).toFixed(4)}</span>
                <span style={{ color:T.faint, fontSize:14, fontFamily:"var(--font-geist-mono)" }}>DRIP</span>
              </div>
            </div>
            <span style={{ color:T.faint, fontSize:14, fontFamily:"var(--font-geist-mono)", flexShrink:0 }}>{age(item.submittedAt)}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// â”€â”€â”€ Create campaign modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function CreateCampaignModal({ authToken, onClose, onSuccess }: {
  authToken: string;
  onClose: () => void;
  onSuccess: (c: Campaign) => void;
}) {
  const [step,      setStep]     = useState(1);
  const [project,   setProject]  = useState("");
  const [ticker,    setTicker]   = useState("");
  const [imageUrl,  setImageUrl] = useState("");   // base64 data URL or empty
  const [imgName,   setImgName]  = useState("");   // original filename for display
  const [dragOver,  setDragOver] = useState(false);
  const [budget,    setBudget]   = useState(10000);
  const [goal,      setGoal]     = useState(5000000);
  const [dripPerK,  setDripPerK] = useState(0.01);
  const [saving,    setSaving]   = useState(false);
  const [errMsg,    setErrMsg]   = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleImageFile(file: File) {
    if (!file.type.startsWith("image/")) return;
    const MAX_MB = 4;
    if (file.size > MAX_MB * 1024 * 1024) { setErrMsg(`Image must be under ${MAX_MB}MB`); return; }
    setErrMsg("");
    setImgName(file.name);
    const reader = new FileReader();
    reader.onload = e => setImageUrl(e.target?.result as string ?? "");
    reader.readAsDataURL(file);
  }

  const step1Valid = project.trim().length > 0;
  const step2Valid = ticker.trim().length > 0 && budget > 0;
  const step3Valid = goal > 0 && dripPerK > 0;
  const canLaunch  = step1Valid && step2Valid && step3Valid && !saving;
  const kPerDrip   = dripPerK > 0 ? Math.round(1 / dripPerK) : 0;
  const STEPS = 3;

  async function save() {
    if (!canLaunch) return;
    setSaving(true); setErrMsg("");
    try {
      const res = await api.createCampaign({
        project: project.trim(),
        logo: ticker.trim(),
        imageUrl: imageUrl.trim() || undefined,
        budgetTotal: budget,
        goal,
        dripPerKViews: dripPerK,
      }, authToken);
      const c = res.campaign;
      onSuccess({
        id: c.id, project: c.project, av: c.logo,
        imageUrl: imageUrl.trim() || undefined,
        budgetTotal: +c.budgetTotal, budgetLeft: +c.budgetLeft,
        goal: +c.goal, verified: +c.verified,
        rateLabel: c.rateLabel, dripHr: +c.dripPerKViews * 100,
        participants: c.participants,
      } as unknown as Campaign);
    } catch (err) {
      setErrMsg((err as Error).message);
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width:"100%", height:48, background:T.el,
    border:`1px solid ${T.border}`, borderRadius:11,
    padding:"0 16px", fontSize:15, color:T.fg,
    outline:"none", fontFamily:"inherit", transition:"border-color 0.2s",
  };

  const stepLabel = ["Identity", "Budget", "Distribution"][step - 1];
  const progPct = ((step - 1) / (STEPS - 1)) * 100;
  const canNext = step === 1 ? step1Valid : step2Valid;

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center"
      initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      style={{ background:"rgba(10,11,14,0.92)", backdropFilter:"blur(28px)", padding:"16px" }}
      onClick={e => e.target === e.currentTarget && !saving && onClose()}>
      <motion.div
        initial={{ opacity:0, scale:0.96, y:20 }}
        animate={{ opacity:1, scale:1, y:0 }}
        exit={{ opacity:0, scale:0.96, y:20 }}
        transition={{ duration:0.3, ease }}
        style={{ width:"100%", maxWidth:480, background:T.surface, border:`1px solid ${T.border}`, borderRadius:24, overflow:"hidden", boxShadow:"0 60px 120px -24px rgba(0,0,0,0.9)" }}>

        {/* Animated progress bar */}
        <div style={{ height:3, background:T.el, position:"relative" }}>
          <motion.div className="rainbow-bg"
            animate={{ width:`${Math.max(4, progPct)}%` }}
            transition={{ duration:0.4, ease }}
            style={{ position:"absolute", inset:"0 auto 0 0", height:"100%" }}/>
        </div>

        {/* Header */}
        <div style={{ padding:"22px 28px 18px", borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <p style={{ fontSize:11, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.16em", color:T.faint, marginBottom:5 }}>
              Step {step} of {STEPS}
            </p>
            <p style={{ fontSize:22, fontWeight:700, color:T.fg, letterSpacing:"-0.02em", lineHeight:1.1, margin:0 }}>
              {stepLabel}
            </p>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            {[1,2,3].map(s => (
              <div key={s} style={{ width:s===step?22:7, height:7, borderRadius:4, transition:"all 0.3s ease",
                background:s<step?"rgba(255,255,255,0.5)":s===step?"rgba(255,255,255,0.9)":T.border }}/>
            ))}
            <button onClick={onClose} data-cursor-hover style={{ marginLeft:6, background:"none", border:"none", color:T.faint, cursor:"pointer", padding:6, display:"flex", alignItems:"center" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Step content */}
        <div style={{ padding:"28px 28px 20px", minHeight:300 }}>
          <AnimatePresence mode="wait">

            {step === 1 && (
              <motion.div key="s1"
                initial={{ opacity:0, x:30 }} animate={{ opacity:1, x:0 }}
                exit={{ opacity:0, x:-30 }} transition={{ duration:0.2 }}>

                {/* Project name — first */}
                <div style={{ marginBottom:24 }}>
                  <p style={{ fontSize:12, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.13em", color:T.subtle, fontWeight:600, marginBottom:5 }}>Project Name</p>
                  <p style={{ fontSize:13, color:T.faint, marginBottom:10, lineHeight:1.5 }}>Full brand name — shown as the campaign title across the platform.</p>
                  <input value={project} onChange={e => setProject(e.target.value)}
                    placeholder="e.g. Solana Foundation"
                    autoFocus
                    style={inputStyle}
                    onFocus={e => (e.currentTarget.style.borderColor="rgba(255,255,255,0.3)")}
                    onBlur={e => (e.currentTarget.style.borderColor=T.border)}/>
                </div>

                {/* Campaign image — drag & drop upload */}
                <div>
                  <p style={{ fontSize:12, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.13em", color:T.subtle, fontWeight:600, marginBottom:5 }}>Campaign Image <span style={{ fontFamily:"inherit", fontWeight:400, letterSpacing:0, textTransform:"none", color:T.faint, fontSize:11 }}>— optional</span></p>
                  <p style={{ fontSize:13, color:T.faint, marginBottom:10, lineHeight:1.5 }}>Shown on your campaign card. Drag & drop or click to upload (max 4MB).</p>

                  {/* Hidden file input */}
                  <input ref={fileInputRef} type="file" accept="image/*" style={{ display:"none" }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); }}/>

                  {imageUrl ? (
                    /* Preview state */
                    <div style={{ position:"relative", borderRadius:14, overflow:"hidden", border:`1px solid ${T.border}`, background:T.el }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imageUrl} alt="preview" style={{ width:"100%", maxHeight:160, objectFit:"cover", display:"block" }}/>
                      <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 50%)" }}/>
                      <div style={{ position:"absolute", bottom:0, left:0, right:0, padding:"10px 14px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
                        <span style={{ fontSize:12, color:"rgba(255,255,255,0.75)", fontFamily:"var(--font-geist-mono)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:"70%" }}>{imgName}</span>
                        <button onClick={() => { setImageUrl(""); setImgName(""); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                          style={{ background:"rgba(0,0,0,0.5)", border:"1px solid rgba(255,255,255,0.15)", borderRadius:6, color:"rgba(255,255,255,0.7)", fontSize:11, padding:"3px 8px", cursor:"pointer", fontFamily:"inherit", flexShrink:0 }}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Drop zone */
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleImageFile(f); }}
                      style={{
                        height:130, borderRadius:14, border:`2px dashed ${dragOver ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.12)"}`,
                        background: dragOver ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.02)",
                        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:8,
                        cursor:"pointer", transition:"all 0.2s", userSelect:"none",
                      }}>
                      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                        style={{ color: dragOver ? "rgba(255,255,255,0.7)" : T.faint, transition:"color 0.2s" }}>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                      </svg>
                      <p style={{ fontSize:14, color: dragOver ? T.fg : T.subtle, fontWeight:500, margin:0, transition:"color 0.2s" }}>
                        {dragOver ? "Drop to upload" : "Drag & drop or click to upload"}
                      </p>
                      <p style={{ fontSize:12, color:T.faint, margin:0 }}>PNG, JPG, GIF, WebP — max 4MB</p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="s2"
                initial={{ opacity:0, x:30 }} animate={{ opacity:1, x:0 }}
                exit={{ opacity:0, x:-30 }} transition={{ duration:0.2 }}>

                <div style={{ marginBottom:26 }}>
                  <p style={{ fontSize:12, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.13em", color:T.subtle, fontWeight:600, marginBottom:5 }}>Ticker Symbol</p>
                  <p style={{ fontSize:13, color:T.faint, marginBottom:12, lineHeight:1.5 }}>Short token symbol shown on your campaign badge — max 6 characters.</p>
                  <input value={ticker}
                    onChange={e => setTicker(e.target.value.toUpperCase().slice(0,6))}
                    placeholder="SOL"
                    autoFocus
                    style={{ ...inputStyle, fontFamily:"var(--font-geist-mono)", letterSpacing:"0.16em", fontSize:20, fontWeight:700, textAlign:"center" }}
                    onFocus={e => (e.currentTarget.style.borderColor="rgba(255,255,255,0.3)")}
                    onBlur={e => (e.currentTarget.style.borderColor=T.border)}/>
                </div>

                <div>
                  <p style={{ fontSize:12, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.13em", color:T.subtle, fontWeight:600, marginBottom:5 }}>Budget (DRIP)</p>
                  <p style={{ fontSize:13, color:T.faint, marginBottom:12, lineHeight:1.5 }}>Total $DRIP prize pool distributed to creators across this campaign.</p>
                  <NumInput value={budget} onChange={v => setBudget(Math.max(1, v))} min={1} step={1000}/>
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div key="s3"
                initial={{ opacity:0, x:30 }} animate={{ opacity:1, x:0 }}
                exit={{ opacity:0, x:-30 }} transition={{ duration:0.2 }}>

                <div style={{ marginBottom:26 }}>
                  <p style={{ fontSize:12, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.13em", color:T.subtle, fontWeight:600, marginBottom:5 }}>Impression Goal</p>
                  <p style={{ fontSize:13, color:T.faint, marginBottom:12, lineHeight:1.5 }}>Target total views across all creator posts. Campaign closes automatically when reached.</p>
                  <NumInput value={goal} onChange={v => setGoal(Math.max(1, v))} min={1} step={500000}/>
                </div>

                <div>
                  <p style={{ fontSize:12, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.13em", color:T.subtle, fontWeight:600, marginBottom:5 }}>DRIP per 1K Views</p>
                  <p style={{ fontSize:13, color:T.faint, marginBottom:12, lineHeight:1.5 }}>How much $DRIP a creator earns per 1,000 verified impressions on their post.</p>
                  <NumInput value={dripPerK} onChange={v => setDripPerK(Math.max(0.001, v))} min={0.001} step={0.001}/>
                  {kPerDrip > 0 && (
                    <p className="rainbow-text" style={{ fontSize:13, fontFamily:"var(--font-geist-mono)", fontWeight:600, marginTop:10, textAlign:"center" }}>
                      {kPerDrip.toLocaleString()}K views = 1 DRIP
                    </p>
                  )}
                </div>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        {/* Error */}
        {errMsg && (
          <div style={{ padding:"0 28px 4px" }}>
            <p style={{ fontSize:13, color:"#ff7070", textAlign:"center" }}>{errMsg}</p>
          </div>
        )}

        {/* Footer navigation */}
        <div style={{ padding:"8px 28px 28px", display:"flex", gap:12 }}>
          {step > 1 && (
            <button onClick={() => setStep(s => s-1)} data-cursor-hover
              style={{ flex:1, height:50, borderRadius:13, border:`1px solid ${T.border}`, background:"none", color:T.subtle, fontSize:15, fontWeight:600, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor="rgba(255,255,255,0.22)"; e.currentTarget.style.color=T.fg; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor=T.border; e.currentTarget.style.color=T.subtle; }}>
              Back
            </button>
          )}

          {step < STEPS && (
            <motion.button
              onClick={() => canNext && setStep(s => s+1)}
              disabled={!canNext}
              whileHover={canNext ? { scale:1.01 } : {}}
              whileTap={canNext ? { scale:0.99 } : {}}
              data-cursor-hover
              style={{ flex:step>1?2:1, height:50, borderRadius:13, border:"none",
                background:canNext ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
                color:canNext ? T.fg : T.faint,
                fontSize:15, fontWeight:600, cursor:canNext ? "pointer" : "not-allowed",
                fontFamily:"inherit", transition:"background 0.2s" }}>
              Next →
            </motion.button>
          )}

          {step === STEPS && (
            <motion.button onClick={save} disabled={!canLaunch}
              whileHover={canLaunch ? { scale:1.02 } : {}}
              whileTap={canLaunch ? { scale:0.98 } : {}}
              data-cursor-hover
              className={canLaunch ? "rainbow-bg" : ""}
              style={{
                flex:2, height:58, borderRadius:16, border:"none",
                background:!canLaunch ? "rgba(255,255,255,0.05)" : undefined,
                color:canLaunch ? "#080810" : "rgba(255,255,255,0.2)",
                fontWeight:800, fontSize:18, cursor:canLaunch ? "pointer" : "not-allowed",
                display:"flex", alignItems:"center", justifyContent:"center", gap:10,
                fontFamily:"inherit", letterSpacing:"-0.01em",
                boxShadow:canLaunch ? "0 0 60px rgba(200,190,255,0.45), 0 0 24px rgba(180,210,255,0.3)" : "none",
                transition:"box-shadow 0.4s",
              }}>
              {saving
                ? <><motion.span animate={{ rotate:360 }} transition={{ duration:0.9, repeat:Infinity, ease:"linear" }} style={{ display:"inline-block" }}>&#x27F3;</motion.span> Launching…</>
                : <span style={{ display:"flex", alignItems:"center", gap:10, letterSpacing:"-0.01em" }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink:0 }}>
                      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8l7 4-7 4z"/>
                    </svg>
                    Launch Campaign
                  </span>
              }
            </motion.button>
          )}
        </div>

      </motion.div>
    </motion.div>
  );
}


// â”€â”€â”€ Submit modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function SubmitModal({ joined, campaigns, walletAddress, twitterHandle, authToken, onClose, onSuccess }: {
  joined:string[]; campaigns:Campaign[];
  walletAddress:string; twitterHandle:string; authToken:string;
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
      const res = await api.submitPost({ tweetUrl: url.trim(), campaignId: campaign, token: authToken });
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
            <p style={{ fontSize:14, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.15em", color:T.faint }}>Submit Post</p>
            {state==="idle"&&<button onClick={onClose} data-cursor-hover style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", padding:6, lineHeight:1, display:"flex", alignItems:"center" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>}
          </div>

          {state==="done"?(
            <div style={{ textAlign:"center", padding:"24px 0" }}>
              <motion.p initial={{ scale:0 }} animate={{ scale:1 }} transition={{ type:"spring", stiffness:220, damping:14 }}
                className="rainbow-text" style={{ fontSize:48, marginBottom:12 }}>✓</motion.p>
              <p style={{ fontWeight:700, fontSize:17, color:T.fg, marginBottom:4 }}>Post verified</p>
              <p style={{ fontSize:15, color:T.subtle }}>Earning DRIP now</p>
            </div>
          ):(
            <>
              {state==="error"&&errMsg&&(
                <motion.div initial={{ opacity:0, y:-6 }} animate={{ opacity:1, y:0 }}
                  style={{ background:"rgba(255,80,80,0.08)", border:"1px solid rgba(255,80,80,0.2)", borderRadius:10, padding:"10px 14px", marginBottom:14 }}>
                  <p style={{ fontSize:14, color:"#ff7070", lineHeight:1.5 }}>{errMsg}</p>
                </motion.div>
              )}
              <div style={{ marginBottom:14 }}>
                <label style={{ fontSize:14, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.12em", color:T.faint, display:"block", marginBottom:7 }}>Tweet URL</label>
                <input value={url} onChange={e=>{setUrl(e.target.value);if(state==="error")setState("idle");}} placeholder="https://x.com/handle/status/..."
                  style={{ width:"100%", height:48, background:T.el, border:`1px solid ${state==="error"?"rgba(255,80,80,0.35)":T.border}`, borderRadius:11, padding:"0 14px", fontSize:15, color:T.fg, outline:"none", transition:"border-color 0.2s", fontFamily:"inherit" }}
                  onFocus={e=>(e.target.style.borderColor="rgba(255,255,255,0.35)")}
                  onBlur={e=>(e.target.style.borderColor=state==="error"?"rgba(255,80,80,0.35)":T.border)}/>
              </div>
              <div style={{ marginBottom:22 }}>
                <label style={{ fontSize:14, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.12em", color:T.faint, display:"block", marginBottom:7 }}>Campaign</label>
                <Select options={options} value={campaign} onChange={setCampaign} placeholder="Select campaign..."/>
              </div>
              <button onClick={submit} disabled={!url.trim()||state==="verifying"} data-cursor-hover
                className={url.trim()&&state!=="verifying"?"rainbow-bg":""}
                style={{ width:"100%", height:48, borderRadius:12, border:"none", background:(!url.trim()||state==="verifying")?"rgba(255,255,255,0.05)":undefined, color:url.trim()&&state!=="verifying"?"#111":"#fff", fontWeight:700, fontSize:14, cursor:url.trim()&&state!=="verifying"?"pointer":"not-allowed", display:"flex", alignItems:"center", justifyContent:"center", gap:8, fontFamily:"inherit" }}>
                {state==="verifying"?(<><motion.span animate={{ rotate:360 }} transition={{ duration:1, repeat:Infinity, ease:"linear" }} style={{ display:"inline-block" }}>âŸ³</motion.span>Verifying on X…</>):state==="error"?"Try Again":"Verify & Submit"}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// â”€â”€â”€ Claim modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
            <p style={{ fontSize:14, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.15em", color:T.faint }}>Claim Rewards</p>
            {state==="idle"&&<button onClick={onClose} data-cursor-hover style={{ background:"none", border:"none", color:T.faint, cursor:"pointer", padding:6, lineHeight:1, display:"flex", alignItems:"center" }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>}
          </div>

          {state==="confirmed"?(
            <div style={{ textAlign:"center", padding:"28px 0" }}>
              <motion.p initial={{ scale:0 }} animate={{ scale:1 }} transition={{ type:"spring", stiffness:220, damping:14 }}
                className="rainbow-text" style={{ fontSize:52, marginBottom:14 }}>✓</motion.p>
              <p style={{ fontWeight:700, fontSize:20, color:T.fg, marginBottom:6 }}>Claimed!</p>
              <p style={{ fontSize:15, color:T.subtle }}>{fmt(claimable)} DRIP sent to your wallet</p>
            </div>
          ):(
            <>
              <div style={{ background:T.el, border:`1px solid ${T.border}`, borderRadius:16, padding:"20px 22px", marginBottom:16 }}>
                <p style={{ fontSize:15, color:T.subtle, marginBottom:6 }}>Claiming</p>
                <p className="rainbow-text" style={{ fontSize:44, fontWeight:700, lineHeight:1, fontFamily:"var(--font-geist-mono)", letterSpacing:"-0.02em" }}>{fmt(claimable)}</p>
                <p style={{ fontSize:15, color:T.faint, marginTop:6, fontFamily:"var(--font-geist-mono)" }}>DRIP Â· â‰ˆ ${fmt(claimable*DRIP_PRICE)} USD</p>
              </div>
              <div style={{ background:T.el, borderRadius:12, padding:"12px 16px", marginBottom:20 }}>
                {[["Network","Solana"],["Fee","< $0.01"],["Settlement","~2 sec"]].map(([l,v],i)=>(
                  <div key={l} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:i>0?10:0, marginTop:i>0?10:0, borderTop:i>0?`1px solid ${T.border}`:"none" }}>
                    <span style={{ fontSize:14, color:T.subtle }}>{l}</span>
                    <span style={{ fontSize:14, color:T.fg, fontFamily:"var(--font-geist-mono)", fontWeight:600 }}>{v}</span>
                  </div>
                ))}
              </div>
              <button onClick={sign} disabled={state!=="idle"} data-cursor-hover
                className={state==="idle"?"rainbow-bg":""}
                style={{ width:"100%", height:50, borderRadius:13, border:"none", background:state!=="idle"?"rgba(255,255,255,0.05)":undefined, color:state==="idle"?"#111":"#fff", fontWeight:700, fontSize:14, cursor:state==="idle"?"pointer":"not-allowed", display:"flex", alignItems:"center", justifyContent:"center", gap:8, boxShadow:state==="idle"?"0 0 50px -10px rgba(255,255,255,0.2)":"none", fontFamily:"inherit" }}>
                {state==="idle"&&"Sign & Claim"}
                {state==="signing"&&<><motion.span animate={{ rotate:360 }} transition={{ duration:1, repeat:Infinity, ease:"linear" }} style={{ display:"inline-block" }}>âŸ³</motion.span>Signing...</>}
                {state==="submitting"&&<><motion.span animate={{ rotate:360 }} transition={{ duration:1, repeat:Infinity, ease:"linear" }} style={{ display:"inline-block" }}>âŸ³</motion.span>Submitting to Solana...</>}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// â”€â”€â”€ Nav â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function Nav({ claimable, fillPct, onClaim, onSubmit, onLogout, walletAddress, twitterHandle }: {
  claimable:number; fillPct:number; onClaim:()=>void; onSubmit:()=>void; onLogout:()=>void;
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
        background: `${T.bg}f2`,
        backdropFilter: "blur(24px)",
        borderBottom:`1px solid ${T.border}`,
        display:"flex", alignItems:"center",
      }}>
        <div style={{ width:"100%", maxWidth:1200, margin:"0 auto", padding:"0 24px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>

          {/* Logo — bigger */}
          <a href="#vault" data-cursor-hover style={{ display:"flex", alignItems:"center", gap:10, textDecoration:"none" }}>
            <Image src="/logos/DripLogo.png" alt="DRIP" width={72} height={54} style={{ objectFit:"contain" }}/>
            <span style={{ fontSize:10, fontFamily:"var(--font-geist-mono)", color:T.faint, background:T.el, border:`1px solid ${T.border}`, borderRadius:4, padding:"2px 6px", letterSpacing:"0.12em", textTransform:"uppercase" }}>beta</span>
          </a>

          {/* Right side — no nav links */}
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            {/* Account pills — same height as buttons */}
            <div className="nav-account" style={{ display:"flex", alignItems:"center", gap:8 }}>
              {twitterHandle && (
                <div style={{ display:"flex", alignItems:"center", gap:6, height:38, padding:"0 12px", background:T.el, border:`1px solid ${T.border}`, borderRadius:9, fontSize:14, color:T.subtle }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill={T.subtle}><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  <span style={{ fontFamily:"var(--font-geist-mono)", fontWeight:600 }}>@{twitterHandle}</span>
                </div>
              )}
              {walletAddress && (
                <div style={{ display:"flex", alignItems:"center", gap:6, height:38, padding:"0 12px", background:T.el, border:`1px solid ${T.border}`, borderRadius:9, fontSize:14, color:T.subtle, fontFamily:"var(--font-geist-mono)" }}>
                  <span className="rainbow-bg" style={{ display:"inline-flex", width:6, height:6, borderRadius:"50%", flexShrink:0 }}/>
                  {walletAddress.slice(0,6)}…{walletAddress.slice(-4)}
                </div>
              )}
            </div>

            <button onClick={onSubmit} data-cursor-hover
              style={{ height:38, padding:"0 13px", borderRadius:8, cursor:"pointer", border:`1px solid ${T.border}`, background:T.el, color:T.subtle, fontSize:14, fontWeight:600, display:"flex", alignItems:"center", gap:4, transition:"color 0.2s, border-color 0.2s", fontFamily:"inherit" }}
              onMouseEnter={e=>{ (e.currentTarget as HTMLElement).style.color=T.fg; (e.currentTarget as HTMLElement).style.borderColor=T.faint; }}
              onMouseLeave={e=>{ (e.currentTarget as HTMLElement).style.color=T.subtle; (e.currentTarget as HTMLElement).style.borderColor=T.border; }}>
              <span style={{ fontSize:15, lineHeight:1 }}>+</span> Post
            </button>

            <button onClick={onLogout} data-cursor-hover title="Log out"
              style={{ height:38, width:38, borderRadius:8, cursor:"pointer", border:`1px solid ${T.border}`, background:T.el, color:T.subtle, fontSize:14, display:"flex", alignItems:"center", justifyContent:"center", transition:"color 0.2s, border-color 0.2s", flexShrink:0 }}
              onMouseEnter={e=>{ (e.currentTarget as HTMLElement).style.color="#ff5555"; (e.currentTarget as HTMLElement).style.borderColor="#ff5555"; }}
              onMouseLeave={e=>{ (e.currentTarget as HTMLElement).style.color=T.subtle; (e.currentTarget as HTMLElement).style.borderColor=T.border; }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>

            <AnimatePresence>
              {claimable>0.1&&(
                <motion.button key="claim" onClick={onClaim} data-cursor-hover
                  initial={{ opacity:0, scale:0.88 }} animate={{ opacity:1, scale:1 }} exit={{ opacity:0, scale:0.88 }}
                  whileHover={{ scale:1.03 }} whileTap={{ scale:0.97 }}
                  className="rainbow-bg"
                  style={{ height:38, padding:"0 14px", borderRadius:8, border:"none", color:"#111", fontWeight:700, fontSize:14, cursor:"pointer", boxShadow:"0 0 30px -6px rgba(255,255,255,0.3)", display:"flex", alignItems:"center", gap:5, fontFamily:"inherit" }}>
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

// â”€â”€â”€ Landing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// ─── Cinematic intro ─────────────────────────────────────────────────────────
function CinematicIntro({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<"in"|"pulse"|"grow"|"out">("in");

  useEffect(() => {
    const t1 = setTimeout(() => setPhase("pulse"),  500);
    const t2 = setTimeout(() => setPhase("grow"),  1400);
    const t3 = setTimeout(() => setPhase("out"),   2000);
    const t4 = setTimeout(onComplete,              2800);
    return () => [t1, t2, t3, t4].forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logoVariants: Record<string, { opacity: number | number[]; scale: number | number[]; filter: string }> = {
    in:    { opacity:1, scale:1,                        filter:"blur(0px)" },
    pulse: { opacity:1, scale:[1, 1.07, 0.96, 1.12, 1], filter:"blur(0px)" },
    grow:  { opacity:1, scale:5,                        filter:"blur(8px)" },
    out:   { opacity:0, scale:7,                        filter:"blur(20px)" },
  };

  const dur = phase==="in" ? 0.55 : phase==="pulse" ? 0.9 : phase==="grow" ? 0.65 : 0.75;
  const logoEase =
    phase==="pulse" ? "easeInOut" :
    phase==="grow"  ? [0.2,0,0.8,1] as [number,number,number,number] :
                      [0.16,1,0.3,1] as [number,number,number,number];

  return (
    <motion.div
      animate={{ opacity: phase === "out" ? 0 : 1 }}
      transition={{ duration: phase === "out" ? 0.75 : 0.01 }}
      style={{ position:"fixed", inset:0, zIndex:9999, background:T.bg,
        display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}>

      {/* Ambient glow */}
      <motion.div
        animate={{ opacity: phase==="pulse" || phase==="grow" ? 1 : 0, scale: phase==="grow" ? 3 : 1 }}
        transition={{ duration: 0.8 }}
        style={{ position:"absolute", width:400, height:400, borderRadius:"50%",
          background:"radial-gradient(circle, rgba(200,180,255,0.15) 0%, rgba(180,210,255,0.08) 40%, transparent 70%)",
          pointerEvents:"none" }}/>

      {/* Logo */}
      <motion.div
        initial={{ opacity:0, scale:0.7, filter:"blur(8px)" }}
        animate={logoVariants[phase]}
        transition={{ duration: dur, ease: logoEase }}>
        <Image src="/logos/DripLogo.png" alt="DRIP" width={160} height={120}
          style={{ objectFit:"contain", display:"block" }}/>
      </motion.div>
    </motion.div>
  );
}


function Landing({ onDone }: { onDone: (handle: string, token: string) => void }) {
  const { publicKey, connected } = useWallet();
  const [showWalletModal, setShowWalletModal] = useState(false);

  // Parse ?token=...&handle=... from URL after X OAuth callback
  const [xToken,   setXToken]   = useState("");
  const [xHandle,  setXHandle]  = useState("");
  const [authError, setAuthError] = useState("");

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const token = p.get("token") ?? "";
    const handle = p.get("handle") ?? "";
    const err    = p.get("auth_error") ?? "";
    if (token && handle) { setXToken(token); setXHandle(handle); }
    if (err) setAuthError(err === "denied" ? "You declined X sign-in." : "X sign-in failed. Please try again.");
    // Clean URL
    if (token || err) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  // After wallet connects (and X is authed), enter app
  useEffect(() => {
    if (connected && publicKey && xToken && xHandle) {
      // Link wallet to account on server (best-effort — onDone fires regardless)
      fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/auth/wallet`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${xToken}` },
        body: JSON.stringify({ walletAddress: publicKey.toString() }),
      }).catch(() => {}).finally(() => onDone(xHandle, xToken));
    }
  }, [connected, publicKey, xToken, xHandle, onDone]);

  function signInWithX() {
    const api    = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
    const origin = window.location.origin; // e.g. http://localhost:3000 or https://drip-frontend-...
    window.location.href = `${api}/api/auth/x?return=${encodeURIComponent(origin)}`;
  }

  const xDone = !!xToken && !!xHandle;
  const wDone = connected && !!publicKey;

  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      style={{ position:"fixed", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:T.bg }}>

      <div style={{ position:"relative", width:"100%", maxWidth:440, padding:"0 24px", textAlign:"center" }}>
        <motion.div initial={{ opacity:0, y:-20 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.7, ease }}>
          {/* Floating logo */}
          <motion.div
            animate={{ y: [0, -10, 0, -6, 0] }}
            transition={{ duration: 6, repeat: Infinity, ease: "easeInOut", times: [0, 0.3, 0.55, 0.75, 1] }}
            style={{ display:"inline-block", marginBottom: 8 }}
          >
            <Image
              src="/logos/DripLogo.png"
              alt="DRIP"
              width={380}
              height={300}
              priority
              style={{ objectFit:"contain", filter:"drop-shadow(0 8px 40px rgba(200,200,255,0.18))" }}
            />
          </motion.div>
          <p style={{ fontSize:15, color:T.subtle, marginTop:4, marginBottom:36, lineHeight:1.6, whiteSpace:"nowrap" }}>
            Earn $DRIP for the attention you generate on X.
          </p>
        </motion.div>

        {authError && (
          <motion.div initial={{ opacity:0, y:-8 }} animate={{ opacity:1, y:0 }}
            style={{ background:"rgba(255,80,80,0.08)", border:"1px solid rgba(255,80,80,0.2)", borderRadius:12, padding:"10px 16px", marginBottom:16 }}>
            <p style={{ fontSize:15, color:"#ff7070" }}>{authError}</p>
          </motion.div>
        )}

        <motion.div initial={{ opacity:0, y:24 }} animate={{ opacity:1, y:0 }} transition={{ duration:0.7, ease, delay:0.15 }} style={{ marginBottom:18 }}>
          <HoloCard borderRadius={22} style={{ background:T.surface, overflow:"hidden", boxShadow:"0 40px 80px -20px rgba(0,0,0,0.6)" }}>
          <div className="rainbow-bg" style={{ height:2 }}/>
          <div style={{ padding:22, display:"flex", flexDirection:"column", gap:8 }}>

            {/* Step 1: Sign in with X */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px", background:T.el, borderRadius:12, border:`1px solid ${xDone?"rgba(255,255,255,0.25)":T.border}`, transition:"border-color 0.4s" }}>
              <div style={{ display:"flex", alignItems:"center", gap:11 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill={xDone?T.fg:T.subtle}><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                <span style={{ fontSize:14, fontWeight:600, color:xDone?T.fg:T.subtle }}>Sign in with X</span>
              </div>
              {xDone
                ? <span className="rainbow-text" style={{ fontSize:14, fontWeight:700 }}>✓ @{xHandle}</span>
                : <button data-cursor-hover onClick={signInWithX} className="rainbow-bg"
                    style={{ height:30, padding:"0 14px", borderRadius:7, border:"none", color:"#111", fontWeight:700, fontSize:15, cursor:"pointer", fontFamily:"inherit" }}>
                    Connect
                  </button>
              }
            </div>

            {/* Step 2: Phantom wallet */}
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"14px 16px", background:T.el, borderRadius:12, border:`1px solid ${wDone?"rgba(255,255,255,0.25)":T.border}`, opacity:xDone?1:0.4, transition:"opacity 0.4s, border-color 0.4s", pointerEvents:xDone?"auto":"none" }}>
              <div style={{ display:"flex", alignItems:"center", gap:11 }}>
                <div style={{ width:15, height:15, borderRadius:4, background:wDone?"rgba(255,255,255,0.85)":T.faint, transition:"background 0.4s" }}/>
                <span style={{ fontSize:14, fontWeight:600, color:wDone?T.fg:T.subtle }}>Connect Phantom Wallet</span>
              </div>
              {!xDone && <span style={{ fontSize:15, color:T.faint }}>Sign in with X first</span>}
              {xDone && !wDone && (
                <button data-cursor-hover onClick={() => setShowWalletModal(true)} className="rainbow-bg"
                  style={{ height:30, padding:"0 14px", borderRadius:7, border:"none", color:"#111", fontWeight:700, fontSize:15, cursor:"pointer", fontFamily:"inherit" }}>
                  Connect
                </button>
              )}
              {wDone && <span className="rainbow-text" style={{ fontSize:14, fontWeight:700 }}>✓ {publicKey!.toString().slice(0,6)}…{publicKey!.toString().slice(-4)}</span>}
            </div>
          </div>
          </HoloCard>
        </motion.div>

        <motion.p initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ delay:0.4 }}
          style={{ fontSize:15, color:T.faint, fontFamily:"var(--font-geist-mono)" }}>
          Your keys. Your vault. Non-custodial.
        </motion.p>
      </div>

      <WalletSelectModal open={showWalletModal} onClose={() => setShowWalletModal(false)}/>
    </motion.div>
  );
}

// â”€â”€â”€ Custom cursor â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Main app â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function DripApp({ walletAddress, twitterHandle, authToken, onLogout }: { walletAddress: string; twitterHandle: string; authToken: string; onLogout: () => void }) {
  const [balance,   setBalance]   = useState(0);
  const [claimable, setClaimable] = useState(0);
  const [fillPct,   setFillPct]   = useState(0);
  const [drops,     setDrops]     = useState<Drop[]>([]);
  const [ripples,   setRipples]   = useState<Ripple[]>([]);
  const [joined,    setJoined]    = useState(new Set<string>());
  const [posts,     setPosts]     = useState<Post[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [showClaim, setShowClaim] = useState(false);
  const [showPost,  setShowPost]  = useState(false);
  const [showCreateCampaign, setShowCreateCampaign] = useState(false);

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
      <Nav claimable={claimable} fillPct={fillPct} onClaim={()=>setShowClaim(true)} onSubmit={()=>setShowPost(true)} onLogout={onLogout} walletAddress={walletAddress} twitterHandle={twitterHandle}/>

      {/* ════ 3-COLUMN FIXED DASHBOARD ════ */}
      <div style={{ position:"fixed", top:NAV_H, left:0, right:0, bottom:0, display:"flex", overflow:"hidden", background:T.bg }}>

        {/* LEFT: Vault (300px) */}
        <div style={{ width:300, flexShrink:0, borderRight:`1px solid ${T.border}`, display:"flex", flexDirection:"column", overflowY:"auto", overflowX:"hidden" }}>

          {/* Row 1 — header */}
          <div style={{ height:56, flexShrink:0, borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 20px" }}>
            <span style={{ fontSize:15, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.16em", color:T.faint }}>Your Vault</span>
            {active && (
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ position:"relative", display:"inline-flex", width:5, height:5, flexShrink:0 }}>
                  <span className="rainbow-bg animate-ping" style={{ position:"absolute", inset:0, borderRadius:"50%", opacity:0.5 }}/>
                  <span className="rainbow-bg" style={{ position:"relative", display:"inline-flex", width:5, height:5, borderRadius:"50%" }}/>
                </span>
                <span className="rainbow-text" style={{ fontSize:14, fontFamily:"var(--font-geist-mono)", fontWeight:600 }}>DRIPPING</span>
              </div>
            )}
          </div>

          {/* Row 2 — vault animation (fixed height, vault scaled inside) */}
          <div style={{ flexShrink:0, borderBottom:`1px solid ${T.border}` }}>
            <Vault fillPct={fillPct} drops={drops} ripples={ripples} onDropEnd={removeDropById} active={active}/>
          </div>

          {/* Row 3 — balance */}
          <div style={{ flexShrink:0, borderBottom:`1px solid ${T.border}`, padding:"14px 20px", textAlign:"center" }}>
            <div style={{ display:"flex", alignItems:"baseline", justifyContent:"center", gap:8, marginBottom:4 }}>
              <span className="rainbow-text" style={{ fontSize:28, fontWeight:800, fontFamily:"var(--font-geist-mono)", letterSpacing:"-0.04em", lineHeight:1 }}>
                <AnimNum value={balance} d={2}/>
              </span>
              <span style={{ fontSize:15, color:T.faint, fontFamily:"var(--font-geist-mono)" }}>DRIP</span>
            </div>
            <p style={{ fontSize:14, color:T.faint }}>≈ ${fmt(balance*DRIP_PRICE)} USD</p>
          </div>

          {/* Row 4 — 2×2 stats */}
          <div style={{ flexShrink:0, display:"grid", gridTemplateColumns:"1fr 1fr", borderBottom:`1px solid ${T.border}` }}>
            {([
              { label:"Earn rate", val: active ? `+${fmt(totalRate,1)}` : "—", sub: active ? "DRIP/hr" : "" },
              { label:"Claimable", val: fmt(claimable,2), sub: "DRIP" },
              { label:"Campaigns", val: `${joined.size}`, sub: "active" },
              { label:"Posts",     val: `${posts.length}`, sub: "tracked" },
            ] as {label:string;val:string;sub:string}[]).map((s,i)=>(
              <div key={s.label} style={{ padding:"12px 14px", textAlign:"center", borderRight: i%2===0 ? `1px solid ${T.border}` : "none", borderBottom: i<2 ? `1px solid ${T.border}` : "none" }}>
                <p style={{ fontSize:14, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.12em", color:T.faint, marginBottom:4 }}>{s.label}</p>
                <p style={{ fontSize:18, fontWeight:700, fontFamily:"var(--font-geist-mono)", letterSpacing:"-0.02em", color:T.fg, lineHeight:1 }}>{s.val}</p>
                {s.sub && <p style={{ fontSize:14, color:T.faint, fontFamily:"var(--font-geist-mono)", marginTop:2 }}>{s.sub}</p>}
              </div>
            ))}
          </div>

          {/* Row 5 — claim button */}
          <div style={{ flex:1, padding:"14px 20px", display:"flex", flexDirection:"column", justifyContent:"flex-end", gap:8 }}>
            {!active && <p style={{ fontSize:15, fontFamily:"var(--font-geist-mono)", color:T.faint, textAlign:"center" }}>Join a campaign to start earning</p>}
            <motion.button
              onClick={()=>claimable>0.1&&setShowClaim(true)}
              disabled={claimable<=0.1}
              whileHover={claimable>0.1?{ scale:1.02 }:{}}
              whileTap={claimable>0.1?{ scale:0.97 }:{}}
              data-cursor-hover
              className={claimable>0.1?"rainbow-bg":""}
              style={{ width:"100%", height:48, borderRadius:10, border:"none", background:claimable<=0.1?"rgba(255,255,255,0.05)":undefined, color:claimable>0.1?"#111":"rgba(255,255,255,0.18)", fontWeight:700, fontSize:15, cursor:claimable>0.1?"pointer":"not-allowed", fontFamily:"inherit", boxShadow:claimable>0.1?"0 0 40px -10px rgba(255,255,255,0.3)":"none" }}>
              {claimable>0.1?`Claim ${fmt(claimable)} DRIP`:"Nothing to claim yet"}
            </motion.button>
          </div>
        </div>

        {/* CENTER: Campaigns (flex: 1) */}
        <div style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0, overflow:"hidden" }}>

          {/* Header — same 56px height */}
          <div style={{ height:56, flexShrink:0, borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 24px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <span style={{ fontSize:15, fontWeight:700, color:T.fg }}>Campaigns</span>
              <span style={{ fontSize:14, fontFamily:"var(--font-geist-mono)", color:T.faint, background:T.el, padding:"3px 9px", borderRadius:20, border:`1px solid ${T.border}` }}>{campaigns.length} live</span>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              {([
                { label:"Submit Post", onClick:()=>setShowPost(true) },
                { label:"Create Campaign", onClick:()=>setShowCreateCampaign(true) },
              ] as {label:string;onClick:()=>void}[]).map(btn=>(
                <button key={btn.label} onClick={btn.onClick} data-cursor-hover
                  style={{ height:36, padding:"0 14px", borderRadius:8, border:`1px solid ${T.border}`, background:T.el, color:T.subtle, fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:5, transition:"all 0.2s" }}
                  onMouseEnter={e=>{ const el=e.currentTarget; el.style.color=T.fg; el.style.borderColor=T.faint; el.style.background="rgba(255,255,255,0.07)"; }}
                  onMouseLeave={e=>{ const el=e.currentTarget; el.style.color=T.subtle; el.style.borderColor=T.border; el.style.background=T.el; }}>
                  + {btn.label}
                </button>
              ))}
            </div>
          </div>

          {/* Scrollable campaign grid */}
          <div style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>
            {campaigns.length>0 ? (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(280px, 1fr))", gap:16 }}>
                {campaigns.map((c,i)=>(
                  <CampaignCard key={c.id} c={c} joined={joined.has(c.id)} onToggle={()=>toggleCampaign(c.id)} earning={joined.has(c.id)&&active} index={i}/>
                ))}
              </div>
            ) : (
              <div style={{ height:"100%", display:"flex", alignItems:"center", justifyContent:"center", flexDirection:"column", gap:14 }}>
                <p style={{ fontSize:15, color:T.faint }}>No campaigns live yet.</p>
                <button onClick={()=>setShowCreateCampaign(true)} data-cursor-hover
                  style={{ height:36, padding:"0 18px", borderRadius:9, border:`1px solid ${T.border}`, background:T.el, color:T.subtle, fontSize:14, fontWeight:600, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s" }}
                  onMouseEnter={e=>{ const el=e.currentTarget; el.style.color=T.fg; el.style.borderColor=T.faint; }}
                  onMouseLeave={e=>{ const el=e.currentTarget; el.style.color=T.subtle; el.style.borderColor=T.border; }}>
                  + Create the first one
                </button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: Activity (280px) */}
        <div style={{ width:280, flexShrink:0, borderLeft:`1px solid ${T.border}`, display:"flex", flexDirection:"column", overflow:"hidden" }}>

          {/* Header — same 56px height */}
          <div style={{ height:56, flexShrink:0, borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 20px" }}>
            <span style={{ fontSize:15, fontWeight:700, color:T.fg }}>Your Posts</span>
            <button onClick={()=>setShowPost(true)} data-cursor-hover
              style={{ height:38, padding:"0 11px", borderRadius:7, border:`1px solid ${T.border}`, background:T.el, color:T.subtle, fontSize:15, fontWeight:600, cursor:"pointer", fontFamily:"inherit", display:"flex", alignItems:"center", gap:4, transition:"all 0.2s" }}
              onMouseEnter={e=>{ const el=e.currentTarget; el.style.color=T.fg; el.style.borderColor=T.faint; }}
              onMouseLeave={e=>{ const el=e.currentTarget; el.style.color=T.subtle; el.style.borderColor=T.border; }}>
              + New
            </button>
          </div>

          {/* Posts list */}
          <div style={{ flex:"0 0 auto", maxHeight:220, overflowY:"auto", borderBottom:`1px solid ${T.border}` }}>
            {posts.length>0 ? posts.map(p=>(
              <div key={p.id} style={{ padding:"11px 20px", borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ width:28, height:38, borderRadius:7, background:"rgba(255,255,255,0.05)", border:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                  <span className="rainbow-text" style={{ fontSize:14 }}>↑</span>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <p style={{ fontSize:14, color:T.fg, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.campaign}</p>
                  <p style={{ fontSize:15, color:T.faint, fontFamily:"var(--font-geist-mono)", marginTop:2 }}>{fmtK(p.impressions)} views</p>
                </div>
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <p className="rainbow-text" style={{ fontSize:14, fontFamily:"var(--font-geist-mono)", fontWeight:700 }}>+{p.dripHr}</p>
                  <p style={{ fontSize:11, color:T.faint, fontFamily:"var(--font-geist-mono)", textTransform:"uppercase", letterSpacing:"0.1em", marginTop:1 }}>DRIP/hr</p>
                </div>
              </div>
            )) : (
              <div style={{ padding:"20px", textAlign:"center" }}>
                <p style={{ fontSize:14, color:T.faint, lineHeight:1.6 }}>No posts yet.<br/>Join a campaign first.</p>
              </div>
            )}
          </div>

          {/* Live feed header */}
          <div style={{ height:48, flexShrink:0, borderBottom:`1px solid ${T.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 20px" }}>
            <span style={{ fontSize:14, fontWeight:700, color:T.fg }}>Live Feed</span>
            <div style={{ display:"flex", alignItems:"center", gap:5 }}>
              <span style={{ position:"relative", display:"inline-flex", width:5, height:5 }}>
                <span className="rainbow-bg animate-ping" style={{ position:"absolute", inset:0, borderRadius:"50%", opacity:0.6 }}/>
                <span className="rainbow-bg" style={{ position:"relative", display:"inline-flex", width:5, height:5, borderRadius:"50%" }}/>
              </span>
              <span className="rainbow-text" style={{ fontSize:14, fontFamily:"var(--font-geist-mono)", fontWeight:600, letterSpacing:"0.1em" }}>LIVE</span>
            </div>
          </div>

          {/* Feed — fills remaining height */}
          <div style={{ flex:1, overflowY:"auto" }}>
            <CommunityFeed compact/>
          </div>
        </div>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showClaim&&<ClaimModal key="claim" claimable={claimable} onClose={()=>setShowClaim(false)} onConfirm={()=>handleClaim(claimable)}/>}
        {showPost &&<SubmitModal key="submit" joined={Array.from(joined)} campaigns={campaigns} walletAddress={walletAddress} twitterHandle={twitterHandle} authToken={authToken} onClose={()=>setShowPost(false)} onSuccess={handleSubmit}/>}
        {showCreateCampaign&&<CreateCampaignModal key="create-campaign" authToken={authToken} onClose={()=>setShowCreateCampaign(false)} onSuccess={(c)=>{ setCampaigns(p=>[c,...p]); setShowCreateCampaign(false); }}/>}
      </AnimatePresence>
    </>
  );
}

// â”€â”€â”€ Root â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function Page() {
  const { publicKey } = useWallet();
  const [screen,        setScreen]        = useState<Screen>("landing");
  const [twitterHandle, setTwitterHandle] = useState("");
  const [authToken,     setAuthToken]     = useState("");
  const [showIntro,     setShowIntro]     = useState(false);

  // Restore session (no cinematic on auto-restore)
  useEffect(() => {
    const saved = localStorage.getItem("drip_token");
    const handle = localStorage.getItem("drip_handle");
    if (saved && handle) { setAuthToken(saved); setTwitterHandle(handle); setScreen("app"); }
  }, []);

  function handleLandingDone(handle: string, token: string) {
    localStorage.setItem("drip_token", token);
    localStorage.setItem("drip_handle", handle);
    setAuthToken(token);
    setTwitterHandle(handle);
    // Show cinematic intro, then reveal app
    setShowIntro(true);
    setScreen("app");
  }

  function handleLogout() {
    localStorage.removeItem("drip_token");
    localStorage.removeItem("drip_handle");
    setAuthToken("");
    setTwitterHandle("");
    setScreen("landing");
  }

  return (
    <TipProvider>
      <div style={{ background:T.bg, color:T.fg, minHeight:"100vh", position:"relative" }}>
        <div>
          <Cursor/>
          <AnimatePresence mode="wait">
            {screen==="landing"
              ? <Landing key="landing" onDone={handleLandingDone}/>
              : <motion.div key="app" initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ duration:0.4, delay: showIntro ? 2.4 : 0 }}>
                  <DripApp walletAddress={publicKey?.toString() ?? ""} twitterHandle={twitterHandle} authToken={authToken} onLogout={handleLogout}/>
                </motion.div>
            }
          </AnimatePresence>

          {/* Cinematic intro overlay — only on fresh login */}
          <AnimatePresence>
            {showIntro && (
              <CinematicIntro key="intro" onComplete={() => setShowIntro(false)}/>
            )}
          </AnimatePresence>
        </div>
      </div>
    </TipProvider>
  );
}




