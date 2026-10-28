"use client";

import { useEffect, useId, useRef } from "react";

/*
 * Glow Keyboard – an AI chat input above a glass keyboard and a moving gradient floor, in a single self-contained file.
 * The prompt types itself, key by key, with a human rhythm and the odd typo; click the input to type yourself.
 * Every key press lights up the keyboard and sends a wave up out of the gradient and a flash through the glow.
 * The floor is two blurred layers – a colour layer and a white "plus-lighter" layer – that drift and morph.
 * The artwork keeps an 11 : 6 frame and scales with its container – every size is in container units.
 * Animations only run while the illustration is on screen; prefers-reduced-motion keeps it still (typing still works).
 */

export type GlowKeyboardProps = {
  /** Prompts the demo types one after another – each one is sent with Enter */
  prompts?: string[];
  /** Placeholder in the chat input */
  placeholder?: string;
  /** Called when a prompt is sent with Enter – by the demo or by the user */
  onSubmit?: (text: string) => void;
  className?: string;
  /** Accessible name of the scene */
  label?: string;
};

/** [key id, legend, left, top, width, height, classes] – a Mac keyboard with German ISO layout, 1575 × 634 */
type Key = [string, string, number, number, number, number, string];
const KEYS: Key[] = [
  ["Escape", "esc", 24, 24, 149, 56, "mod sm"],
  ["F1", "F1", 183, 24, 96, 56, "fkey"],
  ["F2", "F2", 289, 24, 96, 56, "fkey"],
  ["F3", "F3", 395, 24, 96, 56, "fkey"],
  ["F4", "F4", 501, 24, 96, 56, "fkey"],
  ["F5", "F5", 607, 24, 96, 56, "fkey"],
  ["F6", "F6", 713, 24, 96, 56, "fkey"],
  ["F7", "F7", 819, 24, 96, 56, "fkey"],
  ["F8", "F8", 925, 24, 96, 56, "fkey"],
  ["F9", "F9", 1031, 24, 96, 56, "fkey"],
  ["F10", "F10", 1137, 24, 96, 56, "fkey"],
  ["F11", "F11", 1243, 24, 96, 56, "fkey"],
  ["F12", "F12", 1349, 24, 96, 56, "fkey"],
  ["", "", 1455, 24, 96, 56, "touchid"],
  ["^", "^", 24, 90, 96, 96, ""],
  ["1", "1", 130, 90, 96, 96, ""],
  ["2", "2", 236, 90, 96, 96, ""],
  ["3", "3", 342, 90, 96, 96, ""],
  ["4", "4", 448, 90, 96, 96, ""],
  ["5", "5", 554, 90, 96, 96, ""],
  ["6", "6", 660, 90, 96, 96, ""],
  ["7", "7", 766, 90, 96, 96, ""],
  ["8", "8", 872, 90, 96, 96, ""],
  ["9", "9", 978, 90, 96, 96, ""],
  ["0", "0", 1084, 90, 96, 96, ""],
  ["\u00df", "\u00df", 1190, 90, 96, 96, ""],
  ["\u00b4", "\u00b4", 1296, 90, 96, 96, ""],
  ["Backspace", "\u232b", 1402, 90, 149, 96, "mod"],
  ["Tab", "\u21e5", 24, 196, 149, 96, "mod"],
  ["q", "q", 183, 196, 96, 96, ""],
  ["w", "w", 289, 196, 96, 96, ""],
  ["e", "e", 395, 196, 96, 96, ""],
  ["r", "r", 501, 196, 96, 96, ""],
  ["t", "t", 607, 196, 96, 96, ""],
  ["z", "z", 713, 196, 96, 96, ""],
  ["u", "u", 819, 196, 96, 96, ""],
  ["i", "i", 925, 196, 96, 96, ""],
  ["o", "o", 1031, 196, 96, 96, ""],
  ["p", "p", 1137, 196, 96, 96, ""],
  ["\u00fc", "\u00fc", 1243, 196, 96, 96, ""],
  ["+", "+", 1349, 196, 96, 96, ""],
  ["Enter", "\u21a9", 1455, 196, 96, 202, "mod enter"],
  ["CapsLock", "\u21ea", 24, 302, 149, 96, "mod"],
  ["a", "a", 183, 302, 96, 96, ""],
  ["s", "s", 289, 302, 96, 96, ""],
  ["d", "d", 395, 302, 96, 96, ""],
  ["f", "f", 501, 302, 96, 96, ""],
  ["g", "g", 607, 302, 96, 96, ""],
  ["h", "h", 713, 302, 96, 96, ""],
  ["j", "j", 819, 302, 96, 96, ""],
  ["k", "k", 925, 302, 96, 96, ""],
  ["l", "l", 1031, 302, 96, 96, ""],
  ["\u00f6", "\u00f6", 1137, 302, 96, 96, ""],
  ["\u00e4", "\u00e4", 1243, 302, 96, 96, ""],
  ["#", "#", 1349, 302, 96, 96, ""],
  ["ShiftLeft", "\u21e7", 24, 408, 122.5, 96, "mod"],
  ["", "<", 156.5, 408, 96, 96, ""],
  ["y", "y", 262.5, 408, 96, 96, ""],
  ["x", "x", 368.5, 408, 96, 96, ""],
  ["c", "c", 474.5, 408, 96, 96, ""],
  ["v", "v", 580.5, 408, 96, 96, ""],
  ["b", "b", 686.5, 408, 96, 96, ""],
  ["n", "n", 792.5, 408, 96, 96, ""],
  ["m", "m", 898.5, 408, 96, 96, ""],
  [",", ",", 1004.5, 408, 96, 96, ""],
  [".", ".", 1110.5, 408, 96, 96, ""],
  ["-", "-", 1216.5, 408, 96, 96, ""],
  ["ShiftRight", "\u21e7", 1322.5, 408, 228.5, 96, "mod"],
  ["Fn", "fn", 24, 514, 96, 96, "mod sm"],
  ["ControlLeft", "\u2303", 130, 514, 96, 96, "mod"],
  ["AltLeft", "\u2325", 236, 514, 96, 96, "mod"],
  ["MetaLeft", "\u2318", 342, 514, 122.5, 96, "mod"],
  ["Space", "", 474.5, 514, 520, 96, "space"],
  ["MetaRight", "\u2318", 1004.5, 514, 122.5, 96, "mod"],
  ["AltRight", "\u2325", 1137, 514, 96, 96, "mod"],
  ["ArrowLeft", "\u2190", 1243, 514, 96, 96, "mod arrow"],
  ["ArrowUp", "\u2191", 1349, 514, 96, 45.5, "mod arrow half"],
  ["ArrowDown", "\u2193", 1349, 564.5, 96, 45.5, "mod arrow half"],
  ["ArrowRight", "\u2192", 1455, 514, 96, 96, "mod arrow"],
];

