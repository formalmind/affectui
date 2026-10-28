"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

/*
 * Date Range Picker – pick a period from presets or two calendars, in a single self-contained file.
 * Presets on the left ("Last 7 days", "This month" …), two months on the right: click a start, hover to preview,
 * click an end. Optionally compare with the previous period or the previous year – shown as a second band.
 * Arrow keys move day by day, PageUp/PageDown month by month, Enter picks, Esc closes.
 * On narrow screens the presets become a row of chips and one month is shown.
 * The styles are injected below, so no extra files are needed.
 */

export type DateRange = { start: Date; end: Date };
export type CompareMode = "off" | "previous" | "year";

export type RangePreset = {
  id: string;
  label: string;
  /** Builds the range from today */
  range: (today: Date) => DateRange;
};

export type DateRangePickerProps = {
  /** Controlled range */
  value?: DateRange;
  /** Starting range when uncontrolled – defaults to the last 30 days */
  defaultValue?: DateRange;
  /** Called on Apply with the range and the comparison range (if any) */
  onChange?: (range: DateRange, compare: DateRange | null, mode: CompareMode) => void;
  presets?: RangePreset[];
  /** Show the "Compare to" control */
  compare?: boolean;
  defaultCompare?: CompareMode;
  /** 0 = Sunday, 1 = Monday */
  weekStartsOn?: 0 | 1;
  /** Days after this can't be picked – defaults to today */
  max?: Date;
  min?: Date;
  /** Open the panel right away – nice for previews */
  defaultOpen?: boolean;
  /** "Today" for the presets – defaults to the real today */
  today?: Date;
  className?: string;
};

/* ---------- Dates (local days, no library) ---------- */

const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const same = (a?: Date | null, b?: Date | null) => !!a && !!b && a.getTime() === b.getTime();
const utc = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
/** Days from a to b, counting both */
const span = (a: Date, b: Date) => Math.round((utc(b) - utc(a)) / 864e5) + 1;
const clamp = (d: Date, min?: Date, max?: Date) => (min && d < min ? min : max && d > max ? max : d);
const order = (a: Date, b: Date): DateRange => (a <= b ? { start: a, end: b } : { start: b, end: a });
const valid = (d?: Date | null): d is Date => d instanceof Date && !Number.isNaN(d.getTime());
/** Both ends real days, the start first – or the fallback */
const sane = (r: DateRange | null | undefined, fallback: DateRange): DateRange =>
  r && valid(r.start) && valid(r.end) ? order(day(r.start), day(r.end)) : fallback;
const count = new Intl.NumberFormat("en-US");

const fmtDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const fmtDayYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtMonth = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const fmtLong = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

/** "Sep 9 – Oct 8, 2026", "Dec 20, 2025 – Jan 5, 2026", "Oct 8, 2026" */
export function formatRange({ start, end }: DateRange) {
  if (!valid(start) || !valid(end)) return "–";
  if (same(start, end)) return fmtDayYear.format(start);
  const sameYear = start.getFullYear() === end.getFullYear();
  return `${(sameYear ? fmtDay : fmtDayYear).format(start)} – ${fmtDayYear.format(end)}`;
}

export function compareRange(range: DateRange, mode: CompareMode): DateRange | null {
  if (mode === "previous") {
    const length = span(range.start, range.end);
    return { start: addDays(range.start, -length), end: addDays(range.start, -1) };
  }
  if (mode === "year") {
    // Feb 29 goes back to Feb 28, not Mar 1
    const back = (d: Date) => new Date(d.getFullYear() - 1, d.getMonth(), Math.min(d.getDate(), endOfMonth(new Date(d.getFullYear() - 1, d.getMonth(), 1)).getDate()));
    return { start: back(range.start), end: back(range.end) };
  }
  return null;
}

const quarterStart = (d: Date) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);

export const defaultPresets: RangePreset[] = [
  { id: "today", label: "Today", range: (t) => ({ start: t, end: t }) },
  { id: "yesterday", label: "Yesterday", range: (t) => ({ start: addDays(t, -1), end: addDays(t, -1) }) },
  { id: "7d", label: "Last 7 days", range: (t) => ({ start: addDays(t, -6), end: t }) },
  { id: "30d", label: "Last 30 days", range: (t) => ({ start: addDays(t, -29), end: t }) },
  { id: "90d", label: "Last 90 days", range: (t) => ({ start: addDays(t, -89), end: t }) },
  { id: "month", label: "This month", range: (t) => ({ start: startOfMonth(t), end: t }) },
  { id: "last-month", label: "Last month", range: (t) => ({ start: addMonths(t, -1), end: endOfMonth(addMonths(t, -1)) }) },
  { id: "quarter", label: "This quarter", range: (t) => ({ start: quarterStart(t), end: t }) },
  { id: "ytd", label: "Year to date", range: (t) => ({ start: new Date(t.getFullYear(), 0, 1), end: t }) },
];

