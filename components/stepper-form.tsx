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
 * Stepper Form – a multi-step flow for onboarding, checkout or setup wizards, in a single self-contained file.
 * Numbered steps on top; finished steps swap their number for a check that draws in.
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
  <svg viewBox="0 0 24 24" className={cx("ui-sf__glyph", className)} aria-hidden="true">
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
  <svg viewBox="0 0 24 24" className={cx("ui-sf__draw", className)} aria-hidden="true">
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
    (field ?? pane?.querySelector<HTMLElement>(".ui-sf__heading"))?.focus({ preventScroll: true });
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
        <h2 className="ui-sf__heading" tabIndex={-1} id={`${uid}-h${i}`} dir="auto">
          {s.heading ?? s.title}
        </h2>
        {s.description && (
          <p className="ui-sf__desc" dir="auto">
            {s.description}
          </p>
        )}
        <div className="ui-sf__body">{s.render(paneCtx)}</div>
      </>
    );
  };

  const panes = view.from !== null && view.from !== view.index ? [view.from, view.index] : [view.index];

  return (
    <div className={cx("ui-sf", className)} style={{ "--ui-sf-n": n } as CSSProperties}>
      {/* React 19 hoists this into <head> once, no matter how many forms render */}
      <style href="ui-stepper-form" precedence="default">
        {css}
      </style>

      <div className="ui-sf__head">
        {/* Wide: the full list of steps. Narrow: kept for screen readers, replaced on screen by the compact line */}
        <div className="ui-sf__steps">
          <ol className="ui-sf__list" aria-label="Progress">
          {steps.map((s, i) => {
            const state = done || (i < furthest && i !== index) ? "done" : i === index ? "current" : "upcoming";
            const canJump = !done && !submitting && i !== index && i <= furthest;
            const inner = (
              <>
                <span className="ui-sf__mark">
                  {state === "done" ? <DrawCheck key="check" /> : <span key="num">{i + 1}.</span>}
                </span>
                <span className="ui-sf__step-label" dir="auto">
                  {s.title}
                </span>
                <span className="ui-sf__sr">{state === "done" ? " (done)" : state === "current" ? " (current)" : ""}</span>
              </>
            );
            return (
              <li key={`${s.id}#${i}`} className="ui-sf__step" data-state={state} aria-current={!done && i === index ? "step" : undefined}>
                {canJump ? (
                  <button type="button" className="ui-sf__step-btn" title={text(s.title) || undefined} onClick={() => goToIndex(i)}>
                    {inner}
                  </button>
                ) : (
                  <span className="ui-sf__step-btn" title={text(s.title) || undefined}>
                    {inner}
                  </span>
                )}
              </li>
            );
          })}
          </ol>
        </div>

        <div className="ui-sf__compact" aria-hidden="true">
          <span className="ui-sf__compact-text" key={done ? "done" : index}>
            {done ? (
              <>All {fmt(n)} steps done</>
            ) : (
              <>
                Step {fmt(index + 1)} of {fmt(n)}
                <span className="ui-sf__compact-dot">·</span>
                <span className="ui-sf__compact-title" dir="auto">
                  {current.title}
                </span>
              </>
            )}
          </span>
        </div>
      </div>

      <form ref={formRef} className="ui-sf__card" noValidate onSubmit={submit} aria-labelledby={done ? undefined : `${uid}-h${index}`}>
        <div ref={viewport} className="ui-sf__viewport">
          {panes.map((i) => {
            const isCurrent = i === view.index;
            return (
              <div
                key={i}
                className="ui-sf__pane"
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
        <div className="ui-sf__foot-fold" data-hidden={done || undefined}>
          <div className="ui-sf__foot" inert={done}>
            <button type="button" className="ui-sf__btn ui-sf__btn-ghost" data-hidden={index === 0 || undefined} disabled={index === 0 || submitting} onClick={back}>
              <Glyph d={icons.back} />
              Back
            </button>
            {submitError && (
              <span className="ui-sf__submit-error" role="alert" dir="auto">
                {submitError}
              </span>
            )}
            <button
              ref={btn}
              type="submit"
              className="ui-sf__btn ui-sf__btn-primary"
              aria-disabled={!valid || submitting || undefined}
              data-busy={submitting || undefined}
            >
              <span ref={btnInner} className="ui-sf__btn-inner">
                {submitting && <span className="ui-sf__spinner" aria-hidden="true" />}
                <span className="ui-sf__btn-label" key={label} title={label}>
                  {label}
                </span>
              </span>
            </button>
          </div>
        </div>
      </form>

      <span className="ui-sf__sr" aria-live="polite">
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
    <div className="ui-sf__field" data-invalid={invalid || undefined}>
      <label className="ui-sf__label" htmlFor={id} dir="auto">
        <span className="ui-sf__label-text">{label}</span>
        {optional && <span className="ui-sf__optional">Optional</span>}
      </label>
      <div ref={control} className="ui-sf__control">
        <FieldContext.Provider value={{ id, invalid, describedBy: invalid ? `${id}-msg` : hint ? `${id}-hint` : undefined, flag }}>
          {children}
        </FieldContext.Provider>
      </div>
      <div className="ui-sf__fold" data-open={invalid || undefined}>
        <div>
          <p className="ui-sf__msg" id={`${id}-msg`} key={lastMessage.current} dir="auto">
            {lastMessage.current}
          </p>
        </div>
      </div>
      {hint && (
        <div className="ui-sf__fold" data-open={!invalid || undefined}>
          <div>
            <p className="ui-sf__hint" id={`${id}-hint`} dir="auto">
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
    <div className={cx("ui-sf__input", className)} data-invalid={field?.invalid || undefined}>
      {prefix && (
        <span className="ui-sf__prefix" aria-hidden="true" title={prefix}>
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
    <div className="ui-sf__tags" data-invalid={field?.invalid || undefined} onClick={(e) => e.target === e.currentTarget && input.current?.focus()}>
      {value.length > 0 && (
        <ul ref={list} className="ui-sf__chips" aria-label="Added">
          {value.map((entry) => (
            <li key={entry} className="ui-sf__chip" data-entry={entry} data-leaving={leaving.includes(entry) || undefined}>
              <span className="ui-sf__chip-text" title={entry}>
                {entry}
              </span>
              <button type="button" className="ui-sf__chip-x" aria-label={`Remove ${entry}`} onClick={() => remove(entry)}>
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
        className="ui-sf__tags-input"
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
    <div ref={listRef} className="ui-sf__choices" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      <span ref={ring} className="ui-sf__ring" aria-hidden="true" />
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
            className="ui-sf__choice"
            onClick={() => onChange(o.value)}
          >
            <span className="ui-sf__choice-top">
              <span className="ui-sf__choice-title" dir="auto" title={text(o.title)}>
                {o.title}
              </span>
              {o.badge && (
                <span className="ui-sf__badge" title={o.badge}>
                  {o.badge}
                </span>
              )}
              <span className="ui-sf__radio" aria-hidden="true" />
            </span>
            {o.aside && <span className="ui-sf__choice-aside">{o.aside}</span>}
            {o.description && (
              <span className="ui-sf__choice-desc" dir="auto">
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
    <dl className="ui-sf__review">
      {rows.map((r, i) => (
        <div key={`${text(r.label)}#${i}`} className="ui-sf__review-row">
          <dt dir="auto">{r.label}</dt>
          <dd dir="auto">{r.value}</dd>
          {r.step && onEdit && (
            <button type="button" className="ui-sf__edit" aria-label={`Edit ${lower(text(r.label))}`} onClick={() => onEdit(r.step!)}>
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
    <div className="ui-sf__success">
      <span className="ui-sf__success-check">
        <DrawCheck />
      </span>
      <h2 className="ui-sf__heading" tabIndex={-1}>
        {title}
      </h2>
      {description && <p className="ui-sf__desc">{description}</p>}
      {children && <div className="ui-sf__success-actions">{children}</div>}
    </div>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-sf */
.ui-sf {
  --ui-sf-tray: #f0f0f0;
  --ui-sf-card: #ffffff;
  --ui-sf-line: #ececec;
  --ui-sf-ink: #171717;
  --ui-sf-text: #404040;
  --ui-sf-muted: #8f8f8f;
  --ui-sf-faint: #b5b5b5;
  --ui-sf-edge: #dcdcdf;
  --ui-sf-field: #ffffff;
  --ui-sf-hover: #f2f2f3;
  --ui-sf-chip: #f2f2f3;
  --ui-sf-track: #e2e2e5;
  --ui-sf-accent: #2f6bff;
  --ui-sf-accent-soft: rgba(47, 107, 255, 0.05);
  --ui-sf-danger: #e5484d;
  --ui-sf-on-ink: #ffffff;
  --ui-sf-focus: rgba(23, 23, 23, 0.22);
  --ui-sf-ring: rgba(23, 23, 23, 0.08);
  --ui-sf-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  container-type: inline-size;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  width: 100%;
  max-width: 520px;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-sf-tray);
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--ui-sf-text);
  -webkit-font-smoothing: antialiased;
}
.ui-sf *, .ui-sf *::before, .ui-sf *::after { box-sizing: border-box; }
:where(.ui-sf) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; }
:where(.ui-sf) svg { display: block; flex: none; }
:where(.ui-sf) :is(h2, p, dl, dd, ul, ol) { margin: 0; }
.ui-sf button:focus-visible { outline: 2px solid var(--ui-sf-focus); outline-offset: 2px; }
.ui-sf__glyph { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.ui-sf__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* A check that draws in */
.ui-sf__draw { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
.ui-sf__draw path { stroke-dasharray: 1; stroke-dashoffset: 1; animation: ui-sf-draw 360ms var(--ui-sf-ease) 80ms forwards; }

/* ---- The steps on the tray: "1. Account" in a row, the current one in ink ---- */
.ui-sf__head { padding: 6px 6px 4px; }
.ui-sf__steps { position: relative; }
.ui-sf__list { display: grid; grid-template-columns: repeat(var(--ui-sf-n), minmax(0, 1fr)); padding: 0; list-style: none; }
.ui-sf__step { position: relative; display: grid; justify-items: center; min-width: 0; }
.ui-sf__step-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  max-width: 100%;
  height: 26px;
  padding: 0 6px;
  border-radius: 8px;
  line-height: 1;
  cursor: default;
  transition: background-color 200ms ease;
}
button.ui-sf__step-btn { cursor: pointer; }
button.ui-sf__step-btn:hover { background: var(--ui-sf-ring); }
/* The number, or the check once the step is done – same small slot, so the label never moves */
.ui-sf__mark {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  font-size: 12.5px;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: var(--ui-sf-faint);
  transition: color 260ms ease;
}
.ui-sf__mark > span { line-height: 1; animation: ui-sf-in 260ms var(--ui-sf-ease) both; }
.ui-sf__mark .ui-sf__draw { width: 13px; height: 13px; stroke-width: 2.4; }
.ui-sf__step[data-state="current"] .ui-sf__mark { color: var(--ui-sf-ink); }
.ui-sf__step[data-state="done"] .ui-sf__mark { color: var(--ui-sf-ink); }
.ui-sf__step-label {
  overflow: hidden;
  max-width: 100%;
  font-size: 12.5px;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--ui-sf-muted);
  transition: color 260ms ease;
}
.ui-sf__step[data-state="done"] .ui-sf__step-label { color: var(--ui-sf-text); }
.ui-sf__step[data-state="current"] .ui-sf__step-label { color: var(--ui-sf-ink); font-weight: 500; }
button.ui-sf__step-btn:hover .ui-sf__step-label { color: var(--ui-sf-ink); }

/* Compact header for narrow screens */
.ui-sf__compact { display: none; gap: 8px; padding: 0 6px; }
.ui-sf__compact-text { display: flex; align-items: baseline; min-width: 0; font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--ui-sf-muted); white-space: nowrap; animation: ui-sf-in 280ms var(--ui-sf-ease) both; }
.ui-sf__compact-dot { margin: 0 6px; color: var(--ui-sf-faint); }
.ui-sf__compact-title { overflow: hidden; text-overflow: ellipsis; color: var(--ui-sf-ink); font-weight: 500; }

/* ---- The white card ---- */
.ui-sf__card { display: grid; border-radius: 16px; background: var(--ui-sf-card); box-shadow: 0 0 0 1px var(--ui-sf-line), 0 1px 2px rgba(0, 0, 0, 0.04); }
/* Clips the sliding panes; the panes carry a little padding so focus rings aren't cut */
.ui-sf__viewport { position: relative; overflow: hidden; transition: height 380ms var(--ui-sf-ease); }
.ui-sf__pane { padding: 20px 20px 8px; animation: ui-sf-enter 380ms var(--ui-sf-ease) both; }
.ui-sf__pane[data-dir="-1"] { animation-name: ui-sf-enter-back; }
.ui-sf__pane[data-first] { animation: none; }
.ui-sf__pane[data-pane="leaving"] { position: absolute; top: 0; left: 0; right: 0; pointer-events: none; animation: ui-sf-leave 300ms var(--ui-sf-ease) both; }
.ui-sf__pane[data-pane="leaving"][data-dir="-1"] { animation-name: ui-sf-leave-back; }
.ui-sf__heading { font-size: 16px; font-weight: 600; line-height: 1.3; letter-spacing: -0.01em; color: var(--ui-sf-ink); outline: none; overflow-wrap: anywhere; }
.ui-sf__desc { margin-top: 4px; color: var(--ui-sf-muted); text-wrap: pretty; white-space: pre-line; overflow-wrap: anywhere; }
.ui-sf__body { display: grid; gap: 14px; margin-top: 18px; }

/* Fields */
.ui-sf__field { display: grid; min-width: 0; }
.ui-sf__label { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 6px; font-size: 12.5px; font-weight: 500; color: var(--ui-sf-ink); }
.ui-sf__label-text { min-width: 0; overflow-wrap: anywhere; }
.ui-sf__optional { font-weight: 400; color: var(--ui-sf-muted); }
.ui-sf__control { min-width: 0; }
.ui-sf__input, .ui-sf__tags {
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: 38px;
  border-radius: 10px;
  background: var(--ui-sf-field);
  box-shadow: inset 0 0 0 1px var(--ui-sf-edge), 0 1px 2px rgba(0, 0, 0, 0.03);
  transition: box-shadow 180ms ease;
  cursor: text;
}
.ui-sf__input:hover, .ui-sf__tags:hover { box-shadow: inset 0 0 0 1px var(--ui-sf-faint), 0 1px 2px rgba(0, 0, 0, 0.03); }
.ui-sf__input:focus-within, .ui-sf__tags:focus-within { box-shadow: inset 0 0 0 1px var(--ui-sf-ink), 0 0 0 3px var(--ui-sf-ring); }
.ui-sf__input[data-invalid], .ui-sf__tags[data-invalid] { box-shadow: inset 0 0 0 1px var(--ui-sf-danger); }
.ui-sf__input[data-invalid]:focus-within, .ui-sf__tags[data-invalid]:focus-within { box-shadow: inset 0 0 0 1px var(--ui-sf-danger), 0 0 0 3px rgba(229, 72, 77, 0.12); }
.ui-sf__input input, .ui-sf__tags-input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border: 0;
  outline: none;
  background: none;
  font: inherit;
  font-size: 14px;
  color: var(--ui-sf-ink);
}
.ui-sf__input input::placeholder, .ui-sf__tags-input::placeholder { color: var(--ui-sf-faint); }
/* A long prefix shortens, so the field always keeps room to type */
.ui-sf__prefix { flex: 0 1 auto; min-width: 0; max-width: 60%; overflow: hidden; padding-left: 12px; font-size: 14px; color: var(--ui-sf-muted); white-space: nowrap; text-overflow: ellipsis; user-select: none; }
.ui-sf__prefix + input { padding-left: 1px; }

/* Message and hint fold open and closed */
.ui-sf__fold { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 260ms var(--ui-sf-ease), opacity 200ms ease; }
.ui-sf__fold[data-open] { grid-template-rows: 1fr; opacity: 1; }
.ui-sf__fold > div { min-height: 0; overflow: hidden; }
.ui-sf__msg, .ui-sf__hint { padding-top: 6px; font-size: 12.5px; text-wrap: pretty; overflow-wrap: anywhere; }
.ui-sf__msg { color: var(--ui-sf-danger); animation: ui-sf-in 240ms var(--ui-sf-ease) both; }
.ui-sf__hint { color: var(--ui-sf-muted); }

/* Email chips */
.ui-sf__tags { flex-wrap: wrap; gap: 6px; padding: 5px; }
.ui-sf__chips { display: contents; padding: 0; list-style: none; }
.ui-sf__chip {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
  height: 28px;
  padding: 0 2px 0 10px;
  overflow: hidden;
  border-radius: 8px;
  background: var(--ui-sf-chip);
  font-size: 13px;
  color: var(--ui-sf-ink);
  white-space: nowrap;
  animation: ui-sf-chip 300ms var(--ui-sf-ease) both;
}
.ui-sf__chip[data-leaving] { pointer-events: none; }
.ui-sf__chip-text { overflow: hidden; text-overflow: ellipsis; }
.ui-sf__chip-x { display: grid; place-items: center; flex: none; width: 24px; height: 24px; border-radius: 6px; color: var(--ui-sf-muted); transition: background-color 140ms ease, color 140ms ease; }
.ui-sf__chip-x .ui-sf__glyph { width: 13px; height: 13px; }
.ui-sf__chip-x:hover { background: var(--ui-sf-track); color: var(--ui-sf-ink); }
.ui-sf__chip[data-leaving] .ui-sf__chip-x { background: none; }
.ui-sf__tags-input { flex: 1 1 140px; height: 28px; padding: 0 7px; }

/* Selectable cards with a ring that glides */
.ui-sf__choices { position: relative; display: grid; grid-auto-columns: minmax(0, 1fr); grid-auto-flow: column; gap: 8px; }
.ui-sf__ring {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 2;
  border-radius: 12px;
  box-shadow: inset 0 0 0 1.5px var(--ui-sf-accent), 0 0 0 3px rgba(47, 107, 255, 0.1);
  opacity: 0;
  pointer-events: none;
  transition: transform 380ms var(--ui-sf-ease), width 380ms var(--ui-sf-ease), height 380ms var(--ui-sf-ease), opacity 200ms ease;
}
.ui-sf__choice {
  position: relative;
  display: grid;
  align-content: start;
  gap: 2px;
  min-width: 0;
  padding: 12px;
  border-radius: 12px;
  background: var(--ui-sf-field);
  box-shadow: inset 0 0 0 1px var(--ui-sf-edge);
  text-align: left;
  transition: background-color 200ms ease, box-shadow 200ms ease;
}
.ui-sf__choice:hover { box-shadow: inset 0 0 0 1px var(--ui-sf-faint); }
.ui-sf__choice[aria-checked="true"] { background: var(--ui-sf-accent-soft); box-shadow: inset 0 0 0 1px transparent; }
.ui-sf__choice:focus-visible { outline-offset: 3px; }
/* The title keeps a readable minimum – a long badge moves to the next line instead */
.ui-sf__choice-top { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; min-width: 0; }
.ui-sf__choice-title { min-width: min(100%, 72px); overflow: hidden; font-weight: 600; color: var(--ui-sf-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-sf__badge { flex: 0 1 auto; min-width: 0; max-width: 50%; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; padding: 1px 6px; border-radius: 6px; background: var(--ui-sf-chip); font-size: 11px; font-weight: 500; color: var(--ui-sf-text); }
.ui-sf__radio { position: relative; flex: none; width: 16px; height: 16px; margin-left: auto; border-radius: 50%; box-shadow: inset 0 0 0 1.5px var(--ui-sf-edge); transition: box-shadow 220ms ease; }
.ui-sf__radio::after { content: ""; position: absolute; inset: 4px; border-radius: 50%; background: var(--ui-sf-accent); transform: scale(0); transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1); }
.ui-sf__choice[aria-checked="true"] .ui-sf__radio { box-shadow: inset 0 0 0 1.5px var(--ui-sf-accent); }
.ui-sf__choice[aria-checked="true"] .ui-sf__radio::after { transform: scale(1); }
.ui-sf__choice-aside { font-size: 13px; font-variant-numeric: tabular-nums; color: var(--ui-sf-ink); }
.ui-sf__choice-desc { margin-top: 4px; font-size: 12px; line-height: 1.4; color: var(--ui-sf-muted); text-wrap: pretty; overflow-wrap: anywhere; }

/* Review */
.ui-sf__review { display: grid; border-radius: 12px; box-shadow: inset 0 0 0 1px var(--ui-sf-line); }
.ui-sf__review-row { display: grid; grid-template-columns: 96px minmax(0, 1fr) auto; align-items: baseline; gap: 12px; padding: 11px 8px 11px 14px; }
.ui-sf__review-row + .ui-sf__review-row { border-top: 1px solid var(--ui-sf-line); }
.ui-sf__review dt { min-width: 0; font-size: 12.5px; color: var(--ui-sf-muted); overflow-wrap: anywhere; }
.ui-sf__review dd { min-width: 0; color: var(--ui-sf-ink); overflow-wrap: anywhere; }
.ui-sf__edit { height: 26px; margin: -4px 0; padding: 0 8px; border-radius: 7px; font-size: 12.5px; font-weight: 500; color: var(--ui-sf-text); transition: background-color 140ms ease, color 140ms ease; }
.ui-sf__edit:hover { background: var(--ui-sf-hover); color: var(--ui-sf-ink); }

/* Success */
.ui-sf__success { display: grid; justify-items: center; padding: 20px 0 14px; text-align: center; }
.ui-sf__success-check {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  margin-bottom: 14px;
  border-radius: 50%;
  background: var(--ui-sf-ink);
  color: var(--ui-sf-on-ink);
  box-shadow: 0 0 0 6px var(--ui-sf-ring);
  animation: ui-sf-pop 520ms cubic-bezier(0.34, 1.56, 0.64, 1) 120ms both;
}
.ui-sf__success-check .ui-sf__draw { width: 20px; height: 20px; }
.ui-sf__success-check .ui-sf__draw path { animation-delay: 320ms; }
.ui-sf__success .ui-sf__heading { animation: ui-sf-in 340ms var(--ui-sf-ease) 220ms both; }
.ui-sf__success .ui-sf__desc { max-width: 40ch; text-wrap: balance; animation: ui-sf-in 340ms var(--ui-sf-ease) 290ms both; }
.ui-sf__success-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 16px; animation: ui-sf-in 340ms var(--ui-sf-ease) 360ms both; }

/* ---- Footer: sticks to the bottom of the screen in long pages ---- */
.ui-sf__foot-fold { position: sticky; bottom: 0; z-index: 3; display: grid; grid-template-rows: 1fr; border-radius: 0 0 16px 16px; background: var(--ui-sf-card); transition: grid-template-rows 360ms var(--ui-sf-ease), opacity 220ms ease; }
.ui-sf__foot-fold[data-hidden] { grid-template-rows: 0fr; opacity: 0; }
.ui-sf__foot { display: flex; align-items: center; gap: 10px; min-height: 0; overflow: hidden; padding: 12px 16px 16px; }
.ui-sf__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  height: 36px;
  border-radius: 10px;
  font-weight: 500;
  white-space: nowrap;
  transition: background-color 140ms ease, opacity 200ms ease, transform 140ms ease, width 320ms var(--ui-sf-ease), visibility 200ms;
}
.ui-sf__btn-ghost { gap: 4px; padding: 0 12px 0 8px; color: var(--ui-sf-text); }
.ui-sf__btn-ghost:hover { background: var(--ui-sf-hover); color: var(--ui-sf-ink); }
.ui-sf__btn-ghost[data-hidden] { opacity: 0; visibility: hidden; }
.ui-sf__btn-primary { margin-left: auto; overflow: hidden; background: var(--ui-sf-ink); color: var(--ui-sf-on-ink); }
.ui-sf__btn-primary:hover { opacity: 0.88; }
.ui-sf__btn-primary:active { transform: scale(0.97); }
/* Not ready yet: dimmed, but still answers a press with the messages */
.ui-sf__btn-primary[aria-disabled="true"] { opacity: 0.4; }
.ui-sf__btn-primary[data-busy] { opacity: 0.75; cursor: progress; }
/* A long label shortens – the button never grows past the room Back leaves it */
.ui-sf__btn-inner { display: inline-flex; flex: none; align-items: center; gap: 8px; max-width: calc(100cqw - 120px); padding: 0 15px; }
.ui-sf__btn-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; animation: ui-sf-in 260ms var(--ui-sf-ease) both; }
.ui-sf__btn-secondary { padding: 0 14px; color: var(--ui-sf-text); box-shadow: inset 0 0 0 1px var(--ui-sf-edge); }
.ui-sf__btn-secondary:hover { background: var(--ui-sf-hover); color: var(--ui-sf-ink); }
.ui-sf__spinner { width: 13px; height: 13px; border-radius: 50%; border: 1.8px solid currentColor; border-right-color: transparent; animation: ui-sf-spin 700ms linear infinite; }
.ui-sf__submit-error { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; font-size: 12.5px; color: var(--ui-sf-danger); animation: ui-sf-in 240ms var(--ui-sf-ease) both; }

@keyframes ui-sf-in { from { opacity: 0; transform: translateY(4px); filter: blur(2px); } to { opacity: 1; transform: none; filter: none; } }
@keyframes ui-sf-enter { from { opacity: 0; transform: translateX(28px); } to { opacity: 1; transform: none; } }
@keyframes ui-sf-enter-back { from { opacity: 0; transform: translateX(-28px); } to { opacity: 1; transform: none; } }
@keyframes ui-sf-leave { to { opacity: 0; transform: translateX(-28px); } }
@keyframes ui-sf-leave-back { to { opacity: 0; transform: translateX(28px); } }
@keyframes ui-sf-draw { to { stroke-dashoffset: 0; } }
@keyframes ui-sf-pop { 0% { opacity: 0; transform: scale(0.4); } 60% { opacity: 1; transform: scale(1.08); } 100% { opacity: 1; transform: scale(1); } }
@keyframes ui-sf-chip { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: none; } }
@keyframes ui-sf-spin { to { transform: rotate(360deg); } }

/* Narrow (phones): the compact header, cards as rows, stacked review rows, bigger buttons */
@container (max-width: 420px) {
  .ui-sf__head { padding: 12px 8px 12px; }
  .ui-sf__steps { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
  .ui-sf__compact { display: grid; }
  .ui-sf__pane { padding: 18px 16px 6px; }
  .ui-sf__foot { padding: 12px 12px 12px; }
  .ui-sf__btn { height: 40px; }
  .ui-sf__choices { grid-template-columns: minmax(0, 1fr); grid-auto-flow: row; }
  .ui-sf__choice { grid-template-columns: minmax(0, 1fr) auto; column-gap: 10px; }
  .ui-sf__choice-top { grid-column: 1; }
  .ui-sf__choice-aside { grid-column: 2; grid-row: 1; align-self: center; }
  .ui-sf__choice-desc { grid-column: 1 / -1; margin-top: 2px; }
  .ui-sf__radio { order: -1; margin-left: 0; margin-right: 2px; }
  .ui-sf__review-row { grid-template-columns: minmax(0, 1fr) auto; row-gap: 2px; padding-left: 12px; }
  .ui-sf__review dt { grid-column: 1; }
  .ui-sf__review dd { grid-column: 1; grid-row: 2; }
  .ui-sf__edit { grid-column: 2; grid-row: 1 / span 2; align-self: center; margin: 0; }
}
/* Touch screens: 16px fields (no zoom on iOS) and 40px targets */
@media (hover: none) and (pointer: coarse) {
  .ui-sf__input input, .ui-sf__tags-input, .ui-sf__prefix { font-size: 16px; }
  .ui-sf__input, .ui-sf__tags { min-height: 44px; }
  .ui-sf__input input { height: 42px; }
  .ui-sf__chip { height: 32px; }
  .ui-sf__chip-x { width: 30px; height: 30px; }
  .ui-sf__btn { height: 42px; }
  .ui-sf__edit { height: 36px; padding: 0 12px; }
  .ui-sf__step-btn { padding: 4px; margin: -4px 0; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-sf *, .ui-sf *::before, .ui-sf *::after { animation-duration: 1ms !important; animation-delay: 0ms !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-sf {
  --ui-sf-tray: #111113;
  --ui-sf-card: #19191b;
  --ui-sf-line: #2a2a2e;
  --ui-sf-ink: #ededed;
  --ui-sf-text: #c8c8cc;
  --ui-sf-muted: #8b8b92;
  --ui-sf-faint: #5c5c63;
  --ui-sf-edge: #34343a;
  --ui-sf-field: #1d1d20;
  --ui-sf-hover: #232326;
  --ui-sf-chip: #2a2a2e;
  --ui-sf-track: #2e2e33;
  --ui-sf-accent: #6d8bff;
  --ui-sf-accent-soft: rgba(109, 139, 255, 0.08);
  --ui-sf-danger: #ff6369;
  --ui-sf-on-ink: #111113;
  --ui-sf-focus: rgba(255, 255, 255, 0.3);
  --ui-sf-ring: rgba(255, 255, 255, 0.08);
}
`;