/** Base points of both floor shapes: peaks (l, m, r) and valleys (vL, vR) move independently */
type Shape = {
  k: number;
  v1: [number, number]; c: [number, number]; l: [number, number]; bottom: number; r: [number, number];
  v4: [number, number]; v3: [number, number]; m2: [number, number]; m1: [number, number]; v2: [number, number];
};
const COLOR: Shape = {
  k: 1, v1: [926.8, 565.8], c: [302.1, 297.3], l: [291.3, 291.3], bottom: 1222.8, r: [3155.8, 361.3],
  v4: [2493.8, 565.8], v3: [2189.3, 565.8], m2: [1898.8, 428.8], m1: [1510.8, 428.8], v2: [1230.8, 565.8],
};
const LIGHT: Shape = {
  k: 0.8427, v1: [781.039, 476.815], c: [254.588, 250.543], l: [245.486, 245.486], bottom: 1030.49, r: [2659.48, 304.477],
  v4: [2101.59, 476.815], v3: [1844.98, 476.815], m2: [1600.17, 361.361], m1: [1273.19, 361.361], v2: [1037.23, 476.815],
};
const PERIOD = 6000;
const PEAK = 60;
const VALLEY = 45;
/** Frame → SVG offsets of the two floor layers (both SVGs are 1 : 1 with the 2200 frame) */
const COLOR_OFF = { x: 581.3, y: 461.7 };
const LIGHT_OFF = { x: 310.5, y: 676.5 };
const KB = { left: 312.5, width: 1575 };

function shapePath(p: Shape, t: number) {
  const d = {
    l: PEAK * Math.sin(t),
    m: -PEAK * Math.sin(t + 0.5),
    r: PEAK * Math.sin(t + 1),
    vL: VALLEY * Math.sin(t + Math.PI / 2 + 0.25),
    vR: VALLEY * Math.sin(t - Math.PI / 2 + 0.75),
  };
  const y = (pt: [number, number], dy: number) => (pt[1] + dy * p.k).toFixed(1);
  return (
    `M${p.v1[0]} ${y(p.v1, d.vL)}` +
    `C${p.v1[0]} ${y(p.v1, d.vL)} ${p.c[0]} ${y(p.c, d.l)} ${p.l[0]} ${y(p.l, d.l)}` +
    `V${p.bottom}H${p.r[0]}V${y(p.r, d.r)}` +
    `L${p.v4[0]} ${y(p.v4, d.vR)}H${p.v3[0]}V${y(p.v3, d.vR)}` +
    `L${p.m2[0]} ${y(p.m2, d.m)}H${p.m1[0]}V${y(p.m1, d.m)}` +
    `L${p.v2[0]} ${y(p.v2, d.vL)}H${p.v1[0]}V${y(p.v1, d.vL)}Z`
  );
}

/** Wave that rises out of the floor: fast up, soft down; -1 once it is over */
function envelope(t: number) {
  const A = 160;
  const D = 1200;
  if (t < A) return Math.sin((Math.PI / 2) * (t / A));
  if (t < A + D) return 0.5 * (1 + Math.cos((Math.PI * (t - A)) / D));
  return -1;
}

