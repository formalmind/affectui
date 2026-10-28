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
 * Prompt Library (clean style) – saved prompt templates with variables, in one self-contained file.
 * The clean style: one white card with hairline shadows instead of the gray tray – the caption, Copy and Use
 * sit in the card's last row.
 * A short list of templates sits on the left (on top when the card is narrow), with a search field and a tiny category tag.
 * The chosen template shows on the right:
 *   · its text with every {variable} as an inline field – type straight into the sentence
 *   · below it the finished prompt is assembled live; the part you just changed lights up for a moment
 *   · empty variables stay soft placeholders, and a counter says how many are filled
 *   · the last row rolls the token estimate as you type; Use stays off until every variable is filled, then pulses once
 *   · switching templates crossfades the content while the highlight slides along the list
 * The styles are injected below, so no extra files are needed.
 */

export type PromptTone = "blue" | "violet" | "amber" | "green" | "red" | "gray";

export type PromptVariable = {
  /** What to put in – shown in the last row while the field is focused or hovered */
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
    <span className="ui-plic__swap">
      {out && (
        <span key={`out-${out.id}`} className="ui-plic__swap-item" data-out="" data-tone={out.tone} aria-hidden="true">
          {out.node}
        </span>
      )}
      <span key={id} className="ui-plic__swap-item" data-tone={tone}>
        {children}
      </span>
    </span>
  );
}

/* ---------- Icons ---------- */