const COMPARE: { id: CompareMode; label: string }[] = [
  { id: "off", label: "Off" },
  { id: "previous", label: "Previous period" },
  { id: "year", label: "Previous year" },
];

/* ---------- Icons ---------- */

const Glyph = ({ d, className }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={["ui-drp__glyph", className].filter(Boolean).join(" ")} aria-hidden="true">
    <path d={d} />
  </svg>
);
const icons = {
  calendar: "M7 3v3M17 3v3M4.5 9.5h15M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
  chevron: "M8 10l4 4 4-4",
  left: "M14.5 6l-6 6 6 6",
  right: "M9.5 6l6 6-6 6",
  arrow: "M5 12h14M13 6l6 6-6 6",
};

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

/* ---------- Month grid ---------- */

/** The weeks of a month, each 7 days or null for days of the neighbouring months */
function weeks(month: Date, weekStartsOn: number) {
  const first = startOfMonth(month);
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const days = endOfMonth(month).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  while (cells.length % 7) cells.push(null);
  const out: (Date | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
  return out;
}

export function DateRangePicker({
  value,
  defaultValue,
  onChange,
  presets = defaultPresets,
  compare = true,
  defaultCompare = "previous",
  weekStartsOn = 1,
  max,
  min,
  defaultOpen = false,
  today: todayProp,
  className,
}: DateRangePickerProps) {
  // Invalid dates, an unknown week start or compare mode fall back instead of crashing
  const wso = weekStartsOn === 0 ? 0 : 1;
  const today = useMemo(() => day(valid(todayProp) ? todayProp : new Date()), [todayProp?.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const maxDay = valid(max) ? day(max) : today;
  const minDay = valid(min) && day(min) <= maxDay ? day(min) : undefined;

  const [own, setOwn] = useState<DateRange>(() => {
    // The last 30 days – kept inside min / max
    const end = clamp(today, minDay, maxDay);
    return sane(defaultValue, { start: clamp(addDays(end, -29), minDay, maxDay), end });
  });
  const applied = value ? sane(value, own) : own;
  const [appliedMode, setAppliedMode] = useState<CompareMode>(compare && COMPARE.some((c) => c.id === defaultCompare) ? defaultCompare : "off");
  const appliedCompare = compare && appliedMode !== "off" ? compareRange(applied, appliedMode) : null;

  const [open, setOpen] = useState(defaultOpen);
  // The draft while the panel is open: end is null between the first and second click
  const [draft, setDraft] = useState<{ start: Date; end: Date | null }>(applied);
  const [hover, setHover] = useState<Date | null>(null);
  const [mode, setMode] = useState<CompareMode>(appliedMode);
  const [month, setMonth] = useState(() => addMonths(applied.end, -1)); // left month
  const [dir, setDir] = useState<1 | -1>(1);
  const [focus, setFocus] = useState<Date>(() => clamp(applied.end, minDay, maxDay));

  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const keyboard = useRef(false);
  const uid = useId();
  const panelInner = useRef<HTMLDivElement>(null);
  const triggerInner = useRef<HTMLSpanElement>(null);
  const presetList = useRef<HTMLDivElement>(null);
  const presetPill = useRef<HTMLSpanElement>(null);
  const segmentList = useRef<HTMLDivElement>(null);
  const segmentPill = useRef<HTMLSpanElement>(null);
  const lastCompare = useRef<DateRange | null>(null);

  // Reset the draft whenever the panel opens
  const openPanel = () => {
    setDraft(applied);
    setMode(appliedMode);
    setMonth(addMonths(applied.end, -1));
    setFocus(clamp(applied.end, minDay, maxDay));
    setHover(null);
    setOpen(true);
  };
  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };

  // Click outside and Esc close the panel
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  // Keyboard focus follows the focused day
  useLayoutEffect(() => {
    if (!open || !keyboard.current) return;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focus.getTime()}"]`)?.focus();
  }, [focus, month, open]);

  const range: DateRange | null = draft.end ? order(draft.start, draft.end) : hover ? order(draft.start, hover) : null;
  const shown = range ?? { start: draft.start, end: draft.start };
  const cmp = compare && range ? compareRange(range, mode) : null;
  const presetAt = draft.end ? presets.findIndex((p) => {
    const r = p.range(today);
    return valid(r?.start) && valid(r?.end) && same(day(r.start), shown.start) && same(day(r.end), shown.end);
  }) : -1;
  const preset = presets[presetAt];

  const pick = (d: Date) => {
    if (draft.end) setDraft({ start: d, end: null });
    else {
      const r = order(draft.start, d);
      setDraft(r);
    }
    setHover(null);
    setFocus(d);
  };
  const choosePreset = (p: RangePreset) => {
    const r = p.range(today);
    if (!valid(r?.start) || !valid(r?.end)) return;
    const next = { start: clamp(day(r.start), minDay, maxDay), end: clamp(day(r.end), minDay, maxDay) };
    setDraft(next);
    setHover(null);
    setFocus(next.end);
    const left = addMonths(next.end, -1);
    if (left.getTime() !== month.getTime()) {
      setDir(left > month ? 1 : -1);
      setMonth(left);
    }
  };
  const shift = (n: number) => {
    setDir(n > 0 ? 1 : -1);
    setMonth((m) => addMonths(m, n));
  };
  const apply = () => {
    const r = draft.end ? order(draft.start, draft.end) : { start: draft.start, end: draft.start };
    if (!value) setOwn(r);
    setAppliedMode(mode);
    onChange?.(r, compare ? compareRange(r, mode) : null, mode);
    close();
  };

  const disabled = (d: Date) => d > maxDay || (!!minDay && d < minDay);

  const onGridKey = (e: KeyboardEvent) => {
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next: Date | null = null;
    if (e.key in moves) next = addDays(focus, moves[e.key]);
    else if (e.key === "PageUp") next = new Date(focus.getFullYear(), focus.getMonth() - 1, Math.min(focus.getDate(), 28));
    else if (e.key === "PageDown") next = new Date(focus.getFullYear(), focus.getMonth() + 1, Math.min(focus.getDate(), 28));
    else if (e.key === "Home") next = addDays(focus, -((focus.getDay() - wso + 7) % 7));
    else if (e.key === "End") next = addDays(focus, 6 - ((focus.getDay() - wso + 7) % 7));
    if (!next) return;
    e.preventDefault();
    keyboard.current = true;
    next = clamp(next, minDay, maxDay);
    setFocus(next);
    if (!draft.end) setHover(next);
    // Keep the focused day on screen
    const right = endOfMonth(addMonths(month, 1));
    if (next < month) shift(-1);
    else if (next > right) shift(1);
  };

  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(2026, 0, 4 + wso + i)).slice(0, 2),
  );
  const months = [month, addMonths(month, 1)];
  const rows = Math.max(...months.map((m) => weeks(m, wso).length));
  const length = span(shown.start, shown.end);

  const inRange = (d: Date, r: DateRange | null) => !!r && d >= r.start && d <= r.end;
  if (cmp) lastCompare.current = cmp;

  // The gray highlight glides to the active preset and the active compare option
  useLayoutEffect(() => {
    glide(presetList.current, presetPill.current, '[aria-selected="true"], [data-active]');
    glide(segmentList.current, segmentPill.current, '[aria-checked="true"]');
  });

  // Phones: the row of preset chips scrolls the active one into view (at once when opening, smoothly afterwards)
  const scrolled = useRef(false);
  useEffect(() => {
    if (!open) {
      scrolled.current = false;
      return;
    }
    const list = presetList.current;
    const active = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !active || list.scrollWidth <= list.clientWidth) return;
    const left = Math.max(0, active.offsetLeft - (list.clientWidth - active.offsetWidth) / 2);
    list.scrollTo({ left, behavior: scrolled.current ? "smooth" : "auto" });
    scrolled.current = true;
  }, [open, presetAt]);

  // The panel stays on screen: near the right edge it opens leftwards
  useLayoutEffect(() => {
    const el = root.current?.querySelector<HTMLElement>('[role="dialog"]');
    if (!open || !el) return;
    el.style.left = "";
    const r = el.getBoundingClientRect();
    const over = r.right - (document.documentElement.clientWidth - 8);
    if (over > 0) el.style.left = `${-Math.max(0, Math.min(over, r.left - 8))}px`;
  }, [open]);

  // The panel glides to its new height (5 or 6 weeks, the compare line) instead of jumping
  useLayoutEffect(() => {
    const box = panel.current;
    const inner = panelInner.current;
    if (!open || !box || !inner) return;
    const set = () => (box.style.height = `${inner.offsetHeight + 8}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [open]);

  // The trigger glides to the width of its new text
  useLayoutEffect(() => {
    const box = trigger.current;
    const inner = triggerInner.current;
    if (!box || !inner) return;
    const set = () => (box.style.width = `${inner.offsetWidth + 20}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={root} className={["ui-drp", className].filter(Boolean).join(" ")} data-open={open || undefined}>
      {/* React 19 hoists this into <head> once, no matter how many pickers render */}
      <style href="ui-date-range-picker" precedence="default">
        {css}
      </style>

      <button
        ref={trigger}
        type="button"
        className="ui-drp__trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${uid}-panel`}
        onClick={() => (open ? close() : openPanel())}
      >
        <span ref={triggerInner} className="ui-drp__trigger-inner">
          <Glyph d={icons.calendar} />
          <span className="ui-drp__trigger-text" key={`${formatRange(applied)}-${appliedMode}`}>
            <span className="ui-drp__trigger-range">{formatRange(applied)}</span>
            {appliedCompare && <span className="ui-drp__trigger-compare">vs. {formatRange(appliedCompare)}</span>}
          </span>
          <Glyph d={icons.chevron} className="ui-drp__chevron" />
        </span>
      </button>

      {open && (
        <div
          ref={panel}
          id={`${uid}-panel`}
          role="dialog"
          aria-label="Choose a date range"
          className="ui-drp__panel"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          <div ref={panelInner} className="ui-drp__panel-inner">
          <div className="ui-drp__body">
            <div ref={presetList} className="ui-drp__presets" role="listbox" aria-label="Presets">
              <span ref={presetPill} className="ui-drp__pill" aria-hidden="true" />
              {presets.map((p, i) => (
                <button
                  key={`${p.id}-${i}`}
                  type="button"
                  role="option"
                  title={p.label}
                  dir="auto"
                  aria-selected={presetAt === i}
                  className="ui-drp__preset"
                  onClick={() => choosePreset(p)}
                >
                  <span className="ui-drp__preset-label">{p.label}</span>
                </button>
              ))}
              <span className="ui-drp__preset ui-drp__preset-custom" aria-hidden={!!preset} data-active={!preset || undefined}>
                Custom
              </span>
            </div>

            <div className="ui-drp__cal">
              <div className="ui-drp__nav">
                <button type="button" className="ui-drp__icon-btn" aria-label="Previous month" onClick={() => shift(-1)}>
                  <Glyph d={icons.left} />
                </button>
                <button type="button" className="ui-drp__icon-btn" aria-label="Next month" onClick={() => shift(1)}>
                  <Glyph d={icons.right} />
                </button>
              </div>

              <div
                ref={grid}
                className="ui-drp__months"
                key={month.getTime()}
                data-dir={dir}
                onKeyDown={onGridKey}
                onPointerLeave={() => !draft.end && setHover(null)}
                onPointerDown={() => (keyboard.current = false)}
              >
                {months.map((m, mi) => (
                  <div key={m.getTime()} className="ui-drp__month" data-second={mi === 1 || undefined}>
                    <div className="ui-drp__month-name" aria-live={mi === 0 ? "polite" : undefined}>
                      {fmtMonth.format(m)}
                    </div>
                    <div role="grid" aria-label={fmtMonth.format(m)} className="ui-drp__grid">
                      <div role="row" className="ui-drp__weekdays">
                        {weekdays.map((w) => (
                          <span key={w} role="columnheader" className="ui-drp__weekday">
                            {w}
                          </span>
                        ))}
                      </div>
                      {Array.from({ length: rows }, (_, ri) => weeks(m, wso)[ri] ?? Array(7).fill(null)).map((week, wi) => (
                        <div role="row" key={wi} className="ui-drp__week">
                          {week.map((d, di) => {
                            if (!d) return <span key={di} className="ui-drp__day ui-drp__day-empty" role="gridcell" />;
                            const isStart = same(d, shown.start);
                            const isEnd = same(d, shown.end);
                            const inMain = inRange(d, range);
                            const inCmp = !inMain && inRange(d, cmp);
                            const off = disabled(d);
                            return (
                              <span
                                key={di}
                                role="gridcell"
                                aria-selected={inMain || isStart || undefined}
                                className="ui-drp__day"
                                data-range={inMain || undefined}
                                data-start={isStart || undefined}
                                data-end={isEnd || undefined}
                                data-preview={!draft.end && inMain || undefined}
                                data-compare={inCmp || undefined}
                                data-compare-start={cmp && same(d, cmp.start) || undefined}
                                data-compare-end={cmp && same(d, cmp.end) || undefined}
                                data-row-start={di === 0 || d.getDate() === 1 || undefined}
                                data-row-end={di === 6 || same(d, endOfMonth(d)) || undefined}
                              >
                                <button
                                  type="button"
                                  data-day={d.getTime()}
                                  tabIndex={same(d, focus) ? 0 : -1}
                                  disabled={off}
                                  aria-label={fmtLong.format(d)}
                                  aria-current={same(d, today) ? "date" : undefined}
                                  onClick={() => pick(d)}
                                  onPointerEnter={() => !draft.end && setHover(d)}
                                  onFocus={() => setFocus(d)}
                                >
                                  {d.getDate()}
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="ui-drp__foot">
            <div className="ui-drp__summary">
              <div className="ui-drp__summary-range">
                <span key={`${shown.start.getTime()}-${shown.end.getTime()}`}>
                  {draft.end || hover ? formatRange(shown) : `${fmtDayYear.format(draft.start)} – pick an end`}
                </span>
                <span className="ui-drp__count" key={length}>
                  {count.format(length)} {length === 1 ? "day" : "days"}
                </span>
              </div>
              {compare && (
                <div className="ui-drp__compare">
                  <span className="ui-drp__compare-label">Compare</span>
                  <div ref={segmentList} className="ui-drp__segments" role="radiogroup" aria-label="Compare to">
                    <span ref={segmentPill} className="ui-drp__pill" aria-hidden="true" />
                    {COMPARE.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        role="radio"
                        aria-checked={mode === c.id}
                        className="ui-drp__segment"
                        onClick={() => setMode(c.id)}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* Folds open and closed; keeps the last text while folding away */}
              {compare && (
                <div className="ui-drp__fold" data-open={!!cmp || undefined}>
                  <div>
                    {lastCompare.current && (
                      <div className="ui-drp__compare-range" key={`${lastCompare.current.start.getTime()}-${lastCompare.current.end.getTime()}`}>
                        vs. {formatRange(lastCompare.current)}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <div className="ui-drp__buttons">
              <button type="button" className="ui-drp__btn" onClick={() => close()}>
                Cancel
              </button>
              <button type="button" className="ui-drp__btn ui-drp__btn-primary" disabled={!draft.end} onClick={apply}>
                Apply
              </button>
            </div>
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-drp */
.ui-drp {
  --ui-drp-tray: #f0f0f0;
  --ui-drp-card: #ffffff;
  --ui-drp-line: #ececec;
  --ui-drp-ink: #171717;
  --ui-drp-text: #404040;
  --ui-drp-muted: #8f8f8f;
  --ui-drp-faint: #c4c4c7;
  --ui-drp-hover: #f2f2f3;
  --ui-drp-active: #ebebed;
  --ui-drp-band: rgba(47, 107, 255, 0.1);
  --ui-drp-band-preview: rgba(47, 107, 255, 0.06);
  --ui-drp-accent: #2f6bff;
  --ui-drp-on-accent: #ffffff;
  --ui-drp-compare: #ececee;
  --ui-drp-compare-edge: #b9b9be;
  --ui-drp-focus: rgba(23, 23, 23, 0.22);
  --ui-drp-shadow: 0 0 0 1px rgba(0, 0, 0, 0.06), 0 18px 40px -12px rgba(0, 0, 0, 0.18), 0 4px 12px -4px rgba(0, 0, 0, 0.06);
  --ui-drp-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  display: inline-block;
  max-width: 100%;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 1.4;
  color: var(--ui-drp-text);
  -webkit-font-smoothing: antialiased;
}
.ui-drp *, .ui-drp *::before, .ui-drp *::after { box-sizing: border-box; }
:where(.ui-drp) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; }
:where(.ui-drp) svg { display: block; flex: none; }
.ui-drp button:focus-visible { outline: 2px solid var(--ui-drp-focus); outline-offset: 2px; }
.ui-drp__glyph { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

/* The trigger */
.ui-drp__trigger {
  display: inline-flex;
  align-items: center;
  overflow: hidden;
  max-width: 100%;
  min-height: 38px;
  padding: 5px 9px 5px 11px;
  border-radius: 11px;
  background: var(--ui-drp-card);
  box-shadow: 0 0 0 1px var(--ui-drp-line), 0 1px 2px rgba(0, 0, 0, 0.04);
  text-align: left;
  transition: box-shadow 160ms ease, width 320ms var(--ui-drp-ease);
}
.ui-drp__trigger-inner { display: inline-flex; flex: none; align-items: center; gap: 10px; max-width: calc(100vw - 56px); }
.ui-drp__trigger:hover { box-shadow: 0 0 0 1px var(--ui-drp-faint), 0 1px 2px rgba(0, 0, 0, 0.04); }
.ui-drp__trigger > .ui-drp__glyph { color: var(--ui-drp-muted); }
.ui-drp__trigger-text { display: grid; min-width: 0; animation: ui-drp-in 280ms var(--ui-drp-ease) both; }
.ui-drp__trigger-range { overflow: hidden; color: var(--ui-drp-ink); font-weight: 500; white-space: nowrap; text-overflow: ellipsis; }
.ui-drp__trigger-compare { overflow: hidden; font-size: 12px; color: var(--ui-drp-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-drp__chevron { color: var(--ui-drp-muted); transition: transform 260ms var(--ui-drp-ease); }
.ui-drp[data-open] .ui-drp__chevron { transform: rotate(180deg); }

/* The panel: a gray tray around a white card, like the other affectUI menus */
.ui-drp__panel {
  position: absolute;
  z-index: 30;
  top: calc(100% + 8px);
  left: 0;
  container-type: inline-size;
  /* A fixed width (not max-content), so the container queries below can measure it; override --ui-drp-panel-width to fit your layout */
  width: var(--ui-drp-panel-width, min(652px, calc(100vw - 32px)));
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-drp-tray);
  box-shadow: var(--ui-drp-shadow);
  overflow: hidden;
  transform-origin: top left;
  transition: height 320ms var(--ui-drp-ease);
  animation: ui-drp-open 260ms var(--ui-drp-ease) both;
}
/* The pill behind the active preset and compare option */
.ui-drp__pill {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 0;
  border-radius: 8px;
  background: var(--ui-drp-active);
  opacity: 0;
  pointer-events: none;
  transition: transform 320ms var(--ui-drp-ease), width 320ms var(--ui-drp-ease), height 320ms var(--ui-drp-ease), opacity 200ms ease;
}
.ui-drp__body {
  display: grid;
  grid-template-columns: 136px 1fr;
  border-radius: 16px;
  background: var(--ui-drp-card);
  box-shadow: 0 0 0 1px var(--ui-drp-line);
}

/* Presets */
.ui-drp__presets { position: relative; display: flex; flex-direction: column; gap: 1px; padding: 6px; border-right: 1px solid var(--ui-drp-line); }
.ui-drp__preset {
  display: flex;
  align-items: center;
  height: 30px;
  padding: 0 10px;
  border-radius: 8px;
  text-align: left;
  white-space: nowrap;
  color: var(--ui-drp-text);
  position: relative;
  z-index: 1;
  transition: background-color 140ms ease, color 200ms ease;
}
/* A long label shortens inside its row – the full text is the tooltip */
.ui-drp__preset { max-width: 100%; min-width: 0; }
.ui-drp__preset-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
button.ui-drp__preset:hover:not([aria-selected="true"]) { background: var(--ui-drp-hover); color: var(--ui-drp-ink); }
.ui-drp__preset[aria-selected="true"], .ui-drp__preset-custom[data-active] { color: var(--ui-drp-ink); }
.ui-drp__preset-custom { margin-top: auto; color: var(--ui-drp-muted); cursor: default; }

/* Calendars */
.ui-drp__cal { position: relative; padding: 12px 14px 10px; overflow: hidden; }
.ui-drp__nav { position: absolute; top: 8px; left: 10px; right: 10px; z-index: 1; display: flex; justify-content: space-between; pointer-events: none; }
.ui-drp__nav > * { pointer-events: auto; }
.ui-drp__icon-btn { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; color: var(--ui-drp-muted); transition: background-color 140ms ease, color 140ms ease; }
.ui-drp__icon-btn:hover { background: var(--ui-drp-hover); color: var(--ui-drp-ink); }
.ui-drp__months { display: grid; grid-template-columns: repeat(2, auto); justify-content: center; gap: 24px; animation: ui-drp-slide 320ms var(--ui-drp-ease) both; }
.ui-drp__months[data-dir="-1"] { animation-name: ui-drp-slide-back; }
.ui-drp__month-name { height: 22px; margin-bottom: 6px; font-weight: 600; text-align: center; color: var(--ui-drp-ink); }
.ui-drp__grid { display: grid; gap: 2px; }
.ui-drp__weekdays, .ui-drp__week { display: grid; grid-template-columns: repeat(7, 32px); }
.ui-drp__weekday { height: 26px; font-size: 11px; font-weight: 500; line-height: 26px; text-align: center; color: var(--ui-drp-muted); }

/* A day: the band sits behind the number and runs on into its neighbours */
.ui-drp__day { position: relative; display: grid; height: 32px; }
.ui-drp__day::before { content: ""; position: absolute; inset: 2px 0; transition: background-color 220ms ease, border-radius 220ms var(--ui-drp-ease), left 220ms var(--ui-drp-ease), right 220ms var(--ui-drp-ease); }
.ui-drp__day[data-range]::before { background: var(--ui-drp-band); }
.ui-drp__day[data-preview]::before { background: var(--ui-drp-band-preview); }
.ui-drp__day[data-compare]::before { background: var(--ui-drp-compare); }
.ui-drp__day[data-start]::before, .ui-drp__day[data-compare-start]::before, .ui-drp__day[data-row-start]::before { left: 2px; border-top-left-radius: 9px; border-bottom-left-radius: 9px; }
.ui-drp__day[data-end]::before, .ui-drp__day[data-compare-end]::before, .ui-drp__day[data-row-end]::before { right: 2px; border-top-right-radius: 9px; border-bottom-right-radius: 9px; }
.ui-drp__day button {
  position: relative;
  border-radius: 9px;
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
  color: var(--ui-drp-ink);
  transition: background-color 200ms ease, color 200ms ease, box-shadow 200ms ease, transform 160ms var(--ui-drp-ease);
}
.ui-drp__day button:hover:not(:disabled) { background: var(--ui-drp-hover); }
.ui-drp__day[data-range] button:hover:not(:disabled) { background: transparent; box-shadow: inset 0 0 0 1px var(--ui-drp-accent); }
.ui-drp__day button:active:not(:disabled) { transform: scale(0.94); }
.ui-drp__day button:disabled { color: var(--ui-drp-faint); cursor: default; }
.ui-drp__day button[aria-current="date"]::after { content: ""; position: absolute; left: 50%; bottom: 4px; width: 3px; height: 3px; margin-left: -1.5px; border-radius: 50%; background: currentColor; opacity: 0.55; }
.ui-drp__day[data-start] button, .ui-drp__day[data-end] button { background: var(--ui-drp-accent) !important; color: var(--ui-drp-on-accent); font-weight: 600; box-shadow: none !important; animation: ui-drp-pick 380ms cubic-bezier(0.34, 1.56, 0.64, 1); }
/* While previewing, the end follows the pointer – no pop on every move */
.ui-drp__day[data-preview][data-end] button { animation: none; }
.ui-drp__day[data-compare-start] button, .ui-drp__day[data-compare-end] button { box-shadow: inset 0 0 0 1px var(--ui-drp-compare-edge); }
.ui-drp__day-empty::before { display: none; }

/* Footer */
.ui-drp__foot { display: flex; align-items: flex-end; justify-content: space-between; gap: 14px; padding: 10px 10px 6px 10px; }
.ui-drp__summary { display: grid; gap: 6px; min-width: 0; }
.ui-drp__summary-range { display: flex; align-items: baseline; gap: 8px; color: var(--ui-drp-ink); font-weight: 500; }
.ui-drp__summary-range > span:first-child { animation: ui-drp-in 280ms var(--ui-drp-ease) both; }
.ui-drp__count { font-size: 12px; font-weight: 400; font-variant-numeric: tabular-nums; color: var(--ui-drp-muted); animation: ui-drp-in 280ms var(--ui-drp-ease) both; }
.ui-drp__compare { display: flex; align-items: center; gap: 8px; }
.ui-drp__compare-label { font-size: 12px; color: var(--ui-drp-muted); }
.ui-drp__segments { position: relative; display: inline-flex; padding: 2px; border-radius: 9px; background: var(--ui-drp-card); box-shadow: 0 0 0 1px var(--ui-drp-line); }
.ui-drp__segment { position: relative; z-index: 1; height: 24px; padding: 0 8px; border-radius: 7px; font-size: 12px; white-space: nowrap; color: var(--ui-drp-muted); transition: color 200ms ease; }
.ui-drp__segment:hover { color: var(--ui-drp-ink); }
.ui-drp__segment[aria-checked="true"] { color: var(--ui-drp-ink); }
.ui-drp__segments .ui-drp__pill { border-radius: 7px; }
.ui-drp__fold { display: grid; grid-template-rows: 0fr; opacity: 0; margin-top: -6px; transition: grid-template-rows 300ms var(--ui-drp-ease), opacity 200ms ease, margin-top 300ms var(--ui-drp-ease); }
.ui-drp__fold[data-open] { grid-template-rows: 1fr; opacity: 1; margin-top: 0; }
.ui-drp__fold > div { min-height: 0; overflow: hidden; }
.ui-drp__compare-range { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ui-drp-muted); animation: ui-drp-in 220ms var(--ui-drp-ease) both; }
.ui-drp__compare-range::before { content: ""; width: 14px; height: 8px; border-radius: 3px; background: var(--ui-drp-compare); box-shadow: inset 0 0 0 1px var(--ui-drp-compare-edge); }
.ui-drp__buttons { display: flex; flex: none; gap: 6px; }
.ui-drp__btn { height: 32px; padding: 0 13px; border-radius: 9px; font-weight: 500; color: var(--ui-drp-text); transition: background-color 140ms ease, opacity 140ms ease, transform 140ms ease; }
.ui-drp__btn:not(.ui-drp__btn-primary):hover { background: var(--ui-drp-active); }
.ui-drp__btn-primary { background: var(--ui-drp-ink); color: var(--ui-drp-card); }
.ui-drp__btn-primary:hover { opacity: 0.88; }
.ui-drp__btn-primary:active { transform: scale(0.97); }
.ui-drp__btn-primary:disabled { opacity: 0.35; cursor: default; }

@keyframes ui-drp-open { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes ui-drp-slide { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
@keyframes ui-drp-slide-back { from { opacity: 0; transform: translateX(-14px); } to { opacity: 1; transform: none; } }
@keyframes ui-drp-in { from { opacity: 0; transform: translateY(4px); filter: blur(2px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes ui-drp-pick { 0% { transform: scale(0.82); } 60% { transform: scale(1.06); } 100% { transform: scale(1); } }

/* Narrow panel (phones): presets as a scrolling row of chips, one month, stacked footer */
@container (max-width: 600px) {
  .ui-drp__body { grid-template-columns: 1fr; }
  .ui-drp__presets {
    flex-direction: row;
    gap: 6px;
    padding: 10px;
    overflow-x: auto;
    border-right: 0;
    border-bottom: 1px solid var(--ui-drp-line);
    scrollbar-width: none;
  }
  .ui-drp__presets::-webkit-scrollbar { display: none; }
  .ui-drp__preset { flex: none; height: 32px; padding: 0 12px; border-radius: 999px; box-shadow: inset 0 0 0 1px var(--ui-drp-line); }
  .ui-drp__presets .ui-drp__pill { border-radius: 999px; }
  .ui-drp__preset-custom { display: none; }
  .ui-drp__months { grid-template-columns: 1fr; justify-items: center; }
  /* One month: the one the range ends in */
  .ui-drp__month:not([data-second]) { display: none; }
  .ui-drp__foot { flex-direction: column; align-items: stretch; }
  .ui-drp__buttons { justify-content: flex-end; }
  .ui-drp__compare { flex-wrap: wrap; }
}
@container (max-width: 340px) {
  .ui-drp__weekdays, .ui-drp__week { grid-template-columns: repeat(7, 1fr); }
  .ui-drp__cal { padding: 14px 8px 10px; }
  .ui-drp__months { justify-items: stretch; }
}
/* Touch screens: bigger targets */
@media (hover: none) and (pointer: coarse) {
  .ui-drp__day { height: 38px; }
  .ui-drp__weekdays, .ui-drp__week { grid-template-columns: repeat(7, minmax(0, 38px)); }
  .ui-drp__icon-btn { width: 38px; height: 38px; }
  .ui-drp__btn { height: 38px; }
  .ui-drp__segment { height: 30px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-drp *, .ui-drp *::before, .ui-drp *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-drp {
  --ui-drp-tray: #111113;
  --ui-drp-card: #19191b;
  --ui-drp-line: #2a2a2e;
  --ui-drp-ink: #ededed;
  --ui-drp-text: #c8c8cc;
  --ui-drp-muted: #8b8b92;
  --ui-drp-faint: #4a4a50;
  --ui-drp-hover: #232326;
  --ui-drp-active: #2a2a2e;
  --ui-drp-band: rgba(109, 139, 255, 0.18);
  --ui-drp-band-preview: rgba(109, 139, 255, 0.1);
  --ui-drp-accent: #6d8bff;
  --ui-drp-on-accent: #0d0d10;
  --ui-drp-compare: #26262a;
  --ui-drp-compare-edge: #4a4a50;
  --ui-drp-focus: rgba(255, 255, 255, 0.3);
  --ui-drp-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06), 0 18px 40px -12px rgba(0, 0, 0, 0.6);
}
`;