/** Physical key → key id on the drawn keyboard */
const BY_CODE: Record<string, string> = {
  ShiftLeft: "ShiftLeft", ShiftRight: "ShiftRight", ControlLeft: "ControlLeft", ControlRight: "ControlLeft",
  AltLeft: "AltLeft", AltRight: "AltRight", MetaLeft: "MetaLeft", MetaRight: "MetaRight", OSLeft: "MetaLeft", OSRight: "MetaRight",
  Space: "Space", Backspace: "Backspace", Delete: "Backspace", Tab: "Tab", Enter: "Enter", NumpadEnter: "Enter",
  CapsLock: "CapsLock", Escape: "Escape", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight", ArrowUp: "ArrowUp", ArrowDown: "ArrowDown",
};
/** Physical position → German legend, for shifted, option and dead keys */
const CODE_CHAR: Record<string, string> = {
  Minus: "ß", Equal: "´", BracketLeft: "ü", BracketRight: "+", Semicolon: "ö", Quote: "ä", Backslash: "#",
  Comma: ",", Period: ".", Slash: "-", Backquote: "^", IntlBackslash: "^", KeyY: "z", KeyZ: "y",
};
const KEY_IDS = new Set(KEYS.map((k) => k[0]).filter(Boolean));
function resolveKey(e: { code: string; key: string }) {
  if (BY_CODE[e.code]) return BY_CODE[e.code];
  if (/^F([1-9]|1[0-2])$/.test(e.code)) return e.code;
  if (e.key.length === 1 && KEY_IDS.has(e.key.toLowerCase())) return e.key.toLowerCase();
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (CODE_CHAR[e.code]) return CODE_CHAR[e.code];
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  return null;
}

const defaultPrompts = ["Find a quiet hike near Zermatt", "Plan a sunrise climb for Saturday", "What should I pack for two days?"];

