"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/*
 * Usage Meter (clean style) – the "Usage" card of a SaaS or AI product, in a single self-contained file.
 * One white card with hairline shadows; what's left and the button sit in its last row, under a hairline.
 * One big credits meter split into categories (Chat, Search, Image …) with a legend, an optional daily sparkline,
 * thin meters for plan limits (seats, storage, projects) and a button that grows more prominent near the limit.
 * Hovering a part highlights it everywhere; switching the period rolls every number to its new value while the
 * bars glide to their new widths. From 80% a small amber dot warns, at 100% it says "Limit reached".
 * The styles are injected below, so no extra files are needed.
 */

export type UsageItem = {
  label: string;
  value: number;
  /** Any CSS color – defaults to shades of the accent, then grays */
  color?: string;
};

export type UsageLimit = {
  label: string;
  used: number;
  /** Leave out (or pass null / Infinity) for unlimited */
  total?: number | null;
  /** Shown after the numbers, e.g. "GB" */
  unit?: string;
  /** Decimal places – defaults to 1 for fractional values, else 0 */
  decimals?: number;
};

export type UsageDay = {
  /** Shown on hover, e.g. "Oct 3" */
  label: string;
  /** null for days still to come in the period */
  value: number | null;
};

export type UsagePeriod = { id: string; label: string };

export type UsageState = "ok" | "warn" | "limit";

export type UsageMeterProps = {
  /** Credits included in the plan */
  total: number;
  /** What the credits were spent on in the shown period */
  used: UsageItem[];
  /** Thin meters below, e.g. seats, storage, projects */
  limits?: UsageLimit[];
  /** Options of the period switch – no switch when left out */
  periods?: UsagePeriod[];
  /** Controlled period id */
  period?: string;
  defaultPeriod?: string;
  /** Called with the new period id – pass the matching `used`, `limits` and `daily` back in */
  onPeriodChange?: (id: string) => void;
  /** When the credits reset – shown as "Resets in 9 days" */
  resetAt?: Date | string | number;
  /** Usage per day for the sparkline under the meter */
  daily?: UsageDay[];
  /** Called by the button, with the current state */
  onUpgrade?: (state: UsageState) => void;
  title?: string;
  /** Plan name next to the reset date, e.g. "Pro plan" */
  plan?: string;
  /** Unit of the credits */
  unit?: string;
  /** Share from which the meter warns (0–1) */
  warnAt?: number;
  /** Button text while there is room left */
  upgradeLabel?: string;
  /** Button text near and at the limit */
  topUpLabel?: string;
  className?: string;
};

/* ---------- Helpers ---------- */

const fmt = (n: number, digits = 0) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
/** Number and unit with a no-break space, so "3.2 GB" never splits */
const withUnit = (text: string, unit?: string) => (unit ? `${text} ${unit}` : text);
const fmtDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const fmtFar = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
/** Missing or broken numbers (NaN, Infinity) count as zero instead of spreading through every sum */
const num = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : 0);
/** A little used is never shown as nothing */
const fmtSome = (n: number, shown: number) => (n > 0 && n < 1 ? "<1" : fmt(shown));

function resetText(at: Date) {
  const days = Math.ceil((at.getTime() - Date.now()) / 864e5);
  if (days <= 0) return "Resets today";
  if (days === 1) return "Resets tomorrow";
  // Months away a date reads better than a count of days
  if (days > 60) return `Resets ${fmtFar.format(at)}`;
  return `Resets in ${days} days`;
}

const PALETTE = ["var(--ui-umc-c1)", "var(--ui-umc-c2)", "var(--ui-umc-c3)", "var(--ui-umc-c4)", "var(--ui-umc-c5)"];
const ease = (t: number) => 1 - Math.pow(1 - t, 4);
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Tweens a set of named numbers: every key rolls from where it is now to its target, new keys from zero.
 * One animation frame loop for the whole card, so numbers and bar widths move in step.
 */
