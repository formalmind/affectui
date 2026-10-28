"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

/*
 * Blur Crossfade – swaps content with a soft blur while the box glides to the new size,
 * in a single self-contained file. Change `id` and the old content blurs out as the new one
 * blurs in; height (and optionally width) morphs from old to new.
 * The styles are injected below, so no extra files are needed.
 */

export type BlurCrossfadeProps = {
  /** Change this to swap – the children of the old id fade out, the new ones fade in */
  id: string | number;
  children?: ReactNode;
  /** Length of the swap in ms */
  duration?: number;
  /** Blur in px at the start and end of the fade */
  blur?: number;
  /** Which sides glide to the new size; "both" sizes the box to its content */
  morph?: "height" | "both" | "none";
  /** Root element – use span inside buttons and other inline content */
  as?: "div" | "span";
  className?: string;
  style?: CSSProperties;
};

type Exit = { id: string | number; node: ReactNode; n: number; w: number; h: number };

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function BlurCrossfade({
  id,
  children,
  duration = 420,
  blur = 10,
  morph = "height",
  as: Tag = "div",
  className,
  style,
}: BlurCrossfadeProps) {
  const rootRef = useRef<HTMLElement>(null);
  const curRef = useRef<HTMLElement>(null);
  const [exit, setExit] = useState<Exit | null>(null);
  const lastId = useRef(id);
  // Children and size of what is on screen, kept for the moment it has to leave
  const lastNode = useRef<ReactNode>(children);
  const size = useRef({ w: 0, h: 0 });
  const busy = useRef(false);
  const timer = useRef(0);
  const counter = useRef(0);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const layer = curRef.current;
    if (id === lastId.current || !root || !layer) {
      lastNode.current = children;
      return;
    }
    lastId.current = id;
    const leaving = lastNode.current;
    lastNode.current = children;
    window.clearTimeout(timer.current);

    const to = { w: layer.offsetWidth, h: layer.offsetHeight };
    if (reduced() || duration <= 0) {
      setExit(null);
      root.style.height = root.style.width = root.style.transition = "";
      root.removeAttribute("data-busy");
      busy.current = false;
      size.current = to;
      return;
    }

    // Mid-swap the box is already animating – start from where it is right now
    const r = root.getBoundingClientRect();
    const from = busy.current ? { w: r.width, h: r.height } : size.current;
    setExit({ id: lastId.current, node: leaving, n: ++counter.current, w: size.current.w, h: size.current.h });
    size.current = to;
    busy.current = true;
    root.setAttribute("data-busy", "");

    if (morph !== "none") {
      root.style.transition = "none";
      root.style.height = `${from.h}px`;
      if (morph === "both") root.style.width = `${from.w}px`;
      void root.offsetHeight;
      const t = `${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      root.style.transition = morph === "both" ? `height ${t}, width ${t}` : `height ${t}`;
      root.style.height = `${to.h}px`;
      if (morph === "both") root.style.width = `${to.w}px`;
    }

    timer.current = window.setTimeout(() => {
      root.style.height = root.style.width = root.style.transition = "";
      root.removeAttribute("data-busy");
      busy.current = false;
      setExit(null);
    }, duration + 30);
  });

  // Keep the resting size current when the content changes on its own
  useEffect(() => {
    const layer = curRef.current;
    if (!layer || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!busy.current) size.current = { w: layer.offsetWidth, h: layer.offsetHeight };
    });
    ro.observe(layer);
    size.current = { w: layer.offsetWidth, h: layer.offsetHeight };
    return () => ro.disconnect();
  }, [id]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const vars = {
    "--ui-bx-duration": `${duration}ms`,
    "--ui-bx-blur": `${blur}px`,
    ...style,
  } as CSSProperties;

  const Layer = Tag;
  return (
    <>
      <style href="ui-blur-crossfade" precedence="default">
        {css}
      </style>
      <Tag
        ref={rootRef as never}
        className={["ui-bx", `ui-bx--${morph}`, className].filter(Boolean).join(" ")}
        style={vars}
      >
        <Layer
          key={`c-${id}`}
          ref={curRef as never}
          className={`ui-bx__layer${exit ? " ui-bx__layer--in" : ""}`}
        >
          {children}
        </Layer>
        {exit && (
          <Layer
            key={`x-${exit.id}-${exit.n}`}
            className="ui-bx__layer ui-bx__layer--out"
            aria-hidden="true"
            inert
            style={{ width: exit.w || undefined }}
          >
            {exit.node}
          </Layer>
        )}
      </Tag>
    </>
  );
}

const css = /* css */ `
.ui-bx {
  --ui-bx-duration: 420ms;
  --ui-bx-blur: 10px;
  --ui-bx-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  display: block;
}
.ui-bx--both {
  display: inline-block;
  vertical-align: top;
}
/* Clip only while swapping, so shadows and focus rings show the rest of the time */
.ui-bx[data-busy] { overflow: hidden; }

.ui-bx__layer { display: block; }
.ui-bx--both > .ui-bx__layer { width: max-content; }
.ui-bx__layer--out {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
}
.ui-bx--height > .ui-bx__layer--out,
.ui-bx--none > .ui-bx__layer--out { right: 0; }
/* With width morph both layers stay centered in the gliding box */
.ui-bx--both > .ui-bx__layer--out { left: 50%; translate: -50% 0; }
.ui-bx--both > .ui-bx__layer--in { margin-left: 50%; translate: -50% 0; }

.ui-bx__layer--in {
  animation: ui-bx-in var(--ui-bx-duration) var(--ui-bx-ease) both;
}
.ui-bx__layer--out {
  animation: ui-bx-out calc(var(--ui-bx-duration) * 0.8) ease-in both;
}
@keyframes ui-bx-in {
  from { opacity: 0; filter: blur(var(--ui-bx-blur)); transform: scale(0.98); }
  to { opacity: 1; filter: blur(0); transform: scale(1); }
}
@keyframes ui-bx-out {
  from { opacity: 1; filter: blur(0); transform: scale(1); }
  to { opacity: 0; filter: blur(var(--ui-bx-blur)); transform: scale(1.02); }
}

@media (prefers-reduced-motion: reduce) {
  .ui-bx__layer--in, .ui-bx__layer--out { animation: none; }
  .ui-bx__layer--out { display: none; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html>.
   The crossfade has no colors of its own – the content inside brings them. */
:where(.dark, [data-theme="dark"]) .ui-bx { color: inherit; }
`;