const line = { stroke: "currentColor", strokeWidth: 1.1, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="7.25" cy="7.25" r="4.25" {...line} />
    <path d="m10.5 10.5 3 3" {...line} />
  </svg>
);
const CopyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.75" {...line} />
    <path d="M10.5 5.5V4.25A1.75 1.75 0 0 0 8.75 2.5h-4.5A1.75 1.75 0 0 0 2.5 4.25v4.5c0 .97.78 1.75 1.75 1.75H5.5" {...line} />
  </svg>
);
const DoneIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="m3.5 8.25 3 3 6-6.5" {...line} strokeWidth={1.4} />
  </svg>
);
const ArrowIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3.5 8h9M9 4.5 12.5 8 9 11.5" {...line} strokeWidth={1.25} />
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
      className="ui-plic__panel"
      data-out={out ? "" : undefined}
      aria-hidden={out || undefined}
      inert={out}
    >
      <div className="ui-plic__panel-head">
        <span className="ui-plic__panel-title" dir="auto" title={template.title}>
          {template.title}
        </span>
        {template.category && (
          <span className="ui-plic__tag" data-tone={tone} dir="auto" title={template.category}>
            {template.category}
          </span>
        )}
        {names.length > 0 && (
          <span className="ui-plic__count">
            {/* One square per variable – past twelve only the words, the squares would crowd out the title */}
            {names.length <= 12 && (
              <span className="ui-plic__bars" aria-hidden="true">
                {names.map((n) => (
                  <span key={n} className="ui-plic__bar" data-on={values[n]?.trim() ? "" : undefined} />
                ))}
              </span>
            )}
            {filled} of {names.length} filled
          </span>
        )}
      </div>

      {/* The template itself – every variable is a field inside the sentence */}
      <p className="ui-plic__body" dir="auto">
        {parts.map((p, i) =>
          "text" in p ? (
            <Fragment key={i}>{p.text}</Fragment>
          ) : (
            <span key={i} className="ui-plic__glue">
              <span
                className="ui-plic__token"
                data-filled={values[p.name]?.trim() ? "" : undefined}
                data-flash={flashOf(p.name)}
                onPointerEnter={(e) => e.pointerType === "mouse" && onHint?.(p.name)}
                onPointerLeave={(e) => e.pointerType === "mouse" && onHint?.(null)}
              >
                <span className="ui-plic__sizer" aria-hidden="true">
                  {values[p.name] || p.name}
                </span>
                <input
                  className="ui-plic__input"
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

      <div className="ui-plic__label" id={`${idBase}-preview`}>
        Preview
      </div>
      <div className="ui-plic__preview" dir="auto" aria-labelledby={`${idBase}-preview`} role="region">
        {parts.map((p, i) =>
          "text" in p ? (
            <Fragment key={i}>{p.text}</Fragment>
          ) : (
            <span key={i} className="ui-plic__glue">
              {values[p.name]?.trim() ? (
                <span className="ui-plic__fill" data-flash={flashOf(p.name)}>
                  {values[p.name]}
                </span>
              ) : (
                <span className="ui-plic__hole">{`{${p.name}}`}</span>
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
      className="ui-plic__option"
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
      <span className="ui-plic__option-title" dir="auto" title={title}>
        {title}
      </span>
      {category && (
        <span className="ui-plic__tag" data-tone={tone} dir="auto" title={category}>
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
    const inputs = [...(rootRef.current?.querySelectorAll<HTMLInputElement>(".ui-plic__panel:not([data-out]) .ui-plic__input") ?? [])];
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

  /* ----- What the last row says ----- */

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
      className={["ui-plic", className].filter(Boolean).join(" ")}
      role="group"
      aria-labelledby={`${uid}-title`}
    >
      <style href="ui-prompt-library-clean" precedence="default">
        {css}
      </style>

      <div className="ui-plic__card">
        <div className="ui-plic__cols">
          {/* ----- The list ----- */}
          <div className="ui-plic__side">
            <div className="ui-plic__side-head">
              <span id={`${uid}-title`} className="ui-plic__title" title={title}>
                {title}
              </span>
              <span className="ui-plic__total">{num.format(templates.length)}</span>
            </div>
            <label className="ui-plic__search">
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
              className="ui-plic__list"
              data-scroll={shown.length > 12 ? "" : undefined}
              role="listbox"
              aria-label="Templates"
              onKeyDown={onListKey}
            >
              <span
                className="ui-plic__glide"
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
              {shown.length === 0 && <div className="ui-plic__empty">{templates.length ? "No templates match" : "No templates yet"}</div>}
            </div>
          </div>

          {/* ----- The chosen template ----- */}
          <div className="ui-plic__main">
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

        {/* ----- The last row of the card ----- */}
        <div className="ui-plic__foot">
          <span className="ui-plic__caption">
            <Swap id={captionKey} tone={captionTone}>
              {caption}
            </Swap>
          </span>
          <button type="button" className="ui-plic__copy" onClick={copy} aria-label="Copy prompt" disabled={!selected}>
            <span className="ui-plic__copy-icon" key={note?.kind === "copied" ? "done" : "copy"} data-done={note?.kind === "copied" ? "" : undefined}>
              {note?.kind === "copied" ? <DoneIcon /> : <CopyIcon />}
            </span>
            <span className="ui-plic__copy-text">Copy</span>
          </button>
          <button
            type="button"
            className="ui-plic__use"
            aria-disabled={!ready}
            data-pulse={pulse ? (pulse % 2 ? "a" : "b") : undefined}
            onClick={use}
            onPointerEnter={() => setUseHover(true)}
            onPointerLeave={() => setUseHover(false)}
            onFocus={() => setUseHover(true)}
            onBlur={() => setUseHover(false)}
            title={useLabel}
          >
            <span className="ui-plic__use-label">{useLabel}</span>
            <ArrowIcon />
          </button>
        </div>
      </div>
      <span className="ui-plic__sr" role="status" aria-live="polite">
        {said}
      </span>
    </div>
  );
}

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-plic */
.ui-plic {
  --ui-plic-card: #ffffff;
  --ui-plic-ink: rgba(0, 0, 0, 0.88);
  --ui-plic-strong: #000000;
  --ui-plic-text: rgba(0, 0, 0, 0.61);
  --ui-plic-muted: rgba(0, 0, 0, 0.45);
  --ui-plic-faint: rgba(0, 0, 0, 0.27);
  --ui-plic-icon: rgba(0, 0, 0, 0.447);
  --ui-plic-line: rgba(0, 0, 0, 0.06);
  --ui-plic-line-strong: rgba(0, 0, 0, 0.1);
  --ui-plic-wash: rgba(0, 0, 0, 0.03);
  --ui-plic-well: rgba(0, 0, 0, 0.025);
  --ui-plic-fill: rgba(0, 0, 0, 0.06);
  --ui-plic-accent: rgba(0, 96, 226, 0.765);
  --ui-plic-accent-bg: rgba(0, 96, 226, 0.05);
  --ui-plic-pulse: rgba(0, 0, 0, 0.2);
  --ui-plic-accent-flash: rgba(0, 96, 226, 0.16);
  --ui-plic-on-ink: #fcfcfc;
  --ui-plic-ok: #1a9a52;
  --ui-plic-blue: #1f5fc4;
  --ui-plic-blue-bg: rgba(0, 96, 226, 0.07);
  --ui-plic-violet: #5b45b8;
  --ui-plic-violet-bg: rgba(91, 91, 214, 0.08);
  --ui-plic-amber: #93600a;
  --ui-plic-amber-bg: rgba(232, 162, 12, 0.1);
  --ui-plic-green: #17804a;
  --ui-plic-green-bg: rgba(26, 154, 82, 0.08);
  --ui-plic-red: #c0363b;
  --ui-plic-red-bg: rgba(229, 72, 77, 0.08);
  --ui-plic-gray: rgba(0, 0, 0, 0.61);
  --ui-plic-gray-bg: rgba(0, 0, 0, 0.05);
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-plic-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-plic-focus: rgba(0, 96, 226, 0.35);
  --ui-plic-ease: cubic-bezier(0.22, 1, 0.36, 1);
  box-sizing: border-box;
  width: 100%;
  max-width: 640px;
  min-width: 0;
  container-type: inline-size;
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  color: var(--ui-plic-ink);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-plic *, .ui-plic *::before, .ui-plic *::after { box-sizing: border-box; }
:where(.ui-plic) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
:where(.ui-plic) input { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; outline: none; }
.ui-plic button:focus-visible, .ui-plic__option:focus-visible { outline: 2px solid var(--ui-plic-focus); outline-offset: 1px; }
:where(.ui-plic) svg { display: block; flex: none; }
.ui-plic b { font-weight: 500; color: var(--ui-plic-ink); }
.ui-plic p { margin: 0; }
.ui-plic__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* One white card – the edge is a shadow, not a border; the last row sits inside it */
.ui-plic__card { overflow: hidden; border-radius: 10px; background: var(--ui-plic-card); box-shadow: var(--ui-plic-shadow); }
.ui-plic__cols { display: grid; grid-template-columns: 220px minmax(0, 1fr); }

/* ----- List ----- */
.ui-plic__side { min-width: 0; padding: 12px 8px 8px; border-right: 0.5px solid var(--ui-plic-line); }
.ui-plic__side-head { display: flex; align-items: center; gap: 6px; height: 20px; padding: 0 8px; }
.ui-plic__title { overflow: hidden; font-weight: 500; color: var(--ui-plic-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-plic__total { font-size: 12px; line-height: 16px; color: var(--ui-plic-faint); font-variant-numeric: tabular-nums; }
.ui-plic__search { display: flex; align-items: center; gap: 6px; height: 28px; margin-top: 10px; padding: 0 8px 0 6px; border-radius: 6px; box-shadow: inset 0 0 0 0.5px var(--ui-plic-line-strong); color: var(--ui-plic-icon); cursor: text; transition: box-shadow 160ms ease; }
.ui-plic__search:hover { box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, 0.16); }
.ui-plic__search:focus-within { outline: 2px solid var(--ui-plic-focus); outline-offset: 1px; }
.ui-plic__search input { flex: 1; min-width: 0; height: 100%; font-size: 13px; color: var(--ui-plic-ink); caret-color: var(--ui-plic-accent); -webkit-appearance: none; appearance: none; }
.ui-plic__search input::placeholder { color: var(--ui-plic-faint); }
.ui-plic__search input::-webkit-search-cancel-button { -webkit-appearance: none; }

.ui-plic__list { position: relative; isolation: isolate; display: flex; flex-direction: column; gap: 2px; margin-top: 8px; }
/* The chosen row's fill – a short, crisp move to the next row, no long glide */
.ui-plic__glide { position: absolute; top: 0; left: 0; right: 0; z-index: -1; border-radius: 6px; background: var(--ui-plic-fill); opacity: 0; pointer-events: none; transition: opacity 140ms ease; }
.ui-plic__glide[data-on] { opacity: 1; }
.ui-plic__glide[data-moved] { transition: transform 90ms ease-out, height 90ms ease-out, opacity 140ms ease; }
.ui-plic__option { position: relative; display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 6px 0 8px; border-radius: 6px; color: var(--ui-plic-text); cursor: pointer; user-select: none; transition: color 140ms ease; -webkit-tap-highlight-color: transparent; }
.ui-plic__option::before { content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; transition: background-color 140ms ease; }
.ui-plic__option:hover:not([aria-selected="true"])::before { background: var(--ui-plic-wash); }
.ui-plic__option:hover, .ui-plic__option[aria-selected="true"] { color: var(--ui-plic-ink); }
.ui-plic__option-title { text-align: start; flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-plic__empty { height: 32px; padding: 0 8px; line-height: 32px; color: var(--ui-plic-muted); }

/* Category tags: a light tint of their color */
/* A long category shortens – it never pushes the title out */
.ui-plic__tag { flex: 0 1 auto; min-width: 0; max-width: 50%; overflow: hidden; text-overflow: ellipsis; height: 18px; padding: 0 6px; border-radius: 5px; font-size: 11px; font-weight: 500; line-height: 18px; white-space: nowrap; color: var(--ui-plic-gray); background: var(--ui-plic-gray-bg); }
.ui-plic__tag[data-tone="blue"] { color: var(--ui-plic-blue); background: var(--ui-plic-blue-bg); }
.ui-plic__tag[data-tone="violet"] { color: var(--ui-plic-violet); background: var(--ui-plic-violet-bg); }
.ui-plic__tag[data-tone="amber"] { color: var(--ui-plic-amber); background: var(--ui-plic-amber-bg); }
.ui-plic__tag[data-tone="green"] { color: var(--ui-plic-green); background: var(--ui-plic-green-bg); }
.ui-plic__tag[data-tone="red"] { color: var(--ui-plic-red); background: var(--ui-plic-red-bg); }

/* ----- Chosen template: the old one fades out underneath while the new one fades in ----- */
.ui-plic__main { display: grid; min-width: 0; }
.ui-plic__panel { grid-area: 1 / 1; min-width: 0; padding: 12px 16px 16px; animation: ui-plic-in 360ms var(--ui-plic-ease) both; }
.ui-plic__panel[data-out] { animation: ui-plic-out 240ms ease both; pointer-events: none; }
/* A long title keeps the line; the counter wraps below it */
.ui-plic__panel-head { display: flex; flex-wrap: wrap; row-gap: 4px; align-items: center; gap: 8px; min-height: 20px; }
.ui-plic__panel-title { flex: 1 1 auto; min-width: 0; text-align: start; overflow: hidden; font-weight: 500; color: var(--ui-plic-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-plic__count { display: inline-flex; flex: none; align-items: center; gap: 8px; margin-left: auto; font-size: 12px; line-height: 16px; color: var(--ui-plic-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
/* One small square per variable – it fills in the accent color */
.ui-plic__bars { display: inline-flex; gap: 2px; }
.ui-plic__bar { width: 6px; height: 6px; border-radius: 1.5px; background: var(--ui-plic-fill); transition: background-color 300ms ease; }
.ui-plic__bar[data-on] { background: var(--ui-plic-accent); }

.ui-plic__body { margin-top: 10px !important; white-space: pre-line; text-align: start; font-size: 13px; line-height: 28px; color: var(--ui-plic-ink); overflow-wrap: anywhere; }
.ui-plic__glue { white-space: nowrap; }
.ui-plic__preview .ui-plic__glue { white-space: inherit; }
/* A variable: an empty one is a soft field, a filled one a light accent tint */
.ui-plic__token { position: relative; display: inline-grid; vertical-align: top; max-width: 100%; height: 22px; margin: 3px 0; padding: 0 6px; border-radius: 5px; background: var(--ui-plic-wash); box-shadow: inset 0 0 0 0.5px var(--ui-plic-line-strong); line-height: 22px; color: var(--ui-plic-ink); cursor: text; transition: background-color 200ms ease, box-shadow 200ms ease, color 200ms ease; }
.ui-plic__token:hover { background: var(--ui-plic-fill); }
.ui-plic__token[data-filled] { background: var(--ui-plic-accent-bg); box-shadow: inset 0 0 0 0.5px transparent; }
.ui-plic__token:focus-within { outline: 2px solid var(--ui-plic-focus); outline-offset: 1px; }
.ui-plic__token[data-flash="a"] { animation: ui-plic-flash-a 900ms ease-out; }
.ui-plic__token[data-flash="b"] { animation: ui-plic-flash-b 900ms ease-out; }
.ui-plic__sizer, .ui-plic__input { grid-area: 1 / 1; min-width: 2ch; font-size: 13px; line-height: 22px; white-space: pre; }
.ui-plic__sizer { padding-right: 1px; font-weight: 500; visibility: hidden; overflow: hidden; }
.ui-plic__input { width: 100%; height: 22px; color: inherit; font-weight: 500; text-overflow: ellipsis; caret-color: var(--ui-plic-accent); }
.ui-plic__input::placeholder { color: var(--ui-plic-muted); font-weight: 400; opacity: 1; }

.ui-plic__label { margin-top: 12px; font-size: 10px; font-weight: 500; line-height: 16px; letter-spacing: 0.5px; text-transform: uppercase; color: var(--ui-plic-muted); }
/* A long prompt scrolls inside the preview instead of stretching the card */
.ui-plic__preview { max-height: 168px; overflow-y: auto; overscroll-behavior: contain; text-align: start; margin-top: 4px; padding: 8px 12px; border-radius: 8px; background: var(--ui-plic-well); box-shadow: inset 0 0 0 0.5px var(--ui-plic-line); font-size: 13px; line-height: 20px; color: var(--ui-plic-text); white-space: pre-wrap; overflow-wrap: anywhere; }
.ui-plic__fill { border-radius: 4px; color: var(--ui-plic-ink); font-weight: 500; box-decoration-break: clone; -webkit-box-decoration-break: clone; }
.ui-plic__fill[data-flash="a"] { animation: ui-plic-mark-a 1100ms ease-out; }
.ui-plic__fill[data-flash="b"] { animation: ui-plic-mark-b 1100ms ease-out; }
.ui-plic__hole { color: var(--ui-plic-faint); }

/* ----- The last row: caption, Copy and Use ----- */
.ui-plic__foot { display: flex; align-items: center; gap: 8px; height: 44px; padding: 0 8px 0 16px; border-top: 0.5px solid var(--ui-plic-line); }
.ui-plic__caption { flex: 1; min-width: 0; overflow: hidden; font-size: 12px; line-height: 16px; color: var(--ui-plic-muted); white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.ui-plic__swap { display: grid; min-width: 0; }
.ui-plic__swap-item { grid-area: 1 / 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; animation: ui-plic-swap-in 320ms ease both; }
.ui-plic__swap-item[data-out] { animation: ui-plic-swap-out 220ms ease both; }
.ui-plic__swap-item[data-tone="ok"] { color: var(--ui-plic-ok); }
/* Copy: the secondary button – white with the card's hairline */
.ui-plic__copy { display: inline-flex; flex: none; align-items: center; gap: 6px; height: 28px; padding: 0 10px 0 8px; border-radius: 6px; background: var(--ui-plic-card); box-shadow: var(--ui-plic-shadow); font-size: 13px; font-weight: 500; color: var(--ui-plic-strong); white-space: nowrap; transition: background-color 160ms ease; }
.ui-plic__copy:hover:not(:disabled) { background: color-mix(in srgb, var(--ui-plic-card), #000 3%); }
.ui-plic__copy-icon { display: grid; place-items: center; width: 16px; height: 16px; color: var(--ui-plic-icon); animation: ui-plic-swap-in 300ms ease both; }
.ui-plic__copy-icon[data-done] { color: var(--ui-plic-ok); }
/* Use: the primary dark chip */
.ui-plic__use { position: relative; display: inline-flex; flex: 0 1 auto; min-width: 0; max-width: 60%; align-items: center; gap: 6px; height: 28px; padding: 0 8px 0 10px; border-radius: 6px; background: var(--ui-plic-ink); font-size: 13px; font-weight: 500; color: var(--ui-plic-on-ink); white-space: nowrap; transition: background-color 200ms ease, color 200ms ease; }
.ui-plic__use svg { transition: transform 220ms var(--ui-plic-ease); }
.ui-plic__use:hover:not([aria-disabled="true"]) { background: var(--ui-plic-strong); }
.ui-plic__use:hover:not([aria-disabled="true"]) svg { transform: translateX(2px); }
.ui-plic__use[aria-disabled="true"] { background: var(--ui-plic-fill); color: var(--ui-plic-muted); cursor: default; }
.ui-plic__use[data-pulse="a"] { animation: ui-plic-pulse-a 1400ms ease-out; }
.ui-plic__use[data-pulse="b"] { animation: ui-plic-pulse-b 1400ms ease-out; }

.ui-plic__use-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* Long lists scroll inside the side; the padding keeps the focus ring visible */
.ui-plic__list[data-scroll] { max-height: 400px; overflow-y: auto; overscroll-behavior: contain; padding: 3px; margin: 5px -3px -3px; }
.ui-plic__list[data-scroll] .ui-plic__glide { left: 3px; right: 3px; }

@keyframes ui-plic-in { from { opacity: 0; filter: blur(2px); transform: translateY(3px); } }
@keyframes ui-plic-out { to { opacity: 0; filter: blur(2px); } }
@keyframes ui-plic-swap-in { from { opacity: 0; filter: blur(2px); } }
@keyframes ui-plic-swap-out { from { opacity: 1; } to { opacity: 0; filter: blur(2px); } }
@keyframes ui-plic-flash-a { from { background-color: var(--ui-plic-accent-flash); } }
@keyframes ui-plic-flash-b { from { background-color: var(--ui-plic-accent-flash); } }
@keyframes ui-plic-mark-a { from { background-color: var(--ui-plic-accent-flash); box-shadow: 0 0 0 2px var(--ui-plic-accent-flash); } to { background-color: transparent; box-shadow: 0 0 0 2px transparent; } }
@keyframes ui-plic-mark-b { from { background-color: var(--ui-plic-accent-flash); box-shadow: 0 0 0 2px var(--ui-plic-accent-flash); } to { background-color: transparent; box-shadow: 0 0 0 2px transparent; } }
@keyframes ui-plic-pulse-a { 0% { box-shadow: 0 0 0 0 var(--ui-plic-pulse); } 60%, 100% { box-shadow: 0 0 0 6px transparent; } }
@keyframes ui-plic-pulse-b { 0% { box-shadow: 0 0 0 0 var(--ui-plic-pulse); } 60%, 100% { box-shadow: 0 0 0 6px transparent; } }

/* Narrow: the list moves on top, the copy button keeps only its icon */
@container (max-width: 540px) {
  .ui-plic__cols { grid-template-columns: minmax(0, 1fr); }
  .ui-plic__side { border-right: 0; border-bottom: 0.5px solid var(--ui-plic-line); }
}
@container (max-width: 360px) {
  .ui-plic__copy { width: 28px; padding: 0; justify-content: center; }
  .ui-plic__copy-text { display: none; }
  .ui-plic__count .ui-plic__bars { display: none; }
  .ui-plic__panel { padding: 12px 12px 14px; }
  .ui-plic__foot { padding-left: 12px; }
}

/* Touch screens: taller targets */
@media (pointer: coarse) {
  .ui-plic__option { height: 40px; }
  .ui-plic__search { height: 36px; }
  .ui-plic__copy, .ui-plic__use { height: 34px; }
  .ui-plic__copy { padding-right: 12px; }
  .ui-plic__foot { height: 50px; }
  .ui-plic__body { line-height: 32px; }
  .ui-plic__token, .ui-plic__input, .ui-plic__sizer { height: 26px; line-height: 26px; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-plic *, .ui-plic *::before, .ui-plic *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-plic {
  --ui-plic-card: #1c1c1e;
  --ui-plic-ink: rgba(255, 255, 255, 0.9);
  --ui-plic-strong: #ffffff;
  --ui-plic-text: rgba(255, 255, 255, 0.62);
  --ui-plic-muted: rgba(255, 255, 255, 0.46);
  --ui-plic-faint: rgba(255, 255, 255, 0.3);
  --ui-plic-icon: rgba(255, 255, 255, 0.5);
  --ui-plic-line: rgba(255, 255, 255, 0.08);
  --ui-plic-line-strong: rgba(255, 255, 255, 0.12);
  --ui-plic-wash: rgba(255, 255, 255, 0.04);
  --ui-plic-well: rgba(255, 255, 255, 0.03);
  --ui-plic-fill: rgba(255, 255, 255, 0.08);
  --ui-plic-accent: #4d8dff;
  --ui-plic-accent-bg: rgba(77, 141, 255, 0.14);
  --ui-plic-pulse: rgba(255, 255, 255, 0.25);
  --ui-plic-accent-flash: rgba(77, 141, 255, 0.3);
  --ui-plic-on-ink: #1c1c1e;
  --ui-plic-ok: #3ec27a;
  --ui-plic-blue: #8fb4ff;
  --ui-plic-blue-bg: rgba(77, 141, 255, 0.14);
  --ui-plic-violet: #b7a6f5;
  --ui-plic-violet-bg: rgba(130, 120, 240, 0.15);
  --ui-plic-amber: #f2c063;
  --ui-plic-amber-bg: rgba(232, 162, 12, 0.14);
  --ui-plic-green: #6fd69c;
  --ui-plic-green-bg: rgba(26, 154, 82, 0.16);
  --ui-plic-red: #ff9a9d;
  --ui-plic-red-bg: rgba(229, 72, 77, 0.15);
  --ui-plic-gray: rgba(255, 255, 255, 0.62);
  --ui-plic-gray-bg: rgba(255, 255, 255, 0.08);
  --ui-plic-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-plic-focus: rgba(77, 141, 255, 0.45);
}
:where(.dark, [data-theme="dark"]) .ui-plic__search:hover { box-shadow: inset 0 0 0 0.5px rgba(255, 255, 255, 0.18); }
:where(.dark, [data-theme="dark"]) .ui-plic__copy:hover:not(:disabled) { background: #232326; }
:where(.dark, [data-theme="dark"]) .ui-plic__use:hover:not([aria-disabled="true"]) { background: #ffffff; }
`;
