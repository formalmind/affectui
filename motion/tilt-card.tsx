"use client";

import { useEffect, useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";

/*
 * Tilt Card – a card that tilts in 3D towards the pointer, in a single self-contained file.
 * A soft glare follows the pointer and the card lifts a little; on leave it springs back smoothly.
 * Pointer moves are batched with requestAnimationFrame and written to CSS variables (--rx, --ry, --gx, --gy).
 * Touch pointers don't tilt. Keyboard focus inside the card gives a slight lift.
 * Reduced motion: no tilt, only the shadow changes.
 */

export type TiltCardProps = {
  /** The card's content – it fills the tilting surface */
  children?: ReactNode;
  /** Maximum tilt in degrees */
  maxTilt?: number;
  /** Show a soft glare that follows the pointer */
  glare?: boolean;
  /** Scale while the pointer is over the card */
  scale?: number;
  /** Perspective distance in px – smaller is more dramatic */
  perspective?: number;
  className?: string;
};

export function TiltCard({ children, maxTilt = 10, glare = true, scale = 1.02, perspective = 900, className }: TiltCardProps) {
  const root = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const point = useRef<{ x: number; y: number } | null>(null);
  const still = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => (still.current = mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => {
      mq.removeEventListener("change", sync);
      cancelAnimationFrame(frame.current);
    };
  }, []);

  // Read the pointer relative to the untransformed wrapper, so the tilt itself never feeds back
  const apply = () => {
    frame.current = 0;
    const r = root.current, c = card.current, p = point.current;
    if (!r || !c || !p) return;
    const box = r.getBoundingClientRect();
    const x = Math.min(Math.max((p.x - box.left) / box.width, 0), 1);
    const y = Math.min(Math.max((p.y - box.top) / box.height, 0), 1);
    c.style.setProperty("--rx", `${((0.5 - y) * 2 * maxTilt).toFixed(2)}deg`);
    c.style.setProperty("--ry", `${((x - 0.5) * 2 * maxTilt).toFixed(2)}deg`);
    c.style.setProperty("--gx", `${(x * 100).toFixed(1)}%`);
    c.style.setProperty("--gy", `${(y * 100).toFixed(1)}%`);
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    const c = card.current;
    if (c && !c.hasAttribute("data-active")) c.setAttribute("data-active", "");
    if (still.current) return;
    point.current = { x: e.clientX, y: e.clientY };
    if (!frame.current) frame.current = requestAnimationFrame(apply);
  };

  const onLeave = () => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    point.current = null;
    const c = card.current;
    if (!c) return;
    c.removeAttribute("data-active");
    c.style.setProperty("--rx", "0deg");
    c.style.setProperty("--ry", "0deg");
  };

  const style = {
    "--ui-tc-perspective": `${perspective}px`,
    "--ui-tc-scale": scale,
  } as CSSProperties;

  return (
    <div
      ref={root}
      className={["ui-tc", className].filter(Boolean).join(" ")}
      style={style}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      onPointerCancel={onLeave}
    >
      {/* React 19 hoists this into <head> once, no matter how many instances render */}
      <style href="ui-tilt-card" precedence="default">
        {css}
      </style>
      <div ref={card} className="ui-tc-card">
        {children}
        {glare && <span className="ui-tc-glare" aria-hidden="true" />}
      </div>
    </div>
  );
}

const css = /* css */ `
.ui-tc {
  --ui-tc-radius: 20px;
  --ui-tc-shadow: 0 1px 2px rgba(0, 0, 0, 0.06), 0 8px 24px -12px rgba(0, 0, 0, 0.18);
  --ui-tc-shadow-active: 0 2px 4px rgba(0, 0, 0, 0.05), 0 24px 48px -16px rgba(0, 0, 0, 0.3);
  --ui-tc-glare-color: rgba(255, 255, 255, 0.32);
  --ui-tc-spring: cubic-bezier(0.34, 1.36, 0.64, 1);
  display: inline-block;
  perspective: var(--ui-tc-perspective);
}

.ui-tc-card {
  --rx: 0deg;
  --ry: 0deg;
  --gx: 50%;
  --gy: 50%;
  --ui-tc-lift: 0px;
  --ui-tc-s: 1;
  position: relative;
  overflow: hidden;
  border-radius: var(--ui-tc-radius);
  box-shadow: var(--ui-tc-shadow);
  transform: translateY(var(--ui-tc-lift)) rotateX(var(--rx)) rotateY(var(--ry)) scale(var(--ui-tc-s));
  /* The return: a soft spring back to rest */
  transition: transform 700ms var(--ui-tc-spring), box-shadow 500ms ease;
  will-change: transform;
}

/* While the pointer is over it: follow closely, with just enough easing to smooth the steps */
.ui-tc-card[data-active] {
  --ui-tc-s: var(--ui-tc-scale);
  --ui-tc-lift: -2px;
  box-shadow: var(--ui-tc-shadow-active);
  transition: transform 140ms ease-out, box-shadow 300ms ease;
}

/* Keyboard focus inside the card: a slight lift */
.ui-tc:has(:focus-visible) .ui-tc-card {
  --ui-tc-lift: -4px;
  box-shadow: var(--ui-tc-shadow-active);
}

.ui-tc-glare {
  position: absolute;
  inset: 0;
  z-index: 1;
  border-radius: inherit;
  pointer-events: none;
  background: radial-gradient(circle at var(--gx) var(--gy), var(--ui-tc-glare-color), transparent 55%);
  mix-blend-mode: soft-light;
  opacity: 0;
  transition: opacity 400ms ease;
}
.ui-tc-card[data-active] .ui-tc-glare { opacity: 1; }

@media (hover: none), (pointer: coarse) {
  .ui-tc-card[data-active] { --ui-tc-s: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-tc-card,
  .ui-tc-card[data-active],
  .ui-tc:has(:focus-visible) .ui-tc-card {
    transform: none;
    transition: box-shadow 300ms ease;
  }
  .ui-tc-glare { display: none; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-tc {
  --ui-tc-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px -12px rgba(0, 0, 0, 0.6);
  --ui-tc-shadow-active: 0 2px 4px rgba(0, 0, 0, 0.4), 0 28px 56px -16px rgba(0, 0, 0, 0.75);
  --ui-tc-glare-color: rgba(255, 255, 255, 0.24);
}
`;
