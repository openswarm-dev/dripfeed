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

