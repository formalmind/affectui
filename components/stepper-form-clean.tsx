"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/*
 * Stepper Form (Clean) – a multi-step flow for onboarding, checkout or setup wizards, in a single self-contained file.
 * The clean style: one white card with hairline shadows. On top a thin progress bar per step with small uppercase
 * labels; finished steps swap their number for a blue check that draws in. Back and Continue sit in the card's last row.
 * Each step slides in from the side you're heading to, and the card glides to the new step's height.
 * Continue checks the step: invalid fields shake once and say what's wrong; Enter continues, Back keeps everything.
 * The last step submits, then a small success state takes over. On narrow screens the steps collapse
 * to "Step 2 of 4 · Team".
 * Building blocks for the steps come along: StepperField, StepperInput, StepperTags (emails as chips),
 * StepperChoices (selectable cards), StepperReview (a summary with Edit links) and StepperSuccess.
 * The styles are injected below, so no extra files are needed.
 */

export type StepErrors = Partial<Record<string, string>>;

export type StepContext<V> = {
  values: V;
  /** Merges a patch into the values – shared by every step, so Back keeps what was entered */
  setValues: (patch: Partial<V>) => void;
  /** Messages of this step – only filled after a Continue that didn't pass */
  errors: StepErrors;
  /** Jumps to a step by id – from a later step, Continue then returns to where you came from */
  goTo: (id: string) => void;
  /** Same as pressing Continue */
  next: () => void;
};

export type Step<V> = {
  id: string;
  /** Short label for the step list, e.g. "Team" */
  title: string;
  /** Heading inside the card – defaults to the title */
  heading?: string;
  /** A line under the heading */
  description?: string;
  render: (ctx: StepContext<V>) => ReactNode;
  /** Returns messages by field name; nothing (or an empty object) means the step is fine */
  validate?: (values: V) => StepErrors | null | undefined;
};

export type StepperFormProps<V extends Record<string, unknown>> = {
  steps: Step<V>[];
  initialValues: V;
  /** Called with all values on the last step; return a promise to show "Creating…" until it settles (throw to show an error) */
  onComplete?: (values: V) => void | Promise<void>;
  /** Index of the first step shown */
  initialStep?: number;
  /** Controlled step index – pair it with onStepChange */
  step?: number;
  onStepChange?: (step: number) => void;
  /** Label of the last button */
  submitLabel?: string;
  /** Label while onComplete runs */
  submittingLabel?: string;
  /** What shows once onComplete is done – defaults to a short "All set" */
  success?: (values: V, reset: () => void) => ReactNode;
  className?: string;
};

/* ---------- Helpers ---------- */

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
const hasErrors = (e: StepErrors | null | undefined) => !!e && Object.values(e).some(Boolean);
const text = (v: unknown) => (v == null ? "" : String(v));
const fmt = (x: number) => x.toLocaleString("en-US");
/** "Billing Details" → "billing details", but "API & SSO" stays as it is */
const lower = (t: string) => t.replace(/\p{Lu}\p{Ll}+/gu, (w) => w.toLowerCase());
const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A short, calm shake – Web Animations, so it can run again on the same element without remounting it */
function shake(el: HTMLElement | null) {
  if (!el || reduced() || !el.animate) return;
  el.animate(
    [{ transform: "none" }, { transform: "translateX(-4px)" }, { transform: "translateX(4px)" }, { transform: "translateX(-2px)" }, { transform: "none" }],
    { duration: 340, easing: "ease-out" },
  );
}

/** Moves a ring or pill onto the active child of a list – no transition on the first placement, so it doesn't fly in */
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

/* ---------- Icons ---------- */

const Glyph = ({ d, className }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={cx("ui-sfc__glyph", className)} aria-hidden="true">
    <path d={d} />
  </svg>
);
const icons = {
  check: "M5.5 12.5l4 4L18.5 8",
  close: "M7 7l10 10M17 7 7 17",
  back: "M14.5 6l-6 6 6 6",
};

/** A check that draws itself in – pathLength 1 makes the dash math independent of the path */
const DrawCheck = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={cx("ui-sfc__draw", className)} aria-hidden="true">
    <path d={icons.check} pathLength={1} />
  </svg>
);

/* ---------- Contexts for the building blocks ---------- */

type PaneState = { errors: StepErrors; shake: number; report: (name: string, message: string | null) => void };
const PaneContext = createContext<PaneState>({ errors: {}, shake: 0, report: () => {} });

type FieldState = { id: string; invalid: boolean; describedBy?: string; flag: (message: string | null) => void };
const FieldContext = createContext<FieldState | null>(null);

/* ---------- The form ---------- */

