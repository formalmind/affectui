"use client";

import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/*
 * Prompt Library – saved prompt templates with variables, in one self-contained file.
 * A short list of templates sits on the left (on top when the card is narrow), with a search field and a tiny category tag.
 * The chosen template shows on the right:
 *   · its text with every {variable} as an inline field – type straight into the sentence
 *   · below it the finished prompt is assembled live; the part you just changed lights up for a moment
 *   · empty variables stay soft placeholders, and a counter says how many are filled
 *   · the gray tray rolls the token estimate as you type; Use stays off until every variable is filled, then pulses once
 *   · switching templates crossfades the content while the highlight slides along the list
 * The styles are injected below, so no extra files are needed.
 */

export type PromptTone = "blue" | "violet" | "amber" | "green" | "red" | "gray";

export type PromptVariable = {
  /** What to put in – shown on the tray while the field is focused or hovered */
  description?: string;
  /** Starts filled with this value */
  default?: string;
};

export type PromptTemplate = {
  id: string;
  title: string;
  /** Small tag next to the title, e.g. "Sales" */
  category?: string;
  /** Color of the tag – by default each category gets its own color in the order they appear */
  tone?: PromptTone;
  /** The prompt with variables in curly braces, e.g. "Summarize this for {audience}" */
  body: string;
  /** Optional details per variable name */
  variables?: Record<string, PromptVariable>;
};

export type PromptLibraryProps = {
  templates: PromptTemplate[];
  /** Id of the chosen template (controlled) */
  value?: string;
  /** Id chosen at first when uncontrolled – defaults to the first template */
  defaultValue?: string;
  onSelect?: (id: string) => void;
  /** Called with the finished prompt when Use is pressed (only possible once every variable is filled) */
  onUse?: (prompt: string, template: PromptTemplate, values: Record<string, string>) => void;
  /** Called after the finished prompt was copied */
  onCopy?: (prompt: string) => void;
  title?: string;
  /** Label of the use button */
  useLabel?: string;
  className?: string;
};

/* ---------- Helpers ---------- */

const TONES: PromptTone[] = ["blue", "violet", "amber", "green", "red", "gray"];
const VAR = /\{([A-Za-z0-9_-]+)\}/g;

/** A variable keeps the punctuation right after it (its tail), so a line never starts with "." */
type Part = { text: string } | { name: string; tail: string };
const parse = (body: string): Part[] => {
  const parts: Part[] = [];
  let last = 0;
  for (const m of body.matchAll(VAR)) {
    if (m.index > last) parts.push({ text: body.slice(last, m.index) });
    const end = m.index + m[0].length;
    const tail = /^[.,;:!?)\]"'’…]+/.exec(body.slice(end))?.[0] ?? "";
    parts.push({ name: m[1], tail });
    last = end + tail.length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
};
const namesOf = (body: string) => [...new Set([...body.matchAll(VAR)].map((m) => m[1]))];
const fill = (body: string, values: Record<string, string>) =>
  body.replace(VAR, (whole, name: string) => (values[name]?.trim() ? values[name] : whole));
/** A rough estimate – about four characters per token */
/** Counts with separators – 1,284 */
const num = new Intl.NumberFormat("en");
const estimate = (text: string) => Math.max(1, Math.round(text.length / 4));
const defaults = (t: PromptTemplate) => {
  const v: Record<string, string> = {};
  for (const name of namesOf(t.body)) v[name] = t.variables?.[name]?.default ?? "";
  return v;
};
const ease = (t: number) => 1 - Math.pow(1 - t, 4);
const reduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Rolls a number from where it is to its target in one animation frame loop */
function useRolling(target: number, duration: number) {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const from = current.current;
    if (reduced() || from === target) {
      current.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      current.current = from + (target - from) * ease(t);
      setShown(current.current);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return shown;
}

/**
 * Text that changes without a jump: the old line fades out underneath while the new one fades in.
 */
function Swap({ id, tone, children }: { id: string; tone?: string; children: ReactNode }) {
  type Line = { id: string; tone?: string; node: ReactNode };
  const last = useRef<Line>({ id, tone, node: children });
  const [shownId, setShownId] = useState(id);
  const [out, setOut] = useState<Line | null>(null);
  if (shownId !== id) {
    setShownId(id);
    setOut(last.current);
  }
  last.current = { id, tone, node: children };
  useEffect(() => {
    if (!out) return;
    const timer = window.setTimeout(() => setOut(null), 260);
    return () => window.clearTimeout(timer);
  }, [out]);
  return (
    <span className="ui-pli__swap">
      {out && (
        <span key={`out-${out.id}`} className="ui-pli__swap-item" data-out="" data-tone={out.tone} aria-hidden="true">
          {out.node}
        </span>
      )}
      <span key={id} className="ui-pli__swap-item" data-tone={tone}>
        {children}
      </span>
    </span>
  );
}

/* ---------- Icons ---------- */

const line = { stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const SearchIcon = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
    <circle cx="5.8" cy="5.8" r="3.8" {...line} />
    <path d="m8.6 8.6 2.4 2.4" {...line} />
  </svg>
);
const CopyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <rect x="3.8" y="3.8" width="6.4" height="6.4" rx="1.6" {...line} />
    <path d="M8.2 3.6V3.2A1.4 1.4 0 0 0 6.8 1.8H3.2a1.4 1.4 0 0 0-1.4 1.4v3.6a1.4 1.4 0 0 0 1.4 1.4h.4" {...line} />
  </svg>
);
const DoneIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="m2.6 6.3 2.2 2.2 4.6-5" {...line} strokeWidth={1.6} />
  </svg>
);
const ArrowIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M2.5 6h7M6.5 3l3 3-3 3" {...line} />
  </svg>
);

