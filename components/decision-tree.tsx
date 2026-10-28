"use client";

import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from "react";

/*
 * Decision Tree – an agent that is stuck on a decision lays it out as a tree, in a single self-contained file.
 * A white card on a soft gray tray, a quiet bar on top: how many decisions wait and where you are.
 *   · on the left the question, with the agent, its model and how risky the call is
 *   · from it the options as branches, each with what it leads to – the agent's own pick marked
 *   · risky consequences are marked – point at one (or press F) for the agent's note and its source
 *   · point at a branch and its path lights up while the others step back; pick one (click or 1–4) and the
 *     others fade, the path draws on to its outcome, and the next decision grows in
 *   · "Other…" opens a field that grows with what you write – your own instruction, Enter sends it
 * Narrow containers draw the tree top to bottom. The styles are injected below, so no extra files are needed.
 */

export type DecisionRisk = "high" | "medium" | "low";

/** A part of a consequence the agent isn't sure about – marked, its note shows on hover */
export type DecisionFlag = { text: string; note: string; source?: string };
/** Plain text, or text with flagged parts in it */
export type DecisionText = string | (string | DecisionFlag)[];

export type DecisionOption = {
  /** What to do, in a few words – e.g. "Cancel the newer ones" */
  label: string;
  /** What it leads to, one line each – e.g. "Refunds $147 · not reversible" */
  effects?: DecisionText[];
  /** The agent's own preference – marked "Agent's pick" */
  pick?: boolean;
};

export type Decision = {
  id: string;
  /** The question, in one sentence – e.g. "3 customers have two subscriptions – how should I proceed?" */
  question: string;
  /** A line of context under it */
  context?: string;
  /** Who asks, e.g. "Billing agent" */
  agent: string;
  /** The model behind the agent – shown under its name */
  model?: string;
  /** A small mark, e.g. the model maker's logo – defaults to the agent's initial */
  icon?: ReactNode;
  /** High and medium show as a small tag next to the agent */
  risk?: DecisionRisk;
  /** Two to four options */
  options: DecisionOption[];
};

/** What you chose: one of the options, or your own instruction */
export type DecisionChoice = { index: number; option: DecisionOption } | { other: string };

/** Drive it from outside – e.g. your own shortcuts, or a demo */
export type DecisionTreeHandle = {
  /** Lights up the n-th branch as if pointed at – null lets go */
  hover: (index: number | null) => void;
  /** Picks the n-th option; the index after the last one opens "Other…" */
  choose: (index: number) => void;
  /** Fills the "Other…" field */
  setOther: (text: string) => void;
  /** Sends the "Other…" field */
  send: () => void;
  next: () => void;
  previous: () => void;
  /** Shows the note of the n-th flagged part – null hides it */
  peek: (index: number | null) => void;
};

export type DecisionTreeProps = {
  /** Everything waiting for a call – decided ones leave on their own, new ids join at the end */
  decisions: Decision[];
  /** A branch was picked or an instruction written – return the agent's short answer to an instruction (or a promise of it) */
  onChoose?: (decision: Decision, choice: DecisionChoice) => string | void | Promise<string | void>;
  /** Shows the "Other…" branch (default true) */
  allowOther?: boolean;
  title?: string;
  ref?: Ref<DecisionTreeHandle>;
  className?: string;
};

/* ---------- Helpers ---------- */

const RISK: Record<DecisionRisk, string> = { high: "High risk", medium: "Medium risk", low: "Low risk" };
/** First letter or digit of the agent – an emoji or an empty name never ends up half in the mark */
const initial = (name: string) => (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "").toUpperCase() || "AI";
const fmt = new Intl.NumberFormat("en-US");
/** Motion: how long the picked path shows its outcome, and how long the tree takes to fade */
const HOLD = 1500;
const ANSWER_HOLD = 2600;
const FADE = 280;
const partsOf = (t?: DecisionText): (string | DecisionFlag)[] => (t === undefined ? [] : typeof t === "string" ? [t] : t);
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

type Link = { id: string; d: string; b: number; kind: "branch" | "leaf" | "out" };
type Picked = { id: string; i: number; other?: string; answer?: string; leaving?: boolean };

/* ---------- Icons ---------- */

/* Tick, alert and badge: Hugeicons Free (MIT, © Hugeicons, hugeicons.com) */
const Tick = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M5 14L8.5 17.5L19 6.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
  </svg>
);
const Alert = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M13.9248 21H10.0752C5.44476 21 3.12955 21 2.27636 19.4939C1.42317 17.9879 2.60736 15.9914 4.97574 11.9985L6.90057 8.75333C9.17559 4.91778 10.3131 3 12 3C13.6869 3 14.8244 4.91777 17.0994 8.75332L19.0243 11.9985C21.3926 15.9914 22.5768 17.9879 21.7236 19.4939C20.8704 21 18.5552 21 13.9248 21Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    <path d="M12 9V13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    <path d="M12 16.8V17" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
  </svg>
);
/* A small branching mark for the title (drawn for affectUI) */
const Branches = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="3.5" cy="8" r="2" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="12.5" cy="3.5" r="2" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="12.5" cy="12.5" r="2" stroke="currentColor" strokeWidth="1.4" />
    <path d="M5.5 8H7.5C8.3 8 8.5 7.6 8.5 6.8V5C8.5 4 9 3.5 10 3.5H10.5M8.5 8.2V11C8.5 12 9 12.5 10 12.5H10.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
  </svg>
);
const Badge = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M18.9905 19H19M18.9905 19C18.3678 19.6175 17.2393 19.4637 16.4479 19.4637C15.4765 19.4637 15.0087 19.6537 14.3154 20.347C13.7251 20.9374 12.9337 22 12 22C11.0663 22 10.2749 20.9374 9.68457 20.347C8.99128 19.6537 8.52349 19.4637 7.55206 19.4637C6.76068 19.4637 5.63218 19.6175 5.00949 19C4.38181 18.3776 4.53628 17.2444 4.53628 16.4479C4.53628 15.4414 4.31616 14.9786 3.59938 14.2618C2.53314 13.1956 2.00002 12.6624 2 12C2.00001 11.3375 2.53312 10.8044 3.59935 9.73817C4.2392 9.09832 4.53628 8.46428 4.53628 7.55206C4.53628 6.76065 4.38249 5.63214 5 5.00944C5.62243 4.38178 6.7556 4.53626 7.55208 4.53626C8.46427 4.53626 9.09832 4.2392 9.73815 3.59937C10.8044 2.53312 11.3375 2 12 2C12.6625 2 13.1956 2.53312 14.2618 3.59937C14.9015 4.23907 15.5355 4.53626 16.4479 4.53626C17.2393 4.53626 18.3679 4.38247 18.9906 5C19.6182 5.62243 19.4637 6.75559 19.4637 7.55206C19.4637 8.55858 19.6839 9.02137 20.4006 9.73817C21.4669 10.8044 22 11.3375 22 12C22 12.6624 21.4669 13.1956 20.4006 14.2618C19.6838 14.9786 19.4637 15.4414 19.4637 16.4479C19.4637 17.2444 19.6182 18.3776 18.9905 19Z" stroke="currentColor" strokeWidth="1.6" />
    <path d="M9 12.8929C9 12.8929 10.2 13.5447 10.8 14.5C10.8 14.5 12.6 10.75 15 9.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
  </svg>
);