export function StepperForm<V extends Record<string, unknown>>({
  steps,
  initialValues,
  onComplete,
  initialStep = 0,
  step,
  onStepChange,
  submitLabel = "Finish",
  submittingLabel = "Creating…",
  success,
  className,
}: StepperFormProps<V>) {
  const n = steps.length;
  // A missing, negative or too large index lands on the nearest step
  const safe = (i: number) => (Number.isFinite(i) ? Math.max(0, Math.min(Math.max(n - 1, 0), Math.trunc(i))) : 0);
  const [own, setOwn] = useState(initialStep);
  const index = safe(step ?? own);
  const [values, setValuesState] = useState<V>(initialValues);
  const valuesRef = useRef(values);
  const [reached, setReached] = useState(index);
  const furthest = Math.max(reached, index);
  const [attempted, setAttempted] = useState<Record<number, boolean>>({});
  const [shakes, setShakes] = useState(0);
  const [returnTo, setReturnTo] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [done, setDone] = useState(false);
  const [announce, setAnnounce] = useState("");

  const formRef = useRef<HTMLFormElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const btnInner = useRef<HTMLSpanElement>(null);
  const moved = useRef(false);
  // Nothing slides in on the first render
  const navigated = useRef(false);
  // Problems a building block found on its own, e.g. a typed email that isn't one yet
  const local = useRef<StepErrors>({});
  const report = useCallback((name: string, message: string | null) => {
    local.current = { ...local.current, [name]: message ?? undefined };
  }, []);
  const uid = useId();

  /* Which pane shows, and the one sliding out – derived during render, so both are there in the same frame */
  const viewIndex = done ? n : index;
  const [view, setView] = useState<{ index: number; from: number | null; dir: 1 | -1 }>({ index: viewIndex, from: null, dir: 1 });
  if (view.index !== viewIndex) setView({ index: viewIndex, from: view.index, dir: viewIndex > view.index ? 1 : -1 });

  useEffect(() => {
    if (view.from === null) return;
    const t = window.setTimeout(() => setView((v) => ({ ...v, from: null })), 420);
    return () => clearTimeout(t);
  }, [view.index, view.from]);

  const setValues = useCallback((patch: Partial<V>) => {
    valuesRef.current = { ...valuesRef.current, ...patch };
    setValuesState(valuesRef.current);
  }, []);

  const go = (to: number) => {
    const next = Math.max(0, Math.min(n - 1, to));
    if (next === index) return;
    moved.current = true;
    navigated.current = true;
    local.current = {};
    if (step === undefined) setOwn(next);
    onStepChange?.(next);
    setReached((r) => Math.max(r, next));
    setSubmitError("");
    setAnnounce(`Step ${fmt(next + 1)} of ${fmt(n)}: ${text(steps[next].title)}`);
  };

  /** Checks the current step; shakes and announces the first problem when it doesn't pass */
  const check = () => {
    const errs = { ...local.current, ...steps[index].validate?.(valuesRef.current) };
    if (!hasErrors(errs)) {
      setAttempted((a) => ({ ...a, [index]: false }));
      return true;
    }
    setAttempted((a) => ({ ...a, [index]: true }));
    setShakes((s) => s + 1);
    setAnnounce(Object.values(errs).find(Boolean) ?? "Check this step");
    return false;
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (submitting || done || !check()) return;
    if (index < n - 1) {
      if (returnTo !== null && returnTo > index) {
        setReturnTo(null);
        go(returnTo);
      } else go(index + 1);
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      await onComplete?.(valuesRef.current);
      moved.current = true;
      navigated.current = true;
      setDone(true);
      setAnnounce("All done");
    } catch (err) {
      const message = err instanceof Error && err.message ? err.message : "Something went wrong – try again";
      setSubmitError(message);
      setAnnounce(message);
    } finally {
      setSubmitting(false);
    }
  };

  const back = () => {
    setReturnTo(null);
    go(index - 1);
  };

  /** By position, so steps that share an id still reach the right one */
  const goToIndex = (to: number) => {
    if (to < 0 || to >= n || to === index) return;
    // Forward jumps need the current step to pass first
    if (to > index && !check()) return;
    setReturnTo(to < index ? index : null);
    go(to);
  };
  const goTo = (id: string) => goToIndex(steps.findIndex((s) => s.id === id));

  const reset = () => {
    valuesRef.current = initialValues;
    setValuesState(initialValues);
    setAttempted({});
    setReturnTo(null);
    setReached(safe(initialStep));
    setDone(false);
    setSubmitError("");
    moved.current = true;
    navigated.current = true;
    local.current = {};
    if (step === undefined) setOwn(safe(initialStep));
    onStepChange?.(safe(initialStep));
  };

  // Focus follows the new step: its first field, else its heading (never on the first render)
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    const pane = viewport.current?.querySelector<HTMLElement>('[data-pane="current"]');
    const field = pane?.querySelector<HTMLElement>('input:not([type="hidden"]):not(:disabled), textarea, select');
    (field ?? pane?.querySelector<HTMLElement>(".ui-sfc__heading"))?.focus({ preventScroll: true });
  }, [viewIndex]);

  // After a failed Continue the first field with a problem gets the focus
  useEffect(() => {
    if (!shakes) return;
    viewport.current?.querySelector<HTMLElement>('[data-pane="current"] [aria-invalid="true"]')?.focus({ preventScroll: true });
  }, [shakes]);

  // The card glides to the height of the step that's coming in
  useLayoutEffect(() => {
    const box = viewport.current;
    const pane = box?.querySelector<HTMLElement>('[data-pane="current"]');
    if (!box || !pane) return;
    const first = !box.dataset.ready;
    const set = () => (box.style.height = `${pane.offsetHeight}px`);
    if (first) box.style.transition = "none";
    set();
    if (first) {
      box.dataset.ready = "1";
      void box.offsetWidth;
      box.style.transition = "";
    }
    const ro = new ResizeObserver(set);
    ro.observe(pane);
    return () => ro.disconnect();
  }, [viewIndex]);

  // The primary button glides to the width of its new label
  useLayoutEffect(() => {
    const box = btn.current;
    const inner = btnInner.current;
    if (!box || !inner) return;
    const set = () => (box.style.width = `${inner.offsetWidth}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  // Nothing to show without steps – every hook has run by now
  if (!n) return null;
  const current = steps[index];
  const errors = attempted[index] ? current.validate?.(values) ?? {} : {};
  const valid = !hasErrors(current.validate?.(values));
  const last = index === n - 1;
  const label = submitting ? submittingLabel : last ? submitLabel : returnTo !== null && returnTo > index ? `Back to ${lower(text(steps[returnTo].title))}` : "Continue";

  const ctx: StepContext<V> = { values, setValues, errors, goTo, next: () => formRef.current?.requestSubmit() };

  const renderPane = (i: number) => {
    if (i >= n) {
      return success ? success(values, reset) : <StepperSuccess title="All set" description="Everything is saved. You can change it any time." />;
    }
    const s = steps[i];
    const paneCtx = i === index ? ctx : { ...ctx, errors: {} };
    return (
      <>
        <h2 className="ui-sfc__heading" tabIndex={-1} id={`${uid}-h${i}`} dir="auto">
          {s.heading ?? s.title}
        </h2>
        {s.description && (
          <p className="ui-sfc__desc" dir="auto">
            {s.description}
          </p>
        )}
        <div className="ui-sfc__body">{s.render(paneCtx)}</div>
      </>
    );
  };

  const panes = view.from !== null && view.from !== view.index ? [view.from, view.index] : [view.index];

  return (
    <div className={cx("ui-sfc", className)} style={{ "--ui-sfc-n": n } as CSSProperties}>
      {/* React 19 hoists this into <head> once, no matter how many forms render */}
      <style href="ui-stepper-form-clean" precedence="default">
        {css}
      </style>

      <div className="ui-sfc__head">
        {/* Wide: the full list of steps. Narrow: kept for screen readers, replaced on screen by the compact line */}
        <div className="ui-sfc__steps">
          <ol className="ui-sfc__list" aria-label="Progress">
          {steps.map((s, i) => {
            const state = done || (i < furthest && i !== index) ? "done" : i === index ? "current" : "upcoming";
            const canJump = !done && !submitting && i !== index && i <= furthest;
            const inner = (
              <>
                <span className="ui-sfc__bar" aria-hidden="true" />
                <span className="ui-sfc__mark">
                  {state === "done" ? <DrawCheck key="check" /> : <span key="num">{i + 1}</span>}
                </span>
                <span className="ui-sfc__step-label" dir="auto">
                  {s.title}
                </span>
                <span className="ui-sfc__sr">{state === "done" ? " (done)" : state === "current" ? " (current)" : ""}</span>
              </>
            );
            return (
              <li key={`${s.id}#${i}`} className="ui-sfc__step" data-state={state} aria-current={!done && i === index ? "step" : undefined}>
                {canJump ? (
                  <button type="button" className="ui-sfc__step-btn" title={text(s.title) || undefined} onClick={() => goToIndex(i)}>
                    {inner}
                  </button>
                ) : (
                  <span className="ui-sfc__step-btn" title={text(s.title) || undefined}>
                    {inner}
                  </span>
                )}
              </li>
            );
          })}
          </ol>
        </div>

        <div className="ui-sfc__compact" aria-hidden="true">
          <span className="ui-sfc__compact-text" key={done ? "done" : index}>
            {done ? (
              <>All {fmt(n)} steps done</>
            ) : (
              <>
                Step {fmt(index + 1)} of {fmt(n)}
                <span className="ui-sfc__compact-dot">·</span>
                <span className="ui-sfc__compact-title" dir="auto">
                  {current.title}
                </span>
              </>
            )}
          </span>
        </div>
      </div>

      <form ref={formRef} className="ui-sfc__card" noValidate onSubmit={submit} aria-labelledby={done ? undefined : `${uid}-h${index}`}>
        <div ref={viewport} className="ui-sfc__viewport">
          {panes.map((i) => {
            const isCurrent = i === view.index;
            return (
              <div
                key={i}
                className="ui-sfc__pane"
                data-pane={isCurrent ? "current" : "leaving"}
                data-dir={view.dir}
                data-first={!navigated.current || undefined}
                inert={!isCurrent}
                aria-hidden={!isCurrent || undefined}
              >
                <PaneContext.Provider value={{ errors: isCurrent && i === index ? errors : {}, shake: isCurrent ? shakes : 0, report }}>
                  {renderPane(i)}
                </PaneContext.Provider>
              </div>
            );
          })}
        </div>

        {/* The footer folds away once everything is done */}
        <div className="ui-sfc__foot-fold" data-hidden={done || undefined}>
          <div className="ui-sfc__foot" inert={done}>
            <button type="button" className="ui-sfc__btn ui-sfc__btn-ghost" data-hidden={index === 0 || undefined} disabled={index === 0 || submitting} onClick={back}>
              <Glyph d={icons.back} />
              Back
            </button>
            {submitError && (
              <span className="ui-sfc__submit-error" role="alert" dir="auto">
                {submitError}
              </span>
            )}
            <button
              ref={btn}
              type="submit"
              className="ui-sfc__btn ui-sfc__btn-primary"
              aria-disabled={!valid || submitting || undefined}
              data-busy={submitting || undefined}
            >
              <span ref={btnInner} className="ui-sfc__btn-inner">
                {submitting && <span className="ui-sfc__spinner" aria-hidden="true" />}
                <span className="ui-sfc__btn-label" key={label} title={label}>
                  {label}
                </span>
              </span>
            </button>
          </div>
        </div>
      </form>

      <span className="ui-sfc__sr" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}

