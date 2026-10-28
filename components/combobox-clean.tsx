"use client";

import {
  memo,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

/*
 * Combobox (Clean) – pick one or many options from a searchable list, in a single self-contained file.
 * Clean style: no tray – a white field with a hairline shadow, gray tab-like chips, one white popover with a blue check.
 * Picked options sit in the field as chips (with an avatar, a color dot or an icon) and can be removed with ×;
 * Backspace in the empty field first highlights the last chip, a second Backspace removes it.
 * The list below is grouped, highlights what you typed, marks picked rows with a check and can offer
 * to create what's missing. ↑ ↓ move, ↵ picks, Esc closes, Tab leaves. The field and the list glide to their new heights.
 * The styles are injected below, so no extra files are needed.
 */

export type ComboboxOption = {
  value: string;
  label: string;
  /** Lighter text after the label, e.g. a role or an email */
  hint?: string;
  /** An image URL, or true for initials from the label */
  avatar?: string | boolean;
  /** A small color dot – nice for labels and tags */
  color?: string;
  /** Any icon – wins over avatar and color */
  icon?: ReactNode;
  /** Options with the same group are listed under one title */
  group?: string;
  /** Extra words that should find this option */
  keywords?: string;
};

export type ComboboxProps = {
  options: ComboboxOption[];
  /** Pick many (chips) or one – defaults to many */
  multiple?: boolean;
  /** Controlled values */
  value?: string[];
  /** Starting values when uncontrolled */
  defaultValue?: string[];
  /** Called with the new values and their options */
  onChange?: (value: string[], options: ComboboxOption[]) => void;
  placeholder?: string;
  /** Offer "Create “…”" when nothing matches the typed text exactly */
  creatable?: boolean;
  /** Turn typed text into an option – defaults to { value: text, label: text } */
  onCreate?: (text: string) => ComboboxOption | void;
  /** Text of the create row – defaults to Create “…” */
  createLabel?: (text: string) => string;
  /** At most this many chips – the field always stays one line, chips that don't fit go into "+3" anyway */
  maxVisibleTags?: number;
  /** Visible label above the field */
  label?: string;
  /** Open the list right away – nice for previews */
  defaultOpen?: boolean;
  /** Shown when nothing matches */
  emptyText?: string;
  className?: string;
};

type Chip = { value: string; leaving?: boolean };

const CREATE = "\u0000create";
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/* ---------- Helpers ---------- */

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// First letter or digit of the first and last word – an emoji or a sign never becomes half an initial
const initials = (label: string) => {
  const words = label.trim().split(/\s+/).map((w) => w.match(/[\p{L}\p{N}]/u)?.[0] ?? "").filter(Boolean);
  return ((words[0] ?? "") + (words.length > 1 ? words[words.length - 1] : "")).toUpperCase();
};

const text = (v: unknown) => (v == null ? "" : String(v));
/** Lowercase without accents, so "munchen" finds "München" */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The typed text, marked where it matches */
function Highlight({ text, query }: { text: string; query: string }) {
  const hay = fold(text);
  const needle = fold(query);
  // Marked only where the folded text still lines up with the original, letter for letter
  const i = needle && hay.length === text.length ? hay.indexOf(needle) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + needle.length)}</mark>
      {text.slice(i + needle.length)}
    </>
  );
}

/** Avatar, color dot or icon in front of a chip or a row */
/** Room the text input keeps on the line, in px */
const INPUT_MIN = 72;

function Visual({ option }: { option: ComboboxOption }) {
  // An image that fails to load falls back to the initials
  const [broken, setBroken] = useState(false);
  if (option.icon) return <span className="ui-cbxc__icon">{option.icon}</span>;
  if (typeof option.avatar === "string" && !broken) return <img className="ui-cbxc__avatar" src={option.avatar} alt="" onError={() => setBroken(true)} />;
  if (option.avatar) return <span className="ui-cbxc__avatar" aria-hidden="true">{initials(option.label)}</span>;
  if (option.color) return <span className="ui-cbxc__dot" style={{ background: option.color }} aria-hidden="true" />;
  return null;
}

const Glyph = ({ d, className }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={["ui-cbxc__glyph", className].filter(Boolean).join(" ")} aria-hidden="true">
    <path d={d} />
  </svg>
);
const icons = {
  close: "M7 7l10 10M17 7 7 17",
  check: "M5.5 12.5l4 4L18.5 8",
  chevron: "M8 10l4 4 4-4",
  plus: "M12 6v12M6 12h12",
};

