"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";

/*
 * Billing Schedule – build one phase of a billing plan, in a single self-contained file.
 * Pick a start date and a duration, add products from a catalog, set how often each repeats, its price
 * and whether it's billed in advance or in arrears, then add a discount or a minimum commitment.
 * The phase summary and the totals update as you go; rows glide in and out.
 * The styles are injected below, so no extra files are needed.
 */

export type Repeat = "once" | "monthly" | "quarterly" | "yearly";
export type Timing = "advance" | "arrears";

export type ScheduleLine =
  | { id: string; kind: "product"; name: string; repeat: Repeat; price: number; timing: Timing }
  | { id: string; kind: "discount"; name: string; percent: number }
  | { id: string; kind: "minimum"; name: string; amount: number };

export type CatalogItem = { name: string; repeat: Repeat; price: number };

export type BillingScheduleProps = {
  title?: string;
  phase?: string;
  /** Currency symbol shown with prices */
  currency?: string;
  /** Products offered under "Add product" */
  catalog?: CatalogItem[];
  /** Starting lines */
  defaultLines?: ScheduleLine[];
  /** yyyy-mm-dd */
  defaultStart?: string;
  /** Called with the full schedule after every change */
  onChange?: (schedule: { phase: string; start: string; duration: string; lines: ScheduleLine[] }) => void;
  className?: string;
};

const DURATIONS = [
  { id: "milestone", label: "Milestone", months: 0 },
  { id: "1m", label: "1 month", months: 1 },
  { id: "3m", label: "3 months", months: 3 },
  { id: "6m", label: "6 months", months: 6 },
  { id: "12m", label: "12 months", months: 12 },
];

const REPEATS: { id: Repeat; label: string; perYear: number }[] = [
  { id: "once", label: "Once", perYear: 0 },
  { id: "monthly", label: "Monthly", perYear: 12 },
  { id: "quarterly", label: "Quarterly", perYear: 4 },
  { id: "yearly", label: "Yearly", perYear: 1 },
];

const defaultCatalog: CatalogItem[] = [
  { name: "Set-up fee", repeat: "once", price: 4999 },
  { name: "Platform licence", repeat: "monthly", price: 1200 },
  { name: "Premium support", repeat: "monthly", price: 350 },
  { name: "Extra seats (10)", repeat: "monthly", price: 240 },
  { name: "Onboarding workshop", repeat: "once", price: 1500 },
];

// A repeat the list doesn't know counts as once, so a bad value never crashes the totals
const repeatOf = (id: string) => REPEATS.find((r) => r.id === id) ?? REPEATS[0];
// NaN and Infinity count as 0
const num = (n: number) => (Number.isFinite(n) ? n : 0);

let uid = 0;
const nextId = () => `l${++uid}`;

