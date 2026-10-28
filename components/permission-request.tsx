"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/*
 * Permission Request – an agent asks for one specific right, in a single self-contained file.
 * A white card on a soft gray tray: who asks for what ("Coder wants to push to main"), why, and exactly what will happen –
 * the files, recipients or amounts – before anything does.
 *   · on the tray below, pick how long the right holds: just this once, for a while (e.g. 1 hour) or always
 *   · Allow or Deny – Enter and Esc work while the card has focus
 *   · then the card folds into one line: "Allowed for 1 hour" with a bar that drains until the right expires,
 *     and Revoke to take it back; destructive actions can never be allowed for always
 * Controlled or uncontrolled. The styles are injected below, so no extra files are needed.
 */

export type PermissionRisk = "safe" | "risky" | "destructive";
export type PermissionScope = "once" | "timed" | "always";

export type PermissionDecision = {
  allow: boolean;
  scope: PermissionScope;
  /** When it was decided (ms) */
  at: number;
  /** When a timed right runs out (ms) */
  until?: number;
};

export type PermissionPreviewItem = {
  id: string;
  label: string;
  /** Right-aligned, e.g. "+12 −4" or "$240.00" */
  meta?: ReactNode;
  /** A 16px glyph or a small brand mark */
  icon?: ReactNode;
};

export type PermissionRequestProps = {
  /** Who asks: { name, model?, avatar? } */
  agent: { name: string; model?: string; avatar?: ReactNode };
  /** What it wants to do, lower case after "wants to", e.g. "push to main" */
  action: string;
  /** Where, e.g. "acme/web" – shown with the tool's mark */
  target?: string;
  /** The tool's mark next to the target */
  toolIcon?: ReactNode;
  risk?: PermissionRisk;
  /** The agent's own words on why it needs this */
  reason?: string;
  /** What will happen if you allow it – files, recipients, amounts */
  preview?: PermissionPreviewItem[];
  previewTitle?: string;
  /** Rows shown before "N more" – default 3 */
  previewLimit?: number;
  /** The choices offered – default all three; "always" is never offered for destructive actions */
  scopes?: PermissionScope[];
  /** Controlled choice of how long */
  scope?: PermissionScope;
  defaultScope?: PermissionScope;
  onScopeChange?: (scope: PermissionScope) => void;
  /** Minutes a timed right holds – default 60 */
  duration?: number;
  /** Controlled decision – null while it waits */
  decision?: PermissionDecision | null;
  defaultDecision?: PermissionDecision | null;
  /** Allow, Deny, Revoke (null) – the agent should listen to this */
  onDecisionChange?: (decision: PermissionDecision | null) => void;
  /** The clock for the countdown – defaults to now */
  now?: number;
  className?: string;
};

/* ---------- Helpers ---------- */

const MIN = 60_000;
const reduced = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";
const DAY = 24 * 60;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const count = new Intl.NumberFormat("en");
const RISKS: PermissionRisk[] = ["safe", "risky", "destructive"];
const SCOPES: PermissionScope[] = ["once", "timed", "always"];
// The time of day – with the weekday or the date once it isn't today
const hhmm = (t: number, from = Date.now()) => {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === new Date(from).toDateString()) return time;
  const week = Math.abs(t - from) < 6 * DAY * MIN;
  return `${d.toLocaleDateString([], week ? { weekday: "short" } : { month: "short", day: "numeric" })} ${time}`;
};
const span = (min: number) =>
  min >= DAY && min % DAY === 0
    ? `${min / DAY} day${min === DAY ? "" : "s"}`
    : min % 60 === 0
      ? `${min / 60} hour${min === 60 ? "" : "s"}`
      : `${min} min`;
const left = (ms: number) => {
  const m = Math.max(0, Math.ceil(ms / MIN));
  if (m >= DAY) {
    const h = Math.floor((m % DAY) / 60);
    return `${Math.floor(m / DAY)} d ${h ? `${h} h ` : ""}left`;
  }
  return m >= 60
    ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min ` : ""}left`
    : `${m} min left`;
};
const RISK: Record<PermissionRisk, string> = {
  safe: "",
  risky: "Risky",
  destructive: "Destructive",
};