/** A chip in the field: it grows in with a small pop (not on the first render), folds away when removed */
function ChipItem({ animate, leaving, armed, plain, children }: { animate: boolean; leaving?: boolean; armed?: boolean; plain?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLLIElement>(null);
  useLayoutEffect(() => {
    const li = ref.current;
    if (!animate || !li || reducedMotion()) return;
    li.animate([{ gridTemplateColumns: "0fr", marginRight: "0px" }, { gridTemplateColumns: "1fr", marginRight: "4px" }], { duration: 260, easing: EASE });
    li.firstElementChild?.animate(
      [
        { opacity: 0, transform: "scale(0.6)" },
        { opacity: 1, transform: "scale(1.05)", offset: 0.6 },
        { opacity: 1, transform: "none" },
      ],
      { duration: 340, easing: EASE },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <li ref={ref} className="ui-cbxc__chip" data-leaving={leaving || undefined} data-armed={armed || undefined} data-plain={plain || undefined}>
      {children}
    </li>
  );
}

type RowEvents = { hover: (value: string) => void; choose: (option: ComboboxOption) => void };

/** One row of the list – it only renders again when its own state changes, so long lists stay quick */
const Row = memo(function Row({ option: o, id, on, active, query, events }: { option: ComboboxOption; id: string; on: boolean; active: boolean; query: string; events: { current: RowEvents } }) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={on}
      data-active={active || undefined}
      className="ui-cbxc__option"
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={() => events.current.hover(o.value)}
      onClick={() => events.current.choose(o)}
    >
      <Visual option={o} />
      <span className="ui-cbxc__text">
        <span className="ui-cbxc__name" dir="auto" title={o.label}>
          <Highlight text={o.label} query={query} />
        </span>
        {o.hint && (
          <span className="ui-cbxc__hint" dir="auto" title={o.hint}>
            <Highlight text={o.hint} query={query} />
          </span>
        )}
      </span>
      <Glyph d={icons.check} className="ui-cbxc__check" />
    </div>
  );
});

export function Combobox({
  options,
  multiple = true,
  value,
  defaultValue,
  onChange,
  placeholder = "Search…",
  creatable = false,
  onCreate,
  createLabel = (text) => `Create “${text}”`,
  maxVisibleTags,
  label,
  defaultOpen = false,
  emptyText = "No results",
  className,
}: ComboboxProps) {
  const uid = "ui-cbxc" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [own, setOwn] = useState<string[]>(defaultValue ?? []);
  // A value picked twice counts once
  const selected = [...new Set(value ?? own)];
  const picked = new Set(selected);
  const maxTags = typeof maxVisibleTags === "number" && Number.isFinite(maxVisibleTags) ? Math.max(0, maxVisibleTags) : undefined;
  const [created, setCreated] = useState<ComboboxOption[]>([]);
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | null>(null);
  // The highlight shows while the pointer is over the list or the keyboard moves – leaving the list fades it out
  const [lit, setLit] = useState(true);
  const [armed, setArmed] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");

  const root = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const fieldInner = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listInner = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const byKeyboard = useRef(false);

  // Options as they come: a missing label reads as the value, a value listed twice is kept once
  const list = useMemo(() => {
    const seen = new Set<string>();
    const out: ComboboxOption[] = [];
    for (const o of options ?? []) {
      if (!o || o.value == null) continue;
      const v = String(o.value);
      if (seen.has(v)) continue;
      seen.add(v);
      out.push({ ...o, value: v, label: text(o.label) || v, hint: o.hint == null ? undefined : text(o.hint) });
    }
    return out;
  }, [options]);
  const all = useMemo(() => {
    const known = new Set(list.map((o) => o.value));
    return [...list, ...created.filter((c) => !known.has(c.value))];
  }, [list, created]);
  // What the search looks at, folded once per list instead of on every key
  const folded = useMemo(
    () => new Map(all.map((o) => [o.value, { label: fold(o.label), hay: fold(`${o.label} ${o.hint ?? ""} ${text(o.keywords)}`) }])),
    [all],
  );
  const byValue = useMemo(() => new Map(all.map((o) => [o.value, o])), [all]);
  const optionOf = (v: string): ComboboxOption => byValue.get(v) ?? { value: v, label: v };

  /* ---------- Filtering ---------- */

  const q = query.trim();
  const needle = fold(q);
  const groups = useMemo(() => {
    const out: { name: string; options: ComboboxOption[] }[] = [];
    const byName = new Map<string, { name: string; options: ComboboxOption[] }>();
    for (const o of all) {
      if (needle && !folded.get(o.value)!.hay.includes(needle)) continue;
      const name = text(o.group);
      let g = byName.get(name);
      if (!g) {
        g = { name, options: [] };
        byName.set(name, g);
        out.push(g);
      }
      g.options.push(o);
    }
    return out;
  }, [all, folded, needle]);
  const canCreate = creatable && !!q && !all.some((o) => folded.get(o.value)!.label === needle);
  const order = [...groups.flatMap((g) => g.options.map((o) => o.value)), ...(canCreate ? [CREATE] : [])];
  // Positions by value – looked up per row, so a long list doesn't search itself for every row
  const pos = new Map(order.map((v, i) => [v, i]));
  const current = active !== null && pos.has(active) ? active : order[0];
  const optionId = (v: string) => `${uid}-o${pos.get(v)}`;

  /* ---------- Chips: removed ones stay a moment to fold away ---------- */

  const [chips, setChips] = useState<Chip[]>(() => selected.map((v) => ({ value: v })));
  const chipsRef = useRef(chips);
  chipsRef.current = chips;
  const timers = useRef(new Map<string, number>());
  const ready = useRef(false);
  const selectedKey = selected.join("\u0001");

  useEffect(() => {
    const prev = chipsRef.current;
    let changed = false;
    const next: Chip[] = prev.map((c) => {
      const keep = picked.has(c.value);
      if (keep && c.leaving) {
        changed = true;
        window.clearTimeout(timers.current.get(c.value));
        timers.current.delete(c.value);
        return { value: c.value };
      }
      if (!keep && !c.leaving) {
        changed = true;
        // A short flash, then the chip folds away (matches the CSS delays)
        timers.current.set(
          c.value,
          window.setTimeout(() => {
            timers.current.delete(c.value);
            setChips((list) => list.filter((x) => !(x.value === c.value && x.leaving)));
          }, 420),
        );
        return { value: c.value, leaving: true };
      }
      return c;
    });
    for (const v of selected) {
      if (!next.some((c) => c.value === v)) {
        next.push({ value: v });
        changed = true;
      }
    }
    if (changed) setChips(next);
  }, [selectedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    ready.current = true;
    const t = timers.current;
    return () => t.forEach((id) => window.clearTimeout(id));
  }, []);

  // One line only: as many chips as fit next to the input, the rest hide behind "+N".
  // A hidden copy of the chips is measured to know their widths before they are placed.
  const measure = useRef<HTMLUListElement>(null);
  const [fit, setFit] = useState(Infinity);
  const chipKey = chips.filter((c) => !c.leaving).map((c) => c.value).join("|");
  useLayoutEffect(() => {
    const inner = fieldInner.current;
    const list = measure.current;
    if (!inner || !list) return;
    const place = () => {
      const widths = [...list.children].map((el) => (el as HTMLElement).offsetWidth + 4);
      const more = widths.pop() ?? 0; // the last one is a "+99" sample
      const style = getComputedStyle(inner);
      const room = inner.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - INPUT_MIN;
      let used = 0;
      let n = 0;
      for (; n < widths.length; n++) {
        const rest = n + 1 < widths.length ? more : 0;
        if (used + widths[n] + rest > room) break;
        used += widths[n];
      }
      setFit(n);
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [chipKey]);

  // Chips past the line (or past maxVisibleTags) hide behind "+N"; leaving chips keep their spot while they fold
  const max = Math.min(maxTags ?? Infinity, fit);
  let seen = 0;
  const shownChips = chips.filter((c) => (c.leaving ? seen < max : seen++ < max));
  const hidden = Math.max(0, chips.filter((c) => !c.leaving).length - max);
  const lastHidden = useRef(hidden);
  const hiddenDir = useRef<"up" | "down">("up");
  if (hidden !== lastHidden.current && hidden > 0) {
    hiddenDir.current = hidden > lastHidden.current ? "up" : "down";
  }
  if (hidden > 0) lastHidden.current = hidden;
  const shownHidden = hidden || lastHidden.current;
  const armedMore = !!armed && hidden > 0 && !shownChips.some((c) => c.value === armed);

  // The selected count in the popover slides up or down
  const lastCount = useRef(selected.length);
  const countDir = useRef<"up" | "down">("up");
  if (selected.length !== lastCount.current) {
    countDir.current = selected.length > lastCount.current ? "up" : "down";
    lastCount.current = selected.length;
  }

  /* ---------- Changes ---------- */

  const commit = (next: string[], extra?: ComboboxOption) => {
    if (value === undefined) setOwn(next);
    onChange?.(
      next,
      next.map((v) => (extra?.value === v ? extra : optionOf(v))),
    );
  };

  const say = (text: string, count: number) => setAnnounce(multiple ? `${text}. ${count} selected` : text);

  const pick = (o: ComboboxOption) => {
    const on = picked.has(o.value);
    const next = multiple ? (on ? selected.filter((v) => v !== o.value) : [...selected, o.value]) : [o.value];
    commit(next, o);
    say(`${o.label} ${on && multiple ? "removed" : "selected"}`, next.length);
    setArmed(null);
    if (query) setQuery("");
    if (!multiple) setOpen(false);
  };

  const create = () => {
    const made = onCreate?.(q) || { value: q, label: q };
    setCreated((list) => [...list.filter((c) => c.value !== made.value), made]);
    setActive(made.value);
    pick(made);
  };

  const remove = (v: string) => {
    const next = selected.filter((x) => x !== v);
    commit(next);
    say(`${optionOf(v).label} removed`, next.length);
    setArmed(null);
  };

  const choose = (v: string) => {
    if (v === CREATE) create();
    else pick(optionOf(v));
  };

  /* ---------- Measuring: the field and the list glide to their heights, the highlight to its row ---------- */

  useLayoutEffect(() => {
    const box = field.current;
    const inner = fieldInner.current;
    if (!box || !inner) return;
    const set = () => (box.style.height = `${inner.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    const inner = listInner.current;
    if (!open || !list || !inner) return;
    const set = () => {
      const style = getComputedStyle(list);
      const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const limit = parseFloat(style.maxHeight) || Infinity;
      list.style.height = `${Math.min(inner.offsetHeight + pad, limit)}px`;
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(inner);
    return () => ro.disconnect();
  }, [open]);

  useLayoutEffect(() => {
    const list = listRef.current;
    const pill = pillRef.current;
    if (!open || !list || !pill) return;
    const row = list.querySelector<HTMLElement>("[data-active]");
    if (!row) {
      pill.style.opacity = "0";
      return;
    }
    // No transition on the first placement, so it doesn't fly in
    const first = !pill.dataset.ready;
    if (first) pill.style.transition = "none";
    pill.style.opacity = lit ? "1" : "0";
    pill.style.height = `${row.offsetHeight}px`;
    pill.style.transform = `translateY(${row.offsetTop}px)`;
    if (first) {
      pill.dataset.ready = "1";
      void pill.offsetWidth;
      pill.style.transition = "";
    }
    if (!byKeyboard.current) return;
    byKeyboard.current = false;
    // Scroll only the list, keeping the group title above a first row in view
    const pad = 6;
    const prev = row.previousElementSibling as HTMLElement | null;
    const title = prev?.classList.contains("ui-cbxc__group-label") ? prev.offsetHeight : 0;
    const top = row.offsetTop - pad - title;
    const bottom = row.offsetTop + row.offsetHeight + pad;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  });

  // A click outside closes the list
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) {
        setOpen(false);
        setArmed(null);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  /* ---------- Keyboard ---------- */

  const move = (step: number) => {
    if (!order.length) return;
    byKeyboard.current = true;
    setLit(true);
    const i = pos.get(current) ?? 0;
    setActive(order[(i + step + order.length) % order.length]);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Backspace") setArmed(null);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      move(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      if (!open || !current) return;
      e.preventDefault();
      choose(current);
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      } else if (query) setQuery("");
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key === "Backspace" && !query && selected.length) {
      // First press highlights the last chip, the second removes it
      e.preventDefault();
      const last = selected[selected.length - 1];
      if (armed === last) remove(last);
      else {
        setArmed(last);
        setAnnounce(`${optionOf(last).label} – press Backspace again to remove`);
      }
    }
  };

  const onFieldDown = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    if (e.target !== input.current) e.preventDefault();
    input.current?.focus();
    setArmed(null);
    setOpen(true);
  };

  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (root.current?.contains(e.relatedTarget as Node | null)) return;
    setOpen(false);
    setArmed(null);
  };

  const keepFocus = (e: MouseEvent) => e.preventDefault();

  // The rows call the latest handlers through a ref, so they don't render again for every move
  const rowEvents = useRef<RowEvents>({ hover: () => {}, choose: () => {} });
  rowEvents.current = {
    hover: (v) => {
      setLit(true);
      if (current !== v) setActive(v);
    },
    choose: (o) => {
      setActive(o.value);
      pick(o);
    },
  };

  return (
    <div ref={root} className={["ui-cbxc", className].filter(Boolean).join(" ")} data-open={open || undefined} onBlur={onBlur}>
      {/* React 19 hoists this into <head> once, no matter how many fields render */}
      <style href="ui-combobox-clean" precedence="default">
        {css}
      </style>

      {label && (
        <label className="ui-cbxc__label" id={`${uid}-label`} htmlFor={`${uid}-input`}>
          {label}
        </label>
      )}

      <div ref={field} className="ui-cbxc__field" onMouseDown={onFieldDown}>
        <div ref={fieldInner} className="ui-cbxc__field-inner">
          {/* Hidden copy of the chips plus a "+99" sample, only to measure how many fit on the line */}
          <ul ref={measure} className="ui-cbxc__measure" aria-hidden="true">
            {chips
              .filter((c) => !c.leaving)
              .map((c) => {
                const o = optionOf(c.value);
                const plain = !o.icon && !o.avatar && !o.color;
                return (
                  <li key={c.value} className="ui-cbxc__chip" data-plain={plain || undefined}>
                    <span className="ui-cbxc__chip-body">
                      <Visual option={o} />
                      <span className="ui-cbxc__chip-label">{o.label}</span>
                      <span className="ui-cbxc__chip-x" />
                    </span>
                  </li>
                );
              })}
            <li className="ui-cbxc__chip ui-cbxc__more">
              <span className="ui-cbxc__chip-body">+99</span>
            </li>
          </ul>
          {chips.length > 0 && (
            <ul className="ui-cbxc__chips" role="list" aria-label="Selected">
              {shownChips.map((c) => {
                const o = optionOf(c.value);
                const plain = !o.icon && !o.avatar && !o.color;
                return (
                  <ChipItem key={c.value} animate={ready.current} leaving={c.leaving} armed={armed === c.value} plain={plain}>
                    <span className="ui-cbxc__chip-body">
                      <Visual option={o} />
                      <span className="ui-cbxc__chip-label" dir="auto" title={o.label}>
                        {o.label}
                      </span>
                      <button
                        type="button"
                        className="ui-cbxc__chip-x"
                        tabIndex={-1}
                        aria-label={`Remove ${o.label}`}
                        onMouseDown={keepFocus}
                        onClick={() => remove(c.value)}
                      >
                        <Glyph d={icons.close} />
                      </button>
                    </span>
                  </ChipItem>
                );
              })}
              {(
                <li className="ui-cbxc__chip ui-cbxc__more" data-hidden={!hidden || undefined} data-armed={armedMore || undefined} aria-hidden={!hidden || undefined}>
                  <span className="ui-cbxc__chip-body">
                    +
                    <span className="ui-cbxc__roll">
                      <span key={shownHidden} data-dir={hiddenDir.current}>
                        {shownHidden.toLocaleString("en-US")}
                      </span>
                    </span>
                  </span>
                </li>
              )}
            </ul>
          )}
          <input
            ref={input}
            id={`${uid}-input`}
            className="ui-cbxc__input"
            dir="auto"
            value={query}
            placeholder={selected.length ? undefined : placeholder}
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${uid}-list`}
            aria-autocomplete="list"
            aria-activedescendant={open && current ? optionId(current) : undefined}
            aria-label={label ? undefined : placeholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(null);
              setArmed(null);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <button
          type="button"
          className="ui-cbxc__toggle"
          tabIndex={-1}
          aria-label={open ? "Close list" : "Open list"}
          onMouseDown={keepFocus}
          onClick={() => {
            input.current?.focus();
            setOpen((o) => !o);
          }}
        >
          <Glyph d={icons.chevron} />
        </button>
      </div>

      {open && (
        // Pressing inside the list (also its scrollbar) keeps the focus in the field
        <div className="ui-cbxc__pop" onMouseDown={keepFocus}>
          <div
            ref={listRef}
            id={`${uid}-list`}
            className="ui-cbxc__list"
            role="listbox"
            aria-multiselectable={multiple || undefined}
            aria-labelledby={label ? `${uid}-label` : undefined}
            aria-label={label ? undefined : "Options"}
            onMouseLeave={() => setLit(false)}
          >
            <span ref={pillRef} className="ui-cbxc__pill" aria-hidden="true" />
            <div ref={listInner} className="ui-cbxc__list-inner">
              {groups.map((g, gi) => (
                <div key={g.name || "_"} role="group" aria-labelledby={g.name ? `${uid}-g${gi}` : undefined} className="ui-cbxc__group">
                  {g.name && (
                    <div className="ui-cbxc__group-label" dir="auto" id={`${uid}-g${gi}`}>
                      {g.name}
                    </div>
                  )}
                  {g.options.map((o) => (
                    <Row key={o.value} option={o} id={optionId(o.value)} on={picked.has(o.value)} active={current === o.value} query={q} events={rowEvents} />
                  ))}
                </div>
              ))}

              {!groups.length && (
                <div className="ui-cbxc__empty" key={q}>
                  {emptyText}
                  {q && <> for “{q}”</>}
                </div>
              )}

              {canCreate && (
                <div
                  id={optionId(CREATE)}
                  role="option"
                  aria-selected={false}
                  data-active={current === CREATE || undefined}
                  className="ui-cbxc__option ui-cbxc__create"
                  onMouseDown={keepFocus}
                  onMouseMove={() => {
                    setLit(true);
                    if (current !== CREATE) setActive(CREATE);
                  }}
                  onClick={create}
                >
                  <span className="ui-cbxc__plus" aria-hidden="true">
                    <Glyph d={icons.plus} />
                  </span>
                  <span className="ui-cbxc__name" dir="auto" title={createLabel(q)}>
                      {createLabel(q)}
                    </span>
                </div>
              )}
            </div>
          </div>

          {/* The last row of the popover, under a hairline: how many are picked, and the keys */}
          <div className="ui-cbxc__foot" aria-hidden="true">
            <span className="ui-cbxc__count">
              <span className="ui-cbxc__roll">
                <span key={selected.length} data-dir={countDir.current}>
                  {selected.length.toLocaleString("en-US")}
                </span>
              </span>
              {multiple ? " selected" : selected.length ? " selected" : " selected"}
            </span>
            <span className="ui-cbxc__keys">
              <kbd>↑</kbd>
              <kbd>↓</kbd>
              <span>to move</span>
              <kbd>↵</kbd>
              <span>to {multiple ? "toggle" : "pick"}</span>
            </span>
          </div>
        </div>
      )}

      <span className="ui-cbxc__live" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}

/* ---------- Styles ---------- */


const css = /* css */ `
/* Colors and motion as variables – override them on .ui-cbxc */
.ui-cbxc {
  --ui-cbxc-card: #ffffff;
  --ui-cbxc-ink: rgba(0, 0, 0, 0.88);
  --ui-cbxc-strong: #000000;
  --ui-cbxc-text: rgba(0, 0, 0, 0.61);
  --ui-cbxc-muted: rgba(0, 0, 0, 0.45);
  --ui-cbxc-faint: rgba(0, 0, 0, 0.27);
  --ui-cbxc-icon: rgba(0, 0, 0, 0.447);
  --ui-cbxc-line: rgba(0, 0, 0, 0.06);
  --ui-cbxc-fill: rgba(0, 0, 0, 0.06);
  --ui-cbxc-fill-strong: rgba(0, 0, 0, 0.1);
  --ui-cbxc-wash: rgba(0, 0, 0, 0.03);
  --ui-cbxc-flash: rgba(0, 0, 0, 0.14);
  --ui-cbxc-avatar: rgba(0, 0, 0, 0.06);
  --ui-cbxc-mark: rgba(0, 96, 226, 0.12);
  --ui-cbxc-accent: rgba(0, 96, 226, 0.765);
  --ui-cbxc-focus: rgba(0, 96, 226, 0.35);
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-cbxc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-cbxc-shadow-hover: 0 0 0 0.5px rgba(0, 0, 0, 0.12), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-cbxc-shadow-pop: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 12px 28px -10px rgba(0, 0, 0, 0.16), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-cbxc-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --ui-cbxc-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
  position: relative;
  display: block;
  width: 100%;
  max-width: 440px;
  container-type: inline-size;
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  color: var(--ui-cbxc-ink);
  -webkit-font-smoothing: antialiased;
}
.ui-cbxc *, .ui-cbxc *::before, .ui-cbxc *::after { box-sizing: border-box; }
:where(.ui-cbxc) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; }
:where(.ui-cbxc) svg { display: block; flex: none; }
/* 16px icons with thin ~1.1px lines */
.ui-cbxc__glyph { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.65; stroke-linecap: round; stroke-linejoin: round; }
.ui-cbxc__label { display: block; margin: 0 0 6px 2px; font-size: 12px; line-height: 16px; font-weight: 500; color: var(--ui-cbxc-text); }

/* The field: white with the hairline shadow; its height glides when chips wrap */
.ui-cbxc__field {
  position: relative;
  overflow: hidden;
  border-radius: 8px;
  background: var(--ui-cbxc-card);
  box-shadow: var(--ui-cbxc-shadow);
  cursor: text;
  transition: height 300ms var(--ui-cbxc-ease), box-shadow 160ms ease;
}
.ui-cbxc__field:hover { box-shadow: var(--ui-cbxc-shadow-hover); }
.ui-cbxc__field:focus-within { outline: 2px solid var(--ui-cbxc-focus); outline-offset: 1px; }
/* Always one line: chips that don't fit go into "+N" */
.ui-cbxc__field-inner { position: relative; display: flex; flex-wrap: nowrap; align-items: center; min-height: 32px; padding: 4px 32px 4px 4px; overflow: hidden; }
.ui-cbxc__measure { position: absolute; top: 0; left: 0; display: flex; width: max-content; margin: 0; padding: 0; list-style: none; visibility: hidden; pointer-events: none; white-space: nowrap; }
.ui-cbxc__chips > .ui-cbxc__chip { flex: none; }
.ui-cbxc__measure > .ui-cbxc__chip { flex: none; max-width: none; }
.ui-cbxc__chips { display: contents; margin: 0; padding: 0; list-style: none; }

/* Chips: the gray tab-chip look – the outer grid folds the width, the body flashes and pops */
.ui-cbxc__chip {
  display: grid;
  grid-template-columns: 1fr;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  margin-right: 4px;
  transition: grid-template-columns 260ms var(--ui-cbxc-ease) 160ms, margin-right 260ms var(--ui-cbxc-ease) 160ms, opacity 200ms ease 140ms;
}
.ui-cbxc__chip[data-leaving] { grid-template-columns: 0fr; margin-right: 0; opacity: 0; pointer-events: none; }
.ui-cbxc__chip-body {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 24px;
  overflow: hidden;
  padding: 0 2px 0 4px;
  border-radius: 6px;
  background: var(--ui-cbxc-fill);
  white-space: nowrap;
  font-size: 12px;
  line-height: 16px;
  font-weight: 500;
  color: var(--ui-cbxc-ink);
  transition: background-color 160ms ease, box-shadow 160ms ease;
}
.ui-cbxc__chip[data-plain] .ui-cbxc__chip-body { padding-left: 8px; }
.ui-cbxc__chip[data-armed] .ui-cbxc__chip-body { background: var(--ui-cbxc-fill-strong); box-shadow: inset 0 0 0 0.5px var(--ui-cbxc-faint); }
.ui-cbxc__chip[data-leaving] .ui-cbxc__chip-body { animation: ui-cbxc-flash 300ms ease-out both; }
.ui-cbxc__chip-label { min-width: 0; max-width: 168px; overflow: hidden; text-overflow: ellipsis; }
.ui-cbxc__chip-x { display: grid; place-items: center; flex: none; width: 18px; height: 18px; border-radius: 4px; color: var(--ui-cbxc-icon); transition: background-color 140ms ease, color 140ms ease; }
.ui-cbxc__chip-x:hover { background: var(--ui-cbxc-fill); color: var(--ui-cbxc-ink); }
.ui-cbxc__chip-x .ui-cbxc__glyph { width: 12px; height: 12px; stroke-width: 1.9; }
.ui-cbxc__chip .ui-cbxc__avatar { width: 16px; height: 16px; font-size: 7px; background: var(--ui-cbxc-card); box-shadow: 0 0 0 0.5px var(--ui-cbxc-line); }
.ui-cbxc__chip .ui-cbxc__dot { margin: 0 1px 0 2px; }
.ui-cbxc__chip .ui-cbxc__icon { width: 16px; height: 16px; }

/* "+3": folds open and closed like a chip, the number rolls */
.ui-cbxc__more .ui-cbxc__chip-body { padding: 0 8px; gap: 0; color: var(--ui-cbxc-text); font-variant-numeric: tabular-nums; }
.ui-cbxc__more { transition-delay: 0ms; }
.ui-cbxc__more[data-hidden] { grid-template-columns: 0fr; margin-right: 0; opacity: 0; }
.ui-cbxc__roll { display: inline-grid; overflow: hidden; }
.ui-cbxc__roll > span { animation: ui-cbxc-roll-up 300ms var(--ui-cbxc-ease) both; }
.ui-cbxc__roll > span[data-dir="down"] { animation-name: ui-cbxc-roll-down; }

.ui-cbxc__input {
  flex: 1 0 72px;
  min-width: 72px;
  height: 24px;
  margin: 0;
  padding: 0 4px 0 6px;
  border: 0;
  background: transparent;
  font: inherit;
  color: var(--ui-cbxc-ink);
  outline: none;
}
.ui-cbxc__input::placeholder { color: var(--ui-cbxc-faint); }
/* The chevron: a small ghost button */
.ui-cbxc__toggle { position: absolute; top: 4px; right: 4px; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 6px; color: var(--ui-cbxc-icon); transition: background-color 140ms ease, color 140ms ease; }
.ui-cbxc__toggle:hover { background: var(--ui-cbxc-wash); color: var(--ui-cbxc-ink); }
.ui-cbxc__toggle .ui-cbxc__glyph { transition: transform 260ms var(--ui-cbxc-ease); }
.ui-cbxc[data-open] .ui-cbxc__toggle .ui-cbxc__glyph { transform: rotate(180deg); }

/* Avatars, dots, icons */
.ui-cbxc__avatar {
  display: grid;
  place-items: center;
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--ui-cbxc-avatar);
  color: var(--ui-cbxc-text);
  font-size: 8px;
  line-height: 1;
  font-weight: 500;
  letter-spacing: 0.02em;
}
.ui-cbxc__dot { flex: none; width: 8px; height: 8px; margin: 0 4px; border-radius: 50%; }
.ui-cbxc__icon { display: grid; place-items: center; flex: none; width: 20px; height: 20px; color: var(--ui-cbxc-icon); }
.ui-cbxc__icon svg { width: 16px; height: 16px; }
/* Image icons fit their tile, however wide or tall */
.ui-cbxc__icon { overflow: hidden; }
.ui-cbxc__icon img { width: 16px; height: 16px; object-fit: contain; }

/* The list: one white popover with the count and keys as its last row */
.ui-cbxc__pop {
  position: absolute;
  z-index: 30;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  overflow: hidden;
  border-radius: 10px;
  background: var(--ui-cbxc-card);
  box-shadow: var(--ui-cbxc-shadow-pop);
  transform-origin: top center;
  animation: ui-cbxc-open 240ms var(--ui-cbxc-ease) both;
}
.ui-cbxc__list { position: relative; max-height: 300px; padding: 4px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; transition: height 300ms var(--ui-cbxc-ease); }
.ui-cbxc__pill {
  position: absolute;
  top: 0;
  left: 4px;
  right: 4px;
  border-radius: 6px;
  background: var(--ui-cbxc-fill);
  opacity: 0;
  pointer-events: none;
  /* A short, crisp move between rows – no long glide; it fades out when the pointer leaves the list */
  transition: transform 90ms ease-out, height 90ms ease-out, opacity 140ms ease;
}
.ui-cbxc__group-label { padding: 8px 8px 4px; font-size: 10px; line-height: 16px; font-weight: 500; letter-spacing: 0.5px; text-transform: uppercase; color: var(--ui-cbxc-muted); overflow-wrap: anywhere; }
.ui-cbxc__group:first-child .ui-cbxc__group-label { padding-top: 4px; }
.ui-cbxc__option { position: relative; display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 8px; border-radius: 6px; cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent; }
.ui-cbxc__text { display: flex; flex: 1; align-items: baseline; gap: 8px; min-width: 0; }
/* The name wins over the hint when space runs out */
.ui-cbxc__name { flex: 0 0 auto; max-width: 100%; min-width: 0; overflow: hidden; color: var(--ui-cbxc-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-cbxc__hint { flex: 0 100 auto; min-width: 0; overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-cbxc-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-cbxc mark { border-radius: 3px; background: var(--ui-cbxc-mark); color: inherit; }
/* The blue check pops in with a small spring and fades out quickly */
.ui-cbxc__check { width: 16px; height: 16px; margin-left: auto; color: var(--ui-cbxc-accent); stroke-width: 1.8; opacity: 0; transform: scale(0.4); transition: opacity 120ms ease, transform 160ms ease; }
.ui-cbxc__option[aria-selected="true"] .ui-cbxc__check { opacity: 1; transform: none; transition: opacity 160ms ease, transform 380ms var(--ui-cbxc-spring); }
.ui-cbxc__empty { padding: 12px 8px 10px; text-align: center; color: var(--ui-cbxc-muted); animation: ui-cbxc-in 240ms var(--ui-cbxc-ease) both; overflow-wrap: anywhere; }
.ui-cbxc__create { animation: ui-cbxc-in 240ms var(--ui-cbxc-ease) both; }
/* A long typed text shortens instead of pushing the row wider */
.ui-cbxc__create .ui-cbxc__name { flex: 0 1 auto; }
.ui-cbxc__plus { display: grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: 6px; color: var(--ui-cbxc-icon); box-shadow: inset 0 0 0 0.5px var(--ui-cbxc-fill-strong); }
.ui-cbxc__plus .ui-cbxc__glyph { width: 12px; height: 12px; stroke-width: 1.9; }

/* The last row of the popover, under a hairline */
.ui-cbxc__foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; height: 32px; padding: 0 12px; border-top: 0.5px solid var(--ui-cbxc-line); font-size: 12px; line-height: 16px; color: var(--ui-cbxc-muted); }
.ui-cbxc__count { display: inline-flex; font-variant-numeric: tabular-nums; }
.ui-cbxc__keys { display: inline-flex; align-items: center; gap: 2px; white-space: nowrap; }
.ui-cbxc kbd {
  display: inline-grid;
  place-items: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 4px;
  background: var(--ui-cbxc-card);
  box-shadow: var(--ui-cbxc-shadow);
  font-family: inherit;
  font-size: 10px;
  line-height: 16px;
  font-weight: 500;
  color: var(--ui-cbxc-text);
}
.ui-cbxc__keys > span { margin: 0 6px 0 2px; }
.ui-cbxc__keys > span:last-child { margin-right: 0; }
.ui-cbxc__live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

@keyframes ui-cbxc-open { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: none; } }
@keyframes ui-cbxc-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@keyframes ui-cbxc-flash { 0% { background-color: var(--ui-cbxc-fill); } 35% { background-color: var(--ui-cbxc-flash); } 100% { background-color: var(--ui-cbxc-flash); transform: scale(0.92); } }
@keyframes ui-cbxc-roll-up { from { opacity: 0; transform: translateY(70%); } to { opacity: 1; transform: none; } }
@keyframes ui-cbxc-roll-down { from { opacity: 0; transform: translateY(-70%); } to { opacity: 1; transform: none; } }

/* Narrow (phones): no key hints, chips may use the full width */
@container (max-width: 380px) {
  .ui-cbxc__keys { display: none; }
  .ui-cbxc__chip-label { max-width: 132px; }
  /* The text field fits next to a chip instead of taking a line of its own */
  .ui-cbxc__input { flex-basis: 44px; min-width: 44px; }
}
/* Touch screens: bigger rows, chips and buttons; 16px text so iOS doesn't zoom in */
@media (hover: none) and (pointer: coarse) {
  .ui-cbxc__field-inner { min-height: 40px; padding: 4px 40px 4px 4px; }
  .ui-cbxc__chip-body { height: 32px; }
  .ui-cbxc__chip-x { width: 26px; height: 26px; }
  .ui-cbxc__input { height: 32px; font-size: 16px; }
  .ui-cbxc__toggle { width: 32px; height: 32px; }
  .ui-cbxc__option { height: 44px; }
  .ui-cbxc__list { max-height: 340px; }
  .ui-cbxc__keys { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-cbxc *, .ui-cbxc *::before, .ui-cbxc *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-cbxc {
  --ui-cbxc-card: #1c1c1e;
  --ui-cbxc-ink: rgba(255, 255, 255, 0.9);
  --ui-cbxc-strong: #ffffff;
  --ui-cbxc-text: rgba(255, 255, 255, 0.62);
  --ui-cbxc-muted: rgba(255, 255, 255, 0.46);
  --ui-cbxc-faint: rgba(255, 255, 255, 0.3);
  --ui-cbxc-icon: rgba(255, 255, 255, 0.5);
  --ui-cbxc-line: rgba(255, 255, 255, 0.08);
  --ui-cbxc-fill: rgba(255, 255, 255, 0.08);
  --ui-cbxc-fill-strong: rgba(255, 255, 255, 0.13);
  --ui-cbxc-wash: rgba(255, 255, 255, 0.04);
  --ui-cbxc-flash: rgba(255, 255, 255, 0.18);
  --ui-cbxc-avatar: rgba(255, 255, 255, 0.08);
  --ui-cbxc-mark: rgba(77, 141, 255, 0.24);
  --ui-cbxc-accent: #4d8dff;
  --ui-cbxc-focus: rgba(77, 141, 255, 0.5);
  --ui-cbxc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-cbxc-shadow-hover: 0 0 0 0.5px rgba(255, 255, 255, 0.16), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-cbxc-shadow-pop: 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 12px 28px -10px rgba(0, 0, 0, 0.6);
}
`;