export function BillingSchedule({
  title = "Create a billing schedule",
  phase: phaseDefault = "Build-out phase",
  currency = "$",
  catalog = defaultCatalog,
  defaultLines = [{ id: "seed-1", kind: "product", name: "Set-up fee", repeat: "once", price: 4999, timing: "advance" }],
  defaultStart = "2026-01-01",
  onChange,
  className,
}: BillingScheduleProps) {
  const [phase, setPhase] = useState(phaseDefault);
  const [start, setStart] = useState(defaultStart);
  const [duration, setDuration] = useState("milestone");
  const [lines, setLines] = useState<ScheduleLine[]>(defaultLines);
  const [menu, setMenu] = useState<null | "duration" | "product">(null);
  const rowsInner = useRef<HTMLDivElement>(null);
  const rowsOuter = useSmoothHeight(rowsInner);

  useEffect(() => {
    onChange?.({ phase, start, duration, lines });
  }, [phase, start, duration, lines, onChange]);

  // -$42.50, and <$0.01 for amounts that would round to nothing
  const money = (raw: number) => {
    const n = num(raw);
    if (n !== 0 && Math.abs(n) < 0.005) return `${n < 0 ? "-" : ""}<${currency}0.01`;
    return `${n < 0 ? "-" : ""}${currency}${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const fmtDay = (d: Date) => (isNaN(d.getTime()) ? "–" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }));
  const fmtDate = (iso: string) => fmtDay(new Date(`${iso}T12:00:00`));
  const dur = DURATIONS.find((d) => d.id === duration)!;
  const end = (() => {
    if (!dur.months) return "Milestone";
    const d = new Date(`${start}T12:00:00`);
    if (isNaN(d.getTime())) return "–";
    d.setMonth(d.getMonth() + dur.months);
    d.setDate(d.getDate() - 1);
    // Formatted straight from the date – an ISO round trip breaks past the year 9999
    return fmtDay(d);
  })();

  const update = (id: string, patch: Partial<ScheduleLine>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? ({ ...l, ...patch } as ScheduleLine) : l)));
  const remove = (id: string) => setLines((ls) => ls.filter((l) => l.id !== id));
  const addProduct = (c: CatalogItem) => {
    setLines((ls) => [...ls.filter((l) => l.kind === "product"), { id: nextId(), kind: "product", ...c, timing: "advance" }, ...ls.filter((l) => l.kind !== "product")]);
    setMenu(null);
  };
  const hasDiscount = lines.some((l) => l.kind === "discount");
  const hasMinimum = lines.some((l) => l.kind === "minimum");

  // Totals: what the first invoice holds, and what the phase is worth over its length
  const products = lines.filter((l): l is Extract<ScheduleLine, { kind: "product" }> => l.kind === "product");
  const discount = lines.find((l): l is Extract<ScheduleLine, { kind: "discount" }> => l.kind === "discount");
  const minimum = lines.find((l): l is Extract<ScheduleLine, { kind: "minimum" }> => l.kind === "minimum");
  const off = 1 - Math.min(100, Math.max(0, num(discount?.percent ?? 0))) / 100;
  const firstInvoice = products.filter((p) => p.timing === "advance").reduce((s, p) => s + num(p.price), 0) * off;
  const months = dur.months || 1;
  const phaseTotal =
    products.reduce((s, p) => {
      const per = repeatOf(p.repeat).perYear;
      return s + (per ? num(p.price) * Math.max(1, Math.round((per * months) / 12)) : num(p.price));
    }, 0) * off;
  const minAmount = num(minimum?.amount ?? 0);
  const total = Math.max(phaseTotal, minAmount);

  return (
    <div className={["ui-bs", className].filter(Boolean).join(" ")}>
      <style href="ui-billing-schedule" precedence="default">
        {css}
      </style>

      <p className="ui-bs__title" dir="auto">
        {title}
      </p>

      <div className="ui-bs__card">
        {/* Phase summary – the name is editable, dates follow the fields below */}
        <div className="ui-bs__summary">
          <input className="ui-bs__phase" value={phase} onChange={(e) => setPhase(e.target.value)} aria-label="Phase name" title={phase} dir="auto" size={Math.max(6, Math.min(40, phase.length))} />
          <span>{fmtDate(start)}</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12h14m0 0-5-5m5 5-5 5" />
          </svg>
          <span key={end} className="ui-bs__end">
            {end}
          </span>
        </div>

        <div className="ui-bs__fields">
          <label className="ui-bs__field">
            <span>Start date</span>
            <span className="ui-bs__input">
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              <Icon d="M7 4v3M17 4v3M4.5 9.5h15M6 6h12a1.5 1.5 0 0 1 1.5 1.5v11A1.5 1.5 0 0 1 18 20H6a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 6 6Z" />
            </span>
          </label>
          <div className="ui-bs__field">
            <span id="ui-bs-duration">Duration</span>
            <Dropdown
              open={menu === "duration"}
              onOpenChange={(o) => setMenu(o ? "duration" : null)}
              label={dur.label}
              labelledBy="ui-bs-duration"
            >
              {DURATIONS.map((d) => (
                <button key={d.id} type="button" role="option" aria-selected={d.id === duration} onClick={() => (setDuration(d.id), setMenu(null))}>
                  {d.label}
                  {d.id === duration && <Icon d="m6 12.5 4 4 8-9" />}
                </button>
              ))}
            </Dropdown>
          </div>
        </div>

        {/* Lines */}
        <div className="ui-bs__table" role="table" aria-label="Billing lines">
          <div className="ui-bs__row ui-bs__row--head" role="row">
            <span role="columnheader">Name</span>
            <span role="columnheader">Repeats</span>
            <span role="columnheader" className="ui-bs__right">
              Price
            </span>
          </div>
          <div className="ui-bs__rows-outer" ref={rowsOuter}>
            <div ref={rowsInner}>
              {lines.length === 0 && <p className="ui-bs__empty">No products yet – add one below.</p>}
              {lines.map((l) => (
                <div key={l.id} className="ui-bs__row" role="row" data-kind={l.kind}>
                  <span role="cell" className="ui-bs__name">
                    {l.kind !== "product" && (
                      <span className="ui-bs__tag" aria-hidden="true">
                        <Icon d={l.kind === "discount" ? DISCOUNT : MINIMUM} />
                      </span>
                    )}
                    <span className="ui-bs__name-text" dir="auto" title={l.name}>
                      {l.name}
                    </span>
                  </span>
                  <span role="cell">
                    {l.kind === "product" ? (
                      <label className="ui-bs__repeat">
                        <Icon d={REPEAT} />
                        <select value={repeatOf(l.repeat).id} onChange={(e) => update(l.id, { repeat: e.target.value as Repeat })} aria-label={`${l.name} repeats`}>
                          {REPEATS.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <span className="ui-bs__muted">{l.kind === "discount" ? "Whole phase" : "Per phase"}</span>
                    )}
                  </span>
                  <span role="cell" className="ui-bs__price">
                    {/* Amount on top, billing timing quietly underneath – the column never runs into Repeats */}
                    <span className="ui-bs__price-main">
                      {l.kind === "product" && (
                        <>
                          <NumberField value={l.price} prefix={currency} onChange={(v) => update(l.id, { price: v })} label={`${l.name} price`} />
                          <span className="ui-bs__muted">/ {repeatOf(l.repeat).id === "once" ? "once" : repeatOf(l.repeat).label.toLowerCase().replace("ly", "")}</span>
                        </>
                      )}
                      {l.kind === "discount" && (
                        <>
                          <NumberField value={l.percent} suffix="%" max={100} onChange={(v) => update(l.id, { percent: v })} label="Discount percent" />
                          <span className="ui-bs__muted">off</span>
                        </>
                      )}
                      {l.kind === "minimum" && (
                        <>
                          <NumberField value={l.amount} prefix={currency} onChange={(v) => update(l.id, { amount: v })} label="Minimum commitment" />
                          <span className="ui-bs__muted">minimum</span>
                        </>
                      )}
                      <button type="button" className="ui-bs__remove" aria-label={`Remove ${l.name}`} onClick={() => remove(l.id)}>
                        <Icon d="M7 7l10 10M17 7 7 17" />
                      </button>
                    </span>
                    {l.kind === "product" && (
                      <select className="ui-bs__timing" value={l.timing} onChange={(e) => update(l.id, { timing: e.target.value as Timing })} aria-label={`${l.name} billed`}>
                        <option value="advance">Billed in advance</option>
                        <option value="arrears">Billed in arrears</option>
                      </select>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="ui-bs__actions">
          <Dropdown
            open={menu === "product"}
            onOpenChange={(o) => setMenu(o ? "product" : null)}
            label={
              <>
                <Icon d="M12 5.5v13M5.5 12h13" />
                Add product
              </>
            }
            button
            up
          >
            {catalog.length === 0 && <p className="ui-bs__menu-empty">No products to add</p>}
            {catalog.map((c, i) => (
              <button key={`${c.name}-${i}`} type="button" role="option" aria-selected={false} onClick={() => addProduct(c)}>
                <span>
                  {c.name}
                  <small>
                    {money(c.price)} · {repeatOf(c.repeat).label.toLowerCase()}
                  </small>
                </span>
              </button>
            ))}
          </Dropdown>
          <span className="ui-bs__spacer" />
          <button
            type="button"
            className="ui-bs__btn"
            disabled={hasDiscount}
            onClick={() => setLines((ls) => [...ls, { id: nextId(), kind: "discount", name: "Discount", percent: 10 }])}
          >
            <Icon d={DISCOUNT} />
            Add discount
          </button>
          <button
            type="button"
            className="ui-bs__btn"
            disabled={hasMinimum}
            onClick={() => setLines((ls) => [...ls, { id: nextId(), kind: "minimum", name: "Minimum commitment", amount: 10000 }])}
          >
            <Icon d={MINIMUM} />
            Add minimum
          </button>
        </div>
      </div>

      {/* Totals on the tray */}
      <div className="ui-bs__totals" aria-live="polite">
        <span>
          First invoice <b>{money(firstInvoice)}</b>
        </span>
        <span>
          {dur.months ? `Phase total (${dur.label})` : "Phase total"} <b>{money(total)}</b>
          {minimum && total === minAmount && phaseTotal < minAmount && <em>minimum applies</em>}
        </span>
      </div>
    </div>
  );
}

/* ---------- Pieces ---------- */

const REPEAT = "M17 3.5 19.5 6 17 8.5M19.5 6H9a5 5 0 0 0-5 5M7 20.5 4.5 18 7 15.5M4.5 18H15a5 5 0 0 0 5-5";
const DISCOUNT = "M9 15 15 9M9.5 9.5h.01M14.5 14.5h.01M12 3l2.1 1.6 2.6-.2.9 2.5 2.3 1.2-.4 2.6L21 12.6l-1.5 2.1.4 2.6-2.3 1.2-.9 2.5-2.6-.2L12 21.4l-2.1-1.6-2.6.2-.9-2.5L4.1 16.3l.4-2.6L3 12l1.5-2.1-.4-2.6 2.3-1.2.9-2.5 2.6.2Z";
const MINIMUM = "M5 19.5h14M7 15.5h10M9 11.5h6M10 7.5h4M12 4v1";

const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** Number input that shows a formatted value and edits the raw one */
function NumberField({
  value,
  onChange,
  prefix,
  suffix,
  max,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  prefix?: string;
  suffix?: string;
  max?: number;
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // NaN reads 0, and a value past the field's max reads as the max the totals use
  const safe = Math.min(max ?? Infinity, Number.isFinite(value) ? value : 0);
  // A credit reads -$42.50: the sign goes before the currency, the field holds the amount
  const neg = draft === null && safe < 0;
  const shown = draft ?? Math.abs(safe).toLocaleString("en-US", { minimumFractionDigits: suffix ? 0 : 2, maximumFractionDigits: 2 });
  return (
    <span className="ui-bs__num">
      {neg && "-"}
      {prefix}
      <input
        value={shown}
        inputMode="decimal"
        aria-label={label}
        size={Math.max(2, shown.length)}
        onFocus={() => setDraft(String(safe))}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d.]/g, ""))}
        onBlur={() => {
          const v = Math.max(0, Math.min(max ?? Infinity, parseFloat(draft ?? "") || 0));
          onChange(v);
          setDraft(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      {suffix}
    </span>
  );
}

function Dropdown({
  open,
  onOpenChange,
  label,
  labelledBy,
  accent,
  button,
  up,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: ReactNode;
  labelledBy?: string;
  accent?: boolean;
  button?: boolean;
  up?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onOpenChange(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onOpenChange(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);
  return (
    <div className="ui-bs__dd" ref={ref}>
      <button
        type="button"
        className={button ? "ui-bs__btn" : accent ? "ui-bs__select ui-bs__select--accent" : "ui-bs__select"}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelledBy}
        onClick={() => onOpenChange(!open)}
      >
        <span className="ui-bs__select-label">{label}</span>
        {!button && <Icon d="m7 10 5 5 5-5" />}
      </button>
      {open && (
        <div className="ui-bs__menu" role="listbox" data-up={up ? "" : undefined}>
          {children}
        </div>
      )}
    </div>
  );
}

/** The outer box follows the inner box's height, with a transition after the first frame */
function useSmoothHeight(inner: RefObject<HTMLElement | null>) {
  const outer = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const sync = () => {
      o.style.height = `${i.offsetHeight}px`;
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(i);
    const frame = requestAnimationFrame(() => o.setAttribute("data-smooth", ""));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [inner]);
  return outer;
}

/* ---------- Styles ---------- */

const css = /* css */ `
.ui-bs {
  --ui-bs-tray: #f0f0f0;
  --ui-bs-card: #ffffff;
  --ui-bs-card-line: #e5e5e5;
  --ui-bs-line: #ececec;
  --ui-bs-inset: #f7f7f7;
  --ui-bs-ink: #171717;
  --ui-bs-text: #404040;
  --ui-bs-muted: #8f8f8f;
  --ui-bs-hover: #f5f5f5;
  /* The library's gradient for the chosen duration */
  --ui-bs-grad-a: #c7d7ff;
  --ui-bs-grad-b: #e4d9ff;
  --ui-bs-grad-c: #fbe0ef;
  --ui-bs-grad-text: #3550b0;
  --ui-bs-focus: #2f6bff;
  --ui-bs-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
  --ui-bs-ease: cubic-bezier(0.22, 1, 0.36, 1);
  width: 100%;
  max-width: 560px;
  padding: 6px;
  border-radius: 20px;
  background: var(--ui-bs-tray);
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  color: var(--ui-bs-ink);
  -webkit-font-smoothing: antialiased;
}
.ui-bs *, .ui-bs *::before, .ui-bs *::after { box-sizing: border-box; }
.ui-bs button, .ui-bs select, .ui-bs input { font: inherit; color: inherit; margin: 0; }
.ui-bs button { cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-bs :focus-visible { outline: 2px solid var(--ui-bs-focus); outline-offset: 2px; }
.ui-bs svg { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }

.ui-bs__title { margin: 0; overflow-wrap: anywhere; padding: 10px 10px 12px; font-size: 15px; font-weight: 500; letter-spacing: -0.01em; }

.ui-bs__card {
  padding: 12px;
  border: 1px solid var(--ui-bs-card-line);
  border-radius: 16px;
  background: var(--ui-bs-card);
  box-shadow: var(--ui-bs-shadow);
}

/* Summary */
.ui-bs__summary { display: flex; align-items: center; gap: 8px; padding: 2px 2px 12px; font-size: 14px; color: var(--ui-bs-text); }
.ui-bs__phase {
  min-width: 0;
  padding: 2px 4px;
  margin-left: -4px !important;
  border: 0;
  border-radius: 6px;
  background: none;
  font-weight: 500;
  color: var(--ui-bs-ink) !important;
  outline: none;
  transition: background-color 160ms ease;
}
.ui-bs__phase:hover, .ui-bs__phase:focus { background: var(--ui-bs-hover); }
.ui-bs__summary svg { width: 15px; height: 15px; color: var(--ui-bs-muted); }
.ui-bs__end { animation: ui-bs-fade 260ms ease both; }

/* Fields */
.ui-bs__fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 10px; border-radius: 12px; background: var(--ui-bs-inset); }
.ui-bs__field { display: grid; gap: 7px; min-width: 0; font-size: 13px; color: var(--ui-bs-text); }
.ui-bs__input,
.ui-bs__select {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  height: 40px;
  padding: 0 12px;
  border: 0;
  border-radius: 10px;
  background: var(--ui-bs-card);
  box-shadow: inset 0 0 0 1px var(--ui-bs-card-line), 0 1px 1px rgba(0, 0, 0, 0.03);
  font-size: 14px;
  color: var(--ui-bs-ink) !important;
  text-align: left;
}
.ui-bs__input input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: 0;
  background: none;
  outline: none;
}
/* The native picker opens from the whole field; its own icon is hidden behind ours */
.ui-bs__input input::-webkit-calendar-picker-indicator { position: absolute; inset: 0; width: auto; height: auto; opacity: 0; cursor: pointer; }
.ui-bs__input svg { color: var(--ui-bs-text); pointer-events: none; }
.ui-bs__input:focus-within { box-shadow: inset 0 0 0 1px var(--ui-bs-focus); }
.ui-bs__select svg { color: var(--ui-bs-muted); transition: transform 220ms var(--ui-bs-ease); }
.ui-bs__select[aria-expanded="true"] svg { transform: rotate(180deg); }
.ui-bs__select--accent {
  background: linear-gradient(100deg, var(--ui-bs-grad-a), var(--ui-bs-grad-b) 60%, var(--ui-bs-grad-c));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.5), 0 1px 2px rgba(47, 107, 255, 0.12);
  color: var(--ui-bs-grad-text) !important;
}
.ui-bs__select--accent svg { color: var(--ui-bs-grad-text); }