/* ---------- The template in the detail pane ---------- */

type PanelProps = {
  template: PromptTemplate;
  tone: PromptTone;
  values: Record<string, string>;
  flash: { name: string; n: number } | null;
  idBase: string;
  onChange?: (name: string, value: string) => void;
  onHint?: (name: string | null) => void;
  onEnter?: (name: string) => void;
  out?: boolean;
};

function Panel({ template, tone, values, flash, idBase, onChange, onHint, onEnter, out }: PanelProps) {
  const parts = parse(template.body);
  const names = namesOf(template.body);
  const filled = names.filter((n) => values[n]?.trim()).length;
  const flashOf = (name: string) =>
    flash && flash.name === name ? (flash.n % 2 ? "a" : "b") : undefined;

  return (
    <div
      className="ui-pli__panel"
      data-out={out ? "" : undefined}
      aria-hidden={out || undefined}
      inert={out}
    >
      <div className="ui-pli__panel-head">
        <span className="ui-pli__panel-title" dir="auto" title={template.title}>
          {template.title}
        </span>
        {template.category && (
          <span className="ui-pli__tag" data-tone={tone} dir="auto" title={template.category}>
            {template.category}
          </span>
        )}
        {names.length > 0 && (
          <span className="ui-pli__count">
            {/* One square per variable – past twelve only the words, the squares would crowd out the title */}
            {names.length <= 12 && (
              <span className="ui-pli__bars" aria-hidden="true">
                {names.map((n) => (
                  <span key={n} className="ui-pli__bar" data-on={values[n]?.trim() ? "" : undefined} />
                ))}
              </span>
            )}
            {filled} of {names.length} filled
          </span>
        )}
      </div>

      {/* The template itself – every variable is a field inside the sentence */}
      <p className="ui-pli__body" dir="auto">
        {parts.map((p, i) =>
          "text" in p ? (
            <Fragment key={i}>{p.text}</Fragment>
          ) : (
            <span key={i} className="ui-pli__glue">
              <span
                className="ui-pli__token"
                data-filled={values[p.name]?.trim() ? "" : undefined}
                data-flash={flashOf(p.name)}
                onPointerEnter={(e) => e.pointerType === "mouse" && onHint?.(p.name)}
                onPointerLeave={(e) => e.pointerType === "mouse" && onHint?.(null)}
              >
                <span className="ui-pli__sizer" aria-hidden="true">
                  {values[p.name] || p.name}
                </span>
                <input
                  className="ui-pli__input"
                  data-var={p.name}
                  size={1}
                  value={values[p.name] ?? ""}
                  placeholder={p.name}
                  aria-label={template.variables?.[p.name]?.description ? `${p.name} – ${template.variables[p.name].description}` : p.name}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => onChange?.(p.name, e.target.value)}
                  onFocus={() => onHint?.(p.name)}
                  onBlur={() => onHint?.(null)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      onEnter?.(p.name);
                    }
                  }}
                />
              </span>
              {p.tail}
            </span>
          ),
        )}
      </p>

      <div className="ui-pli__label" id={`${idBase}-preview`}>
        Preview
      </div>
      <div className="ui-pli__preview" dir="auto" aria-labelledby={`${idBase}-preview`} role="region">
        {parts.map((p, i) =>
          "text" in p ? (
            <Fragment key={i}>{p.text}</Fragment>
          ) : (
            <span key={i} className="ui-pli__glue">
              {values[p.name]?.trim() ? (
                <span className="ui-pli__fill" data-flash={flashOf(p.name)}>
                  {values[p.name]}
                </span>
              ) : (
                <span className="ui-pli__hole">{`{${p.name}}`}</span>
              )}
              {p.tail}
            </span>
          ),
        )}
      </div>
    </div>
  );
}

/* ---------- One row of the list – memoized, so typing into a variable doesn't redraw a long list ---------- */

