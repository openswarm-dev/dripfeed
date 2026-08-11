"use client";

import { useEffect, useRef, useState } from "react";

export default function Cursor() {
  const dotRef = useRef<HTMLDivElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  const [vis, setVis] = useState(false);
  const [click, setClick] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(pointer:coarse)").matches) return;

    let dx = 0;
    let dy = 0;
    let rx = 0;
    let ry = 0;
    let raf = 0;

    const mv = (e: MouseEvent) => {
      dx = e.clientX;
      dy = e.clientY;
      if (!vis) setVis(true);
      setHover(!!(e.target as HTMLElement).closest("a,button,[data-cursor-hover]"));
    };
    const md = () => setClick(true);
    const mu = () => setClick(false);

    const loop = () => {
      rx += (dx - rx) * 0.1;
      ry += (dy - ry) * 0.1;
      if (dotRef.current) dotRef.current.style.transform = `translate(${dx}px, ${dy}px)`;
      if (ringRef.current) ringRef.current.style.transform = `translate(${rx}px, ${ry}px)`;
      raf = requestAnimationFrame(loop);
    };

    document.addEventListener("mousemove", mv);
    document.addEventListener("mousedown", md);
    document.addEventListener("mouseup", mu);
    raf = requestAnimationFrame(loop);

    return () => {
      document.removeEventListener("mousemove", mv);
      document.removeEventListener("mousedown", md);
      document.removeEventListener("mouseup", mu);
      cancelAnimationFrame(raf);
    };
  }, [vis]);

  if (!vis) return null;

  const rs = hover ? 44 : click ? 20 : 32;
  const ds = hover ? 3 : click ? 10 : 5;

  return (
    <>
      <div
        ref={ringRef}
        className="fixed top-0 left-0 pointer-events-none z-[9998] rounded-full transition-[width,height] duration-200"
        style={{
          width: rs,
          height: rs,
          marginLeft: -(rs / 2),
          marginTop: -(rs / 2),
          border: "1px solid rgba(255,255,255,0.25)",
        }}
      />
      <div
        ref={dotRef}
        className="rainbow-bg fixed top-0 left-0 pointer-events-none z-[9999] rounded-full transition-[width,height] duration-150"
        style={{
          width: ds,
          height: ds,
          marginLeft: -(ds / 2),
          marginTop: -(ds / 2),
        }}
      />
    </>
  );
}