/* Dropdowns */
.ui-bs__dd { position: relative; }
.ui-bs__menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 5;
  display: grid;
  gap: 2px;
  min-width: 220px;
  padding: 5px;
  border-radius: 12px;
  background: var(--ui-bs-card);
  box-shadow: 0 0 0 1px var(--ui-bs-card-line), 0 10px 30px rgba(0, 0, 0, 0.1);
  animation: ui-bs-menu 200ms var(--ui-bs-ease) both;
  transform-origin: top;
}
/* A long catalog scrolls inside the menu, and long names wrap instead of widening it past the card */
.ui-bs__menu { max-width: min(360px, calc(100vw - 32px)); max-height: min(320px, 60vh); overflow-y: auto; overscroll-behavior: contain; }
.ui-bs__menu button { overflow-wrap: anywhere; }
.ui-bs__menu-empty { margin: 0; padding: 6px 8px; color: var(--ui-bs-muted); }
.ui-bs__menu[data-up] { top: auto; bottom: calc(100% + 6px); right: auto; transform-origin: bottom left; }
.ui-bs__menu button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border: 0;
  border-radius: 8px;
  background: none;
  font-size: 13.5px;
  text-align: left;
}
.ui-bs__menu button:hover { background: var(--ui-bs-hover); }
.ui-bs__menu small { display: block; margin-top: 1px; font-size: 12px; color: var(--ui-bs-muted); }