function useTween(target: Record<string, number>, first: number, then: number) {
  const [shown, setShown] = useState<Record<string, number>>(() => Object.fromEntries(Object.keys(target).map((k) => [k, 0])));
  const current = useRef(shown);
  const started = useRef(false);
  const signature = JSON.stringify(target);
  useEffect(() => {
    const to = JSON.parse(signature) as Record<string, number>;
    const from = { ...current.current };
    if (reduced()) {
      current.current = to;
      setShown(to);
      return;
    }
    // The count-in from zero takes a little longer than later changes
    const live = Object.values(to).some((v) => v !== 0);
    const duration = live && !started.current ? first : then;
    if (live) started.current = true;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = ease(t);
      const next: Record<string, number> = {};
      for (const k in to) next[k] = (from[k] ?? 0) + (to[k] - (from[k] ?? 0)) * e;
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [signature]); // eslint-disable-line react-hooks/exhaustive-deps
  return (key: string) => shown[key] ?? 0;
}

/** Moves a pill under the active child of a list – no transition on the first placement, so it doesn't fly in */
function glide(list: HTMLElement | null, pill: HTMLElement | null, selector: string) {
  if (!list || !pill) return;
  const active = list.querySelector<HTMLElement>(selector);
  if (!active || !active.offsetWidth) {
    pill.style.opacity = "0";
    return;
  }
  const first = !pill.dataset.ready;
  if (first) pill.style.transition = "none";
  pill.style.opacity = "1";
  pill.style.width = `${active.offsetWidth}px`;
  pill.style.height = `${active.offsetHeight}px`;
  pill.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
  if (first) {
    pill.dataset.ready = "1";
    void pill.offsetWidth;
    pill.style.transition = "";
  }
}

type Row = UsageItem & { color: string; leaving?: boolean };

/** The new rows in their order; rows that disappeared stay at their old place (at zero) while they fold away */
function merge(prev: Row[], next: Row[]) {
  const out = [...next];
  prev.forEach((p, i) => {
    if (next.some((n) => n.label === p.label)) return;
    out.splice(Math.min(i, out.length), 0, { ...p, value: 0, leaving: true });
  });
  return out;
}

/* ---------- Component ---------- */

export function UsageMeter({
  total,
  used,
  limits = [],
  periods,
  period,
  defaultPeriod,
  onPeriodChange,
  resetAt,
  daily,
  onUpgrade,
  title = "Usage",
  plan,
  unit = "credits",
  warnAt = 0.8,
  upgradeLabel = "Upgrade",
  topUpLabel = "Add credits",
  className,
}: UsageMeterProps) {
  const uid = useId();
  const root = useRef<HTMLElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const switchRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const actionInner = useRef<HTMLSpanElement>(null);

  const [ownPeriod, setOwnPeriod] = useState(defaultPeriod ?? periods?.[0]?.id);
  const activePeriod = period ?? ownPeriod;
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [tipLabel, setTipLabel] = useState<string | null>(null); // the tooltip keeps its text while fading out
  const [day, setDay] = useState<number | null>(null);
  const [announce, setAnnounce] = useState("");

  // Stable default colors per label, so "API" keeps its shade when "Image" drops out
  const colors = useRef(new Map<string, string>());
  const colorOf = (item: UsageItem) => {
    if (item.color) return item.color;
    if (!colors.current.has(item.label)) colors.current.set(item.label, PALETTE[colors.current.size % PALETTE.length]);
    return colors.current.get(item.label)!;
  };
  const incoming: Row[] = used.map((u) => ({ ...u, color: colorOf(u) }));

  // Rows that leave fold away; the timer drops them afterwards
  const [rows, setRows] = useState<Row[]>(incoming);
  const usedKey = used.map((u) => `${u.label}:${u.value}:${u.color ?? ""}`).join("|");
  const firstRows = useRef(true);
  useLayoutEffect(() => {
    if (firstRows.current) {
      firstRows.current = false;
      return;
    }
    setRows((prev) => merge(prev.filter((p) => !p.leaving), incoming));
    const t = window.setTimeout(() => setRows((list) => list.filter((r) => !r.leaving)), 460);
    return () => clearTimeout(t);
  }, [usedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Count in once the card scrolls into view
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* Numbers */
  total = Math.max(0, num(total));
  const sum = used.reduce((s, u) => s + Math.max(0, num(u.value)), 0);
  // Any use of a plan with no credits at all is over the limit
  const share = total > 0 ? sum / total : sum > 0 ? Infinity : 0;
  const state: UsageState = share >= 1 ? "limit" : share >= warnAt ? "warn" : "ok";
  // Over the limit the parts fill the whole bar instead of overflowing it
  const scale = Math.max(total, sum) || 1;

  const target: Record<string, number> = { used: sum, left: Math.max(0, total - sum), pct: Math.min(share * 100, 1000) };
  rows.forEach((r) => (target[`r:${r.label}`] = r.leaving ? 0 : Math.max(0, num(r.value))));
  limits.forEach((l) => (target[`l:${l.label}`] = num(l.used)));
  daily?.forEach((d, i) => (target[`d:${i}`] = num(d.value)));
  if (!visible) for (const k in target) target[k] = 0;
  const tween = useTween(target, 1200, 650);

  // Where each part starts and ends on the bar, from the tweened values
  let cursor = 0;
  const segments = rows.map((r) => {
    const width = (tween(`r:${r.label}`) / scale) * 100;
    const seg = { ...r, left: cursor, width };
    cursor += width;
    return seg;
  });
  const activeRow = rows.find((r) => r.label === active && !r.leaving);
  const tipRow = rows.find((r) => r.label === tipLabel);
  const tipSeg = segments.find((s) => s.label === tipLabel);
  const tipCenter = tipSeg ? Math.min(100, Math.max(0, tipSeg.left + tipSeg.width / 2)) : 50;

  const highlight = (label: string | null) => {
    setActive(label);
    if (label) setTipLabel(label);
  };
  // Mouse hover shows and hides; a tap toggles, since touch has no hover to leave
  const segmentAt = (e: PointerEvent<HTMLElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * 100;
    return segments.find((s) => !s.leaving && s.width > 0 && x >= s.left && x <= s.left + s.width)?.label ?? null;
  };
  const onBarKey = (e: KeyboardEvent) => {
    const list = rows.filter((r) => !r.leaving && r.value > 0);
    if (!list.length) return;
    const i = list.findIndex((r) => r.label === active);
    if (e.key === "ArrowRight") highlight(list[(i + 1) % list.length].label);
    else if (e.key === "ArrowLeft") highlight(list[(i - 1 + list.length) % list.length].label);
    else if (e.key === "Escape") highlight(null);
    else return;
    e.preventDefault();
  };

  // The daily sparkline
  const days = daily ?? [];
  const dayMax = Math.max(1, ...days.map((d) => num(d.value)));
  const past = days.filter((d) => d.value !== null);
  const average = past.length ? past.reduce((s, d) => s + num(d.value), 0) / past.length : 0;
  const dayAt = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - box.left) / box.width) * days.length);
    return Math.min(days.length - 1, Math.max(0, i));
  };
  const onSparkKey = (e: KeyboardEvent) => {
    if (!days.length) return;
    if (e.key === "ArrowRight") setDay((d) => Math.min(days.length - 1, d === null ? 0 : d + 1));
    else if (e.key === "ArrowLeft") setDay((d) => Math.max(0, d === null ? days.length - 1 : d - 1));
    else if (e.key === "Escape") setDay(null);
    else return;
    e.preventDefault();
  };
  const hoveredDay = day !== null ? days[day] : undefined;
  // A new number of days (30 → 7) grows in fresh; the first fill comes from the count-in
  const lastLength = useRef(days.length);
  const regrow = useRef(false);
  if (lastLength.current !== days.length) {
    lastLength.current = days.length;
    regrow.current = true;
  }

  /* Period switch */
  const choose = (id: string) => {
    if (id === activePeriod) return;
    if (period === undefined) setOwnPeriod(id);
    onPeriodChange?.(id);
    setActive(null);
    setDay(null);
  };
  const onSwitchKey = (e: KeyboardEvent) => {
    if (!periods?.length) return;
    const i = periods.findIndex((p) => p.id === activePeriod);
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % periods.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + periods.length) % periods.length;
    if (next < 0) return;
    e.preventDefault();
    choose(periods[next].id);
    switchRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]")[next]?.focus();
  };

  // The light fill glides to the chosen period – also when a narrow layout changes the option widths
  useLayoutEffect(() => {
    glide(switchRef.current, pillRef.current, '[aria-checked="true"]');
  });
  useLayoutEffect(() => {
    const list = switchRef.current;
    if (!list) return;
    const ro = new ResizeObserver(() => glide(list, pillRef.current, '[aria-checked="true"]'));
    ro.observe(list);
    return () => ro.disconnect();
  }, []);

  // The card glides to its new height when rows come or go
  useLayoutEffect(() => {
    const card = cardRef.current;
    const inner = innerRef.current;
    if (!card || !inner) return;
    const set = () => (card.style.height = `${inner.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  // The button glides to the width of its new label
  useLayoutEffect(() => {
    const box = actionRef.current;
    const inner = actionInner.current;
    if (!box || !inner) return;
    const set = () => (box.style.width = `${inner.offsetWidth}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  // Screen readers hear when the state changes
  const lastState = useRef(state);
  useEffect(() => {
    if (lastState.current === state) return;
    lastState.current = state;
    setAnnounce(
      state === "limit"
        ? `${title}: limit reached, ${fmt(sum)} of ${fmt(total)} ${unit} used`
        : state === "warn"
          ? `${title}: running low, ${Math.round(share * 100)}% of ${unit} used`
          : `${title}: ${fmt(sum)} of ${fmt(total)} ${unit} used`,
    );
  }, [state]); // eslint-disable-line react-hooks/exhaustive-deps

  // A date that can't be read is left out instead of breaking the card
  const resetDate = resetAt !== undefined ? new Date(resetAt) : null;
  const reset = resetDate && !Number.isNaN(resetDate.getTime()) ? resetDate : null;
  const strong = state !== "ok";
  const pct = tween("pct");

  return (
    <section ref={root} className={["ui-umc", className].filter(Boolean).join(" ")} aria-labelledby={`${uid}-title`} data-state={state}>
      {/* React 19 hoists this into <head> once, no matter how many meters render */}
      <style href="ui-usage-meter-clean" precedence="default">
        {css}
      </style>

      <div ref={cardRef} className="ui-umc__card">
        <div ref={innerRef} className="ui-umc__inner">
          <header className="ui-umc__head">
            <div className="ui-umc__heading">
              <h3 id={`${uid}-title`} className="ui-umc__title" title={title} dir="auto">
                {title}
              </h3>
              {(plan || reset) && (
                <p className="ui-umc__sub" title={[plan, reset && resetText(reset)].filter(Boolean).join(" · ")}>
                  {plan}
                  {plan && reset && <span className="ui-umc__sep">·</span>}
                  {reset && <time dateTime={reset.toISOString()} title={`Resets on ${fmtDate.format(reset)}`}>{resetText(reset)}</time>}
                </p>
              )}
            </div>
            {periods && periods.length > 1 && (
              <div ref={switchRef} className="ui-umc__switch" role="radiogroup" aria-label="Period" onKeyDown={onSwitchKey}>
                <span ref={pillRef} className="ui-umc__pill" aria-hidden="true" />
                {periods.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="radio"
                    aria-checked={p.id === activePeriod}
                    tabIndex={p.id === activePeriod ? 0 : -1}
                    className="ui-umc__option"
                    title={p.label}
                    onClick={() => choose(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </header>

          {/* The credits meter */}
          <div className="ui-umc__figure">
            <p className="ui-umc__amount">
              <span className="ui-umc__big">{fmt(tween("used"))}</span>
              <span className="ui-umc__of">
                of {withUnit(fmt(total), unit)}
              </span>
            </p>
            <span className="ui-umc__pct" data-state={state}>
              {strong && <span className="ui-umc__dot" aria-hidden="true" />}
              {pct > 999 ? ">999" : fmt(pct)}%
            </span>
          </div>

          <div
            className="ui-umc__bar"
            tabIndex={0}
            role="group"
            aria-label={`${fmt(sum)} of ${fmt(total)} ${unit} used – arrow keys read each category`}
            data-active={activeRow ? "" : undefined}
            onPointerMove={(e) => e.pointerType === "mouse" && highlight(segmentAt(e))}
            onPointerLeave={(e) => e.pointerType === "mouse" && highlight(null)}
            onPointerUp={(e) => {
              if (e.pointerType === "mouse") return;
              const label = segmentAt(e);
              highlight(label === active ? null : label);
            }}
            onKeyDown={onBarKey}
            onBlur={() => highlight(null)}
          >
            <div
              className="ui-umc__track"
              role="meter"
              aria-valuemin={0}
              aria-valuemax={total}
              aria-valuenow={Math.min(sum, total)}
              aria-valuetext={`${fmt(sum)} of ${fmt(total)} ${unit}`}
            >
              {segments.map((s) => (
                <span
                  key={s.label}
                  className="ui-umc__seg"
                  data-active={s.label === active || undefined}
                  style={{ width: `${s.width}%`, background: s.color }}
                />
              ))}
            </div>
            <div
              className="ui-umc__tip"
              data-open={activeRow ? "" : undefined}
              style={{ left: `${tipCenter}%`, ["--ui-umc-tip-x" as string]: `${-tipCenter}%` }}
              aria-live="polite"
            >
              {tipRow && (
                <>
                  <span className="ui-umc__tip-label">
                    <span className="ui-umc__swatch" style={{ background: tipRow.color }} />
                    <span className="ui-umc__tip-name" dir="auto">
                      {tipRow.label}
                    </span>
                  </span>
                  <span className="ui-umc__tip-value">
                    {withUnit(fmtSome(num(tipRow.value), num(tipRow.value)), unit)}
                    <span className="ui-umc__muted"> · {fmt(sum ? (num(tipRow.value) / sum) * 100 : 0)}%</span>
                  </span>
                </>
              )}
            </div>
          </div>

          <ul className="ui-umc__legend" aria-label="By category" data-active={activeRow ? "" : undefined}>
            {rows.map((r) => {
              const v = tween(`r:${r.label}`);
              return (
                <li key={r.label} className="ui-umc__row" data-leaving={r.leaving || undefined}>
                  <div
                    className="ui-umc__item"
                    data-active={r.label === active || undefined}
                    onPointerEnter={(e) => e.pointerType === "mouse" && !r.leaving && highlight(r.label)}
                    onPointerLeave={(e) => e.pointerType === "mouse" && highlight(null)}
                    onPointerUp={(e) => e.pointerType !== "mouse" && !r.leaving && highlight(r.label === active ? null : r.label)}
                  >
                    <span className="ui-umc__swatch" style={{ background: r.color }} />
                    <span className="ui-umc__label" title={r.label} dir="auto">
                      {r.label}
                    </span>
                    <span className="ui-umc__value">{fmtSome(num(r.value), v)}</span>
                    <span className="ui-umc__share">{fmt(tween("used") ? (v / tween("used")) * 100 : 0)}%</span>
                  </div>
                </li>
              );
            })}
          </ul>

          {days.length > 0 && (
            <div className="ui-umc__daily">
              <div className="ui-umc__daily-head">
                <span>Per day</span>
                <span className="ui-umc__daily-read" key={hoveredDay ? `d${day}` : "avg"}>
                  {hoveredDay ? (
                    <>
                      {hoveredDay.label} · <b>{hoveredDay.value === null ? "–" : withUnit(fmt(hoveredDay.value), unit)}</b>
                    </>
                  ) : (
                    <>
                      Avg <b>{fmt(average)}</b> / day
                    </>
                  )}
                </span>
              </div>
              <div
                className="ui-umc__spark"
                key={days.length}
                tabIndex={0}
                role="img"
                aria-label={`${title} per day, ${fmt(average)} ${unit} on average – arrow keys read each day`}
                data-hover={day !== null || undefined}
                data-regrow={regrow.current || undefined}
                data-few={days.length <= 14 || undefined}
                data-many={days.length > 45 ? (days.length > 120 ? "dense" : "") : undefined}
                onPointerMove={(e) => setDay(dayAt(e))}
                onPointerDown={(e) => setDay(dayAt(e))}
                onPointerLeave={(e) => e.pointerType === "mouse" && setDay(null)}
                onKeyDown={onSparkKey}
                onBlur={() => setDay(null)}
              >
                {days.map((d, i) => (
                  <span key={i} className="ui-umc__day" data-future={d.value === null || undefined} data-active={i === day || undefined} style={{ ["--i" as string]: i }}>
                    <span style={{ height: d.value === null ? undefined : `${Math.max(4, (tween(`d:${i}`) / dayMax) * 100)}%` }} />
                  </span>
                ))}
              </div>
            </div>
          )}

          {limits.length > 0 && (
            <ul className="ui-umc__limits" aria-label="Plan limits" style={{ ["--n" as string]: Math.min(3, limits.length) }}>
              {limits.map((l) => {
                const unlimited = l.total == null || !isFinite(l.total);
                const digits = l.decimals ?? (Number.isInteger(num(l.used)) && (unlimited || Number.isInteger(l.total)) ? 0 : 1);
                const lused = num(l.used);
                const ratio = unlimited ? 0 : lused / Math.max(l.total!, 1e-9);
                const lstate: UsageState = unlimited ? "ok" : ratio >= 1 ? "limit" : ratio >= warnAt ? "warn" : "ok";
                const shownUsed = tween(`l:${l.label}`);
                const totalText = unlimited ? "∞" : fmt(l.total!, Number.isInteger(l.total) ? 0 : digits);
                return (
                  <li key={l.label} className="ui-umc__limit" data-state={lstate}>
                    <span className="ui-umc__limit-label">
                      <span className="ui-umc__limit-name" title={l.label} dir="auto">
                        {l.label}
                      </span>
                      {lstate !== "ok" && <span className="ui-umc__dot" aria-label={lstate === "limit" ? "At the limit" : "Close to the limit"} />}
                    </span>
                    <span className="ui-umc__limit-value">
                      {fmt(shownUsed, digits)}
                      <span className="ui-umc__muted"> of {withUnit(totalText, unlimited ? undefined : l.unit)}</span>
                    </span>
                    {unlimited ? (
                      <span className="ui-umc__thin" data-unlimited="" aria-label={`${l.label}: ${fmt(lused, digits)}, unlimited`} role="img" />
                    ) : (
                      <span
                        className="ui-umc__thin"
                        role="meter"
                        aria-label={l.label}
                        aria-valuemin={0}
                        aria-valuemax={l.total!}
                        aria-valuenow={Math.min(lused, l.total!)}
                        aria-valuetext={`${fmt(lused, digits)} of ${withUnit(totalText, l.unit)}`}
                      >
                        <span style={{ width: `${Math.min(100, (shownUsed / Math.max(l.total!, 1e-9)) * 100)}%` }} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* The last row of the card, under a hairline: what's left, and the button */}
      <div className="ui-umc__foot">
        <span className="ui-umc__status" key={state}>
          {strong && <span className="ui-umc__dot" aria-hidden="true" />}
          {state === "limit" ? (
            <>
              <b>Limit reached</b>
              {sum > total && <span className="ui-umc__muted">{withUnit(fmt(sum - total), "over")}</span>}
            </>
          ) : (
            <>
              {state === "warn" && <b>Running low</b>}
              <span className={state === "warn" ? "ui-umc__muted" : undefined}>{withUnit(fmt(tween("left")), unit)} left</span>
            </>
          )}
        </span>
        <button ref={actionRef} type="button" className="ui-umc__action" data-strong={strong || undefined} onClick={() => onUpgrade?.(state)}>
          <span ref={actionInner} className="ui-umc__action-inner">
            <span key={strong ? "top-up" : "upgrade"} className="ui-umc__action-text">
              {strong ? topUpLabel : upgradeLabel}
            </span>
          </span>
        </button>
      </div>

      <span className="ui-umc__live" aria-live="polite">
        {announce}
      </span>
    </section>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-umc */
.ui-umc {
  --ui-umc-card: #ffffff;
  --ui-umc-strong: #000000;
  --ui-umc-ink: rgba(0, 0, 0, 0.88);
  --ui-umc-text: rgba(0, 0, 0, 0.61);
  --ui-umc-muted: rgba(0, 0, 0, 0.45);
  --ui-umc-faint: rgba(0, 0, 0, 0.27);
  --ui-umc-line: rgba(0, 0, 0, 0.06);
  --ui-umc-wash: rgba(0, 0, 0, 0.03);
  --ui-umc-fill: rgba(0, 0, 0, 0.06);
  --ui-umc-track: rgba(0, 0, 0, 0.06);
  --ui-umc-spark: rgba(0, 0, 0, 0.12);
  --ui-umc-accent: rgba(0, 96, 226, 0.765);
  --ui-umc-warn: #e8a20c;
  --ui-umc-warn-text: #b07800;
  --ui-umc-warn-bg: rgba(232, 162, 12, 0.12);
  --ui-umc-full: #e5484d;
  --ui-umc-full-text: #d63f44;
  --ui-umc-full-bg: rgba(229, 72, 77, 0.08);
  /* The parts: the accent blue, then lighter tints of it, then a gray */
  --ui-umc-c1: rgba(0, 96, 226, 0.765);
  --ui-umc-c2: rgba(0, 96, 226, 0.5);
  --ui-umc-c3: rgba(0, 96, 226, 0.3);
  --ui-umc-c4: rgba(0, 96, 226, 0.16);
  --ui-umc-c5: rgba(0, 0, 0, 0.14);
  /* The solid button near the limit */
  --ui-umc-dark: rgba(0, 0, 0, 0.88);
  --ui-umc-on-dark: #fcfcfc;
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-umc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-umc-tip-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 2px 0 rgba(0, 0, 0, 0.05), 0 8px 20px -8px rgba(0, 0, 0, 0.14);
  --ui-umc-focus: rgba(0, 96, 226, 0.35);
  --ui-umc-ease: cubic-bezier(0.22, 1, 0.36, 1);
  box-sizing: border-box;
  container-type: inline-size;
  position: relative;
  display: grid;
  /* One column that never grows past the card, whatever the button or a label asks for */
  grid-template-columns: minmax(0, 1fr);
  width: 100%;
  max-width: 460px;
  border-radius: 10px;
  background: var(--ui-umc-card);
  box-shadow: var(--ui-umc-shadow);
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  color: var(--ui-umc-ink);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-umc *, .ui-umc *::before, .ui-umc *::after { box-sizing: border-box; }
:where(.ui-umc) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
:where(.ui-umc) :is(h3, p, ul) { margin: 0; padding: 0; }
:where(.ui-umc) ul { list-style: none; }
.ui-umc :is(button, [tabindex="0"]):focus-visible { outline: 2px solid var(--ui-umc-focus); outline-offset: 1px; }
.ui-umc b { font-weight: 500; color: var(--ui-umc-ink); }
.ui-umc__muted { color: var(--ui-umc-muted); }

/* The body of the card – glides to its new height when rows come or go */
.ui-umc__card { overflow: hidden; border-radius: 10px 10px 0 0; transition: height 360ms var(--ui-umc-ease); }
.ui-umc__inner { display: flow-root; padding: 16px 16px 16px; }

/* Head: title and reset date, the period switch on the right */
.ui-umc__head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.ui-umc__heading { flex: 1 1 auto; min-width: min(120px, 40%); }
.ui-umc__title { overflow: hidden; font-size: 15px; font-weight: 500; line-height: 24px; color: var(--ui-umc-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-umc__sub { overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-umc-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-umc__sep { margin: 0 6px; color: var(--ui-umc-faint); }

/* The "button switch": separate chips with a hairline; the light-gray fill glides to the chosen one */
.ui-umc__switch { position: relative; display: grid; grid-auto-columns: minmax(0, auto); grid-auto-flow: column; gap: 8px; flex: 0 1 auto; min-width: 0; }
.ui-umc__pill {
  position: absolute;
  top: 0;
  left: 0;
  border-radius: 6px;
  background: var(--ui-umc-fill);
  opacity: 0;
  pointer-events: none;
  transition: transform 320ms var(--ui-umc-ease), width 320ms var(--ui-umc-ease), height 320ms var(--ui-umc-ease), opacity 200ms ease;
}
.ui-umc__option {
  position: relative;
  z-index: 1;
  min-width: 0;
  height: 28px;
  padding: 4px 10px;
  overflow: hidden;
  border-radius: 6px;
  box-shadow: inset 0 0 0 0.5px var(--ui-umc-line);
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  color: var(--ui-umc-text);
  white-space: nowrap;
  text-overflow: ellipsis;
  transition: color 200ms ease, background-color 120ms ease;
}
.ui-umc__option[aria-checked="true"] { color: var(--ui-umc-ink); }
@media (hover: hover) {
  .ui-umc__option[aria-checked="false"]:hover { background: var(--ui-umc-wash); color: var(--ui-umc-ink); }
}

/* The big number and its share */
.ui-umc__figure { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 14px; }
.ui-umc__amount { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 8px; min-width: 0; }
.ui-umc__big { font-size: 24px; font-weight: 500; line-height: 32px; letter-spacing: -0.24px; color: var(--ui-umc-strong); font-variant-numeric: tabular-nums; }
.ui-umc__of { font-size: 12px; line-height: 16px; color: var(--ui-umc-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
/* The share as a small tag – tinted amber, then red, near and at the limit */
.ui-umc__pct {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 6px;
  border-radius: 5px;
  background: var(--ui-umc-fill);
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  color: var(--ui-umc-text);
  font-variant-numeric: tabular-nums;
  transition: color 260ms ease, background-color 260ms ease;
}
.ui-umc__pct[data-state="warn"] { background: var(--ui-umc-warn-bg); color: var(--ui-umc-warn-text); }
.ui-umc__pct[data-state="limit"] { background: var(--ui-umc-full-bg); color: var(--ui-umc-full-text); }
/* A small status dot: amber when running low, red at the limit */
.ui-umc__dot { display: inline-block; flex: none; width: 6px; height: 6px; border-radius: 50%; background: var(--ui-umc-warn); animation: ui-umc-pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
.ui-umc[data-state="limit"] :is(.ui-umc__pct, .ui-umc__status) .ui-umc__dot, .ui-umc__limit[data-state="limit"] .ui-umc__dot { background: var(--ui-umc-full); }

/* The stacked bar */
.ui-umc__bar { position: relative; margin-top: 10px; padding: 4px 0; border-radius: 4px; cursor: default; }
.ui-umc__track { display: flex; height: 8px; overflow: hidden; border-radius: 4px; background: var(--ui-umc-track); }
.ui-umc__seg { position: relative; flex: none; height: 100%; overflow: hidden; transition: opacity 200ms ease; }
/* A thin cut between the parts */
.ui-umc__seg::after { content: ""; position: absolute; top: 0; right: 0; bottom: 0; width: 2px; background: var(--ui-umc-card); }
.ui-umc__bar[data-active] .ui-umc__seg:not([data-active]) { opacity: 0.3; }

/* Tooltip: a small white card anchored to the middle of the part, shifted so it never leaves the card */
.ui-umc__tip {
  position: absolute;
  bottom: calc(100% + 6px);
  z-index: 2;
  display: grid;
  gap: 2px;
  padding: 6px 10px 7px;
  border-radius: 8px;
  background: var(--ui-umc-card);
  box-shadow: var(--ui-umc-tip-shadow);
  max-width: 100%;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transform: translate(var(--ui-umc-tip-x), 4px) scale(0.97);
  transition: left 260ms var(--ui-umc-ease), transform 260ms var(--ui-umc-ease), opacity 160ms ease;
}
.ui-umc__tip[data-open] { opacity: 1; transform: translate(var(--ui-umc-tip-x), 0); }
.ui-umc__tip-label { display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 16px; color: var(--ui-umc-muted); }
.ui-umc__tip-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-umc__tip-value { font-size: 13px; font-weight: 500; line-height: 20px; color: var(--ui-umc-ink); font-variant-numeric: tabular-nums; }
.ui-umc__tip-value .ui-umc__muted { font-weight: 400; }

/* Legend: one row per category, highlighted with the bar */
.ui-umc__legend { display: grid; margin-top: 10px; }
.ui-umc__row { display: grid; grid-template-rows: 1fr; animation: ui-umc-grow 380ms var(--ui-umc-ease) both; transition: grid-template-rows 320ms var(--ui-umc-ease) 80ms, opacity 200ms ease; }
.ui-umc__row[data-leaving] { grid-template-rows: 0fr; opacity: 0; pointer-events: none; }
.ui-umc__item { display: flex; align-items: center; gap: 10px; min-height: 0; height: 32px; margin: 0 -8px; padding: 0 8px; overflow: hidden; border-radius: 6px; transition: background-color 120ms ease-out, opacity 200ms ease; }
.ui-umc__row[data-leaving] .ui-umc__item { background: none; }
.ui-umc__item[data-active] { background: var(--ui-umc-wash); }
.ui-umc__legend[data-active] .ui-umc__item:not([data-active]) { opacity: 0.45; }
.ui-umc__swatch { flex: none; width: 8px; height: 8px; border-radius: 2px; }
.ui-umc__label { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--ui-umc-ink); }
.ui-umc__value { color: var(--ui-umc-ink); font-weight: 500; font-variant-numeric: tabular-nums; }
.ui-umc__share { width: 40px; font-size: 12px; line-height: 16px; text-align: right; color: var(--ui-umc-muted); font-variant-numeric: tabular-nums; }

/* Daily sparkline */
.ui-umc__daily { margin-top: 14px; }
.ui-umc__daily-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 12px; line-height: 16px; color: var(--ui-umc-muted); white-space: nowrap; }
/* A tiny uppercase label, the readout on the right */
.ui-umc__daily-head > :first-child { font-size: 10px; font-weight: 500; line-height: 16px; letter-spacing: 0.5px; text-transform: uppercase; }
.ui-umc__daily-read { font-variant-numeric: tabular-nums; animation: ui-umc-in 220ms var(--ui-umc-ease) both; }
.ui-umc__spark { display: flex; align-items: stretch; gap: 2px; height: 32px; margin-top: 8px; border-radius: 4px; cursor: default; }
/* A week gets wider gaps, so seven bars don't read as one block */
.ui-umc__spark[data-few] { gap: 5px; }
/* A quarter or a year: thinner gaps, so the bars keep some width */
.ui-umc__spark[data-many] { gap: 1px; }
.ui-umc__spark[data-many="dense"] { gap: 0; }
.ui-umc__day { display: flex; flex: 1 1 0; align-items: flex-end; min-width: 0; }
.ui-umc__day > span { width: 100%; border-radius: 2px; background: var(--ui-umc-spark); transform-origin: bottom; transition: background-color 160ms ease, opacity 160ms ease; }
.ui-umc__spark[data-regrow] .ui-umc__day > span { animation: ui-umc-rise 520ms var(--ui-umc-ease) both; animation-delay: calc(var(--i) * 18ms); }
.ui-umc__day[data-future] > span { height: 2px; background: var(--ui-umc-track); }
.ui-umc__spark[data-hover] .ui-umc__day:not([data-active]) > span { opacity: 0.6; }
.ui-umc__day[data-active] > span { background: var(--ui-umc-accent); }

/* Plan limits: thin meters, side by side on wide cards */
.ui-umc__limits { display: grid; grid-template-columns: repeat(var(--n, 3), minmax(0, 1fr)); gap: 12px 18px; margin-top: 16px; padding-top: 14px; border-top: 0.5px solid var(--ui-umc-line); }
.ui-umc__limit { display: grid; grid-template-columns: minmax(0, 1fr); align-content: start; min-width: 0; }
.ui-umc__limit-label { display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-umc-muted); white-space: nowrap; }
.ui-umc__limit-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* Numbers are never cut – a long one wraps after "of" instead */
.ui-umc__limit-value { color: var(--ui-umc-ink); font-weight: 500; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.ui-umc__limit-value .ui-umc__muted { font-weight: 400; }
.ui-umc__thin { position: relative; display: block; height: 4px; margin-top: 6px; overflow: hidden; border-radius: 2px; background: var(--ui-umc-track); }
.ui-umc__thin > span { position: absolute; top: 0; bottom: 0; left: 0; border-radius: inherit; background: var(--ui-umc-accent); transition: background-color 260ms ease; }
.ui-umc__limit[data-state="warn"] .ui-umc__thin > span { background: var(--ui-umc-warn); }
.ui-umc__limit[data-state="limit"] .ui-umc__thin > span { background: var(--ui-umc-full); }
/* Unlimited: a quiet striped track instead of a fill */
.ui-umc__thin[data-unlimited] { background: repeating-linear-gradient(-45deg, var(--ui-umc-track) 0 3px, transparent 3px 6px); }

/* The last row of the card, under a hairline */
.ui-umc__foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; min-height: 44px; padding: 6px 8px 6px 16px; border-top: 0.5px solid var(--ui-umc-line); font-size: 12px; line-height: 16px; color: var(--ui-umc-muted); }
.ui-umc__status { display: flex; align-items: center; gap: 6px; min-width: 0; overflow: hidden; white-space: nowrap; font-variant-numeric: tabular-nums; animation: ui-umc-in 260ms var(--ui-umc-ease) both; }
.ui-umc__status > :last-child { overflow: hidden; text-overflow: ellipsis; }
/* The button: white with the hairline shadow, a dark chip near the limit */
.ui-umc__action {
  display: inline-flex;
  flex: none;
  justify-content: center;
  max-width: 100%;
  height: 28px;
  margin-left: auto;
  overflow: hidden;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  color: var(--ui-umc-strong);
  background: var(--ui-umc-card);
  box-shadow: var(--ui-umc-shadow);
  transition: background-color 280ms ease, color 280ms ease, box-shadow 280ms ease, width 320ms var(--ui-umc-ease), transform 140ms ease;
}
.ui-umc__action:hover { background: #fafafa; }
.ui-umc__action:active { transform: scale(0.97); }
.ui-umc__action[data-strong] { background: var(--ui-umc-dark); color: var(--ui-umc-on-dark); box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.12); animation: ui-umc-nudge 520ms cubic-bezier(0.34, 1.56, 0.64, 1); }
.ui-umc__action[data-strong]:hover { background: var(--ui-umc-dark); opacity: 0.88; }
.ui-umc__action-inner { display: inline-flex; align-items: center; flex: none; height: 100%; padding: 0 10px; white-space: nowrap; }
.ui-umc__action-text { animation: ui-umc-in 260ms var(--ui-umc-ease) both; }
.ui-umc__live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

@keyframes ui-umc-in { from { opacity: 0; transform: translateY(3px); filter: blur(2px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes ui-umc-grow { from { grid-template-rows: 0fr; opacity: 0; } to { grid-template-rows: 1fr; opacity: 1; } }
@keyframes ui-umc-rise { from { transform: scaleY(0); } to { transform: none; } }
@keyframes ui-umc-pop { 0% { transform: scale(0.3); } 60% { transform: scale(1.25); } 100% { transform: scale(1); } }
@keyframes ui-umc-nudge { 0% { transform: scale(0.94); } 60% { transform: scale(1.04); } 100% { transform: scale(1); } }

/* Narrow (phones): the switch gets its own full-width row, limits stack as rows */
@container (max-width: 400px) {
  .ui-umc__inner { padding: 14px 14px 14px; }
  .ui-umc__foot { padding: 6px 8px 6px 14px; }
  .ui-umc__head { flex-direction: column; align-items: stretch; gap: 12px; }
  .ui-umc__switch { grid-auto-columns: minmax(0, auto); gap: 4px; }
  .ui-umc__option { padding: 4px 8px; }
  .ui-umc__limits { grid-template-columns: minmax(0, 1fr); gap: 12px; }
  .ui-umc__limit { grid-template-columns: minmax(0, 1fr) fit-content(60%); column-gap: 12px; }
  .ui-umc__limit-value { font-size: 12px; line-height: 16px; text-align: end; }
  .ui-umc__thin { grid-column: 1 / -1; margin-top: 6px; }
}
@container (max-width: 300px) {
  .ui-umc__option { padding: 4px 6px; }
  .ui-umc__share { width: 34px; }
}
/* Touch screens: bigger targets */
@media (hover: none) and (pointer: coarse) {
  .ui-umc__option { height: 34px; padding: 7px 10px; }
  .ui-umc__item { height: 36px; }
  .ui-umc__action { height: 36px; }
  .ui-umc__foot { min-height: 52px; }
  .ui-umc__bar { padding: 10px 0; margin-top: 4px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-umc *, .ui-umc *::before, .ui-umc *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-umc {
  --ui-umc-card: #1c1c1e;
  --ui-umc-strong: #ffffff;
  --ui-umc-ink: rgba(255, 255, 255, 0.9);
  --ui-umc-text: rgba(255, 255, 255, 0.62);
  --ui-umc-muted: rgba(255, 255, 255, 0.46);
  --ui-umc-faint: rgba(255, 255, 255, 0.3);
  --ui-umc-line: rgba(255, 255, 255, 0.08);
  --ui-umc-wash: rgba(255, 255, 255, 0.04);
  --ui-umc-fill: rgba(255, 255, 255, 0.08);
  --ui-umc-track: rgba(255, 255, 255, 0.08);
  --ui-umc-spark: rgba(255, 255, 255, 0.16);
  --ui-umc-accent: #4d8dff;
  --ui-umc-warn: #f0b43a;
  --ui-umc-warn-text: #f0b43a;
  --ui-umc-warn-bg: rgba(232, 162, 12, 0.16);
  --ui-umc-full: #ff6b70;
  --ui-umc-full-text: #ff8a8e;
  --ui-umc-full-bg: rgba(229, 72, 77, 0.14);
  --ui-umc-c1: #4d8dff;
  --ui-umc-c2: rgba(77, 141, 255, 0.62);
  --ui-umc-c3: rgba(77, 141, 255, 0.4);
  --ui-umc-c4: rgba(77, 141, 255, 0.22);
  --ui-umc-c5: rgba(255, 255, 255, 0.16);
  --ui-umc-dark: rgba(255, 255, 255, 0.9);
  --ui-umc-on-dark: #111113;
  --ui-umc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-umc-tip-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 8px 20px -8px rgba(0, 0, 0, 0.6);
  --ui-umc-focus: rgba(77, 141, 255, 0.5);
}
:where(.dark, [data-theme="dark"]) .ui-umc__action:hover { background: #232326; }
:where(.dark, [data-theme="dark"]) .ui-umc__tip { background: #2a2a2d; }
`;