type OptionProps = {
  id: string;
  title: string;
  category?: string;
  tone: PromptTone;
  on: boolean;
  focusable: boolean;
  pick: (id: string) => void;
  register: (id: string, el: HTMLDivElement | null) => void;
};

const Option = memo(function Option({ id, title, category, tone, on, focusable, pick, register }: OptionProps) {
  return (
    <div
      ref={(el) => register(id, el)}
      className="ui-pli__option"
      role="option"
      aria-selected={on}
      tabIndex={focusable ? 0 : -1}
      onClick={() => pick(id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          pick(id);
        }
      }}
    >
      <span className="ui-pli__option-title" dir="auto" title={title}>
        {title}
      </span>
      {category && (
        <span className="ui-pli__tag" data-tone={tone} dir="auto" title={category}>
          {category}
        </span>
      )}
    </div>
  );
});

/* ---------- Prompt Library ---------- */

export function PromptLibrary({
  templates,
  value,
  defaultValue,
  onSelect,
  onUse,
  onCopy,
  title = "Prompts",
  useLabel = "Use prompt",
  className,
}: PromptLibraryProps) {
  const uid = useId();
  const [inner, setInner] = useState(defaultValue ?? templates[0]?.id);
  const selectedId = value ?? inner;
  const selected = templates.find((t) => t.id === selectedId) ?? templates[0];

  const [query, setQuery] = useState("");
  const [all, setAll] = useState<Record<string, Record<string, string>>>({});
  const valuesOf = (t: PromptTemplate) => ({ ...defaults(t), ...all[t.id] });
  const [flash, setFlash] = useState<{ name: string; n: number } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [useHover, setUseHover] = useState(false);
  const [note, setNote] = useState<{ id: number; kind: "copied" | "used" } | null>(null);
  const [said, setSaid] = useState("");

  // Category colors in the order the categories first appear
  const toneOf = (() => {
    const map = new Map<string, PromptTone>();
    for (const t of templates)
      if (t.category && !map.has(t.category)) map.set(t.category, TONES[map.size % TONES.length]);
    return (t: PromptTemplate): PromptTone => t.tone ?? map.get(t.category ?? "") ?? "gray";
  })();

  const q = query.trim().toLowerCase();
  const shown = q
    ? templates.filter((t) => [t.title, t.category ?? "", t.body].some((s) => s.toLowerCase().includes(q)))
    : templates;

  /* ----- Selection ----- */

  const select = (id: string) => {
    if (id === selectedId) return;
    if (value === undefined) setInner(id);
    onSelect?.(id);
  };

  // The outgoing template stays a moment and fades out underneath the new one
  const [leaving, setLeaving] = useState<{ id: string; key: number } | null>(null);
  const [lastId, setLastId] = useState(selected?.id);
  if (selected && lastId !== selected.id) {
    if (lastId && !reduced()) setLeaving({ id: lastId, key: Date.now() });
    setLastId(selected.id);
    setHint(null);
    setFlash(null);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(null), 260);
    return () => window.clearTimeout(timer);
  }, [leaving]);
  const leavingTemplate = leaving ? templates.find((t) => t.id === leaving.id) : undefined;

  // The highlight slides to the chosen item
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<string, HTMLDivElement>());
  // Stable for the memoized rows – they always reach the latest select
  const selectRef = useRef(select);
  selectRef.current = select;
  const pick = useCallback((id: string) => selectRef.current(id), []);
  const register = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) optionRefs.current.set(id, el);
    else optionRefs.current.delete(id);
  }, []);
  const [glide, setGlide] = useState<{ y: number; h: number; on: boolean; moved: boolean }>({ y: 0, h: 0, on: false, moved: false });
  const shownKey = shown.map((t) => t.id).join("|");
  // Once per render, not once per row
  const selectedShown = shown.some((s) => s.id === selected?.id);
  useLayoutEffect(() => {
    const measure = () => {
      const el = selected ? optionRefs.current.get(selected.id) : undefined;
      setGlide((g) =>
        el
          ? { y: el.offsetTop, h: el.offsetHeight, on: true, moved: g.on }
          : { ...g, on: false, moved: false },
      );
    };
    measure();
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [selected?.id, shownKey]);

  const onListKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!shown.length) return;
    const at = shown.findIndex((t) => t.id === selected?.id);
    let next = -1;
    if (e.key === "ArrowDown") next = at < 0 ? 0 : Math.min(shown.length - 1, at + 1);
    else if (e.key === "ArrowUp") next = at < 0 ? shown.length - 1 : Math.max(0, at - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = shown.length - 1;
    else return;
    e.preventDefault();
    select(shown[next].id);
    optionRefs.current.get(shown[next].id)?.focus();
  };

  /* ----- Values ----- */

  const values = selected ? valuesOf(selected) : {};
  const names = selected ? namesOf(selected.body) : [];
  const missing = names.filter((n) => !values[n]?.trim());
  const ready = Boolean(selected) && missing.length === 0;
  const prompt = selected ? fill(selected.body, values) : "";
  const count = useRolling(estimate(prompt), 420);

  const change = (name: string, v: string) => {
    if (!selected) return;
    const id = selected.id;
    setAll((a) => ({ ...a, [id]: { ...valuesOf(selected), ...a[id], [name]: v } }));
    setFlash((f) => ({ name, n: (f?.n ?? 0) + 1 }));
  };

  // Use pulses once when the last variable gets filled
  const [pulse, setPulse] = useState(0);
  const wasReady = useRef(ready);
  const wasId = useRef(selected?.id);
  useEffect(() => {
    if (ready && !wasReady.current && wasId.current === selected?.id) {
      setPulse((p) => p + 1);
      setSaid("All variables filled");
    }
    wasReady.current = ready;
    wasId.current = selected?.id;
  }, [ready, selected?.id]);

  const rootRef = useRef<HTMLDivElement>(null);
  const enter = (name: string) => {
    // Enter moves on to the next field that is still empty, or presses Use when all are filled
    const inputs = [...(rootRef.current?.querySelectorAll<HTMLInputElement>(".ui-pli__panel:not([data-out]) .ui-pli__input") ?? [])];
    const from = inputs.findIndex((i) => i.dataset.var === name);
    const next = [...inputs.slice(from + 1), ...inputs.slice(0, from)].find((i) => !i.value.trim());
    if (next) next.focus();
    else if (ready) use();
  };

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(prompt);
    } catch {
      /* Clipboard not allowed here – still say what would have been copied */
    }
    onCopy?.(prompt);
    setNote({ id: Date.now(), kind: "copied" });
    setSaid("Prompt copied");
  };
  const use = () => {
    if (!ready || !selected) return;
    onUse?.(prompt, selected, values);
    setNote({ id: Date.now(), kind: "used" });
    setSaid(`${selected.title} used`);
  };
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 1800);
    return () => window.clearTimeout(timer);
  }, [note]);
  useEffect(() => {
    if (!said) return;
    const timer = window.setTimeout(() => setSaid(""), 2000);
    return () => window.clearTimeout(timer);
  }, [said]);

  /* ----- What the tray says ----- */

  const tokens = Math.round(count);
  let caption: ReactNode = selected ? <>~{num.format(tokens)} {tokens === 1 ? "token" : "tokens"}</> : null;
  let captionKey = "tokens";
  let captionTone: string | undefined;
  const hinted = hint && names.includes(hint) ? hint : null;
  if (note) {
    caption = note.kind === "copied" ? "Copied to clipboard" : "Prompt sent";
    captionKey = `${note.kind}-${note.id}`;
    captionTone = "ok";
  } else if (hinted) {
    const d = selected?.variables?.[hinted]?.description;
    caption = (
      <>
        <b>{hinted}</b> · {d ?? (values[hinted]?.trim() ? "filled" : "fill this in")}
      </>
    );
    captionKey = `hint-${hinted}`;
  } else if (useHover && !ready) {
    caption = `Fill ${missing.length} more to use`;
    captionKey = "missing";
  }

  return (
    <div
      ref={rootRef}
      className={["ui-pli", className].filter(Boolean).join(" ")}
      role="group"
      aria-labelledby={`${uid}-title`}
    >
      <style href="ui-prompt-library" precedence="default">
        {css}
      </style>

      <div className="ui-pli__card">
        {/* ----- The list ----- */}
        <div className="ui-pli__side">
          <div className="ui-pli__side-head">
            <span id={`${uid}-title`} className="ui-pli__title" title={title}>
              {title}
            </span>
            <span className="ui-pli__total">{num.format(templates.length)}</span>
          </div>
          <label className="ui-pli__search">
            <SearchIcon />
            <input
              type="search"
              value={query}
              placeholder="Search templates"
              aria-label="Search templates"
              aria-controls={`${uid}-list`}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" && shown.length) {
                  e.preventDefault();
                  const target = shown.find((t) => t.id === selected?.id) ?? shown[0];
                  select(target.id);
                  optionRefs.current.get(target.id)?.focus();
                } else if (e.key === "Escape" && query) {
                  e.preventDefault();
                  setQuery("");
                }
              }}
            />
          </label>

          <div
            ref={listRef}
            id={`${uid}-list`}
            className="ui-pli__list"
            data-scroll={shown.length > 12 ? "" : undefined}
            role="listbox"
            aria-label="Templates"
            onKeyDown={onListKey}
          >
            <span
              className="ui-pli__glide"
              aria-hidden="true"
              data-on={glide.on ? "" : undefined}
              data-moved={glide.moved ? "" : undefined}
              style={{ transform: `translateY(${glide.y}px)`, height: glide.h }}
            />
            {shown.map((t) => {
              const isOn = t.id === selected?.id;
              const focusable = isOn || (!selectedShown && t === shown[0]);
              return (
                <Option
                  key={t.id}
                  id={t.id}
                  title={t.title}
                  category={t.category}
                  tone={toneOf(t)}
                  on={isOn}
                  focusable={focusable}
                  pick={pick}
                  register={register}
                />
              );
            })}
            {shown.length === 0 && <div className="ui-pli__empty">{templates.length ? "No templates match" : "No templates yet"}</div>}
          </div>
        </div>

        {/* ----- The chosen template ----- */}
        <div className="ui-pli__main">
          {leavingTemplate && (
            <Panel
              key={`out-${leaving!.key}`}
              template={leavingTemplate}
              tone={toneOf(leavingTemplate)}
              values={valuesOf(leavingTemplate)}
              flash={null}
              idBase={`${uid}-out`}
              out
            />
          )}
          {selected && (
            <Panel
              key={selected.id}
              template={selected}
              tone={toneOf(selected)}
              values={values}
              flash={flash}
              idBase={uid}
              onChange={change}
              onHint={setHint}
              onEnter={enter}
            />
          )}
        </div>
      </div>

      <div className="ui-pli__foot">
        <span className="ui-pli__caption">
          <Swap id={captionKey} tone={captionTone}>
            {caption}
          </Swap>
        </span>
        <button type="button" className="ui-pli__copy" onClick={copy} aria-label="Copy prompt" disabled={!selected}>
          <span className="ui-pli__copy-icon" key={note?.kind === "copied" ? "done" : "copy"}>
            {note?.kind === "copied" ? <DoneIcon /> : <CopyIcon />}
          </span>
          <span className="ui-pli__copy-text">Copy</span>
        </button>
        <button
          type="button"
          className="ui-pli__use"
          aria-disabled={!ready}
          data-pulse={pulse ? (pulse % 2 ? "a" : "b") : undefined}
          onClick={use}
          onPointerEnter={() => setUseHover(true)}
          onPointerLeave={() => setUseHover(false)}
          onFocus={() => setUseHover(true)}
          onBlur={() => setUseHover(false)}
          title={useLabel}
        >
          <span className="ui-pli__use-label">{useLabel}</span>
          <ArrowIcon />
        </button>
      </div>
      <span className="ui-pli__sr" role="status" aria-live="polite">
        {said}
      </span>
    </div>
  );
}