/* ---------- Icons ---------- */

/* Risk, check, cross and quote: Hugeicons Free (MIT, © Hugeicons, hugeicons.com) – rounded 1.5px strokes */
const RiskyIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M13.9248 21H10.0752C5.44476 21 3.12955 21 2.27636 19.4939C1.42317 17.9879 2.60736 15.9914 4.97574 11.9985L6.90057 8.75333C9.17559 4.91778 10.3131 3 12 3C13.6869 3 14.8244 4.91777 17.0994 8.75332L19.0243 11.9985C21.3926 15.9914 22.5768 17.9879 21.7236 19.4939C20.8704 21 18.5552 21 13.9248 21Z"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
    <path
      d="M12 9V13"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
    <path
      d="M12.125 16.75H12M12.25 16.75C12.25 16.8881 12.1381 17 12 17C11.8619 17 11.75 16.8881 11.75 16.75C11.75 16.6119 11.8619 16.5 12 16.5C12.1381 16.5 12.25 16.6119 12.25 16.75Z"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </svg>
);
const DestructiveIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M5.92089 5.92089C8.15836 3.68342 9.2771 2.56468 10.5857 2.19562C11.5105 1.93479 12.4895 1.93479 13.4143 2.19562C14.7229 2.56468 15.8416 3.68342 18.0791 5.92089C20.3166 8.15836 21.4353 9.2771 21.8044 10.5857C22.0652 11.5105 22.0652 12.4895 21.8044 13.4143C21.4353 14.7229 20.3166 15.8416 18.0791 18.0791C15.8416 20.3166 14.7229 21.4353 13.4143 21.8044C12.4895 22.0652 11.5105 22.0652 10.5857 21.8044C9.2771 21.4353 8.15836 20.3166 5.92089 18.0791C3.68342 15.8416 2.56468 14.7229 2.19562 13.4143C1.93479 12.4895 1.93479 11.5105 2.19562 10.5857C2.56468 9.2771 3.68342 8.15836 5.92089 5.92089Z"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
    <path
      d="M12 8V12"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
    <path
      d="M12.125 15.75H12M12.25 15.75C12.25 15.8881 12.1381 16 12 16C11.8619 16 11.75 15.8881 11.75 15.75C11.75 15.6119 11.8619 15.5 12 15.5C12.1381 15.5 12.25 15.6119 12.25 15.75Z"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </svg>
);
const CheckIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12Z"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M8 12.5L10.5 15L16 9"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </svg>
);
const CrossIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C17.5228 22 22 17.5228 22 12Z"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M14.9994 15L9 9M9.00064 15L15 9"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </svg>
);
const ClockIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z"
      stroke="currentColor"
      strokeWidth="1.5"
    />
    <path
      d="M12 8V12L14 14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
    />
  </svg>
);
const DotIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="2.4" fill="currentColor" />
  </svg>
);