/* Table */
.ui-bs__table { margin-top: 6px; }
.ui-bs__row {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr) 216px;
  align-items: center;
  gap: 14px;
  min-height: 52px;
  padding: 6px 4px 6px 6px;
  border-bottom: 1px solid var(--ui-bs-line);
  font-size: 14px;
  animation: ui-bs-row 320ms var(--ui-bs-ease) both;
}
.ui-bs__row--head { min-height: 40px; font-size: 13px; color: var(--ui-bs-muted); animation: none; }
.ui-bs__right { text-align: right; padding-right: 30px; }
.ui-bs__rows-outer { overflow: hidden; }
.ui-bs__rows-outer[data-smooth] { transition: height 320ms var(--ui-bs-ease); }
.ui-bs__empty { margin: 0; padding: 16px 6px; font-size: 13px; color: var(--ui-bs-muted); }
.ui-bs__name { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ui-bs__name-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ui-bs__tag { display: grid; place-items: center; width: 22px; height: 22px; flex: none; border-radius: 7px; background: var(--ui-bs-inset); color: var(--ui-bs-text); }
.ui-bs__tag svg { width: 13px; height: 13px; }
.ui-bs__muted { font-size: 13px; color: var(--ui-bs-muted); white-space: nowrap; }
.ui-bs__repeat { position: relative; display: inline-flex; align-items: center; gap: 6px; color: var(--ui-bs-text); }
.ui-bs__repeat select,
.ui-bs__timing {
  padding: 3px 4px;
  margin-left: -4px !important;
  border: 0;
  border-radius: 6px;
  background: none;
  appearance: none;
  cursor: pointer;
  transition: background-color 160ms ease;
}
.ui-bs__repeat select:hover, .ui-bs__timing:hover { background: var(--ui-bs-hover); }
/* Under the amount, right-aligned with it (the remove button's slot stays free) */
.ui-bs__timing { margin: 0 28px 0 0 !important; padding: 1px 4px !important; font-size: 12px; color: var(--ui-bs-muted) !important; text-align: right; }
.ui-bs__price { display: grid; justify-items: end; min-width: 0; }
.ui-bs__price-main { display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.ui-bs__num { display: inline-flex; align-items: center; color: var(--ui-bs-ink); font-variant-numeric: tabular-nums; }
.ui-bs__num input {
  padding: 3px 1px;
  border: 0;
  border-radius: 6px;
  background: none;
  outline: none;
  text-align: right;
  font-variant-numeric: tabular-nums;
  transition: background-color 160ms ease, box-shadow 160ms ease;
}
.ui-bs__num input:hover { background: var(--ui-bs-hover); }
.ui-bs__num input:focus { background: var(--ui-bs-card); box-shadow: inset 0 0 0 1px var(--ui-bs-focus); }
.ui-bs__remove {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-left: 4px !important;
  padding: 0;
  border: 0;
  border-radius: 7px;
  background: none;
  color: var(--ui-bs-muted) !important;
  opacity: 0;
  transition: opacity 160ms ease, background-color 160ms ease, color 160ms ease;
}
.ui-bs__remove svg { width: 13px; height: 13px; }
.ui-bs__row:hover .ui-bs__remove, .ui-bs__remove:focus-visible { opacity: 1; }
.ui-bs__remove:hover { background: var(--ui-bs-hover); color: var(--ui-bs-ink) !important; }

/* Actions */
.ui-bs__actions { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 10px; border-radius: 12px; background: var(--ui-bs-inset); }
.ui-bs__spacer { flex: 1; }
.ui-bs__btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 14px;
  border: 0;
  border-radius: 10px;
  background: var(--ui-bs-card);
  box-shadow: inset 0 0 0 1px var(--ui-bs-card-line), 0 1px 1px rgba(0, 0, 0, 0.03);
  font-size: 13.5px;
  color: var(--ui-bs-ink) !important;
  white-space: nowrap;
  transition: background-color 160ms ease, opacity 200ms ease, transform 160ms ease;
}
.ui-bs__btn:hover:not(:disabled) { background: var(--ui-bs-hover); }
.ui-bs__btn:active:not(:disabled) { transform: scale(0.98); }
.ui-bs__btn:disabled { opacity: 0.45; cursor: default; }
.ui-bs__btn svg { color: var(--ui-bs-text); }
.ui-bs__select-label { display: inline-flex; align-items: center; gap: 8px; }

/* Totals */
.ui-bs__totals { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px 10px 6px; font-size: 13px; color: var(--ui-bs-muted); }
.ui-bs__totals b { margin-left: 4px; white-space: nowrap; font-weight: 600; color: var(--ui-bs-ink); font-variant-numeric: tabular-nums; }
.ui-bs__totals em { margin-left: 6px; font-style: normal; font-size: 12px; color: var(--ui-bs-grad-text); }

@keyframes ui-bs-fade { from { opacity: 0; } }
@keyframes ui-bs-row { from { opacity: 0; transform: translateY(-4px); } }
@keyframes ui-bs-menu { from { opacity: 0; transform: scale(0.97) translateY(-4px); } }

@media (max-width: 520px) {
  .ui-bs__fields { grid-template-columns: 1fr; }
  .ui-bs__summary { flex-wrap: wrap; row-gap: 2px; }
  /* Each line stacks: name on top, price and timing below */
  .ui-bs__row { grid-template-columns: minmax(0, 1fr); gap: 2px; padding: 10px 4px 10px 6px; }
  .ui-bs__row > :nth-child(2) { display: none; }
  .ui-bs__row--head { display: none; }
  .ui-bs__price { justify-items: stretch; }
  .ui-bs__price-main { justify-content: flex-start; }
  .ui-bs__timing { justify-self: start; margin: 0 0 0 -4px !important; }
  .ui-bs__remove { opacity: 1; margin-left: auto !important; }
  .ui-bs__actions { flex-wrap: wrap; }
  .ui-bs__spacer { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-bs__rows-outer[data-smooth] { transition: none; }
  .ui-bs__row, .ui-bs__menu, .ui-bs__end { animation: none; }
}


/* Text fields: no focus box while typing – also against global :focus-visible rules of the host page */
.ui-bs input:not([type="checkbox"]):not([type="radio"]):focus-visible,
.ui-bs textarea:focus-visible,
.ui-bs [contenteditable]:focus-visible { outline: none; }
/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-bs {
  --ui-bs-tray: #161618;
  --ui-bs-card: #232326;
  --ui-bs-card-line: rgba(255, 255, 255, 0.08);
  --ui-bs-line: rgba(255, 255, 255, 0.07);
  --ui-bs-inset: #1c1c1f;
  --ui-bs-ink: #ededed;
  --ui-bs-text: #c4c4c4;
  --ui-bs-muted: #8f8f8f;
  --ui-bs-hover: rgba(255, 255, 255, 0.05);
  --ui-bs-grad-a: #2a3a6b;
  --ui-bs-grad-b: #3a2d66;
  --ui-bs-grad-c: #4a2240;
  --ui-bs-grad-text: #c9d6ff;
  --ui-bs-focus: #6b95ff;
  --ui-bs-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}
:where(.dark, [data-theme="dark"]) .ui-bs__input input { color-scheme: dark; }
`;