const css = /* css */ `
.ui-pli {
  --ui-pli-tray: #f0f0f0;
  --ui-pli-card: #ffffff;
  --ui-pli-line: #ececec;
  --ui-pli-ink: #171717;
  --ui-pli-text: #404040;
  --ui-pli-muted: #8f8f8f;
  --ui-pli-well: #f4f4f5;
  --ui-pli-accent: #2f6bff;
  --ui-pli-accent-ink: #1f55d6;
  --ui-pli-accent-bg: rgba(47, 107, 255, 0.09);
  --ui-pli-accent-flash: rgba(47, 107, 255, 0.24);
  --ui-pli-hole: #b4b4b9;
  --ui-pli-on-ink: #ffffff;
  --ui-pli-ok: #18794e;
  --ui-pli-blue: #2f6bff;
  --ui-pli-blue-bg: rgba(47, 107, 255, 0.1);
  --ui-pli-violet: #6941c6;
  --ui-pli-violet-bg: rgba(105, 65, 198, 0.1);
  --ui-pli-amber: #96590a;
  --ui-pli-amber-bg: rgba(240, 160, 32, 0.14);
  --ui-pli-green: #18794e;
  --ui-pli-green-bg: rgba(34, 160, 90, 0.11);
  --ui-pli-red: #b42318;
  --ui-pli-red-bg: rgba(229, 72, 77, 0.1);
  --ui-pli-gray: #5f5f66;
  --ui-pli-gray-bg: #f0f0f2;
  --ui-pli-focus: rgba(23, 23, 23, 0.22);
  --ui-pli-ease: cubic-bezier(0.32, 0.72, 0.24, 1);
  box-sizing: border-box;
  width: 100%;
  max-width: 640px;
  min-width: 0;
  container-type: inline-size;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-pli-tray);
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 20px;
  color: var(--ui-pli-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-pli *, .ui-pli *::before, .ui-pli *::after { box-sizing: border-box; }
:where(.ui-pli) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
:where(.ui-pli) input { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; outline: none; }
.ui-pli button:focus-visible, .ui-pli__option:focus-visible { outline: 2px solid var(--ui-pli-focus); outline-offset: 2px; }
.ui-pli svg { display: block; flex: none; }
.ui-pli b { font-weight: 500; color: var(--ui-pli-ink); }
.ui-pli p { margin: 0; }
.ui-pli__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

.ui-pli__card { display: grid; grid-template-columns: 220px minmax(0, 1fr); border-radius: 16px; background: var(--ui-pli-card); box-shadow: 0 0 0 1px var(--ui-pli-line), 0 1px 2px rgba(0, 0, 0, 0.04); }

/* ----- List ----- */
.ui-pli__side { min-width: 0; padding: 12px 8px 8px; border-right: 1px solid var(--ui-pli-line); }
.ui-pli__side-head { display: flex; align-items: center; gap: 6px; height: 22px; padding: 0 6px; }
.ui-pli__title { overflow: hidden; font-size: 13px; font-weight: 500; color: var(--ui-pli-text); white-space: nowrap; text-overflow: ellipsis; }
.ui-pli__total { font-size: 12px; color: var(--ui-pli-muted); font-variant-numeric: tabular-nums; }
.ui-pli__search { display: flex; align-items: center; gap: 7px; height: 30px; margin-top: 8px; padding: 0 9px; border-radius: 8px; background: var(--ui-pli-well); color: var(--ui-pli-muted); cursor: text; transition: box-shadow 160ms ease; }
.ui-pli__search:focus-within { box-shadow: 0 0 0 1px var(--ui-pli-line), 0 0 0 3px var(--ui-pli-focus); }
.ui-pli__search input { flex: 1; min-width: 0; height: 100%; font-size: 12.5px; color: var(--ui-pli-ink); -webkit-appearance: none; appearance: none; }
.ui-pli__search input::placeholder { color: var(--ui-pli-muted); }
.ui-pli__search input::-webkit-search-cancel-button { -webkit-appearance: none; }

.ui-pli__list { position: relative; display: flex; flex-direction: column; gap: 2px; margin-top: 6px; }
.ui-pli__glide { position: absolute; top: 0; left: 0; right: 0; border-radius: 9px; background: var(--ui-pli-well); opacity: 0; pointer-events: none; transition: opacity 180ms ease; }
.ui-pli__glide[data-on] { opacity: 1; }
.ui-pli__glide[data-moved] { transition: transform 340ms var(--ui-pli-ease), height 340ms var(--ui-pli-ease), opacity 180ms ease; }
.ui-pli__option { position: relative; display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 6px 0 8px; border-radius: 9px; color: var(--ui-pli-text); cursor: pointer; user-select: none; transition: color 160ms ease; -webkit-tap-highlight-color: transparent; }
.ui-pli__option::before { content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; transition: background-color 160ms ease; }
.ui-pli__list { isolation: isolate; }
.ui-pli__glide { z-index: -1; }
.ui-pli__option:hover:not([aria-selected="true"])::before { background: color-mix(in srgb, var(--ui-pli-well) 55%, transparent); }
.ui-pli__option[aria-selected="true"] { color: var(--ui-pli-ink); }
.ui-pli__option-title { text-align: start; flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-pli__empty { height: 34px; padding: 0 8px; font-size: 12.5px; line-height: 34px; color: var(--ui-pli-muted); }

/* A long category shortens – it never pushes the title out */
.ui-pli__tag { flex: 0 1 auto; min-width: 0; max-width: 50%; overflow: hidden; text-overflow: ellipsis; height: 18px; padding: 0 5px; border-radius: 5px; font-size: 11px; font-weight: 500; line-height: 18px; white-space: nowrap; color: var(--ui-pli-gray); background: var(--ui-pli-gray-bg); }
.ui-pli__tag[data-tone="blue"] { color: var(--ui-pli-blue); background: var(--ui-pli-blue-bg); }
.ui-pli__tag[data-tone="violet"] { color: var(--ui-pli-violet); background: var(--ui-pli-violet-bg); }
.ui-pli__tag[data-tone="amber"] { color: var(--ui-pli-amber); background: var(--ui-pli-amber-bg); }
.ui-pli__tag[data-tone="green"] { color: var(--ui-pli-green); background: var(--ui-pli-green-bg); }
.ui-pli__tag[data-tone="red"] { color: var(--ui-pli-red); background: var(--ui-pli-red-bg); }

/* ----- Chosen template: the old one fades out underneath while the new one fades in ----- */
.ui-pli__main { display: grid; min-width: 0; }
.ui-pli__panel { grid-area: 1 / 1; min-width: 0; padding: 12px 14px 14px; animation: ui-pli-in 360ms ease both; }
.ui-pli__panel[data-out] { animation: ui-pli-out 240ms ease both; pointer-events: none; }
/* A long title keeps the line; the counter wraps below it */
.ui-pli__panel-head { display: flex; flex-wrap: wrap; row-gap: 4px; align-items: center; gap: 8px; min-height: 22px; }
.ui-pli__panel-title { flex: 1 1 auto; min-width: 0; text-align: start; overflow: hidden; font-size: 13.5px; font-weight: 600; color: var(--ui-pli-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-pli__count { display: inline-flex; flex: none; align-items: center; gap: 7px; margin-left: auto; font-size: 12px; color: var(--ui-pli-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ui-pli__bars { display: inline-flex; gap: 2px; }
.ui-pli__bar { width: 8px; height: 4px; border-radius: 2px; background: var(--ui-pli-line); transition: background-color 300ms ease; }
.ui-pli__bar[data-on] { background: var(--ui-pli-accent); }

.ui-pli__body { margin-top: 10px !important; white-space: pre-line; text-align: start; font-size: 13px; line-height: 26px; color: var(--ui-pli-text); overflow-wrap: anywhere; }
.ui-pli__glue { white-space: nowrap; }
.ui-pli__preview .ui-pli__glue { white-space: inherit; }
.ui-pli__token { position: relative; display: inline-grid; vertical-align: top; max-width: 100%; height: 22px; margin: 2px 0; padding: 0 6px; border-radius: 6px; background: var(--ui-pli-well); box-shadow: inset 0 0 0 1px var(--ui-pli-line); line-height: 22px; color: var(--ui-pli-muted); cursor: text; transition: background-color 200ms ease, box-shadow 200ms ease, color 200ms ease; }
.ui-pli__token:hover { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ui-pli-muted) 45%, transparent); }
.ui-pli__token[data-filled] { background: var(--ui-pli-accent-bg); box-shadow: none; color: var(--ui-pli-accent-ink); }
.ui-pli__token:focus-within { box-shadow: inset 0 0 0 1px var(--ui-pli-accent), 0 0 0 3px var(--ui-pli-accent-bg); }
.ui-pli__token[data-flash="a"] { animation: ui-pli-flash-a 900ms ease-out; }
.ui-pli__token[data-flash="b"] { animation: ui-pli-flash-b 900ms ease-out; }
.ui-pli__sizer, .ui-pli__input { grid-area: 1 / 1; min-width: 2ch; font-size: 13px; line-height: 22px; white-space: pre; }
.ui-pli__sizer { padding-right: 1px; font-weight: 500; visibility: hidden; overflow: hidden; }
.ui-pli__input { width: 100%; height: 22px; color: inherit; font-weight: 500; text-overflow: ellipsis; }
.ui-pli__input::placeholder { color: var(--ui-pli-muted); font-weight: 400; opacity: 1; }

.ui-pli__label { margin-top: 12px; font-size: 12px; color: var(--ui-pli-muted); }
/* A long prompt scrolls inside the preview instead of stretching the card */
.ui-pli__preview { max-height: 168px; overflow-y: auto; overscroll-behavior: contain; text-align: start; margin-top: 4px; padding: 9px 11px; border-radius: 10px; background: var(--ui-pli-well); font-size: 12.5px; line-height: 20px; color: var(--ui-pli-text); white-space: pre-wrap; overflow-wrap: anywhere; }
.ui-pli__fill { border-radius: 4px; color: var(--ui-pli-ink); font-weight: 500; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.ui-pli__fill[data-flash="a"] { animation: ui-pli-mark-a 1100ms ease-out; }
.ui-pli__fill[data-flash="b"] { animation: ui-pli-mark-b 1100ms ease-out; }
.ui-pli__hole { color: var(--ui-pli-hole); }

/* ----- Tray ----- */
.ui-pli__foot { display: flex; align-items: center; gap: 4px; min-height: 40px; padding: 4px 2px 0 10px; }
.ui-pli__caption { flex: 1; min-width: 0; overflow: hidden; font-size: 12.5px; color: var(--ui-pli-muted); white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.ui-pli__swap { display: grid; min-width: 0; }
.ui-pli__swap-item { grid-area: 1 / 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; animation: ui-pli-swap-in 320ms ease both; }
.ui-pli__swap-item[data-out] { animation: ui-pli-swap-out 220ms ease both; }
.ui-pli__swap-item[data-tone="ok"] { color: var(--ui-pli-ok); }
.ui-pli__copy { display: inline-flex; flex: none; align-items: center; gap: 5px; height: 28px; padding: 0 9px 0 8px; border-radius: 10px; font-size: 12.5px; font-weight: 500; color: var(--ui-pli-text); white-space: nowrap; transition: background-color 160ms ease, color 160ms ease; }
.ui-pli__copy:hover:not(:disabled) { background: var(--ui-pli-card); color: var(--ui-pli-ink); }
.ui-pli__copy-icon { display: grid; place-items: center; width: 12px; height: 12px; animation: ui-pli-swap-in 300ms ease both; }
.ui-pli__use { position: relative; display: inline-flex; flex: 0 1 auto; min-width: 0; max-width: 60%; align-items: center; gap: 5px; height: 28px; padding: 0 9px 0 11px; border-radius: 10px; background: var(--ui-pli-ink); font-size: 12.5px; font-weight: 500; color: var(--ui-pli-on-ink); white-space: nowrap; transition: background-color 200ms ease, color 200ms ease, opacity 200ms ease; }
.ui-pli__use svg { transition: transform 220ms var(--ui-pli-ease); }
.ui-pli__use:hover:not([aria-disabled="true"]) svg { transform: translateX(2px); }
.ui-pli__use[aria-disabled="true"] { background: color-mix(in srgb, var(--ui-pli-ink) 10%, transparent); color: var(--ui-pli-muted); cursor: default; }
.ui-pli__use[data-pulse="a"] { animation: ui-pli-pulse-a 1400ms ease-out; }
.ui-pli__use[data-pulse="b"] { animation: ui-pli-pulse-b 1400ms ease-out; }

.ui-pli__use-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* Long lists scroll inside the side; the padding keeps the focus ring visible */
.ui-pli__list[data-scroll] { max-height: 400px; overflow-y: auto; overscroll-behavior: contain; padding: 3px; margin: 3px -3px -3px; }
.ui-pli__list[data-scroll] .ui-pli__glide { left: 3px; right: 3px; }

@keyframes ui-pli-in { from { opacity: 0; filter: blur(2px); transform: translateY(3px); } }
@keyframes ui-pli-out { to { opacity: 0; filter: blur(2px); } }
@keyframes ui-pli-swap-in { from { opacity: 0; filter: blur(2px); } }
@keyframes ui-pli-swap-out { from { opacity: 1; } to { opacity: 0; filter: blur(2px); } }
@keyframes ui-pli-flash-a { from { background-color: var(--ui-pli-accent-flash); } }
@keyframes ui-pli-flash-b { from { background-color: var(--ui-pli-accent-flash); } }
@keyframes ui-pli-mark-a { from { background-color: var(--ui-pli-accent-flash); box-shadow: 0 0 0 2px var(--ui-pli-accent-flash); } to { background-color: transparent; box-shadow: 0 0 0 2px transparent; } }
@keyframes ui-pli-mark-b { from { background-color: var(--ui-pli-accent-flash); box-shadow: 0 0 0 2px var(--ui-pli-accent-flash); } to { background-color: transparent; box-shadow: 0 0 0 2px transparent; } }
@keyframes ui-pli-pulse-a { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ui-pli-ink) 30%, transparent); } 60%, 100% { box-shadow: 0 0 0 8px transparent; } }
@keyframes ui-pli-pulse-b { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--ui-pli-ink) 30%, transparent); } 60%, 100% { box-shadow: 0 0 0 8px transparent; } }

/* Narrow: the list moves on top, the copy button keeps only its icon */
@container (max-width: 540px) {
  .ui-pli__card { grid-template-columns: minmax(0, 1fr); }
  .ui-pli__side { border-right: 0; border-bottom: 1px solid var(--ui-pli-line); }
}
@container (max-width: 360px) {
  .ui-pli__copy { width: 28px; padding: 0; justify-content: center; }
  .ui-pli__copy-text { display: none; }
  .ui-pli__count .ui-pli__bars { display: none; }
}

@media (pointer: coarse) {
  .ui-pli__option { height: 40px; }
  .ui-pli__search { height: 36px; }
  .ui-pli__copy, .ui-pli__use { height: 34px; }
  .ui-pli__body { line-height: 30px; }
  .ui-pli__token, .ui-pli__input, .ui-pli__sizer { height: 26px; line-height: 26px; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-pli *, .ui-pli *::before, .ui-pli *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-pli {
  --ui-pli-tray: #111113;
  --ui-pli-card: #19191b;
  --ui-pli-line: #2a2a2e;
  --ui-pli-ink: #ededed;
  --ui-pli-text: #c8c8cc;
  --ui-pli-muted: #8b8b92;
  --ui-pli-well: #222225;
  --ui-pli-accent: #4f82ff;
  --ui-pli-accent-ink: #9dbbff;
  --ui-pli-accent-bg: rgba(79, 130, 255, 0.16);
  --ui-pli-accent-flash: rgba(79, 130, 255, 0.36);
  --ui-pli-hole: #5c5c63;
  --ui-pli-on-ink: #111113;
  --ui-pli-ok: #6ee7a8;
  --ui-pli-blue: #8fb1ff;
  --ui-pli-blue-bg: rgba(79, 130, 255, 0.16);
  --ui-pli-violet: #b9a2f5;
  --ui-pli-violet-bg: rgba(150, 110, 240, 0.16);
  --ui-pli-amber: #f5c264;
  --ui-pli-amber-bg: rgba(240, 160, 32, 0.15);
  --ui-pli-green: #6ee7a8;
  --ui-pli-green-bg: rgba(34, 160, 90, 0.16);
  --ui-pli-red: #ff9b93;
  --ui-pli-red-bg: rgba(229, 72, 77, 0.16);
  --ui-pli-gray: #b4b4ba;
  --ui-pli-gray-bg: #26262a;
  --ui-pli-focus: rgba(255, 255, 255, 0.3);
}
`;