export function GlowKeyboard({
  prompts = defaultPrompts,
  placeholder = "Ask AI anything...",
  onSubmit,
  className,
  label = "AI chat input above a glass keyboard and a moving colour gradient",
}: GlowKeyboardProps) {
  const id = "ui-gk" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const color = useRef<SVGPathElement>(null);
  const light = useRef<SVGPathElement>(null);
  // Latest props for the long-running effect, without restarting it
  const latest = useRef({ prompts, onSubmit });
  latest.current = { prompts, onSubmit };

  useEffect(() => {
    const el = root.current;
    const field = input.current;
    const pathC = color.current;
    const pathL = light.current;
    if (!el || !field || !pathC || !pathL) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const svgC = pathC.ownerSVGElement!;
    const svgL = pathL.ownerSVGElement!;
    const composer = el.querySelector<HTMLElement>(".ui-gk-composer")!;
    const glowHard = el.querySelector<HTMLElement>(".ui-gk-glow--hard")!;
    const keyEls = new Map<string, HTMLElement>();
    el.querySelectorAll<HTMLElement>("[data-k]").forEach((k) => keyEls.set(k.dataset.k!, k));
    const unit = () => el.clientWidth / 2200;

    /* Waves out of the floor */
    const NS = "http://www.w3.org/2000/svg";
    const bumps: { c: SVGEllipseElement; l: SVGEllipseElement; t0: number }[] = [];
    const addBump = (frameX: number) => {
      if (still) return;
      const c = document.createElementNS(NS, "ellipse");
      c.setAttribute("fill", `url(#${id}-floor)`);
      c.setAttribute("rx", "230");
      c.setAttribute("ry", "320");
      c.setAttribute("cx", String(frameX + COLOR_OFF.x));
      c.setAttribute("cy", String(1361.7 - COLOR_OFF.y));
      const l = document.createElementNS(NS, "ellipse");
      l.setAttribute("fill", "#fff");
      l.setAttribute("fill-opacity", "0.8");
      l.setAttribute("rx", "200");
      l.setAttribute("ry", "260");
      l.setAttribute("cx", String(frameX + LIGHT_OFF.x));
      l.setAttribute("cy", String(1401.7 - LIGHT_OFF.y));
      svgC.appendChild(c);
      svgL.appendChild(l);
      bumps.push({ c, l, t0: performance.now() });
      if (bumps.length > 14) {
        const b = bumps.shift()!;
        b.c.remove();
        b.l.remove();
      }
    };

    /* Floor morph and waves – one loop, only while on screen */
    let frame = 0;
    let visible = false;
    let drawn = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      // The floor moves slowly under a heavy blur – 30 redraws a second look the same as 60
      if (now - drawn < 32) return;
      drawn = now;
      const t = (now / PERIOD) * Math.PI * 2;
      pathC.setAttribute("d", shapePath(COLOR, t));
      pathL.setAttribute("d", shapePath(LIGHT, t));
      for (let i = bumps.length - 1; i >= 0; i--) {
        const b = bumps[i];
        const a = envelope(now - b.t0);
        if (a < 0) {
          b.c.remove();
          b.l.remove();
          bumps.splice(i, 1);
          continue;
        }
        // The light layer rises less, so it never outshines the colour layer
        b.c.setAttribute("cy", (1361.7 - a * 470 - COLOR_OFF.y).toFixed(1));
        b.l.setAttribute("cy", (1401.7 - a * 330 - LIGHT_OFF.y).toFixed(1));
      }
    };

    /* Flash in the input glow at the key's position, in the colour the glow has there right now */
    const swapPhase = () => {
      const a = glowHard.getAnimations({ subtree: true }).find((x) => (x as CSSAnimation).animationName === "ui-gk-swap");
      const ms = Number(a?.currentTime ?? 0);
      return (1 - Math.cos((2 * Math.PI * (ms % 6000)) / 6000)) / 2;
    };
    const flashGlow = (rel: number) => {
      if (still) return;
      const p = swapPhase();
      const pink = rel * (1 - p) + (1 - rel) * p;
      const g = Math.round(119 * (1 - pink));
      const b = Math.round(85 * pink);
      const s = unit();
      const hit = document.createElement("div");
      hit.className = "ui-gk-hit";
      hit.style.left = `${(578.36 + rel * 1037.79 - 170) * s}px`;
      hit.style.background = `radial-gradient(closest-side, rgba(255,${g},${b},.95), rgba(255,${g},${b},0))`;
      composer.insertBefore(hit, glowHard);
      hit.animate(
        [
          { opacity: 0, transform: "scale(.8, 1)", filter: `blur(${14 * s}px)` },
          { opacity: 0.6, transform: `translateY(${-2 * s}px) scale(1.1, 1.35)`, filter: `blur(${22 * s}px)`, offset: 0.15 },
          { opacity: 0, transform: "scale(1.2, 1.15)", filter: `blur(${30 * s}px)` },
        ],
        { duration: 1100, easing: "ease-out" },
      ).onfinish = () => hit.remove();
    };

    /* Pressed keys: quick taps stay visible for a moment */
    const downAt = new Map<string, number>();
    const press = (k: string) => {
      const key = keyEls.get(k);
      if (!key) return;
      key.setAttribute("data-down", "");
      downAt.set(k, performance.now());
    };
    const release = (k: string) => {
      const key = keyEls.get(k);
      if (!key) return;
      const wait = Math.max(0, 150 - (performance.now() - (downAt.get(k) ?? 0)));
      downAt.delete(k);
      window.setTimeout(() => {
        if (!downAt.has(k)) key.removeAttribute("data-down");
      }, wait);
    };
    const releaseAll = () => [...downAt.keys()].forEach(release);
    const surge = (k: string) => {
      const key = keyEls.get(k);
      if (!key || !visible) return;
      const rel = Math.min(1, Math.max(0, (key.offsetLeft + key.offsetWidth / 2) / (KB.width * unit())));
      addBump(120 + rel * 1960);
      flashGlow(rel);
    };
    const submit = () => {
      const text = field.value.trim();
      if (text) latest.current.onSubmit?.(text);
      field.value = "";
      field.dispatchEvent(new Event("input", { bubbles: true }));
    };

    /* The user types: mirror every key, Enter sends */
    let userTook = false;
    const onDown = (e: KeyboardEvent) => {
      if (e.isTrusted) userTook = true;
      const k = resolveKey(e);
      if (k) press(k);
      if (k && !e.repeat) surge(k);
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    };
    const onUp = (e: KeyboardEvent) => {
      const k = resolveKey(e);
      if (k) release(k);
      // macOS swallows the keyup of other keys while ⌘ is held
      if (k === "MetaLeft" || k === "MetaRight") releaseAll();
    };
    const takeOver = () => {
      userTook = true;
    };
    field.addEventListener("keydown", onDown);
    field.addEventListener("keyup", onUp);
    field.addEventListener("blur", releaseAll);
    field.addEventListener("focus", takeOver);

    /* The demo: types each prompt by itself, slow and human, with one typo, then sends it */
    let alive = true;
    const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
    const rand = (min: number, max: number) => min + Math.random() * (max - min);
    const stop = () => !alive || userTook;
    const set = (v: string) => {
      field.value = v;
      field.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const tap = async (k: string, hold = rand(130, 180)) => {
      press(k);
      surge(k);
      await sleep(hold);
      release(k);
    };
    const typeChar = async (ch: string) => {
      if (ch === " ") {
        await tap("Space");
        set(field.value + " ");
        return;
      }
      const lower = ch.toLowerCase();
      if (!KEY_IDS.has(lower)) {
        set(field.value + ch);
        return;
      }
      if (ch !== lower) {
        // Capital: hold shift around the letter
        press("ShiftLeft");
        await sleep(rand(60, 90));
        press(lower);
        surge(lower);
        set(field.value + ch);
        await sleep(rand(130, 170));
        release(lower);
        await sleep(60);
        release("ShiftLeft");
        return;
      }
      press(lower);
      surge(lower);
      set(field.value + ch);
      await sleep(rand(130, 180));
      release(lower);
    };
    const runDemo = async () => {
      await sleep(1700); // let the entry animation finish
      for (let round = 0; !stop(); round++) {
        const list = latest.current.prompts;
        if (!list.length) return;
        const text = list[round % list.length];
        // One typo in the first prompt, after its first word and a bit
        const typoAt = round === 0 ? Math.min(text.length - 1, (text.indexOf(" ") + 4) || 4) : -1;
        for (let i = 0; i < text.length; i++) {
          if (stop()) return;
          if (i === typoAt) {
            await typeChar("w");
            await sleep(rand(320, 420));
            await tap("Backspace");
            set(field.value.slice(0, -1));
            await sleep(rand(160, 220));
          }
          await typeChar(text[i]);
          await sleep(text[i] === " " ? rand(220, 380) : rand(110, 260)); // uneven rhythm like a person
        }
        await sleep(1600);
        if (stop()) return;
        await tap("Enter");
        submit();
        await sleep(1100);
      }
    };

    const start = () => {
      el.setAttribute("data-in", "");
      if (!still) void runDemo();
    };
    let started = false;
    const io =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([e]) => {
            visible = e.isIntersecting;
            cancelAnimationFrame(frame);
            el.toggleAttribute("data-paused", !visible);
            if (!visible) return;
            if (!started) {
              started = true;
              start();
            }
            if (!still) frame = requestAnimationFrame(tick);
          });
    if (io) io.observe(el);
    else {
      visible = true;
      started = true;
      start();
      if (!still) frame = requestAnimationFrame(tick);
    }

    return () => {
      alive = false;
      io?.disconnect();
      cancelAnimationFrame(frame);
      field.removeEventListener("keydown", onDown);
      field.removeEventListener("keyup", onUp);
      field.removeEventListener("blur", releaseAll);
      field.removeEventListener("focus", takeOver);
      bumps.forEach((b) => {
        b.c.remove();
        b.l.remove();
      });
    };
  }, [id]);

  return (
    <div
      ref={root}
      className={["ui-gk", className].filter(Boolean).join(" ")}
      role="group"
      aria-label={label}
      // A click anywhere on the scene puts the cursor into the input
      onPointerDown={(e) => {
        if (e.target !== input.current) {
          e.preventDefault();
          input.current?.focus();
        }
      }}
    >
      {/* React 19 hoists this into <head> once, no matter how many instances render */}
      <style href="ui-glow-keyboard" precedence="default">
        {css}
      </style>
      <div className="ui-gk-frame">
        {/* Gradient floor: colour layer, then a white layer that lightens it with plus-lighter */}
        <div className="ui-gk-floor ui-gk-floor--color" aria-hidden="true">
          <div className="ui-gk-bleed">
            <svg viewBox="0 0 3447.1 1514.1" preserveAspectRatio="none">
              <defs>
                <linearGradient id={`${id}-floor`} x1="1723.8" y1="423.3" x2="1723.8" y2="894.3" gradientUnits="userSpaceOnUse">
                  <stop stopColor="#FF7700" />
                  <stop offset="0.302885" stopColor="#FF0055" />
                  <stop offset="0.673077" stopColor="#0073FF" />
                </linearGradient>
              </defs>
              <path ref={color} d={shapePath(COLOR, 0)} fill={`url(#${id}-floor)`} />
            </svg>
          </div>
        </div>
        <div className="ui-gk-floor ui-gk-floor--light" aria-hidden="true">
          <div className="ui-gk-bleed">
            <svg viewBox="0 0 2904.96 1275.97" preserveAspectRatio="none">
              <path ref={light} d={shapePath(LIGHT, 0)} fill="#fff" fillOpacity="0.8" />
            </svg>
          </div>
        </div>

        {/* Chat input with its glow */}
        <div className="ui-gk-composer">
          <div className="ui-gk-glow ui-gk-glow--soft" aria-hidden="true" />
          <div className="ui-gk-glow-mid" aria-hidden="true" />
          <div className="ui-gk-glow ui-gk-glow--hard" aria-hidden="true" />
          <div className="ui-gk-ring" aria-hidden="true" />
          <div className="ui-gk-input">
            <div className="ui-gk-glass" aria-hidden="true" />
            <svg className="ui-gk-orb" viewBox="0 0 95.5862 95.5862" aria-hidden="true">
              <defs>
                <radialGradient id={`${id}-orb`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(47.7931 9.55862) rotate(90) scale(86.0276)">
                  <stop offset="0.221154" stopColor="#FF7700" />
                  <stop offset="1" stopColor="#FF2A91" />
                </radialGradient>
                <filter id={`${id}-orb-glow`} x="0" y="0" width="95.5862" height="95.5862" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
                  <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="alpha" />
                  <feGaussianBlur stdDeviation="21.3703" />
                  <feComposite in2="alpha" operator="arithmetic" k2="-1" k3="1" />
                  <feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0" />
                  <feBlend mode="normal" in2="SourceGraphic" />
                </filter>
              </defs>
              <circle cx="47.7931" cy="47.7931" r="47.7931" fill={`url(#${id}-orb)`} filter={`url(#${id}-orb-glow)`} />
            </svg>
            <span className="ui-gk-field">
              <span className="ui-gk-caret" aria-hidden="true" />
              <input
                ref={input}
                className="ui-gk-prompt"
                type="text"
                placeholder={placeholder}
                aria-label={placeholder}
                autoComplete="off"
                spellCheck={false}
              />
            </span>
            <div className="ui-gk-glass ui-gk-glass--inner" aria-hidden="true" />
          </div>
        </div>

        {/* Glass keyboard */}
        <div className="ui-gk-keyboard" aria-hidden="true">
          {KEYS.map(([k, legend, left, top, width, height, cls], i) => (
            <span
              key={i}
              className={["ui-gk-key", ...cls.split(" ").filter(Boolean).map((c) => `ui-gk-key--${c}`)].join(" ")}
              data-k={k || undefined}
              style={{ left: u(left), top: u(top), width: u(width), height: u(height) }}
            >
              {legend}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- Styles ---------- */

/** A length in the 2200 × 1200 design frame, scaled to the container */
function u(n: number) {
  return `calc(${n} * var(--ui-gk-u))`;
}

const css = /* css */ `
.ui-gk {
  --ui-gk-bg: #fafafa;
  /* Theme colours – light by default, overridden for dark at the end */
  --ui-gk-floor-light: 1;
  --ui-gk-ring: 1;
  --ui-gk-input-border: #fff;
  --ui-gk-input-bg: rgba(255, 255, 255, 0.9);
  --ui-gk-input-inner: #fff;
  --ui-gk-caret: rgba(175, 175, 175, 0.4);
  --ui-gk-text: #676767;
  --ui-gk-placeholder: #afafaf;
  --ui-gk-board-border: rgba(255, 255, 255, 0.55);
  --ui-gk-board-bg: rgba(255, 255, 255, 0.16);
  --ui-gk-board-inner: rgba(255, 255, 255, 0.5);
  --ui-gk-board-shadow: rgba(0, 0, 0, 0.05);
  --ui-gk-key-bg: rgba(255, 255, 255, 0.72);
  --ui-gk-key-edge: inset 0 0 0 transparent;
  --ui-gk-key-drop: rgba(0, 0, 0, 0.05);
  --ui-gk-key-inner: rgba(255, 255, 255, 0.6);
  --ui-gk-key-text: rgba(20, 20, 30, 0.5);
  --ui-gk-touchid: rgba(20, 20, 30, 0.25);
  --ui-gk-key-down-bg: rgba(206, 206, 214, 0.97);
  --ui-gk-key-down-text: rgba(20, 20, 30, 0.9);
  --ui-gk-key-down-inner: rgba(0, 0, 0, 0.08);
  container-type: inline-size;
  width: 100%;
  font-family: inherit;
  -webkit-font-smoothing: antialiased;
  cursor: text;
}
.ui-gk-frame {
  --ui-gk-u: calc(100cqw / 2200);
  position: relative;
  aspect-ratio: 2200 / 1200;
  overflow: hidden;
  isolation: isolate;
  background: var(--ui-gk-bg);
}
.ui-gk-frame > * { position: absolute; margin: 0; }

/* Gradient floor */
.ui-gk-floor--color { left: ${u(-290)}; top: ${u(753)}; width: ${u(2864.5)}; height: ${u(931.5)}; }
.ui-gk-floor--light { left: ${u(-65)}; top: ${u(922)}; width: ${u(2414)}; height: ${u(785)}; mix-blend-mode: plus-lighter; opacity: var(--ui-gk-floor-light); }
.ui-gk-bleed { position: absolute; inset: -31.27% -10.17%; transform-origin: 50% 70%; will-change: transform; }
/* The floor is so soft that it can be drawn at a quarter of its size and scaled up 4× on the GPU –
   it looks the same, but every redraw of the moving shapes costs about a sixteenth */
.ui-gk-bleed svg {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  width: 25%;
  height: 25%;
  overflow: visible;
  transform: scale(4);
  transform-origin: 0 0;
  will-change: transform;
}
.ui-gk-floor--color svg { filter: blur(calc(${u(145.65)} / 4)); }
.ui-gk-floor--light svg { filter: blur(calc(${u(122.74)} / 4)); }
/* Both layers drift on the same slow beat; the light one moves a little less */
.ui-gk-floor--color .ui-gk-bleed { animation: ui-gk-drift-color 6s ease-in-out infinite; }
.ui-gk-floor--light .ui-gk-bleed { animation: ui-gk-drift-light 6s ease-in-out infinite; }
@keyframes ui-gk-drift-color {
  0%, 100% { transform: translate(0, 0) scale(1, 1); }
  33% { transform: translate(${u(-120)}, ${u(-20)}) scale(1.05, 1.08); }
  66% { transform: translate(${u(100)}, ${u(12)}) scale(0.98, 0.96); }
}
@keyframes ui-gk-drift-light {
  0%, 100% { transform: translate(0, 0) scale(1, 1); }
  33% { transform: translate(${u(-100)}, ${u(-10)}) scale(1.03, 1); }
  66% { transform: translate(${u(85)}, ${u(10)}) scale(0.98, 0.94); }
}

/* Chat input and its glow */
.ui-gk-composer { inset: 0; }
.ui-gk-composer > * { position: absolute; }
.ui-gk-glow {
  left: ${u(578.36)};
  top: ${u(230)};
  width: ${u(1037.79)};
  height: ${u(152.94)};
  border-radius: ${u(163.86)};
}
/* Two blurred layers – orange → pink and pink → orange – that cross-fade, so the colours swap sides.
   Only opacity moves, so the GPU blends them without redrawing the blur */
.ui-gk-glow::before,
.ui-gk-glow::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  filter: var(--ui-gk-glow-blur);
  will-change: opacity;
}
.ui-gk-glow::before { background-image: linear-gradient(to right, var(--ui-gk-glow-a), var(--ui-gk-glow-b)); }
.ui-gk-glow::after {
  background-image: linear-gradient(to right, var(--ui-gk-glow-b), var(--ui-gk-glow-a));
  opacity: 0;
  animation: ui-gk-swap 6s ease-in-out infinite;
}
.ui-gk-glow--soft {
  --ui-gk-glow-a: rgba(255, 119, 0, 0.3);
  --ui-gk-glow-b: rgba(255, 0, 85, 0.3);
  --ui-gk-glow-blur: blur(${u(54)});
}
.ui-gk-glow--hard {
  --ui-gk-glow-a: #f70;
  --ui-gk-glow-b: #f05;
  --ui-gk-glow-blur: blur(${u(9.5)});
}
.ui-gk-glow-mid {
  left: ${u(817.25)};
  top: ${u(230)};
  width: ${u(560)};
  height: ${u(152.94)};
  border-radius: ${u(76.47)};
  background: radial-gradient(closest-side, rgba(255, 60, 45, 0.75), rgba(255, 60, 45, 0));
  /* A fixed blur; only transform and opacity move, so it stays on the GPU */
  filter: blur(${u(22)});
  will-change: transform, opacity;
  animation: ui-gk-breathe 4s ease-in-out infinite;
}
/* Flash at the position of a pressed key */
.ui-gk-hit {
  top: ${u(230)};
  width: ${u(340)};
  height: ${u(152.94)};
  border-radius: ${u(76.47)};
  pointer-events: none;
}
@keyframes ui-gk-swap {
  50% { opacity: 1; }
}
@keyframes ui-gk-breathe {
  0%, 100% { transform: translateY(0) scaleY(1); opacity: 0.7; }
  25% { transform: translateY(${u(-16)}) scaleY(1.4); opacity: 1; }
  50% { transform: translateY(0) scaleY(1.1); opacity: 0.8; }
  75% { transform: translateY(${u(16)}) scaleY(1.45); opacity: 1; }
}
/* White stroke around the glow, fading out at both ends */
.ui-gk-ring {
  left: ${u(576.86)};
  top: ${u(228.5)};
  width: ${u(1040.79)};
  height: ${u(155.94)};
  border: ${u(3)} solid transparent;
  border-radius: ${u(77.97)};
  background: linear-gradient(to right, rgba(255, 255, 255, 0) 0.14%, #fff 25%, #fff 75%, rgba(255, 255, 255, 0) 99.86%) border-box;
  -webkit-mask: linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0) border-box;
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  filter: blur(${u(5.74)});
  mix-blend-mode: plus-lighter;
  opacity: var(--ui-gk-ring);
}
.ui-gk-input {
  left: ${u(576.99)};
  top: ${u(230)};
  width: ${u(1046.09)};
  height: ${u(152.94)};
  display: flex;
  align-items: center;
  gap: ${u(20.59)};
  padding: ${u(27.31)};
  border: ${u(1.37)} solid var(--ui-gk-input-border);
  border-radius: ${u(109.24)};
}
.ui-gk-glass { position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
.ui-gk-input > .ui-gk-glass {
  background: var(--ui-gk-input-bg);
  -webkit-backdrop-filter: blur(${u(25.48)});
  backdrop-filter: blur(${u(25.48)});
}
.ui-gk-input > .ui-gk-glass--inner {
  background: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  box-shadow: inset 0 0 ${u(35.91)} 0 var(--ui-gk-input-inner), inset 0 0 ${u(35.91)} 0 var(--ui-gk-input-inner);
}
.ui-gk-orb { position: relative; flex: none; width: ${u(95.59)}; height: ${u(95.59)}; }
.ui-gk-field { position: relative; flex: 1; display: flex; align-items: center; gap: ${u(8.19)}; min-width: 0; }
/* Drawn cursor that blinks like a native input – only while the input is empty */
.ui-gk-caret {
  flex: none;
  width: ${u(2.73)};
  height: ${u(60.08)};
  background: var(--ui-gk-caret);
  animation: ui-gk-blink 1.06s step-end infinite;
}
.ui-gk-field:has(.ui-gk-prompt:not(:placeholder-shown)) .ui-gk-caret { visibility: hidden; }
@keyframes ui-gk-blink { 50% { opacity: 0; } }
.ui-gk-prompt {
  flex: 1;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  font: inherit;
  font-size: ${u(46.43)};
  line-height: normal;
  color: var(--ui-gk-text);
  caret-color: var(--ui-gk-placeholder);
}
.ui-gk-prompt::placeholder { color: var(--ui-gk-placeholder); opacity: 1; }
.ui-gk-prompt:placeholder-shown { caret-color: transparent; }
/* No focus box while typing – also against global :focus-visible rules of the host page */
.ui-gk .ui-gk-prompt:focus-visible { outline: none; }

/* Glass keyboard */
.ui-gk-keyboard {
  left: ${u(312.5)};
  top: ${u(440)};
  width: ${u(1575)};
  height: ${u(634)};
  border: ${u(1.5)} solid var(--ui-gk-board-border);
  border-radius: ${u(52)};
  background: var(--ui-gk-board-bg);
  -webkit-backdrop-filter: blur(${u(24)});
  backdrop-filter: blur(${u(24)});
  box-shadow: inset 0 0 ${u(30)} var(--ui-gk-board-inner), 0 ${u(22)} ${u(48)} var(--ui-gk-board-shadow);
}
.ui-gk-key {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: ${u(20)};
  background-color: var(--ui-gk-key-bg);
  box-shadow: var(--ui-gk-key-edge), 0 ${u(1.5)} 0 var(--ui-gk-key-drop), inset 0 0 ${u(12)} var(--ui-gk-key-inner);
  font-size: ${u(44)};
  line-height: 1;
  color: var(--ui-gk-key-text);
  user-select: none;
  transition: transform 0.28s ease-out, background-color 0.28s ease-out, color 0.28s ease-out, box-shadow 0.28s ease-out;
}
.ui-gk-key--mod { font-size: ${u(36)}; }
.ui-gk-key--sm { font-size: ${u(26)}; }
.ui-gk-key--fkey { font-size: ${u(22)}; border-radius: ${u(14)}; }
.ui-gk-key--arrow { font-size: ${u(28)}; }
.ui-gk-key--half { font-size: ${u(22)}; border-radius: ${u(12)}; }
.ui-gk-key--touchid { border-radius: ${u(14)}; }
.ui-gk-key--touchid::after {
  content: "";
  width: ${u(30)};
  height: ${u(30)};
  border: ${u(2)} solid var(--ui-gk-touchid);
  border-radius: 50%;
}
/* Pressed */
.ui-gk-key[data-down] {
  transform: translateY(${u(3)}) scale(0.9);
  background-color: var(--ui-gk-key-down-bg);
  color: var(--ui-gk-key-down-text);
  box-shadow: inset 0 0 0 transparent, 0 0 0 rgba(0, 0, 0, 0), inset 0 ${u(2)} ${u(6)} var(--ui-gk-key-down-inner);
  transition-duration: 0.06s;
}

/* Entry: the input first, then the keyboard. Fill mode "backwards" only,
   so no stacking context stays behind – the glass and plus-lighter keep blending like the static frame */
.ui-gk:not([data-in]) .ui-gk-composer,
.ui-gk:not([data-in]) .ui-gk-keyboard { opacity: 0; }
.ui-gk[data-in] .ui-gk-composer { animation: ui-gk-rise 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) 0.15s backwards; }
.ui-gk[data-in] .ui-gk-keyboard { animation: ui-gk-rise 0.9s cubic-bezier(0.2, 0.8, 0.2, 1) 0.45s backwards; }
@keyframes ui-gk-rise {
  from { opacity: 0; transform: translateY(${u(60)}); }
  to { opacity: 1; transform: none; }
}

/* Dark: dark caps with a faint top edge, light legends, deeper shadows.
   The white plus-lighter layers would wash the dark page grey, so they only keep a soft hot core */
:where(.dark, [data-theme="dark"]) .ui-gk {
  --ui-gk-bg: #111113;
  --ui-gk-floor-light: 0.3;
  --ui-gk-ring: 0.55;
  --ui-gk-input-border: rgba(255, 255, 255, 0.14);
  --ui-gk-input-bg: rgba(24, 24, 27, 0.88);
  --ui-gk-input-inner: rgba(255, 255, 255, 0.04);
  --ui-gk-caret: rgba(255, 255, 255, 0.3);
  --ui-gk-text: #e4e4e7;
  --ui-gk-placeholder: #737378;
  --ui-gk-board-border: rgba(255, 255, 255, 0.08);
  --ui-gk-board-bg: rgba(14, 14, 16, 0.5);
  --ui-gk-board-inner: rgba(255, 255, 255, 0.03);
  --ui-gk-board-shadow: rgba(0, 0, 0, 0.5);
  --ui-gk-key-bg: rgba(32, 32, 35, 0.86);
  --ui-gk-key-edge: inset 0 ${u(1.5)} 0 rgba(255, 255, 255, 0.08);
  --ui-gk-key-drop: rgba(0, 0, 0, 0.6);
  --ui-gk-key-inner: rgba(0, 0, 0, 0.18);
  --ui-gk-key-text: rgba(235, 235, 245, 0.6);
  --ui-gk-touchid: rgba(235, 235, 245, 0.22);
  --ui-gk-key-down-bg: rgba(56, 56, 62, 0.97);
  --ui-gk-key-down-text: rgba(255, 255, 255, 0.95);
  --ui-gk-key-down-inner: rgba(0, 0, 0, 0.4);
}

/* Off screen: loops pause */
.ui-gk[data-paused] * { animation-play-state: paused; }

@media (prefers-reduced-motion: reduce) {
  .ui-gk-bleed, .ui-gk-glow::after, .ui-gk-glow-mid, .ui-gk-caret,
  .ui-gk[data-in] .ui-gk-composer, .ui-gk[data-in] .ui-gk-keyboard { animation: none; }
  .ui-gk-key { transition: none; }
}
`;