// The first whole letter or digit of the first two words – emoji and marks are skipped
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w.match(/[\p{L}\p{N}]/u)?.[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
// A logo that fails to load hides itself instead of showing a broken image
const hideBroken = (e: { target: EventTarget }) => {
  if (e.target instanceof HTMLImageElement) e.target.style.visibility = "hidden";
};

export function PermissionRequest({
  agent,
  action,
  target,
  toolIcon,
  risk: riskProp = "risky",
  reason,
  preview = [],
  previewTitle = "What will happen",
  previewLimit: limitProp = 3,
  scopes: scopesProp = ["once", "timed", "always"],
  scope: scopeProp,
  defaultScope = "once",
  onScopeChange,
  duration: durationProp = 60,
  decision,
  defaultDecision = null,
  onDecisionChange,
  now: nowIn,
  className,
}: PermissionRequestProps) {
  const uid = useId();
  // Unknown or broken values fall back to the defaults instead of showing NaN or the wrong words
  const risk = RISKS.includes(riskProp) ? riskProp : "risky";
  const scopes = scopesProp.filter((s) => SCOPES.includes(s));
  const duration = finite(durationProp) && durationProp > 0 ? Math.max(1, Math.round(durationProp)) : 60;
  const previewLimit = finite(limitProp) && limitProp >= 0 ? Math.floor(limitProp) : 3;
  const nowProp = finite(nowIn) ? nowIn : undefined;
  const name = agent.name?.trim() || "Agent";
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [innerDecision, setInnerDecision] = useState<PermissionDecision | null>(
    defaultDecision,
  );
  const current = decision === undefined ? innerDecision : decision;
  const offered = scopes.filter(
    (s) => !(s === "always" && risk === "destructive"),
  );
  const [innerScope, setInnerScope] = useState<PermissionScope>(defaultScope);
  const wanted = scopeProp ?? innerScope;
  const scope = offered.includes(wanted) ? wanted : (offered[0] ?? "once");
  const setScope = (next: PermissionScope) => {
    setInnerScope(next);
    onScopeChange?.(next);
  };
  const [open, setOpen] = useState(false);

  // A tick for the countdown, only while a timed right runs and no clock is passed in
  const [tick, setTick] = useState(() => Date.now());
  const running =
    current?.allow && current.scope === "timed" && finite(current.until) && nowProp === undefined;
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  const now = nowProp ?? tick;

  const decide = (next: PermissionDecision | null) => {
    setInnerDecision(next);
    onDecisionChange?.(next);
  };
  const allow = () => {
    const at = nowProp ?? Date.now();
    decide({
      allow: true,
      scope,
      at,
      until: scope === "timed" ? at + duration * MIN : undefined,
    });
  };
  const deny = () => decide({ allow: false, scope, at: nowProp ?? Date.now() });

  const onKey = (e: KeyboardEvent) => {
    if (current) return;
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === "Enter" && tag !== "BUTTON") {
      e.preventDefault();
      allow();
    } else if (e.key === "Escape") {
      e.preventDefault();
      deny();
    }
  };

  const expired = !!(current?.allow && finite(current.until) && now >= current.until);

  /* ---------- Motion: the card folds to one line and back ---------- */

  const cardRef = useRef<HTMLDivElement>(null);
  const height = useRef(0);
  const shape = current
    ? expired
      ? "expired"
      : current.allow
        ? "allowed"
        : "denied"
    : `pending:${open}`;
  const lastShape = useRef(shape);
  if (cardRef.current && shape !== lastShape.current)
    height.current = cardRef.current.offsetHeight;
  useLayoutEffect(() => {
    if (lastShape.current === shape) return;
    lastShape.current = shape;
    const card = cardRef.current;
    if (!card || reduced() || !height.current) return;
    const to = card.offsetHeight;
    if (Math.abs(to - height.current) > 1) {
      card.animate([{ height: `${height.current}px` }, { height: `${to}px` }], {
        duration: 380,
        easing: EASE,
      });
    }
  }, [shape]);

  const allowLabel =
    scope === "once"
      ? "Allow once"
      : scope === "timed"
        ? `Allow for ${span(duration)}`
        : "Always allow";
  const scopeLabel = (s: PermissionScope) =>
    s === "once" ? "Just once" : s === "timed" ? span(duration) : "Always";
  const shown = open ? preview : preview.slice(0, previewLimit);
  const hidden = preview.length - shown.length;

  /* ---------- The decided line ---------- */

  const result = () => {
    if (!current) return null;
    const at = finite(current.at) ? current.at : now;
    const until = finite(current.until) ? current.until : undefined;
    const total = until !== undefined ? until - at : 0;
    const share = total > 0 ? Math.max(0, Math.min(1, (until! - now) / total)) : 0;
    const kind = expired ? "expired" : current.allow ? "allowed" : "denied";
    const headline = expired
      ? "Access expired"
      : !current.allow
        ? "Denied"
        : current.scope === "once"
          ? "Allowed once"
          : current.scope === "timed"
            ? total > 0
              ? `Allowed for ${span(Math.round(total / MIN))}`
              : "Allowed"
            : "Always allowed";
    const note = expired
      ? `${name} will ask again`
      : !current.allow
        ? `${name} was told and won't do it`
        : current.scope === "timed"
          ? until !== undefined
            ? `${left(until - now)} · until ${hhmm(until, now)}`
            : "No end time given"
          : current.scope === "once"
            ? `At ${hhmm(at, now)} · it won't carry over`
            : `${name} won't ask for this again`;
    return (
      <div className="ui-pr__result" data-kind={kind} role="status">
        <span className="ui-pr__result-icon">
          {kind === "allowed" ? (
            <CheckIcon />
          ) : kind === "denied" ? (
            <CrossIcon />
          ) : (
            <ClockIcon />
          )}
        </span>
        <span className="ui-pr__result-text">
          <span className="ui-pr__result-head" title={`${headline} · ${action}`}>
            {headline}
            <span className="ui-pr__result-action">
              {" · "}
              <span dir="auto">{action}</span>
            </span>
          </span>
          <span className="ui-pr__result-note" title={note}>
            {note}
          </span>
        </span>
        {current.allow && !expired && current.scope !== "once" ? (
          <button
            type="button"
            className="ui-pr__ghost"
            onClick={() => decide(null)}
          >
            Revoke
          </button>
        ) : (
          <button
            type="button"
            className="ui-pr__ghost"
            onClick={() => decide(null)}
          >
            {expired ? "Ask again" : "Change"}
          </button>
        )}
        {current.allow && current.scope === "timed" && until !== undefined && !expired && (
          <span className="ui-pr__drain" aria-hidden="true">
            <span style={{ transform: `scaleX(${share})` }} />
          </span>
        )}
      </div>
    );
  };

  return (
    <div
      className={["ui-pr", className].filter(Boolean).join(" ")}
      data-risk={risk}
      data-state={shape.split(":")[0]}
    >
      <style href="ui-permission-request" precedence="default">
        {css}
      </style>

      <div
        ref={cardRef}
        className="ui-pr__card"
        role={current ? undefined : "dialog"}
        aria-labelledby={current ? undefined : `${uid}-title`}
        aria-describedby={current || !reason ? undefined : `${uid}-why`}
        onKeyDown={onKey}
      >
        {current ? (
          result()
        ) : (
          <div className="ui-pr__ask" key="ask">
            <div className="ui-pr__body">
              {/* ----- Who asks for what ----- */}
              <header className="ui-pr__head">
                <span
                  className="ui-pr__avatar"
                  data-logo={agent.avatar && !avatarFailed ? "" : undefined}
                  onErrorCapture={() => setAvatarFailed(true)}
                >
                  {agent.avatar && !avatarFailed ? agent.avatar : initials(name) || "AI"}
                </span>
                <span className="ui-pr__heading">
                  <span className="ui-pr__title" id={`${uid}-title`}>
                    <b dir="auto">{name}</b> wants to <b dir="auto">{action}</b>
                  </span>
                  {(target || agent.model) && (
                    <span className="ui-pr__sub" title={target ?? agent.model}>
                      {toolIcon && (
                        <span className="ui-pr__tool" onErrorCapture={hideBroken}>
                          {toolIcon}
                        </span>
                      )}
                      <span className="ui-pr__sub-text" dir="auto">
                        {target ?? agent.model}
                      </span>
                    </span>
                  )}
                </span>
                {risk !== "safe" && (
                  <span className="ui-pr__risk" data-risk={risk}>
                    {risk === "risky" ? <RiskyIcon /> : <DestructiveIcon />}
                    {RISK[risk]}
                  </span>
                )}
              </header>

              {reason && (
                <p className="ui-pr__why" id={`${uid}-why`} dir="auto">
                  {reason}
                </p>
              )}

              {/* ----- Exactly what will happen ----- */}
              {preview.length > 0 && (
                <section
                  className="ui-pr__preview"
                  aria-labelledby={`${uid}-what`}
                  data-open={open ? "" : undefined}
                >
                  <h4 className="ui-pr__label" id={`${uid}-what`}>
                    <span className="ui-pr__label-text" dir="auto">
                      {previewTitle}
                    </span>
                    <span className="ui-pr__count">{count.format(preview.length)}</span>
                  </h4>
                  <ul className="ui-pr__list">
                    {shown.map((p, i) => (
                      <li
                        key={`${p.id}#${i}`}
                        className="ui-pr__item"
                        style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}
                      >
                        <span className="ui-pr__item-icon" onErrorCapture={hideBroken}>
                          {p.icon ?? <DotIcon />}
                        </span>
                        <span className="ui-pr__item-label" dir="auto" title={p.label}>
                          {p.label}
                        </span>
                        {p.meta != null && (
                          <span className="ui-pr__item-meta">{p.meta}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {(hidden > 0 || open) && preview.length > previewLimit && (
                    <button
                      type="button"
                      className="ui-pr__more"
                      aria-expanded={open}
                      onClick={() => setOpen((o) => !o)}
                    >
                      {open ? "Show less" : `${count.format(hidden)} more`}
                    </button>
                  )}
                </section>
              )}
            </div>

            {/* ----- How long, and the answer ----- */}
            <div className="ui-pr__answer">
              {offered.length > 1 && (
                <div
                  className="ui-pr__scopes"
                  role="radiogroup"
                  aria-label="How long"
                >
                  {offered.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={s === scope}
                      className="ui-pr__scope"
                      onClick={() => setScope(s)}
                      onKeyDown={(e) => {
                        const step =
                          e.key === "ArrowRight"
                            ? 1
                            : e.key === "ArrowLeft"
                              ? -1
                              : 0;
                        if (!step) return;
                        e.preventDefault();
                        const next =
                          offered[
                            (offered.indexOf(scope) + step + offered.length) %
                              offered.length
                          ];
                        setScope(next);
                        (
                          e.currentTarget.parentElement?.querySelector(
                            `[data-scope="${next}"]`,
                          ) as HTMLElement | null
                        )?.focus();
                      }}
                      data-scope={s}
                      tabIndex={s === scope ? 0 : -1}
                    >
                      {scopeLabel(s)}
                    </button>
                  ))}
                </div>
              )}
              {risk === "destructive" && scopes.includes("always") && (
                <span className="ui-pr__hint">
                  Destructive actions can't be allowed for always
                </span>
              )}
              <div className="ui-pr__buttons">
                <button type="button" className="ui-pr__btn" onClick={deny}>
                  Deny
                  <kbd className="ui-pr__kbd">Esc</kbd>
                </button>
                <button
                  type="button"
                  className="ui-pr__btn ui-pr__btn--primary"
                  onClick={allow}
                >
                  <span key={allowLabel} className="ui-pr__btn-label">
                    {allowLabel}
                  </span>
                  <kbd className="ui-pr__kbd">↵</kbd>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-pr */
.ui-pr {
  --ui-pr-tray: #f0f0f0;
  --ui-pr-card: #ffffff;
  --ui-pr-ink: #171717;
  --ui-pr-text: #6b6b6b;
  --ui-pr-muted: #8a8a8a;
  --ui-pr-faint: #b8b8b8;
  --ui-pr-line: #ececec;
  --ui-pr-chip: #f5f5f5;
  --ui-pr-track: #e6e6e6;
  --ui-pr-accent: #2f6bff;
  --ui-pr-ok-bg: #e6f6ec;
  --ui-pr-ok-fg: #1a7f45;
  --ui-pr-warn-bg: #fff3e0;
  --ui-pr-warn-fg: #b85c00;
  --ui-pr-danger-bg: #fdecea;
  --ui-pr-danger-fg: #c2331f;
  --ui-pr-primary: #171717;
  --ui-pr-on-primary: #ffffff;
  --ui-pr-ring: rgba(23, 23, 23, 0.22);
  --ui-pr-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  width: 100%;
  max-width: 420px;
  padding: 4px;
  overflow: hidden;
  border-radius: 20px;
  background: var(--ui-pr-tray);
  container-type: inline-size;
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 20px;
  letter-spacing: -0.006em;
  color: var(--ui-pr-text);
  text-align: left;
  -webkit-font-smoothing: antialiased;
}
.ui-pr *, .ui-pr *::before, .ui-pr *::after { box-sizing: border-box; }
:where(.ui-pr) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; text-align: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }
.ui-pr button:focus-visible { outline: 2px solid var(--ui-pr-ring); outline-offset: 2px; }
.ui-pr ul { margin: 0; padding: 0; list-style: none; }
.ui-pr h4, .ui-pr p { margin: 0; }
.ui-pr svg { display: block; flex: none; }

/* The tray holds a white card with the request; the answer sits on the tray below it */
.ui-pr__card { overflow: hidden; border-radius: 16px; }
.ui-pr__ask { animation: ui-pr-in 260ms var(--ui-pr-ease) both; }
.ui-pr__body { border-radius: 16px; background: var(--ui-pr-card); box-shadow: 0 0 0 1px var(--ui-pr-line), 0 1px 2px rgba(0, 0, 0, 0.04); }

/* ----- Who asks for what ----- */
.ui-pr__head { display: flex; align-items: center; gap: 12px; padding: 16px 16px 0; }
.ui-pr__avatar { display: grid; flex: none; place-items: center; width: 32px; height: 32px; border-radius: 10px; background: var(--ui-pr-card); box-shadow: 0 0 0 1px var(--ui-pr-line), 0 1px 2px rgba(0, 0, 0, 0.05); font-size: 12px; font-weight: 600; color: var(--ui-pr-text); overflow: hidden; }
.ui-pr__avatar[data-logo] > svg { width: 18px; height: 18px; }
.ui-pr__heading { display: grid; flex: 1; grid-template-columns: minmax(0, 1fr); min-width: 0; }
.ui-pr__title { color: var(--ui-pr-text); overflow-wrap: anywhere; }
.ui-pr__title b { font-weight: 600; color: var(--ui-pr-ink); }
.ui-pr__sub { display: flex; align-items: center; gap: 5px; min-width: 0; overflow: hidden; font-size: 12.5px; line-height: 18px; color: var(--ui-pr-muted); white-space: nowrap; text-overflow: ellipsis; }
.ui-pr__tool { display: grid; flex: none; place-items: center; width: 12px; height: 12px; overflow: hidden; }
.ui-pr__sub-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
/* Image marks fit their tile, whatever their size */
.ui-pr__tool > img { width: 12px; height: 12px; object-fit: contain; }
.ui-pr__avatar > img { width: 18px; height: 18px; object-fit: contain; }
.ui-pr__item-icon > img { width: 16px; height: 16px; object-fit: contain; }
.ui-pr__tool > svg { width: 12px; height: 12px; }
.ui-pr__risk { display: inline-flex; flex: none; align-self: start; align-items: center; gap: 4px; height: 22px; margin-top: 1px; padding: 0 8px 0 6px; border-radius: 999px; background: var(--ui-pr-warn-bg); font-size: 12px; font-weight: 500; color: var(--ui-pr-warn-fg); }
.ui-pr__risk[data-risk="destructive"] { background: var(--ui-pr-danger-bg); color: var(--ui-pr-danger-fg); }

/* The agent's reason: a quiet line with a rule on the left */
.ui-pr__why { margin: 12px 16px 0 60px !important; padding-left: 10px; border-left: 2px solid var(--ui-pr-line); font-size: 13px; line-height: 19px; color: var(--ui-pr-text); white-space: pre-line; overflow-wrap: anywhere; }

/* ----- What will happen ----- */
.ui-pr__preview { margin-top: 14px; padding: 12px 8px 6px; border-top: 1px solid var(--ui-pr-line); }
.ui-pr__label { display: flex; align-items: center; gap: 6px; margin: 0 8px 4px !important; font-size: 12.5px; font-weight: 500; line-height: 18px; color: var(--ui-pr-muted); }
.ui-pr__count { display: grid; flex: none; place-items: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 6px; background: var(--ui-pr-chip); font-size: 11px; color: var(--ui-pr-text); font-variant-numeric: tabular-nums; }
.ui-pr__label-text { min-width: 0; overflow-wrap: anywhere; }
/* All of a long preview: the list scrolls instead of growing the card */
.ui-pr__preview[data-open] .ui-pr__list { max-height: 320px; overflow-y: auto; overscroll-behavior: contain; }
.ui-pr__list { display: grid; grid-template-columns: minmax(0, 1fr); }
.ui-pr__item { display: flex; align-items: center; gap: 10px; min-height: 32px; padding: 0 8px; border-radius: 8px; animation: ui-pr-in 260ms var(--ui-pr-ease) both; }
.ui-pr__item-icon { display: grid; flex: none; place-items: center; width: 16px; height: 16px; color: var(--ui-pr-muted); overflow: hidden; }
.ui-pr__item-icon > svg { width: 16px; height: 16px; }
.ui-pr__item-label { flex: 1; min-width: 0; overflow: hidden; font-size: 13.5px; color: var(--ui-pr-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-pr__item-meta { flex: none; font-size: 12.5px; color: var(--ui-pr-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.ui-pr__more { margin: 0 0 6px 34px; padding: 2px 0; font-size: 12.5px; font-weight: 500; line-height: 18px; color: var(--ui-pr-muted); transition: color 160ms ease; }
.ui-pr__more:hover { color: var(--ui-pr-ink); }
.ui-pr__body:not(:has(.ui-pr__preview)) { padding-bottom: 16px; }

/* ----- On the tray: how long, and the answer ----- */
.ui-pr__answer { display: grid; gap: 12px; padding: 12px 8px 8px; }
/* A gray track, the chosen one raised in white */
.ui-pr__scopes { display: flex; padding: 3px; border-radius: 12px; background: var(--ui-pr-track); }
.ui-pr__scope { flex: 1; height: 30px; padding: 0 10px; border-radius: 9px; font-size: 13px; font-weight: 500; color: var(--ui-pr-muted); text-align: center !important; white-space: nowrap; transition: color 200ms ease, background-color 200ms ease, box-shadow 200ms ease; }
.ui-pr__scope[aria-checked="true"] { background: var(--ui-pr-card); box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08), 0 0 0 1px rgba(0, 0, 0, 0.04); color: var(--ui-pr-ink); }
.ui-pr__scope[aria-checked="false"]:hover { color: var(--ui-pr-ink); }
.ui-pr__hint { margin: -6px 4px 0; font-size: 12px; line-height: 16px; color: var(--ui-pr-muted); }
.ui-pr__buttons { display: flex; gap: 8px; }
.ui-pr__btn { display: inline-flex; flex: 1; align-items: center; justify-content: center; gap: 8px; height: 40px; padding: 0 14px; border-radius: 12px; background: var(--ui-pr-card); box-shadow: 0 0 0 1px var(--ui-pr-line), 0 1px 2px rgba(0, 0, 0, 0.04); font-size: 14px; font-weight: 500; color: var(--ui-pr-ink); white-space: nowrap; transition: background-color 160ms ease, transform 120ms ease, opacity 160ms ease; }
.ui-pr__btn:hover { background: #fafafa; }
.ui-pr__btn:active { transform: scale(0.98); }
.ui-pr__btn--primary { flex: 1.4; background: var(--ui-pr-primary); box-shadow: none; color: var(--ui-pr-on-primary); }
.ui-pr__btn--primary:hover { background: var(--ui-pr-primary); opacity: 0.88; }
.ui-pr[data-risk="destructive"] .ui-pr__btn--primary { background: var(--ui-pr-danger-fg); }
.ui-pr__btn-label { animation: ui-pr-swap 220ms var(--ui-pr-ease) both; }
.ui-pr__kbd { display: grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 6px; background: var(--ui-pr-chip); font-family: inherit; font-size: 11px; font-weight: 500; line-height: 18px; color: var(--ui-pr-muted); }
.ui-pr__btn--primary .ui-pr__kbd { background: rgba(255, 255, 255, 0.16); color: rgba(255, 255, 255, 0.72); }

/* ----- The decided line: a white card on the tray ----- */
.ui-pr__result { position: relative; display: flex; align-items: center; gap: 12px; min-height: 60px; padding: 10px 10px 10px 16px; overflow: hidden; border-radius: 16px; background: var(--ui-pr-card); box-shadow: 0 0 0 1px var(--ui-pr-line), 0 1px 2px rgba(0, 0, 0, 0.04); animation: ui-pr-in 300ms var(--ui-pr-ease) both; }
.ui-pr__result-icon { display: grid; flex: none; place-items: center; width: 18px; height: 18px; animation: ui-pr-pop 360ms var(--ui-pr-ease) both; }
.ui-pr__result-icon > svg { width: 18px; height: 18px; }
.ui-pr__result[data-kind="allowed"] .ui-pr__result-icon { color: var(--ui-pr-ok-fg); }
.ui-pr__result[data-kind="denied"] .ui-pr__result-icon { color: var(--ui-pr-danger-fg); }
.ui-pr__result[data-kind="expired"] .ui-pr__result-icon { color: var(--ui-pr-muted); }
.ui-pr__result-text { display: grid; flex: 1; min-width: 0; }
.ui-pr__result-head { overflow: hidden; font-weight: 600; color: var(--ui-pr-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-pr__result-action { font-weight: 400; color: var(--ui-pr-muted); }
.ui-pr__result-note { overflow: hidden; font-size: 12.5px; line-height: 18px; color: var(--ui-pr-muted); white-space: nowrap; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.ui-pr__ghost { flex: none; height: 32px; padding: 0 12px; border-radius: 999px; background: var(--ui-pr-chip); font-size: 13px; font-weight: 500; color: var(--ui-pr-ink); transition: background-color 160ms ease; }
.ui-pr__ghost:hover { background: var(--ui-pr-line); }
.ui-pr__drain { position: absolute; right: 0; bottom: 0; left: 0; height: 3px; background: var(--ui-pr-chip); }
.ui-pr__drain > span { display: block; height: 100%; background: var(--ui-pr-ok-fg); opacity: 0.6; transform-origin: left; transition: transform 900ms linear; }

@keyframes ui-pr-in { from { opacity: 0; transform: translateY(3px); } }
@keyframes ui-pr-swap { from { opacity: 0; transform: translateY(2px); } }
@keyframes ui-pr-pop { 0% { opacity: 0; transform: scale(0.5); } 60% { opacity: 1; transform: scale(1.12); } }

/* Narrow containers: the reason loses its indent, no keyboard hints */
@container (max-width: 360px) {
  .ui-pr__why { margin-left: 16px !important; }
  .ui-pr__scope { padding: 0 6px; font-size: 12.5px; }
  .ui-pr__kbd { display: none; }
}
@media (hover: none) {
  .ui-pr__kbd { display: none; }
}
@media (pointer: coarse) {
  .ui-pr__scope { height: 38px; }
  .ui-pr__btn { height: 46px; }
  .ui-pr__ghost { height: 40px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-pr *, .ui-pr *::before, .ui-pr *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-pr__btn:hover { background: #26262a; }
:where(.dark, [data-theme="dark"]) .ui-pr__btn--primary:hover { background: var(--ui-pr-primary); }
:where(.dark, [data-theme="dark"]) .ui-pr__btn--primary .ui-pr__kbd { background: rgba(0, 0, 0, 0.1); color: rgba(0, 0, 0, 0.55); }
:where(.dark, [data-theme="dark"]) .ui-pr[data-risk="destructive"] .ui-pr__btn--primary { background: #e5484d; color: #ffffff; }
:where(.dark, [data-theme="dark"]) .ui-pr[data-risk="destructive"] .ui-pr__btn--primary .ui-pr__kbd { background: rgba(255, 255, 255, 0.18); color: rgba(255, 255, 255, 0.75); }
:where(.dark, [data-theme="dark"]) .ui-pr__scope[aria-checked="true"] { box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.06); }
:where(.dark, [data-theme="dark"]) .ui-pr {
  --ui-pr-tray: #111113;
  --ui-pr-card: #1c1c1f;
  --ui-pr-ink: #ededed;
  --ui-pr-text: #a1a1a6;
  --ui-pr-muted: #7c7c82;
  --ui-pr-faint: #4a4a50;
  --ui-pr-line: #2a2a2e;
  --ui-pr-chip: #26262a;
  --ui-pr-track: #1f1f22;
  --ui-pr-accent: #5b9aff;
  --ui-pr-ok-bg: #12301f;
  --ui-pr-ok-fg: #3dd68c;
  --ui-pr-warn-bg: #3a2410;
  --ui-pr-warn-fg: #ffa057;
  --ui-pr-danger-bg: #3b1714;
  --ui-pr-danger-fg: #ff977d;
  --ui-pr-primary: #ededed;
  --ui-pr-on-primary: #111113;
  --ui-pr-ring: rgba(237, 237, 237, 0.3);
}
`;