export function DecisionTree({ decisions, onChoose, allowOther = true, title = "Decisions", ref, className }: DecisionTreeProps) {
  const tipId = `${useId()}-tip`;
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const otherRef = useRef<HTMLTextAreaElement>(null);
  const growRef = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLSpanElement>(null);
  const els = useRef(new Map<string, HTMLElement>());
  const flagEls = useRef(new Map<number, HTMLElement>());
  const timers = useRef<number[]>([]);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const tref = (k: string) => (el: HTMLElement | null) => {
    if (el) els.current.set(k, el);
    else els.current.delete(k);
  };

  /* ---------- State ---------- */

  const [done, setDone] = useState<Record<string, true>>({});
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [otherOpen, setOtherOpen] = useState(false);
  const [other, setOther] = useState("");
  const [peek, setPeek] = useState<number | null>(null);
  const [hoverFlag, setHoverFlag] = useState<number | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const [narrow, setNarrow] = useState(false);

  // Each decision gets its own key – two with the same id stay apart, so next and done reach both
  const keys = new Map<Decision, string>();
  const seenIds = new Map<string, number>();
  for (const d of decisions) {
    const n = seenIds.get(d.id) ?? 0;
    seenIds.set(d.id, n + 1);
    keys.set(d, n ? `${d.id}#${n}` : d.id);
  }
  const keyOf = (d: Decision) => keys.get(d) ?? d.id;
  const list = decisions.filter((d) => !done[keyOf(d)]);
  const lastIndex = useRef(0);
  const found = list.findIndex((d) => keyOf(d) === currentId);
  const index = found >= 0 ? found : Math.min(lastIndex.current, list.length - 1);
  const current = index >= 0 ? list[index] : undefined;
  const total = decisions.length;
  const decided = Object.keys(done).length;
  useLayoutEffect(() => {
    lastIndex.current = Math.max(0, index);
    if (current && keyOf(current) !== currentId) setCurrentId(keyOf(current));
  });
  // A fresh decision starts clean
  useLayoutEffect(() => {
    setHover(null);
    setPicked(null);
    setOtherOpen(false);
    setOther("");
    setPeek(null);
    setHoverFlag(null);
  }, [current && keyOf(current)]);
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Measured right away too, so the first frame already draws the right way round
    setNarrow(root.clientWidth < 640);
    const ro = new ResizeObserver(() => setNarrow(root.clientWidth < 640));
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  /* ---------- Actions ---------- */

  const flash = (name: string) => {
    setPressed(name);
    later(() => setPressed((p) => (p === name ? null : p)), 220);
  };
  // The picked path holds a moment with its outcome, the tree fades, the next one grows in
  const finish = (d: Decision, hold: number) => {
    const fade = reduced() ? 0 : FADE;
    later(() => setPicked((p) => (p && p.id === keyOf(d) ? { ...p, leaving: true } : p)), hold);
    later(() => {
      setDone((x) => ({ ...x, [keyOf(d)]: true }));
      const keep = rootRef.current?.contains(document.activeElement);
      if (keep) requestAnimationFrame(() => rootRef.current?.focus({ preventScroll: true }));
    }, hold + fade);
  };
  const choose = (i: number) => {
    if (!current || picked) return;
    const d = current;
    if (allowOther && i === d.options.length) {
      flash("other");
      setOtherOpen(true);
      setHover(i);
      requestAnimationFrame(() => otherRef.current?.focus({ preventScroll: true }));
      return;
    }
    const o = d.options[i];
    if (!o) return;
    flash(`opt:${i}`);
    setHover(null);
    setPeek(null);
    setPicked({ id: keyOf(d), i });
    setSaid(`${o.label} – picked. ${d.agent.trim() || "The agent"} goes ahead.`);
    void onChoose?.(d, { index: i, option: o });
    finish(d, HOLD);
  };
  const send = () => {
    const text = other.trim();
    if (!current || !text || picked) return;
    const d = current;
    flash("send");
    setPicked({ id: keyOf(d), i: d.options.length, other: text });
    setSaid(`Sent to the ${(d.agent.trim() || "Agent").toLowerCase()}: ${text}`);
    Promise.resolve(onChoose?.(d, { other: text })).then((answer) => {
      later(() => {
        const reply = answer || "Got it – I'll take it from here.";
        setPicked((p) => (p && p.id === keyOf(d) ? { ...p, answer: reply } : p));
        setSaid(`${d.agent.trim() || "Agent"}: ${reply}`);
      }, 700);
      finish(d, ANSWER_HOLD);
    });
  };
  const move = (step: number) => {
    if (list.length < 2 || !current || picked) return;
    setCurrentId(keyOf(list[(index + step + list.length) % list.length]));
  };
  const flags = current ? current.options.flatMap((o) => (o.effects ?? []).flatMap((e) => partsOf(e))).filter((p): p is DecisionFlag => typeof p !== "string") : [];
  const cycleFlag = () => flags.length && setPeek((p) => (p === null ? 0 : p + 1 >= flags.length ? null : p + 1));

  useImperativeHandle(ref, () => ({
    hover: (i: number | null) => !picked && setHover(i),
    choose,
    setOther: (text: string) => {
      if (!otherOpen) setOtherOpen(true);
      setOther(text);
    },
    send,
    next: () => move(1),
    previous: () => move(-1),
    peek: (i: number | null) => setPeek(i),
  }));

  /* ---------- Keyboard: numbers pick, arrows move, while the focus is anywhere inside ---------- */

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing || !current) return;
    if ((e.target as HTMLElement).closest("textarea, input")) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const run = (fn: () => void) => {
      e.preventDefault();
      fn();
    };
    const n = Number(e.key);
    if (n >= 1 && n <= current.options.length + (allowOther ? 1 : 0)) return run(() => choose(n - 1));
    const keys: Record<string, () => void> = {
      arrowright: () => move(1),
      j: () => move(1),
      arrowleft: () => move(-1),
      k: () => move(-1),
      f: () => void cycleFlag(),
      escape: () => (peek !== null ? setPeek(null) : setOtherOpen(false)),
    };
    const fn = keys[e.key.toLowerCase()];
    if (fn) run(fn);
  };

  /* ---------- The lines: question to branches, branches to consequences, the pick to its outcome ---------- */

  const [links, setLinks] = useState<Link[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const box = treeRef.current;
    if (!box || !current) return;
    const measure = () => {
      // Offsets up to the page, minus the box's own – they ignore transforms, so the lines land where the cards settle
      const page = (el: HTMLElement) => {
        let l = 0;
        let t = 0;
        for (let e: HTMLElement | null = el; e; e = e.offsetParent as HTMLElement | null) {
          l += e.offsetLeft;
          t += e.offsetTop;
        }
        return { l, t };
      };
      const origin = page(box);
      const R = (k: string) => {
        const el = els.current.get(k);
        if (!el) return null;
        const p = page(el);
        const l = p.l - origin.l;
        const t = p.t - origin.t;
        return { l, t, r: l + el.offsetWidth, b: t + el.offsetHeight, h: el.offsetHeight };
      };
      const C = 8;
      // Wide: out of the right edge, a right-angled turn with small rounded corners, into the left edge
      const across = (x1: number, y1: number, x2: number, y2: number) => {
        const dy = y2 - y1;
        if (Math.abs(dy) < 2) return `M${x1} ${y1}H${x2}`;
        const mid = Math.round(x1 + (x2 - x1) / 2);
        const r = Math.min(C, Math.abs(dy) / 2, (x2 - x1) / 2);
        const sg = Math.sign(dy);
        return `M${x1} ${y1}H${mid - r}Q${mid} ${y1} ${mid} ${y1 + sg * r}V${y2 - sg * r}Q${mid} ${y2} ${mid + r} ${y2}H${x2}`;
      };
      // Narrow: down a rail on the left, a rounded corner, into the card's side
      const hang = (x1: number, y1: number, x2: number, y2: number) => {
        if (x2 - x1 < 2) return `M${x1} ${y1}V${y2}`;
        const r = Math.min(C, (y2 - y1) / 2, (x2 - x1) / 2);
        return `M${x1} ${y1}V${y2 - r}Q${x1} ${y2} ${x1 + r} ${y2}H${x2}`;
      };
      const root = R("root");
      if (!root) return;
      const next: Link[] = [];
      const n = current.options.length + (allowOther ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const o = R(`opt:${i}`);
        if (!o) continue;
        // "Other…" is met at its first line, so it can grow downwards without dragging its line along
        const isOther = i === current.options.length;
        const oc = isOther ? o.t + 18 : o.t + o.h / 2;
        next.push({ id: `b${i}`, b: i, kind: "branch", d: narrow ? hang(root.l + 18, root.b, o.l, o.t + Math.min(18, o.h / 2)) : across(root.r, root.t + root.h / 2, o.l, oc) });
        const lf = R(`leaf:${i}`);
        if (lf) next.push({ id: `l${i}`, b: i, kind: "leaf", d: narrow ? hang(o.l + 16, o.b, lf.l, lf.t + Math.min(14, lf.h / 2)) : across(o.r, o.t + o.h / 2, lf.l, lf.t + lf.h / 2) });
      }
      // The outcome hangs under the picked branch's last card
      const outEl = els.current.get("out");
      if (outEl && picked) {
        const from = R(`leaf:${picked.i}`) ?? R(`opt:${picked.i}`);
        if (from) {
          outEl.style.left = `${from.l + 24}px`;
          // Never wider than the room to its right – narrow cards keep it inside
          outEl.style.maxWidth = `${Math.max(120, Math.min(280, box.clientWidth - (from.l + 24)))}px`;
          outEl.style.top = `${from.b + 14}px`;
          const oc = R("out")!;
          next.push({ id: "o", b: picked.i, kind: "out", d: hang(from.l + 12, from.b, oc.l, oc.t + Math.min(16, oc.h / 2)) });
        }
      }
      const key = JSON.stringify(next);
      setLinks((prev) => (JSON.stringify(prev) === key ? prev : next));
      setSize((sz) => (sz.w === box.scrollWidth && sz.h === box.scrollHeight ? sz : { w: box.scrollWidth, h: box.scrollHeight }));
    };
    measure();
    // Every frame of a card's growth reports a new size – the lines follow it
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    for (const el of els.current.values()) ro.observe(el);
    return () => ro.disconnect();
  });

  /* ---------- "Other…": two lines when it opens, it grows to three, then it scrolls ---------- */

  useLayoutEffect(() => {
    const box = growRef.current;
    const m = mirrorRef.current;
    const ta = otherRef.current;
    if (!box || !m || !ta) return;
    const line = 20;
    const pad = 12;
    const h = Math.min(Math.max(m.offsetHeight, 2 * line + pad), 3 * line + pad);
    // It starts at one line, so opening is the first glide down to two
    if (!box.style.height) box.style.height = `${line + pad}px`;
    requestAnimationFrame(() => {
      box.style.height = `${h}px`;
    });
    const over = m.offsetHeight > 3 * line + pad;
    ta.style.overflowY = over ? "auto" : "hidden";
    if (over) ta.scrollTop = ta.scrollHeight;
  });

  /* ---------- The agent's note on a flagged part ---------- */

  const tipIndex = hoverFlag ?? peek;
  const tipFlag = tipIndex !== null && !picked ? flags[tipIndex] : undefined;
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const body = bodyRef.current;
    const el = tipIndex !== null ? flagEls.current.get(tipIndex) : undefined;
    if (!tip || !body || !el) return;
    const b = body.getBoundingClientRect();
    const scale = body.offsetWidth ? b.width / body.offsetWidth : 1;
    const lines = el.getClientRects();
    const r = lines[0] ?? el.getBoundingClientRect();
    const rEnd = lines[lines.length - 1] ?? r;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const top = (r.top - b.top) / scale;
    const bottom = (rEnd.bottom - b.top) / scale;
    const center = (r.left + r.width / 2 - b.left) / scale;
    // Below the part by default – above only when there's no room under it
    const above = bottom + 8 + h > body.offsetHeight - 4 && top - h - 8 >= 4;
    const left = Math.max(10, Math.min(center - w / 2, body.offsetWidth - w - 10));
    tip.style.top = `${above ? top - h - 8 : bottom + 8}px`;
    tip.style.left = `${left}px`;
    tip.style.setProperty("--x", `${center - left}px`);
    tip.dataset.side = above ? "above" : "below";
  });

  /* ---------- Pieces ---------- */

  const text = (t: DecisionText, counter: { n: number }) =>
    partsOf(t).map((p, k) => {
      if (typeof p === "string") return <span key={k}>{p}</span>;
      const i = counter.n++;
      const on = tipIndex === i && !picked;
      return (
        <mark
          key={k}
          ref={(el) => {
            if (el) flagEls.current.set(i, el);
            else flagEls.current.delete(i);
          }}
          className="ui-dct__flag"
          data-on={on ? "" : undefined}
          tabIndex={0}
          aria-label={`${p.text} – the agent is unsure`}
          aria-describedby={on ? tipId : undefined}
          onMouseEnter={() => setHoverFlag(i)}
          onMouseLeave={() => setHoverFlag((h) => (h === i ? null : h))}
          onFocus={() => setPeek(i)}
          onBlur={() => setPeek((x) => (x === i ? null : x))}
        >
          {p.text}
        </mark>
      );
    });

  const tree = (d: Decision) => {
    const counter = { n: 0 };
    const p = picked?.id === keyOf(d) ? picked : null;
    const otherIndex = d.options.length;
    const dim = (i: number) => (p ? p.i !== i : hover !== null && hover !== i);
    const hot = (i: number) => (p ? p.i === i : hover === i);
    const row = (i: number, content: ReactNode, leaf?: ReactNode) => (
      <div key={i} className="ui-dct__row" data-dim={dim(i) ? "" : undefined} style={{ "--i": i } as CSSProperties} onMouseEnter={() => !p && setHover(i)} onMouseLeave={() => !p && !otherOpen && setHover(null)}>
        {content}
        {leaf}
      </div>
    );
    return (
      <div ref={treeRef} key={keyOf(d)} className="ui-dct__tree" data-picked={p ? "" : undefined} data-leaving={p?.leaving ? "" : undefined}>
        <svg className="ui-dct__links" width={size.w} height={size.h} aria-hidden="true">
          {links.map((l) => (
            <path key={l.id} pathLength={1} d={l.d} className="ui-dct__link" data-kind={l.kind} data-pick={d.options[l.b]?.pick ? "" : undefined} data-hot={hot(l.b) ? "" : undefined} data-dim={dim(l.b) ? "" : undefined} style={{ "--i": l.b } as CSSProperties} />
          ))}
        </svg>
        <div ref={tref("root")} className="ui-dct__root">
          <div className="ui-dct__who">
            <span className="ui-dct__avatar" aria-hidden="true">
              {d.icon ?? initial(d.agent)}
            </span>
            <span className="ui-dct__meta">
              <span className="ui-dct__name">
                <span className="ui-dct__agent" dir="auto" title={d.agent}>
                {d.agent}
              </span>
                {(d.risk === "high" || d.risk === "medium") && (
                  <span className="ui-dct__risk" data-risk={d.risk}>
                    {RISK[d.risk]}
                  </span>
                )}
              </span>
              {d.model && (
                <span className="ui-dct__model" title={d.model}>
                  {d.model}
                </span>
              )}
            </span>
          </div>
          <h3 className="ui-dct__q" dir="auto">
            {d.question}
          </h3>
          {d.context && (
            <p className="ui-dct__context" dir="auto">
              {d.context}
            </p>
          )}
        </div>
        <div className="ui-dct__branches" role="group" aria-label="How should the agent go on?">
          {d.options.map((o, i) =>
            row(
              i,
              <button
                ref={tref(`opt:${i}`)}
                type="button"
                className="ui-dct__opt"
                data-pick={o.pick ? "" : undefined}
                data-hot={hot(i) ? "" : undefined}
                data-pressed={pressed === `opt:${i}` ? "" : undefined}
                disabled={!!p}
                aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
                aria-label={`${o.label}${o.pick ? " – the agent's pick" : ""}`}
                onClick={() => choose(i)}
              >
                <kbd className="ui-dct__kbd" data-off={i > 8 ? "" : undefined}>
                  {i + 1}
                </kbd>
                <span className="ui-dct__label" dir="auto">
                  {o.label}
                </span>
                {o.pick && <span className="ui-dct__pick">Agent's pick</span>}
              </button>,
              !!o.effects?.length && (
                <div ref={tref(`leaf:${i}`)} className="ui-dct__leaf">
                  {o.effects.map((e, k) => (
                    <span key={k} className="ui-dct__effect" dir="auto">
                      {text(e, counter)}
                    </span>
                  ))}
                </div>
              ),
            ),
          )}
          {/* Other…: your own instruction, as a prompt for the agent */}
          {allowOther &&
            row(
              otherIndex,
              <div ref={tref(`opt:${otherIndex}`)} className="ui-dct__opt" data-other="" data-open={otherOpen || p?.other ? "" : undefined} data-hot={hot(otherIndex) ? "" : undefined}>
                {p?.other ? (
                  <span className="ui-dct__said" dir="auto">
                    {p.other}
                  </span>
                ) : otherOpen ? (
                  <div ref={growRef} className="ui-dct__grow">
                    {/* The mirror measures the text, so the box can glide to its height */}
                    <span ref={mirrorRef} className="ui-dct__mirror" aria-hidden="true">
                      {other || "Tell the agent what to do instead…"}
                      {"​"}
                    </span>
                    <textarea
                      ref={otherRef}
                      className="ui-dct__input"
                      value={other}
                      rows={2}
                      placeholder="Tell the agent what to do instead…"
                      aria-label={`Your own instruction for the ${(d.agent.trim() || "Agent").toLowerCase()} – Enter sends, Shift+Enter for a new line`}
                      onChange={(e) => setOther(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation();
                          setOtherOpen(false);
                          setHover(null);
                          rootRef.current?.focus({ preventScroll: true });
                          return;
                        }
                        if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                        e.preventDefault();
                        send();
                      }}
                    />
                  </div>
                ) : (
                  <button type="button" className="ui-dct__other" data-pressed={pressed === "other" ? "" : undefined} disabled={!!p} aria-keyshortcuts={otherIndex < 9 ? String(otherIndex + 1) : undefined} onClick={() => choose(otherIndex)}>
                    <kbd className="ui-dct__kbd" data-off={otherIndex > 8 ? "" : undefined}>
                      {otherIndex + 1}
                    </kbd>
                    <span className="ui-dct__label">Other…</span>
                  </button>
                )}
              </div>,
            )}
        </div>
        {p && (
          <div ref={tref("out")} className="ui-dct__out" data-kind={p.other !== undefined ? "replied" : "approved"}>
            {p.other !== undefined ? (
              <>
                <span className="ui-dct__out-head">
                  <Tick />
                  Sent to the {(d.agent.trim() || "Agent").toLowerCase()}
                </span>
                {p.answer ? (
                  <span className="ui-dct__answer">{p.answer}</span>
                ) : (
                  <span className="ui-dct__typing" aria-label={`${d.agent} is typing`}>
                    <span />
                    <span />
                    <span />
                  </span>
                )}
              </>
            ) : (
              <span className="ui-dct__out-head">
                <Tick />
                Approved <span className="ui-dct__running">· running</span>
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  // Eight dots at most – they move along so the current one is always among them
  const dotsFrom = Math.max(0, Math.min(index - 3, list.length - 8));

  return (
    <div
      ref={rootRef}
      className={["ui-dct", className].filter(Boolean).join(" ")}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        // A click on plain content keeps the keys working
        if (!(e.target as HTMLElement).closest("button, a, input, textarea, mark")) requestAnimationFrame(() => rootRef.current?.focus({ preventScroll: true }));
      }}
    >
      <style href="ui-decision-tree" precedence="default">
        {css}
      </style>

      <header className="ui-dct__head">
        <span className="ui-dct__mark">
          <Branches />
        </span>
        <span className="ui-dct__heading" title={title}>
          {title}
        </span>
        <span className="ui-dct__count">{list.length ? `${fmt.format(list.length)} waiting for you` : `${fmt.format(decided)} of ${fmt.format(total)} decided`}</span>
        {current && list.length > 1 && (
          <span className="ui-dct__pager" aria-label={`Decision ${fmt.format(index + 1)} of ${fmt.format(list.length)}`}>
            <span className="ui-dct__dots" aria-hidden="true">
              {list.slice(dotsFrom, dotsFrom + 8).map((x, k) => (
                <span key={keyOf(x)} data-on={dotsFrom + k === index ? "" : undefined} />
              ))}
            </span>
            <span className="ui-dct__of">
              {fmt.format(index + 1)} of {fmt.format(list.length)}
            </span>
          </span>
        )}
      </header>

      <div ref={bodyRef} className="ui-dct__body" data-narrow={narrow ? "" : undefined}>
        {current ? (
          tree(current)
        ) : (
          <div className="ui-dct__empty">
            <span className="ui-dct__empty-mark">
              <Badge size={22} />
            </span>
            <b>All decided</b>
            <span>New decisions from your agents show up here.</span>
          </div>
        )}
        {tipFlag && (
          <div ref={tipRef} id={tipId} role="tooltip" className="ui-dct__tip" key={tipIndex}>
            <span className="ui-dct__tip-head">
              <Alert />
              Agent's note
            </span>
            <p>{tipFlag.note}</p>
            {tipFlag.source && <span className="ui-dct__tip-source">{tipFlag.source}</span>}
          </div>
        )}
        {current && !picked && (
          <p className="ui-dct__hint" aria-hidden="true">
            Pick a branch <kbd className="ui-dct__kbd">1</kbd>–<kbd className="ui-dct__kbd">{Math.min(9, current.options.length + (allowOther ? 1 : 0))}</kbd>
            {list.length > 1 && (
              <>
                <span>·</span> next <kbd className="ui-dct__kbd">→</kbd>
              </>
            )}
          </p>
        )}
      </div>
      <div className="ui-dct__sr" aria-live="polite" aria-atomic="true">
        {said}
      </div>
    </div>
  );
}

const css = /* css */ `
/* Colors, sizes and motion as variables – override them on .ui-dct */
.ui-dct {
  --ui-dct-tray: #f0f0f0;
  --ui-dct-card: #ffffff;
  --ui-dct-strong: #171717;
  --ui-dct-ink: #171717;
  --ui-dct-text: #5f5f5f;
  --ui-dct-muted: #8a8a8a;
  --ui-dct-faint: #b8b8b8;
  --ui-dct-line: #ececec;
  --ui-dct-line-strong: #dedede;
  --ui-dct-fill: #f3f3f3;
  --ui-dct-leaf-bg: #fafafa;
  --ui-dct-accent: #2f6bff;
  --ui-dct-focus: rgba(23, 23, 23, 0.22);
  /* Lines: idle, the agent's pick, the path you point at or picked */
  --ui-dct-link: #d6d6d6;
  --ui-dct-link-pick: #a9bff5;
  --ui-dct-link-hot: #a3a3a3;
  --ui-dct-link-pick-hot: #7d9df0;
  --ui-dct-high-bg: #fde8e5;
  --ui-dct-high-fg: #c2331f;
  --ui-dct-mid-bg: #fff3e0;
  --ui-dct-mid-fg: #b85c00;
  --ui-dct-ok-bg: #e6f6ec;
  --ui-dct-ok-edge: #a9dcbc;
  --ui-dct-ok-fg: #1a7f45;
  --ui-dct-flag-bg: #fff2d4;
  --ui-dct-flag-edge: #f0b44c;
  --ui-dct-flag-hot: #ffe2a6;
  --ui-dct-flag-ink: #6e4300;
  --ui-dct-shadow: 0 0 0 1px #ececec, 0 1px 2px rgba(0, 0, 0, 0.04);
  --ui-dct-raised: 0 0 0 1px #e8e8e8, 0 1px 3px rgba(0, 0, 0, 0.07);
  --ui-dct-lift: 0 0 0 1px #ececec, 0 4px 12px -4px rgba(0, 0, 0, 0.14), 0 1px 2px rgba(0, 0, 0, 0.05);
  --ui-dct-lift-hot: 0 0 0 1px #e8e8e8, 0 8px 20px -6px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.06);
  --ui-dct-pick-lift: 0 0 0 1px rgba(0, 96, 226, 0.2), 0 3px 8px -4px rgba(0, 96, 226, 0.14), 0 1px 2px rgba(0, 60, 140, 0.05);
  --ui-dct-pick-lift-hot: 0 0 0 1px rgba(0, 96, 226, 0.36), 0 8px 22px -6px rgba(0, 96, 226, 0.34), 0 2px 4px -1px rgba(0, 96, 226, 0.16);
  --ui-dct-pop: 0 0 0 1px #ececec, 0 16px 36px -12px rgba(0, 0, 0, 0.22);
  --ui-dct-height: 400px;
  --ui-dct-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-dct-tray);
  letter-spacing: -0.006em;
  outline: none;
  container: ui-dct / inline-size;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  font-weight: 400;
  line-height: 20px;
  color: var(--ui-dct-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-dct *, .ui-dct *::before, .ui-dct *::after { box-sizing: border-box; }
:where(.ui-dct) :is(button, textarea) { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; letter-spacing: inherit; text-align: inherit; -webkit-tap-highlight-color: transparent; }
:where(.ui-dct) button { cursor: pointer; }
:where(.ui-dct) button:disabled { cursor: default; }
.ui-dct :is(button, mark):focus-visible { outline: 2px solid var(--ui-dct-focus); outline-offset: 1px; }
:where(.ui-dct) :is(p, h3) { margin: 0; }
.ui-dct svg { display: block; flex: none; }
.ui-dct__kbd { display: inline-grid; place-items: center; min-width: 18px; height: 18px; padding: 0 4px; border-radius: 5px; background: var(--ui-dct-fill); font-family: inherit; font-size: 10.5px; font-weight: 500; line-height: 1; color: var(--ui-dct-muted); letter-spacing: 0; }
.ui-dct__kbd[data-off] { visibility: hidden; }
.ui-dct__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* ----- The bar: what this is, how many wait, where you are ----- */
.ui-dct__head { display: flex; align-items: center; gap: 8px; min-width: 0; padding: 8px 14px 12px 12px; }
.ui-dct__mark { display: grid; flex: none; place-items: center; width: 16px; color: var(--ui-dct-accent); }
.ui-dct__heading { flex: 0 1 auto; min-width: 0; overflow: hidden; font-weight: 600; color: var(--ui-dct-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-dct__count { flex: 1; min-width: 0; overflow: hidden; font-size: 13px; color: var(--ui-dct-muted); white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.ui-dct__pager { display: inline-flex; flex: none; align-items: center; gap: 10px; font-size: 12px; line-height: 16px; color: var(--ui-dct-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ui-dct__dots { display: flex; gap: 4px; }
.ui-dct__dots > span { width: 5px; height: 5px; border-radius: 50%; background: var(--ui-dct-line-strong); transition: background-color 240ms ease, transform 240ms var(--ui-dct-ease); }
.ui-dct__dots > span[data-on] { background: var(--ui-dct-ink); transform: scale(1.15); }

/* ----- The card with the tree ----- */
.ui-dct__body { position: relative; display: flex; align-items: center; justify-content: center; min-height: var(--ui-dct-height); padding: 44px 28px 56px; border-radius: 16px; background: var(--ui-dct-card); box-shadow: var(--ui-dct-shadow); }
.ui-dct__tree { position: relative; isolation: isolate; display: grid; grid-template-columns: minmax(0, 210px) minmax(0, 1fr); align-items: center; column-gap: 44px; width: 100%; max-width: 860px; transition: opacity 260ms ease; }
.ui-dct__tree[data-leaving] { opacity: 0; }
.ui-dct__links { position: absolute; top: 0; left: 0; z-index: -1; overflow: visible; pointer-events: none; }
/* Thin neutral hairlines that draw themselves in – the agent's pick a quiet blue, the path you point at a little stronger */
.ui-dct__link { fill: none; stroke: var(--ui-dct-link); stroke-width: 1px; stroke-linecap: round; stroke-dasharray: 1 1; animation: ui-dct-draw 460ms var(--ui-dct-ease) calc(180ms + var(--i, 0) * 80ms) both; transition: stroke 220ms ease, opacity 260ms ease, stroke-width 220ms ease; }
.ui-dct__link[data-kind="leaf"] { animation-delay: calc(360ms + var(--i, 0) * 80ms); }
.ui-dct__link[data-kind="out"] { animation: ui-dct-draw 380ms var(--ui-dct-ease) 120ms both; }
.ui-dct__link[data-pick] { stroke: var(--ui-dct-link-pick); }
.ui-dct__link[data-hot] { stroke: var(--ui-dct-link-hot); stroke-width: 1.5px; }
.ui-dct__link[data-pick][data-hot] { stroke: var(--ui-dct-link-pick-hot); }
.ui-dct__link[data-dim] { opacity: 0.25; }
.ui-dct__tree[data-picked] .ui-dct__link[data-dim] { opacity: 0; }

/* The question */
.ui-dct__root { grid-template-columns: minmax(0, 1fr); display: grid; gap: 10px; padding: 14px 16px 15px; border-radius: 10px; background: var(--ui-dct-card); box-shadow: var(--ui-dct-shadow); animation: ui-dct-node 420ms var(--ui-dct-ease) 40ms backwards; }
.ui-dct__who { display: flex; align-items: flex-start; gap: 10px; min-width: 0; }
.ui-dct__avatar { display: grid; flex: none; place-items: center; width: 28px; height: 28px; border-radius: 7px; background: var(--ui-dct-card); box-shadow: 0 0 0 1px var(--ui-dct-line), 0 1px 2px rgba(0, 0, 0, 0.06); font-size: 12px; font-weight: 500; color: var(--ui-dct-text); }
.ui-dct__avatar > :is(svg, img) { width: 14px; height: 14px; object-fit: contain; }
/* Logos of any size stay in their tile */
.ui-dct__avatar { overflow: hidden; }
.ui-dct__meta { display: grid; flex: 1; gap: 1px; min-width: 0; }
/* The agent's name may wrap here – the question card is narrow */
.ui-dct__name { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; min-width: 0; }
.ui-dct__agent { min-width: 0; font-size: 13px; font-weight: 600; line-height: 18px; color: var(--ui-dct-ink); overflow-wrap: anywhere; }
.ui-dct__model { overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-dct-muted); white-space: nowrap; text-overflow: ellipsis; }
/* The risk tag: a tint with its color, like the Live tag in Trace Waterfall */
.ui-dct__risk { display: inline-flex; flex: none; align-items: center; height: 20px; padding: 0 8px; border-radius: 999px; background: var(--k-bg); font-size: 11.5px; font-weight: 500; line-height: 16px; color: var(--k-fg); white-space: nowrap; }
.ui-dct [data-risk="high"] { --k-bg: var(--ui-dct-high-bg); --k-fg: var(--ui-dct-high-fg); }
.ui-dct [data-risk="medium"] { --k-bg: var(--ui-dct-mid-bg); --k-fg: var(--ui-dct-mid-fg); }
.ui-dct__q { font-size: 14px; font-weight: 600; line-height: 20px; color: var(--ui-dct-strong); text-wrap: pretty; overflow-wrap: anywhere; }
.ui-dct__context { margin-top: -4px; font-size: 12px; line-height: 17px; color: var(--ui-dct-muted); text-wrap: pretty; overflow-wrap: anywhere; white-space: pre-line; }

/* The branches: an option card, then its consequences in muted text */
.ui-dct__branches { display: grid; gap: 14px; }
.ui-dct__row { display: grid; grid-template-columns: minmax(0, 200px) minmax(0, 1fr); align-items: center; column-gap: 32px; transition: opacity 280ms ease; animation: ui-dct-node 420ms var(--ui-dct-ease) calc(140ms + var(--i, 0) * 80ms) backwards; }
.ui-dct__row[data-dim] { opacity: 0.38; }
.ui-dct__tree[data-picked] .ui-dct__row[data-dim] { opacity: 0; pointer-events: none; }
.ui-dct__opt { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 2px 8px; min-width: 0; padding: 9px 12px; border-radius: 10px; background: var(--ui-dct-card); box-shadow: var(--ui-dct-shadow); text-align: left; transition: box-shadow 200ms ease, transform 140ms ease; }
/* Highlighted boxes lift with a deeper shadow instead of a darker stroke */
button.ui-dct__opt:hover:not(:disabled), .ui-dct__opt[data-hot] { box-shadow: var(--ui-dct-lift-hot); }
/* The agent's pick: the same lift, tinted blue, with a faint blue edge */
.ui-dct__opt[data-pick] { box-shadow: var(--ui-dct-pick-lift); }
button.ui-dct__opt[data-pick]:hover:not(:disabled), .ui-dct__opt[data-pick][data-hot] { box-shadow: var(--ui-dct-pick-lift-hot); }
.ui-dct__opt[data-pressed] { transform: scale(0.98); }
.ui-dct__label { min-width: 0; font-size: 13px; font-weight: 500; line-height: 18px; color: var(--ui-dct-ink); overflow-wrap: anywhere; }
.ui-dct__pick { grid-column: 2; font-size: 11.5px; line-height: 14px; color: var(--ui-dct-accent); }
.ui-dct__leaf { display: grid; gap: 3px; justify-self: start; min-width: 0; padding: 8px 12px; border-radius: 10px; background: var(--ui-dct-leaf-bg); box-shadow: inset 0 0 0 1px var(--ui-dct-line); animation: ui-dct-node 420ms var(--ui-dct-ease) calc(300ms + var(--i, 0) * 80ms) backwards; }
.ui-dct__effect { font-size: 12.5px; line-height: 18px; color: var(--ui-dct-text); overflow-wrap: anywhere; white-space: pre-line; }
/* A part the agent isn't sure about: a warm tint with a hairline underline – brighter while its note shows */
.ui-dct__flag { padding: 1px 2px; margin: 0 -1px; border-radius: 4px; background: var(--ui-dct-flag-bg); box-shadow: inset 0 -1.5px 0 var(--ui-dct-flag-edge); color: var(--ui-dct-flag-ink); cursor: help; -webkit-box-decoration-break: clone; box-decoration-break: clone; transition: background-color 160ms ease, box-shadow 160ms ease; }
.ui-dct__flag:is(:hover, [data-on]) { background: var(--ui-dct-flag-hot); box-shadow: inset 0 0 0 1px var(--ui-dct-flag-edge); }

/* Other…: a quiet outline; opened, a field that grows with what you write – no focus ring, its hairline darkens */
.ui-dct__opt[data-other] { padding: 0; background: transparent; box-shadow: inset 0 0 0 1px var(--ui-dct-line-strong); }
.ui-dct__opt[data-other][data-open] { background: var(--ui-dct-card); }
.ui-dct__opt[data-other][data-open]:focus-within { box-shadow: inset 0 0 0 1px var(--ui-dct-link-hot); }
.ui-dct__other { display: flex; align-items: center; gap: 8px; width: 100%; padding: 9px 12px; border-radius: inherit; text-align: left; }
.ui-dct__other .ui-dct__label { font-weight: 400; color: var(--ui-dct-muted); }
.ui-dct__grow { position: relative; height: 32px; overflow: hidden; transition: height 250ms var(--ui-dct-ease); }
.ui-dct__mirror { position: absolute; top: 0; right: 0; left: 0; padding: 6px 12px; font-size: 13px; line-height: 20px; white-space: pre-wrap; overflow-wrap: anywhere; visibility: hidden; pointer-events: none; }
.ui-dct__input { display: block; width: 100%; height: 100%; padding: 6px 12px; font-size: 13px; line-height: 20px; color: var(--ui-dct-ink); resize: none; overflow-y: hidden; outline: none; scrollbar-width: thin; }
.ui-dct .ui-dct__input:focus-visible { outline: none; }
.ui-dct__input::placeholder { color: var(--ui-dct-muted); }
.ui-dct__said { padding: 6px 12px; font-size: 13px; line-height: 20px; color: var(--ui-dct-ink); white-space: pre-wrap; overflow-wrap: anywhere; }

/* The outcome under the picked path */
.ui-dct__out { position: absolute; z-index: 1; display: grid; gap: 6px; max-width: 280px; padding: 9px 12px; border-radius: 10px; background: var(--ui-dct-card); box-shadow: var(--ui-dct-raised), 0 0 0 1px var(--ui-dct-ok-edge); animation: ui-dct-node 360ms var(--ui-dct-ease) 320ms backwards; }
.ui-dct__out[data-kind="replied"] { box-shadow: var(--ui-dct-lift); }
.ui-dct__out-head { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-size: 13px; font-weight: 500; color: var(--ui-dct-ink); overflow-wrap: anywhere; }
.ui-dct__out-head > svg { width: 15px; height: 15px; color: var(--ui-dct-ok-fg); }
.ui-dct__running { font-weight: 400; color: var(--ui-dct-muted); }
.ui-dct__answer { font-size: 12.5px; line-height: 18px; color: var(--ui-dct-text); animation: ui-dct-fade-up 280ms var(--ui-dct-ease) backwards; overflow-wrap: anywhere; }
.ui-dct__typing { display: inline-flex; gap: 4px; justify-self: start; padding: 6px 0 4px; }
.ui-dct__typing > span { width: 5px; height: 5px; border-radius: 50%; background: var(--ui-dct-muted); animation: ui-dct-dot 1100ms ease-in-out infinite; }
.ui-dct__typing > span:nth-child(2) { animation-delay: 150ms; }
.ui-dct__typing > span:nth-child(3) { animation-delay: 300ms; }

.ui-dct__hint { position: absolute; bottom: 16px; left: 24px; display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: var(--ui-dct-muted); pointer-events: none; animation: ui-dct-fade 300ms ease 600ms backwards; }
.ui-dct__hint > span { margin: 0 3px; color: var(--ui-dct-faint); }

/* The agent's note on a flagged part */
.ui-dct__tip { position: absolute; top: 0; left: 0; z-index: 6; display: grid; gap: 4px; width: min(300px, calc(100% - 20px)); padding: 10px 12px 11px; border-radius: 12px; background: var(--ui-dct-card); box-shadow: var(--ui-dct-pop); pointer-events: none; transform-origin: var(--x, 50%) top; animation: ui-dct-tip 200ms var(--ui-dct-ease) both; }
.ui-dct__tip[data-side="above"] { transform-origin: var(--x, 50%) bottom; }
.ui-dct__tip-head { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; line-height: 16px; color: var(--ui-dct-mid-fg); }
.ui-dct__tip-head > svg { width: 12px; height: 12px; }
.ui-dct__tip p { font-size: 12.5px; line-height: 18px; color: var(--ui-dct-ink); text-wrap: pretty; overflow-wrap: anywhere; }
.ui-dct__tip-source { justify-self: start; margin-top: 2px; padding: 1px 7px; border-radius: 5px; background: var(--ui-dct-fill); font-size: 11.5px; line-height: 16px; color: var(--ui-dct-text); max-width: 100%; overflow-wrap: anywhere; }

.ui-dct__empty { display: grid; justify-items: center; gap: 4px; text-align: center; animation: ui-dct-fade-up 360ms var(--ui-dct-ease) both; }
.ui-dct__empty-mark { display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: 8px; border-radius: 14px; background: var(--ui-dct-card); color: var(--ui-dct-ok-fg); box-shadow: var(--ui-dct-shadow), 0 0 0 4px var(--ui-dct-ok-bg); }
.ui-dct__empty b { font-size: 15px; font-weight: 600; line-height: 22px; color: var(--ui-dct-strong); }
.ui-dct__empty > span:last-child { font-size: 13px; color: var(--ui-dct-muted); }

/* ----- Narrow: top to bottom – the question, then each branch hanging off a rail with its consequences under it ----- */
@container ui-dct (max-width: 639px) {
  .ui-dct__body { min-height: 0; padding: 20px 16px 48px; }
  .ui-dct__count { display: none; }
  .ui-dct__tree { grid-template-columns: minmax(0, 1fr); row-gap: 18px; }
  .ui-dct__branches { padding-left: 34px; }
  .ui-dct__row { grid-template-columns: minmax(0, 1fr); row-gap: 8px; }
  .ui-dct__leaf { margin-left: 26px; }
  .ui-dct__hint { left: 16px; bottom: 14px; }
  .ui-dct__hint kbd:last-of-type, .ui-dct__hint > span { display: none; }
}
@container ui-dct (max-width: 380px) {
  .ui-dct__of { display: none; }
  .ui-dct__branches { padding-left: 26px; }
  .ui-dct__leaf { margin-left: 18px; }
}

@keyframes ui-dct-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes ui-dct-node { from { opacity: 0; transform: translateX(-8px); } }
@keyframes ui-dct-fade { from { opacity: 0; } }
@keyframes ui-dct-fade-up { from { opacity: 0; transform: translateY(6px); } }
@keyframes ui-dct-tip { from { opacity: 0; transform: translateY(4px) scale(0.96); } }
@keyframes ui-dct-dot { 0%, 60%, 100% { opacity: 0.35; } 30% { opacity: 1; } }

@media (pointer: coarse) {
  .ui-dct .ui-dct__kbd, .ui-dct__hint { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-dct *, .ui-dct *::before, .ui-dct *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-dct {
  --ui-dct-tray: #19191c;
  --ui-dct-card: #232326;
  --ui-dct-strong: #ededed;
  --ui-dct-ink: #ededed;
  --ui-dct-text: #a8a8ad;
  --ui-dct-muted: #7c7c82;
  --ui-dct-faint: #55555b;
  --ui-dct-line: #2e2e33;
  --ui-dct-line-strong: #3a3a40;
  --ui-dct-fill: #2e2e32;
  --ui-dct-leaf-bg: #26262a;
  --ui-dct-accent: #5b9aff;
  --ui-dct-focus: rgba(237, 237, 237, 0.3);
  --ui-dct-link: #3a3a40;
  --ui-dct-link-pick: #36518f;
  --ui-dct-link-hot: #6a6a72;
  --ui-dct-link-pick-hot: #4d70c2;
  --ui-dct-high-bg: #3b1714;
  --ui-dct-high-fg: #ff977d;
  --ui-dct-mid-bg: #3a2610;
  --ui-dct-mid-fg: #ffb068;
  --ui-dct-ok-bg: #12301f;
  --ui-dct-ok-edge: #23593a;
  --ui-dct-ok-fg: #4fd890;
  --ui-dct-flag-bg: #3d2b0c;
  --ui-dct-flag-edge: #a8741f;
  --ui-dct-flag-hot: #54390c;
  --ui-dct-flag-ink: #ffd28a;
  --ui-dct-shadow: 0 0 0 1px #2e2e33, 0 1px 2px rgba(0, 0, 0, 0.3);
  --ui-dct-raised: 0 0 0 1px #38383e, 0 1px 3px rgba(0, 0, 0, 0.4);
  --ui-dct-lift: 0 0 0 1px #2e2e33, 0 6px 16px -4px rgba(0, 0, 0, 0.6), 0 1px 2px rgba(0, 0, 0, 0.3);
  --ui-dct-lift-hot: 0 0 0 1px #38383e, 0 10px 24px -6px rgba(0, 0, 0, 0.7), 0 1px 3px rgba(0, 0, 0, 0.4);
  --ui-dct-pick-lift: 0 0 0 1px rgba(91, 154, 255, 0.3), 0 4px 12px -4px rgba(40, 100, 220, 0.24), 0 1px 2px rgba(0, 0, 0, 0.3);
  --ui-dct-pick-lift-hot: 0 0 0 1px rgba(112, 170, 255, 0.5), 0 10px 26px -6px rgba(60, 130, 255, 0.5), 0 2px 5px -1px rgba(60, 130, 255, 0.25);
  --ui-dct-pop: 0 0 0 1px #34343a, 0 16px 36px -12px rgba(0, 0, 0, 0.6);
}
`;