/* ---------- Building blocks ---------- */

export type StepperFieldProps = {
  /** Matches the key in the step's validate result */
  name: string;
  label: string;
  hint?: ReactNode;
  optional?: boolean;
  children: ReactNode;
};

/** A label, the control and an inline message that folds in – the control shakes when Continue finds a problem */
export function StepperField({ name, label, hint, optional, children }: StepperFieldProps) {
  const { errors, shake: shakes, report } = useContext(PaneContext);
  const [local, setLocal] = useState<string | null>(null);
  const [localShake, setLocalShake] = useState(0);
  const id = useId();
  const control = useRef<HTMLDivElement>(null);
  const message = errors[name] ?? local ?? "";
  // Keeps the last text while the message folds away
  const lastMessage = useRef(message);
  if (message) lastMessage.current = message;
  const invalid = !!message;

  useEffect(() => {
    if (shakes && (errors[name] || local)) shake(control.current);
  }, [shakes]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (localShake) shake(control.current);
  }, [localShake]);

  const flag = useCallback((m: string | null) => {
    setLocal(m);
    report(name, m);
    if (m) setLocalShake((s) => s + 1);
  }, [name, report]);

  return (
    <div className="ui-sfc__field" data-invalid={invalid || undefined}>
      <label className="ui-sfc__label" htmlFor={id} dir="auto">
        <span className="ui-sfc__label-text">{label}</span>
        {optional && <span className="ui-sfc__optional">Optional</span>}
      </label>
      <div ref={control} className="ui-sfc__control">
        <FieldContext.Provider value={{ id, invalid, describedBy: invalid ? `${id}-msg` : hint ? `${id}-hint` : undefined, flag }}>
          {children}
        </FieldContext.Provider>
      </div>
      <div className="ui-sfc__fold" data-open={invalid || undefined}>
        <div>
          <p className="ui-sfc__msg" id={`${id}-msg`} key={lastMessage.current} dir="auto">
            {lastMessage.current}
          </p>
        </div>
      </div>
      {hint && (
        <div className="ui-sfc__fold" data-open={!invalid || undefined}>
          <div>
            <p className="ui-sfc__hint" id={`${id}-hint`} dir="auto">
              {hint}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export type StepperInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "prefix"> & {
  /** Fixed text before the value, e.g. "acme.com/" */
  prefix?: string;
};

/** A text field wired to its StepperField – label, message and aria come from there */
export function StepperInput({ prefix, className, ...rest }: StepperInputProps) {
  const field = useContext(FieldContext);
  return (
    <div className={cx("ui-sfc__input", className)} data-invalid={field?.invalid || undefined}>
      {prefix && (
        <span className="ui-sfc__prefix" aria-hidden="true" title={prefix}>
          {prefix}
        </span>
      )}
      <input
        id={field?.id}
        aria-invalid={field?.invalid || undefined}
        aria-describedby={field?.describedBy}
        autoComplete="off"
        spellCheck={false}
        {...rest}
      />
    </div>
  );
}

export type StepperTagsProps = {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Returns a message when an entry can't be added */
  validate?: (entry: string, list: string[]) => string | null;
  /** Largest number of entries */
  max?: number;
};

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

/** Entries as chips – add with Enter, comma or by pasting a list, remove with × or Backspace. Defaults to email checks */
export function StepperTags({
  value,
  onChange,
  placeholder = "name@company.com",
  validate = (entry, list) => (!EMAIL.test(entry) ? "That doesn't look like an email address" : list.includes(entry) ? "Already on the list" : null),
  max,
}: StepperTagsProps) {
  const field = useContext(FieldContext);
  const [draft, setDraft] = useState("");
  const [leaving, setLeaving] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const box = useRef<HTMLDivElement>(null);
  const count = useRef(value.length);

  // The field stays one line: chips scroll sideways, and a new one scrolls into view next to the text
  useLayoutEffect(() => {
    const el = box.current;
    if (el && value.length > count.current) el.scrollTo({ left: el.scrollWidth, behavior: reduced() ? "auto" : "smooth" });
    count.current = value.length;
  }, [value.length]);

  /** Adds every entry in the text; keeps the ones that fail in the field and says why */
  const commit = (text: string) => {
    const parts = text.split(/[\s,;]+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
    if (!parts.length) return true;
    const next = [...valueRef.current];
    const rest: string[] = [];
    let problem: string | null = null;
    for (const p of parts) {
      const m = max !== undefined && next.length >= max ? `Up to ${max}` : validate(p, next);
      if (m) {
        problem ??= m;
        rest.push(p);
      } else next.push(p);
    }
    if (next.length !== valueRef.current.length) {
      valueRef.current = next;
      onChange(next);
    }
    setDraft(rest.join(", "));
    field?.flag(problem);
    return !problem;
  };

  const remove = (entry: string) => {
    if (leaving.includes(entry)) return;
    setLeaving((l) => [...l, entry]);
    const el = list.current?.querySelector<HTMLElement>(`[data-entry="${CSS.escape(entry)}"]`);
    const finish = () => {
      setLeaving((l) => l.filter((x) => x !== entry));
      onChange(valueRef.current.filter((x) => x !== entry));
    };
    // A short flash, then the chip folds away and the others close the gap
    if (el && el.animate && !reduced()) {
      el.animate(
        [
          { width: `${el.offsetWidth}px`, marginRight: "0px", opacity: 1, transform: "none" },
          { width: "0px", marginRight: "-6px", opacity: 0, transform: "scale(0.85)" },
        ],
        { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" },
      ).onfinish = finish;
    } else finish();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" && draft.trim()) || e.key === "," || e.key === ";") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Backspace" && !draft && value.length) {
      e.preventDefault();
      remove(value[value.length - 1]);
    }
    // Enter in an empty field falls through to the form: Continue
  };

  return (
    <div ref={box} className="ui-sfc__tags" data-invalid={field?.invalid || undefined} onClick={(e) => e.target === e.currentTarget && input.current?.focus()}>
      {value.length > 0 && (
        <ul ref={list} className="ui-sfc__chips" aria-label="Added">
          {value.map((entry) => (
            <li key={entry} className="ui-sfc__chip" data-entry={entry} data-leaving={leaving.includes(entry) || undefined}>
              <span className="ui-sfc__chip-text" title={entry}>
                {entry}
              </span>
              <button type="button" className="ui-sfc__chip-x" aria-label={`Remove ${entry}`} onClick={() => remove(entry)}>
                <Glyph d={icons.close} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        ref={input}
        id={field?.id}
        type="email"
        inputMode="email"
        autoComplete="off"
        spellCheck={false}
        className="ui-sfc__tags-input"
        placeholder={value.length ? "Add another" : placeholder}
        value={draft}
        aria-invalid={field?.invalid || undefined}
        aria-describedby={field?.describedBy}
        onChange={(e) => {
          setDraft(e.target.value);
          field?.flag(null);
        }}
        onKeyDown={onKeyDown}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (/[\s,;]/.test(text.trim())) {
            e.preventDefault();
            commit(`${draft} ${text}`);
          }
        }}
        onBlur={() => draft.trim() && commit(draft)}
      />
    </div>
  );
}

export type StepperChoice = {
  value: string;
  title: string;
  /** Shown on the right of the title, e.g. a price */
  aside?: ReactNode;
  description?: ReactNode;
  /** A small label, e.g. "Popular" */
  badge?: string;
};

export type StepperChoicesProps = {
  value: string;
  onChange: (value: string) => void;
  options: StepperChoice[];
  /** Name of the group for screen readers */
  label: string;
};

/** Selectable cards – a ring glides to the chosen one. Arrow keys move, Enter picks and continues */
export function StepperChoices({ value, onChange, options, label }: StepperChoicesProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    glide(listRef.current, ring.current, '[aria-checked="true"]');
  });
  // Columns turn into rows on narrow screens – the ring follows
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const ro = new ResizeObserver(() => glide(list, ring.current, '[aria-checked="true"]'));
    ro.observe(list);
    return () => ro.disconnect();
  }, []);

  // Only the first option with the value is the chosen one – two equal values don't both light up
  const at = options.findIndex((o) => o.value === value);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!options.length) return;
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step) {
      e.preventDefault();
      const to = (at + step + options.length) % options.length;
      onChange(options[to].value);
      listRef.current?.querySelector<HTMLElement>(`[data-index="${to}"]`)?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      (e.currentTarget.closest("form") as HTMLFormElement | null)?.requestSubmit();
    }
  };

  return (
    <div ref={listRef} className="ui-sfc__choices" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      <span ref={ring} className="ui-sfc__ring" aria-hidden="true" />
      {options.map((o, i) => {
        const on = i === at;
        return (
          <button
            key={`${o.value}#${i}`}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-value={o.value}
            data-index={i}
            className="ui-sfc__choice"
            onClick={() => onChange(o.value)}
          >
            <span className="ui-sfc__choice-top">
              <span className="ui-sfc__choice-title" dir="auto" title={text(o.title)}>
                {o.title}
              </span>
              {o.badge && (
                <span className="ui-sfc__badge" title={o.badge}>
                  {o.badge}
                </span>
              )}
              <span className="ui-sfc__radio" aria-hidden="true" />
            </span>
            {o.aside && <span className="ui-sfc__choice-aside">{o.aside}</span>}
            {o.description && (
              <span className="ui-sfc__choice-desc" dir="auto">
                {o.description}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export type StepperReviewRow = {
  label: string;
  value: ReactNode;
  /** Id of the step that sets it – shows an Edit link */
  step?: string;
};

/** A summary of what was entered, each row with an Edit link back to its step */
export function StepperReview({ rows, onEdit }: { rows: StepperReviewRow[]; onEdit?: (step: string) => void }) {
  return (
    <dl className="ui-sfc__review">
      {rows.map((r, i) => (
        <div key={`${text(r.label)}#${i}`} className="ui-sfc__review-row">
          <dt dir="auto">{r.label}</dt>
          <dd dir="auto">{r.value}</dd>
          {r.step && onEdit && (
            <button type="button" className="ui-sfc__edit" aria-label={`Edit ${lower(text(r.label))}`} onClick={() => onEdit(r.step!)}>
              Edit
            </button>
          )}
        </div>
      ))}
    </dl>
  );
}

/** The success state: a check pops in, a heading and a short line, plus optional actions */
export function StepperSuccess({ title, description, children }: { title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="ui-sfc__success">
      <span className="ui-sfc__success-check">
        <DrawCheck />
      </span>
      <h2 className="ui-sfc__heading" tabIndex={-1}>
        {title}
      </h2>
      {description && <p className="ui-sfc__desc">{description}</p>}
      {children && <div className="ui-sfc__success-actions">{children}</div>}
    </div>
  );
}

/* ---------- Styles ---------- */


const css = /* css */ `
/* Colors and motion as variables – override them on .ui-sfc */
.ui-sfc {
  --ui-sfc-card: #ffffff;
  --ui-sfc-ink: rgba(0, 0, 0, 0.88);
  --ui-sfc-strong: #000000;
  --ui-sfc-text: rgba(0, 0, 0, 0.61);
  --ui-sfc-muted: rgba(0, 0, 0, 0.45);
  --ui-sfc-faint: rgba(0, 0, 0, 0.27);
  --ui-sfc-icon: rgba(0, 0, 0, 0.447);
  --ui-sfc-line: rgba(0, 0, 0, 0.06);
  --ui-sfc-fill: rgba(0, 0, 0, 0.06);
  --ui-sfc-fill-strong: rgba(0, 0, 0, 0.1);
  --ui-sfc-wash: rgba(0, 0, 0, 0.03);
  --ui-sfc-wash-soft: rgba(0, 0, 0, 0.015);
  --ui-sfc-accent: rgba(0, 96, 226, 0.765);
  --ui-sfc-accent-soft: rgba(0, 96, 226, 0.08);
  --ui-sfc-accent-fill: rgba(0, 96, 226, 0.05);
  --ui-sfc-accent-line: rgba(0, 96, 226, 0.35);
  --ui-sfc-ok: #1a9a52;
  --ui-sfc-ok-soft: rgba(26, 154, 82, 0.1);
  --ui-sfc-danger: #e5484d;
  --ui-sfc-danger-soft: rgba(229, 72, 77, 0.55);
  --ui-sfc-chip: rgba(0, 0, 0, 0.88);
  --ui-sfc-chip-hover: rgba(0, 0, 0, 0.8);
  --ui-sfc-on-chip: #fcfcfc;
  --ui-sfc-white-hover: #fafafa;
  --ui-sfc-focus: rgba(0, 96, 226, 0.35);
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-sfc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-sfc-shadow-hover: 0 0 0 0.5px rgba(0, 0, 0, 0.12), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-sfc-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  container-type: inline-size;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  width: 100%;
  max-width: 520px;
  border-radius: 10px;
  background: var(--ui-sfc-card);
  box-shadow: var(--ui-sfc-shadow);
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  color: var(--ui-sfc-ink);
  -webkit-font-smoothing: antialiased;
}
.ui-sfc *, .ui-sfc *::before, .ui-sfc *::after { box-sizing: border-box; }
:where(.ui-sfc) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; }
:where(.ui-sfc) svg { display: block; flex: none; }
:where(.ui-sfc) :is(h2, p, dl, dd, ul, ol) { margin: 0; }
.ui-sfc button:focus-visible { outline: 2px solid var(--ui-sfc-focus); outline-offset: 1px; }
/* 16px icons with thin ~1.1px lines */
.ui-sfc__glyph { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.65; stroke-linecap: round; stroke-linejoin: round; }
.ui-sfc__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* A check that draws in */
.ui-sfc__draw { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.ui-sfc__draw path { stroke-dasharray: 1; stroke-dashoffset: 1; animation: ui-sfc-draw 360ms var(--ui-sfc-ease) 80ms forwards; }

/* ---- The steps on top: a thin bar per step, a small uppercase label under it ---- */
.ui-sfc__head { padding: 16px 20px 0; }
.ui-sfc__steps { position: relative; }
.ui-sfc__list { display: grid; grid-template-columns: repeat(var(--ui-sfc-n), minmax(0, 1fr)); gap: 8px; padding: 0; list-style: none; }
.ui-sfc__step { position: relative; display: grid; min-width: 0; }
.ui-sfc__step-btn {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  column-gap: 6px;
  row-gap: 6px;
  min-width: 0;
  margin: -4px;
  padding: 4px 4px 2px;
  border-radius: 6px;
  text-align: left;
  cursor: default;
  transition: background-color 100ms ease;
}
button.ui-sfc__step-btn { cursor: pointer; }
button.ui-sfc__step-btn:hover { background: var(--ui-sfc-wash); }
/* The bar fills from the left once the step is reached */
.ui-sfc__bar { position: relative; grid-column: 1 / -1; height: 2px; overflow: hidden; border-radius: 1px; background: var(--ui-sfc-line); }
.ui-sfc__bar::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--ui-sfc-accent);
  transform: scaleX(0);
  transform-origin: left center;
  transition: transform 360ms var(--ui-sfc-ease);
}
.ui-sfc__step:not([data-state="upcoming"]) .ui-sfc__bar::after { transform: none; }
/* The number, or the check once the step is done – same small slot, so the label never moves */
.ui-sfc__mark {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: flex-start;
  min-width: 12px;
  height: 16px;
  font-size: 10px;
  font-weight: 500;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--ui-sfc-faint);
  transition: color 200ms ease;
}
.ui-sfc__mark > span { animation: ui-sfc-in 260ms var(--ui-sfc-ease) both; }
.ui-sfc__mark .ui-sfc__draw { width: 12px; height: 12px; stroke-width: 2.4; }
.ui-sfc__step[data-state="current"] .ui-sfc__mark { color: var(--ui-sfc-accent); }
.ui-sfc__step[data-state="done"] .ui-sfc__mark { color: var(--ui-sfc-accent); }
.ui-sfc__step-label {
  overflow: hidden;
  min-width: 0;
  font-size: 10px;
  font-weight: 500;
  line-height: 16px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--ui-sfc-muted);
  transition: color 200ms ease;
}
.ui-sfc__step[data-state="done"] .ui-sfc__step-label { color: var(--ui-sfc-text); }
.ui-sfc__step[data-state="current"] .ui-sfc__step-label { color: var(--ui-sfc-strong); }
button.ui-sfc__step-btn:hover .ui-sfc__step-label { color: var(--ui-sfc-ink); }

/* Compact line for narrow screens: "STEP 2 OF 4 · TEAM" above the bars */
.ui-sfc__compact { display: none; }
.ui-sfc__compact-text {
  display: flex;
  min-width: 0;
  font-size: 10px;
  font-weight: 500;
  line-height: 16px;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  font-variant-numeric: tabular-nums;
  color: var(--ui-sfc-muted);
  white-space: nowrap;
  animation: ui-sfc-in 280ms var(--ui-sfc-ease) both;
}
.ui-sfc__compact-dot { margin: 0 6px; color: var(--ui-sfc-faint); }
.ui-sfc__compact-title { overflow: hidden; text-overflow: ellipsis; color: var(--ui-sfc-strong); }

/* ---- The step content: only this part clips and glides to each step's height ---- */
.ui-sfc__card { display: grid; min-width: 0; }
/* The panes carry a little padding so focus rings aren't cut */
.ui-sfc__viewport { position: relative; overflow: hidden; transition: height 360ms var(--ui-sfc-ease); }
.ui-sfc__pane { padding: 20px 20px 20px; animation: ui-sfc-enter 360ms var(--ui-sfc-ease) both; }
.ui-sfc__pane[data-dir="-1"] { animation-name: ui-sfc-enter-back; }
.ui-sfc__pane[data-first] { animation: none; }
.ui-sfc__pane[data-pane="leaving"] { position: absolute; top: 0; left: 0; right: 0; pointer-events: none; animation: ui-sfc-leave 280ms var(--ui-sfc-ease) both; }
.ui-sfc__pane[data-pane="leaving"][data-dir="-1"] { animation-name: ui-sfc-leave-back; }
.ui-sfc__heading { font-size: 15px; font-weight: 500; line-height: 24px; color: var(--ui-sfc-strong); outline: none; overflow-wrap: anywhere; }
.ui-sfc__desc { color: var(--ui-sfc-text); text-wrap: pretty; white-space: pre-line; overflow-wrap: anywhere; }
.ui-sfc__body { display: grid; gap: 16px; margin-top: 16px; }

/* Fields */
.ui-sfc__field { display: grid; min-width: 0; }
.ui-sfc__label { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin: 0 0 6px 2px; font-size: 12px; font-weight: 500; line-height: 16px; color: var(--ui-sfc-text); }
.ui-sfc__label-text { min-width: 0; overflow-wrap: anywhere; }
.ui-sfc__optional { flex: none; font-weight: 400; color: var(--ui-sfc-muted); }
.ui-sfc__control { min-width: 0; }
.ui-sfc__input, .ui-sfc__tags {
  display: flex;
  align-items: center;
  min-width: 0;
  height: 32px;
  border-radius: 8px;
  background: var(--ui-sfc-card);
  box-shadow: var(--ui-sfc-shadow);
  transition: box-shadow 120ms ease;
  cursor: text;
}
.ui-sfc__input:hover, .ui-sfc__tags:hover { box-shadow: var(--ui-sfc-shadow-hover); }
.ui-sfc__input:focus-within, .ui-sfc__tags:focus-within { outline: 2px solid var(--ui-sfc-focus); outline-offset: 1px; }
.ui-sfc__input[data-invalid], .ui-sfc__tags[data-invalid] { box-shadow: 0 0 0 0.5px var(--ui-sfc-danger), 0 1px 2px 0 rgba(229, 72, 77, 0.08); }
.ui-sfc__input[data-invalid]:focus-within, .ui-sfc__tags[data-invalid]:focus-within { outline-color: rgba(229, 72, 77, 0.3); }
.ui-sfc__input input, .ui-sfc__tags-input {
  flex: 1;
  min-width: 0;
  height: 32px;
  margin: 0;
  padding: 0 10px;
  border: 0;
  outline: none;
  background: none;
  font: inherit;
  color: var(--ui-sfc-ink);
}
.ui-sfc__input input::placeholder, .ui-sfc__tags-input::placeholder { color: var(--ui-sfc-faint); }
/* A long prefix shortens, so the field always keeps room to type */
.ui-sfc__prefix { flex: 0 1 auto; min-width: 0; max-width: 60%; overflow: hidden; padding-left: 10px; color: var(--ui-sfc-muted); white-space: nowrap; text-overflow: ellipsis; user-select: none; }
.ui-sfc__prefix + input { padding-left: 0; }

/* Message and hint fold open and closed */
.ui-sfc__fold { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 260ms var(--ui-sfc-ease), opacity 200ms ease; }
.ui-sfc__fold[data-open] { grid-template-rows: 1fr; opacity: 1; }
.ui-sfc__fold > div { min-height: 0; overflow: hidden; }
.ui-sfc__msg, .ui-sfc__hint { padding: 6px 0 0 2px; font-size: 12px; line-height: 16px; text-wrap: pretty; overflow-wrap: anywhere; }
.ui-sfc__msg { color: var(--ui-sfc-danger); animation: ui-sfc-in 240ms var(--ui-sfc-ease) both; }
.ui-sfc__hint { color: var(--ui-sfc-muted); }

/* Email chips: one line – the chips scroll sideways, the text field stays at the end */
.ui-sfc__tags { gap: 4px; padding: 0 4px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; overscroll-behavior-x: contain; }
.ui-sfc__tags::-webkit-scrollbar { display: none; }
.ui-sfc__chips { display: contents; padding: 0; list-style: none; }
.ui-sfc__chip {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 2px;
  max-width: 220px;
  height: 24px;
  padding: 0 3px 0 8px;
  overflow: hidden;
  border-radius: 6px;
  background: var(--ui-sfc-fill);
  font-size: 12px;
  font-weight: 500;
  line-height: 16px;
  color: var(--ui-sfc-ink);
  white-space: nowrap;
  animation: ui-sfc-chip 260ms var(--ui-sfc-ease) both;
}
.ui-sfc__chip[data-leaving] { pointer-events: none; }
.ui-sfc__chip-text { overflow: hidden; text-overflow: ellipsis; }
.ui-sfc__chip-x { display: grid; place-items: center; flex: none; width: 18px; height: 18px; border-radius: 4px; color: var(--ui-sfc-icon); transition: background-color 100ms ease, color 100ms ease; }
.ui-sfc__chip-x .ui-sfc__glyph { width: 12px; height: 12px; stroke-width: 1.9; }
.ui-sfc__chip-x:hover { background: var(--ui-sfc-fill); color: var(--ui-sfc-ink); }
.ui-sfc__chip[data-leaving] .ui-sfc__chip-x { background: none; }
.ui-sfc__tags-input { flex: 1 0 140px; height: 24px; padding: 0 6px; }
.ui-sfc__tags-input:first-child { padding-left: 6px; }

/* Selectable cards: white with the hairline shadow; the chosen one gets a faint blue fill and a light blue hairline that moves to it */
.ui-sfc__choices { position: relative; display: grid; grid-auto-columns: minmax(0, 1fr); grid-auto-flow: column; gap: 8px; }
.ui-sfc__ring {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  border-radius: 8px;
  box-shadow: 0 0 0 0.5px var(--ui-sfc-accent-line);
  opacity: 0;
  pointer-events: none;
  transition: transform 260ms var(--ui-sfc-ease), width 260ms var(--ui-sfc-ease), height 260ms var(--ui-sfc-ease), opacity 160ms ease;
}
.ui-sfc__choice {
  position: relative;
  display: grid;
  align-content: start;
  gap: 2px;
  min-width: 0;
  padding: 10px 12px 12px;
  border-radius: 8px;
  background: var(--ui-sfc-card);
  box-shadow: var(--ui-sfc-shadow);
  text-align: left;
  transition: background-color 100ms ease;
}
.ui-sfc__choice:hover { background: var(--ui-sfc-wash-soft); }
.ui-sfc__choice[aria-checked="true"] { background: var(--ui-sfc-accent-fill); }
.ui-sfc__choice:focus-visible { outline-offset: 3px; }
/* The title keeps a readable minimum – a long badge moves to the next line instead */
.ui-sfc__choice-top { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; min-width: 0; }
.ui-sfc__choice-title { min-width: min(100%, 72px); overflow: hidden; font-weight: 500; color: var(--ui-sfc-strong); white-space: nowrap; text-overflow: ellipsis; }
.ui-sfc__badge { flex: 0 1 auto; min-width: 0; max-width: 50%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 0 5px; border-radius: 5px; background: var(--ui-sfc-accent-soft); font-size: 11px; font-weight: 500; line-height: 16px; color: var(--ui-sfc-accent); }
.ui-sfc__radio { position: relative; flex: none; width: 14px; height: 14px; margin-left: auto; border-radius: 50%; box-shadow: inset 0 0 0 1px var(--ui-sfc-fill-strong); transition: box-shadow 200ms ease; }
.ui-sfc__radio::after { content: ""; position: absolute; inset: 3.5px; border-radius: 50%; background: var(--ui-sfc-accent); transform: scale(0); transition: transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1); }
.ui-sfc__choice[aria-checked="true"] .ui-sfc__radio { box-shadow: inset 0 0 0 1px var(--ui-sfc-accent); }
.ui-sfc__choice[aria-checked="true"] .ui-sfc__radio::after { transform: scale(1); }
.ui-sfc__choice-aside { font-variant-numeric: tabular-nums; color: var(--ui-sfc-ink); }
.ui-sfc__choice-desc { margin-top: 2px; font-size: 12px; line-height: 16px; color: var(--ui-sfc-text); text-wrap: pretty; overflow-wrap: anywhere; }

/* Review: rows under hairlines */
.ui-sfc__review { display: grid; border-radius: 8px; box-shadow: var(--ui-sfc-shadow); }
.ui-sfc__review-row { display: grid; grid-template-columns: 96px minmax(0, 1fr) auto; align-items: baseline; gap: 12px; padding: 10px 8px 10px 12px; }
.ui-sfc__review-row + .ui-sfc__review-row { border-top: 0.5px solid var(--ui-sfc-line); }
.ui-sfc__review dt { min-width: 0; font-size: 12px; line-height: 20px; color: var(--ui-sfc-muted); overflow-wrap: anywhere; }
.ui-sfc__review dd { min-width: 0; color: var(--ui-sfc-ink); overflow-wrap: anywhere; }
.ui-sfc__edit { height: 24px; margin: -2px 0; padding: 0 8px; border-radius: 6px; font-size: 12px; font-weight: 500; line-height: 16px; color: var(--ui-sfc-text); transition: background-color 100ms ease, color 100ms ease; }
.ui-sfc__edit:hover { background: var(--ui-sfc-wash); color: var(--ui-sfc-ink); }

/* Success */
.ui-sfc__success { display: grid; justify-items: center; padding: 16px 0 8px; text-align: center; }
.ui-sfc__success-check {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  margin-bottom: 12px;
  border-radius: 50%;
  background: var(--ui-sfc-ok-soft);
  color: var(--ui-sfc-ok);
  animation: ui-sfc-pop 520ms cubic-bezier(0.34, 1.56, 0.64, 1) 120ms both;
}
.ui-sfc__success-check .ui-sfc__draw { width: 18px; height: 18px; stroke-width: 2; }
.ui-sfc__success-check .ui-sfc__draw path { animation-delay: 320ms; }
.ui-sfc__success .ui-sfc__heading { animation: ui-sfc-in 340ms var(--ui-sfc-ease) 220ms both; }
.ui-sfc__success .ui-sfc__desc { max-width: 40ch; text-wrap: balance; animation: ui-sfc-in 340ms var(--ui-sfc-ease) 290ms both; }
.ui-sfc__success-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 16px; animation: ui-sfc-in 340ms var(--ui-sfc-ease) 360ms both; }

/* ---- The last row of the card: Back and Continue under a hairline; sticks to the bottom in long pages ---- */
.ui-sfc__foot-fold { position: sticky; bottom: 0; z-index: 3; display: grid; grid-template-rows: 1fr; border-radius: 0 0 10px 10px; background: var(--ui-sfc-card); transition: grid-template-rows 340ms var(--ui-sfc-ease), opacity 200ms ease; }
.ui-sfc__foot-fold[data-hidden] { grid-template-rows: 0fr; opacity: 0; }
.ui-sfc__foot { display: flex; align-items: center; gap: 12px; min-height: 0; overflow: hidden; padding: 0 12px; border-top: 0.5px solid var(--ui-sfc-line); }
/* The row's height lives on a pseudo spacer so the fold can still close it to 0 */
.ui-sfc__foot::before { content: ""; flex: none; width: 0; height: 48px; margin-right: -12px; }
.ui-sfc__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  height: 28px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  white-space: nowrap;
  transition: background-color 100ms ease, opacity 200ms ease, transform 120ms ease, width 300ms var(--ui-sfc-ease), visibility 200ms;
}
/* Secondary: white with the hairline shadow */
.ui-sfc__btn-ghost, .ui-sfc__btn-secondary { gap: 6px; padding: 0 10px 0 8px; background: var(--ui-sfc-card); box-shadow: var(--ui-sfc-shadow); color: var(--ui-sfc-strong); }
.ui-sfc__btn-secondary { padding: 0 10px; }
.ui-sfc__btn-ghost .ui-sfc__glyph { color: var(--ui-sfc-icon); }
.ui-sfc__btn-ghost:hover, .ui-sfc__btn-secondary:hover { background: var(--ui-sfc-white-hover); }
.ui-sfc__btn-ghost[data-hidden] { opacity: 0; visibility: hidden; }
/* Primary: the dark chip */
.ui-sfc__btn-primary { margin-left: auto; overflow: hidden; background: var(--ui-sfc-chip); color: var(--ui-sfc-on-chip); }
.ui-sfc__btn-primary:hover { background: var(--ui-sfc-chip-hover); }
.ui-sfc__btn:active { transform: scale(0.97); }
/* Not ready yet: dimmed, but still answers a press with the messages */
.ui-sfc__btn-primary[aria-disabled="true"] { opacity: 0.35; }
.ui-sfc__btn-primary[data-busy] { opacity: 0.7; cursor: progress; }
/* A long label shortens – the button never grows past the room Back leaves it */
.ui-sfc__btn-inner { display: inline-flex; flex: none; align-items: center; gap: 6px; max-width: calc(100cqw - 112px); padding: 0 10px; }
.ui-sfc__btn-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; animation: ui-sfc-in 240ms var(--ui-sfc-ease) both; }
.ui-sfc__spinner { width: 12px; height: 12px; border-radius: 50%; border: 1.5px solid currentColor; border-right-color: transparent; animation: ui-sfc-spin 700ms linear infinite; }
.ui-sfc__submit-error { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; font-size: 12px; line-height: 16px; color: var(--ui-sfc-danger); animation: ui-sfc-in 240ms var(--ui-sfc-ease) both; }

@keyframes ui-sfc-in { from { opacity: 0; transform: translateY(3px); filter: blur(2px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes ui-sfc-enter { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
@keyframes ui-sfc-enter-back { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: none; } }
@keyframes ui-sfc-leave { to { opacity: 0; transform: translateX(-24px); } }
@keyframes ui-sfc-leave-back { to { opacity: 0; transform: translateX(24px); } }
@keyframes ui-sfc-draw { to { stroke-dashoffset: 0; } }
@keyframes ui-sfc-pop { 0% { opacity: 0; transform: scale(0.4); } 60% { opacity: 1; transform: scale(1.08); } 100% { opacity: 1; transform: scale(1); } }
@keyframes ui-sfc-chip { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: none; } }
@keyframes ui-sfc-spin { to { transform: rotate(360deg); } }

/* Narrow (phones): the compact line over the bars, cards as rows, stacked review rows */
@container (max-width: 420px) {
  .ui-sfc__head { padding: 14px 16px 0; }
  .ui-sfc__compact { display: flex; margin-bottom: 8px; }
  /* Many steps: the gaps shrink so every bar still fits – with a few steps they stay 8px */
  .ui-sfc__list { gap: min(8px, calc((100cqw - 32px) / (var(--ui-sfc-n) * 4))); }
  .ui-sfc__step-btn { row-gap: 0; padding-bottom: 4px; }
  .ui-sfc__mark, .ui-sfc__step-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .ui-sfc__pane { padding: 16px 16px 16px; }
  .ui-sfc__foot { padding: 0 12px; }
  .ui-sfc__choices { grid-template-columns: minmax(0, 1fr); grid-auto-flow: row; }
  .ui-sfc__choice { grid-template-columns: minmax(0, 1fr) auto; column-gap: 10px; padding: 10px 12px; }
  .ui-sfc__choice-top { grid-column: 1; }
  .ui-sfc__choice-aside { grid-column: 2; grid-row: 1; align-self: center; }
  .ui-sfc__choice-desc { grid-column: 1 / -1; margin-top: 0; }
  .ui-sfc__radio { order: -1; margin-left: 0; margin-right: 2px; }
  .ui-sfc__review-row { grid-template-columns: minmax(0, 1fr) auto; row-gap: 0; }
  .ui-sfc__review dt { grid-column: 1; }
  .ui-sfc__review dd { grid-column: 1; grid-row: 2; }
  .ui-sfc__edit { grid-column: 2; grid-row: 1 / span 2; align-self: center; margin: 0; }
}
/* Touch screens: 16px fields (no zoom on iOS) and taller targets */
@media (hover: none) and (pointer: coarse) {
  .ui-sfc__input input, .ui-sfc__tags-input, .ui-sfc__prefix { font-size: 16px; }
  .ui-sfc__input, .ui-sfc__tags, .ui-sfc__input input { height: 40px; }
  .ui-sfc__chip { height: 30px; }
  .ui-sfc__chip-x { width: 26px; height: 26px; }
  .ui-sfc__tags-input { height: 30px; }
  .ui-sfc__btn { height: 36px; }
  .ui-sfc__foot::before { height: 56px; }
  .ui-sfc__edit { height: 34px; padding: 0 12px; }
  .ui-sfc__step-btn { padding-top: 10px; padding-bottom: 8px; margin: -10px -4px -8px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-sfc *, .ui-sfc *::before, .ui-sfc *::after { animation-duration: 1ms !important; animation-delay: 0ms !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-sfc {
  --ui-sfc-card: #1c1c1e;
  --ui-sfc-ink: rgba(255, 255, 255, 0.9);
  --ui-sfc-strong: #ffffff;
  --ui-sfc-text: rgba(255, 255, 255, 0.62);
  --ui-sfc-muted: rgba(255, 255, 255, 0.46);
  --ui-sfc-faint: rgba(255, 255, 255, 0.3);
  --ui-sfc-icon: rgba(255, 255, 255, 0.5);
  --ui-sfc-line: rgba(255, 255, 255, 0.08);
  --ui-sfc-fill: rgba(255, 255, 255, 0.08);
  --ui-sfc-fill-strong: rgba(255, 255, 255, 0.16);
  --ui-sfc-wash: rgba(255, 255, 255, 0.04);
  --ui-sfc-wash-soft: rgba(255, 255, 255, 0.025);
  --ui-sfc-accent: #4d8dff;
  --ui-sfc-accent-soft: rgba(77, 141, 255, 0.14);
  --ui-sfc-accent-fill: rgba(77, 141, 255, 0.09);
  --ui-sfc-accent-line: rgba(77, 141, 255, 0.5);
  --ui-sfc-ok: #3ec27a;
  --ui-sfc-ok-soft: rgba(62, 194, 122, 0.14);
  --ui-sfc-danger: #ff6369;
  --ui-sfc-chip: rgba(255, 255, 255, 0.9);
  --ui-sfc-chip-hover: rgba(255, 255, 255, 0.8);
  --ui-sfc-on-chip: #111113;
  --ui-sfc-white-hover: #232326;
  --ui-sfc-focus: rgba(77, 141, 255, 0.5);
  --ui-sfc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-sfc-shadow-hover: 0 0 0 0.5px rgba(255, 255, 255, 0.16), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
}
`;
