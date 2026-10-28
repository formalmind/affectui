"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

/*
 * Integration Settings (clean style) – the settings card of one connected service, in a single self-contained file.
 * One white card: the header with the switch on top, the settings in hairline-separated sections below,
 * and the save bar as the card's last row. Switch it on and off, generate and copy an API key, set the site
 * address with validation and pick a time zone. The styles are injected below, so no extra files are needed.
 */

export type IntegrationValues = { enabled: boolean; siteUrl: string; timeZone: string; apiKey: string | null };

export type IntegrationSettingsProps = {
  name: string;
  logo: ReactNode;
  /** Small number next to the name, e.g. synced orders */
  count?: number;
  /** Line under the name, e.g. when it was connected */
  meta?: string;
  defaultValues?: Partial<IntegrationValues>;
  /** Helper text under the address field */
  siteHint?: string;
  timeZones?: string[];
  /** Creates a key – return it, or a promise of it. Without it a random demo key is made */
  onGenerateKey?: () => string | Promise<string>;
  /** Called with all values when Save is pressed */
  onSave?: (values: IntegrationValues) => void | Promise<void>;
  onToggle?: (enabled: boolean) => void;
  className?: string;
};

const defaultZones = [
  "(GMT −08:00) Los Angeles",
  "(GMT −05:00) New York",
  "(GMT −03:00) São Paulo",
  "(GMT +00:00) London",
  "(GMT +01:00) Berlin",
  "(GMT +01:00) Amsterdam",
  "(GMT +01:00) Warsaw",
  "(GMT +02:00) Athens",
  "(GMT +04:00) Dubai",
  "(GMT +05:30) Mumbai",
  "(GMT +08:00) Singapore",
  "(GMT +09:00) Tokyo",
  "(GMT +10:00) Sydney",
];

// Letters of any script, so internationalized domains like münchen.de pass too
const DOMAIN = /^(?!-)[\p{L}\p{N}-]+(\.[\p{L}\p{N}-]+)*\.\p{L}{2,}$/iu;
/** First whole letter or digit of the name – the tile when there is no logo or it fails to load */
const initial = (name: string) => name.match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? "";
const clean = (v: string) => v.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");

export function IntegrationSettings({
  name,
  logo,
  count,
  meta,
  defaultValues,
  siteHint = "Your store's primary domain, without https://",
  timeZones = defaultZones,
  onGenerateKey,
  onSave,
  onToggle,
  className,
}: IntegrationSettingsProps) {
  const start: IntegrationValues = {
    enabled: true,
    siteUrl: "",
    timeZone: timeZones[0],
    apiKey: null,
    ...defaultValues,
  };
  const [saved, setSaved] = useState(start);
  const [values, setValues] = useState(start);
  const [keyState, setKeyState] = useState<"idle" | "busy">("idle");
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  const urlId = useId();
  const hintId = useId();

  const url = clean(values.siteUrl);
  const urlValid = url === "" || DOMAIN.test(url);
  const dirty = values.siteUrl !== saved.siteUrl || values.timeZone !== saved.timeZone || values.apiKey !== saved.apiKey;

  const set = (patch: Partial<IntegrationValues>) => setValues((v) => ({ ...v, ...patch }));

  const generate = async () => {
    if (keyState === "busy") return;
    setKeyState("busy");
    try {
      const key = await (onGenerateKey
        ? onGenerateKey()
        : new Promise<string>((r) =>
            setTimeout(
              () => r(`sk_live_${Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("")}`),
              700,
            ),
          ));
      set({ apiKey: key });
      setRevealed(true);
    } finally {
      setKeyState("idle");
    }
  };

  const copy = async () => {
    if (!values.apiKey) return;
    try {
      await navigator.clipboard.writeText(values.apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard not available */
    }
  };

  const save = async () => {
    if (!urlValid || saving) return;
    setSaving(true);
    const next = { ...values, siteUrl: url };
    try {
      await onSave?.(next);
      setValues(next);
      setSaved(next);
    } finally {
      setSaving(false);
    }
  };

  // Short keys are fully hidden – start and end would add up to the whole key
  const masked = !values.apiKey ? "" : values.apiKey.length < 16 ? "•".repeat(14) : `${values.apiKey.slice(0, 8)}${"•".repeat(14)}${values.apiKey.slice(-4)}`;

  return (
    <>
      <style href="ui-integration-settings-clean" precedence="default">
        {css}
      </style>
      <section className={["ui-isc", className].filter(Boolean).join(" ")} aria-label={`${name} settings`} data-off={!values.enabled || undefined}>
        <header className="ui-isc__head">
          <span className="ui-isc__logo" onErrorCapture={() => setLogoFailed(true)}>
            {logo == null || logo === false || logoFailed ? <span className="ui-isc__initial">{initial(name)}</span> : logo}
          </span>
          <span className="ui-isc__who">
            <span className="ui-isc__name">
              <span className="ui-isc__name-text" dir="auto" title={name}>
                {name}
              </span>
              {count !== undefined && Number.isFinite(count) && <span className="ui-isc__count">{count.toLocaleString("en-US")}</span>}
            </span>
            <span className="ui-isc__meta" dir="auto" title={values.enabled ? meta : undefined}>
              {values.enabled ? meta : "Paused – no data is synced"}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={values.enabled}
            aria-label={`${name} sync`}
            className="ui-isc__switch"
            onClick={() => {
              const enabled = !values.enabled;
              set({ enabled });
              setSaved((s) => ({ ...s, enabled }));
              onToggle?.(enabled);
            }}
          >
            <span />
          </button>
        </header>

        <div className="ui-isc__fold" data-open={values.enabled || undefined} inert={!values.enabled}>
          <div className="ui-isc__fold-inner">
            <div className="ui-isc__section">
              <span className="ui-isc__label">API key</span>
              {values.apiKey ? (
                <div className="ui-isc__key" data-new={revealed || undefined}>
                  <code>{revealed ? values.apiKey : masked}</code>
                  <button type="button" className="ui-isc__mini" aria-label={revealed ? "Hide key" : "Show key"} onClick={() => setRevealed((r) => !r)}>
                    <Icon d={revealed ? "M2 8s2.2-4.5 6-4.5S14 8 14 8s-2.2 4.5-6 4.5S2 8 2 8ZM2.5 2.5l11 11" : "M2 8s2.2-4.5 6-4.5S14 8 14 8s-2.2 4.5-6 4.5S2 8 2 8ZM8 9.8a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6Z"} />
                  </button>
                  <button type="button" className="ui-isc__mini" aria-label="Copy key" onClick={copy}>
                    <Icon d={copied ? "m3.5 8.5 3 3 6-7" : "M5.5 5.5V3.5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M3.5 5.5h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"} />
                  </button>
                  <button type="button" className="ui-isc__regen" onClick={generate} disabled={keyState === "busy"}>
                    {keyState === "busy" ? <span className="ui-isc__spinner" aria-hidden="true" /> : "Regenerate"}
                  </button>
                </div>
              ) : (
                <button type="button" className="ui-isc__generate" onClick={generate} disabled={keyState === "busy"}>
                  {keyState === "busy" ? (
                    <span className="ui-isc__shimmer" data-text="Generating…">
                      Generating…
                    </span>
                  ) : (
                    <span>Generate a new API key</span>
                  )}
                  <KeyIcon />
                </button>
              )}
              {values.apiKey && revealed && (
                <p className="ui-isc__note" role="status">
                  {copied ? "Copied to the clipboard." : "Copy it now – it is shown in full only once."}
                </p>
              )}
            </div>

            <div className="ui-isc__section">
              <label className="ui-isc__label" htmlFor={urlId}>
                Site address
              </label>
              <div className="ui-isc__field" data-invalid={!urlValid || undefined}>
                <span className="ui-isc__prefix">https://</span>
                <input
                  id={urlId}
                  value={values.siteUrl}
                  onChange={(e) => set({ siteUrl: e.target.value.replace(/^https?:\/\//i, "") })}
                  placeholder="yourstore.com"
                  inputMode="url"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!urlValid}
                  aria-describedby={hintId}
                />
                {url && urlValid && <span className="ui-isc__ok" aria-hidden="true"><Icon d="m3.5 8.5 3 3 6-7" /></span>}
              </div>
              <p className="ui-isc__hint" dir="auto" id={hintId} data-error={!urlValid || undefined}>
                {urlValid ? siteHint : "That doesn't look like a domain – try something like yourstore.com"}
              </p>
            </div>

            <div className="ui-isc__section">
              <span className="ui-isc__label" id={`${urlId}-tz`}>
                Time zone
              </span>
              <ZonePicker zones={timeZones} value={values.timeZone} onChange={(timeZone) => set({ timeZone })} labelledBy={`${urlId}-tz`} />
            </div>

            {/* The save bar is the card's last row – it slides open when something changed */}
            <div className="ui-isc__save" data-open={dirty || undefined} inert={!dirty}>
              <div className="ui-isc__save-inner">
                <span className="ui-isc__save-text">Unsaved changes</span>
                <div className="ui-isc__save-actions">
                  <button type="button" className="ui-isc__btn" onClick={() => setValues(saved)}>
                    Discard
                  </button>
                  <button type="button" className="ui-isc__btn ui-isc__btn--primary" onClick={save} disabled={!urlValid || saving}>
                    {saving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

/** Time zone dropdown with a search field */
function ZonePicker({ zones, value, onChange, labelledBy }: { zones: string[]; value: string; onChange: (v: string) => void; labelledBy: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", away);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  const list = useMemo(() => zones.filter((z) => z.toLowerCase().includes(query.trim().toLowerCase())), [zones, query]);

  return (
    <div className="ui-isc__zone" ref={ref}>
      <button
        type="button"
        className="ui-isc__field ui-isc__zone-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelledBy}
        onClick={() => {
          setOpen((o) => !o);
          setQuery("");
        }}
      >
        <span className="ui-isc__zone-value" dir="auto" title={value}>
          {value}
        </span>
        <ClockIcon />
      </button>
      {open && (
        <div className="ui-isc__menu">
          <div className="ui-isc__menu-search">
            <Icon d="M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM13.5 13.5 10.6 10.6" />
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search city or offset" aria-label="Search time zones" />
          </div>
          <div className="ui-isc__menu-list" role="listbox" aria-labelledby={labelledBy}>
            {list.length === 0 && <p className="ui-isc__menu-empty">No time zone matches.</p>}
            {list.map((z, i) => (
              <button
                key={`${i}-${z}`}
                dir="auto"
                type="button"
                role="option"
                aria-selected={z === value}
                className="ui-isc__option"
                onClick={() => {
                  onChange(z);
                  setOpen(false);
                }}
              >
                {z}
                {z === value && <Icon d="m3.5 8.5 3 3 6-7" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const KeyIcon = () => (
  <svg className="ui-isc__glyph-solid" viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
    <path d="M10.5 1.5a4 4 0 0 0-3.86 5.05L1.8 11.4a1 1 0 0 0-.3.7v1.9a.5.5 0 0 0 .5.5h1.9a.5.5 0 0 0 .5-.5V13h1v-1h1v-1l.95-.95A4 4 0 1 0 10.5 1.5Zm1 4a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
  </svg>
);
const ClockIcon = () => <Icon d="M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM8 4.5V8l2.5 1.5" />;
const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg className="ui-isc__glyph" viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/* ---------- Styles ---------- */

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-isc */
.ui-isc {
  --ui-isc-card: #ffffff;
  --ui-isc-ink: rgba(0, 0, 0, 0.88);
  --ui-isc-strong: #000000;
  --ui-isc-text: rgba(0, 0, 0, 0.61);
  --ui-isc-muted: rgba(0, 0, 0, 0.45);
  --ui-isc-faint: rgba(0, 0, 0, 0.27);
  --ui-isc-icon: rgba(0, 0, 0, 0.447);
  --ui-isc-line: rgba(0, 0, 0, 0.06);
  --ui-isc-fill: rgba(0, 0, 0, 0.06);
  --ui-isc-fill-strong: rgba(0, 0, 0, 0.1);
  --ui-isc-wash: rgba(0, 0, 0, 0.03);
  --ui-isc-accent: rgba(0, 96, 226, 0.765);
  --ui-isc-ok: #1a9a52;
  --ui-isc-ok-soft: rgba(26, 154, 82, 0.08);
  --ui-isc-danger: #e5484d;
  --ui-isc-danger-soft: rgba(229, 72, 77, 0.08);
  --ui-isc-solid: rgba(0, 0, 0, 0.88);
  --ui-isc-solid-hover: rgba(0, 0, 0, 0.8);
  --ui-isc-on-solid: #fcfcfc;
  --ui-isc-switch-off: rgba(0, 0, 0, 0.12);
  --ui-isc-shine: rgba(255, 255, 255, 0.82);
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-isc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-isc-shadow-hover: 0 0 0 0.5px rgba(0, 0, 0, 0.12), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-isc-shadow-pop: 0 0 0 0.5px rgba(0, 0, 0, 0.08), 0 12px 28px -10px rgba(0, 0, 0, 0.16), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-isc-focus: rgba(0, 96, 226, 0.35);
  --ui-isc-ease: cubic-bezier(0.22, 1, 0.36, 1);
  box-sizing: border-box;
  container-type: inline-size;
  width: 100%;
  max-width: 560px;
  /* One white card – the edge is a shadow, not a border */
  border-radius: 10px;
  background: var(--ui-isc-card);
  box-shadow: var(--ui-isc-shadow);
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  color: var(--ui-isc-ink);
  -webkit-font-smoothing: antialiased;
}
.ui-isc *, .ui-isc *::before, .ui-isc *::after { box-sizing: border-box; }
:where(.ui-isc) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; }
:where(.ui-isc) svg { display: block; flex: none; }
.ui-isc button:focus-visible { outline: 2px solid var(--ui-isc-focus); outline-offset: 1px; }

/* Header: logo tile, name with count, meta line and the switch */
.ui-isc__head { display: flex; align-items: center; gap: 12px; padding: 16px; }
.ui-isc__logo {
  display: grid;
  place-items: center;
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 8px;
  background: var(--ui-isc-card);
  box-shadow: var(--ui-isc-shadow);
}
.ui-isc__logo { overflow: hidden; }
.ui-isc__logo svg { width: 22px; height: 22px; }
/* Image logos of any size fit the tile; without one, the first letter of the name */
.ui-isc__logo img { display: block; width: 22px; height: 22px; object-fit: contain; }
.ui-isc__initial { font-size: 15px; font-weight: 600; color: var(--ui-isc-text); }
.ui-isc__who { display: grid; flex: 1; min-width: 0; }
.ui-isc__name { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 15px; line-height: 24px; font-weight: 500; color: var(--ui-isc-strong); }
.ui-isc__name-text { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-isc__count {
  flex: none;
  padding: 0 5px;
  border-radius: 5px;
  background: var(--ui-isc-fill);
  font-size: 11px;
  line-height: 16px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  color: var(--ui-isc-text);
}
.ui-isc__meta { overflow: hidden; font-size: 12px; line-height: 16px; white-space: nowrap; text-overflow: ellipsis; color: var(--ui-isc-muted); }

/* A small switch: 28×16, white knob with the card shadow */
.ui-isc__switch {
  position: relative;
  flex: none;
  width: 28px;
  height: 16px;
  border-radius: 8px;
  background: var(--ui-isc-switch-off) !important;
  transition: background-color 220ms ease;
}
.ui-isc__switch[aria-checked="true"] { background: var(--ui-isc-accent) !important; }
.ui-isc__switch span {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  box-shadow: var(--ui-isc-shadow);
  transition: transform 280ms var(--ui-isc-ease);
}
.ui-isc__switch[aria-checked="true"] span { transform: translateX(12px); }
/* A bigger invisible hit area around the small switch */
.ui-isc__switch::after { content: ""; position: absolute; inset: -8px -6px; }

/* Switching off folds the settings away – only this part animates, the header stays */
.ui-isc__fold { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 420ms var(--ui-isc-ease), opacity 260ms ease; }
.ui-isc__fold[data-open] { grid-template-rows: 1fr; opacity: 1; }
.ui-isc__fold-inner { min-width: 0; min-height: 0; overflow: hidden; }
.ui-isc__fold[data-open] .ui-isc__fold-inner { overflow: visible; }

/* Sections sit right in the card, split by hairlines */
.ui-isc__section { padding: 14px 16px 16px; border-top: 0.5px solid var(--ui-isc-line); }
.ui-isc__label { display: block; margin: 0 0 6px; font-size: 13px; line-height: 20px; font-weight: 500; color: var(--ui-isc-ink); }

/* No key yet: a quiet full-width slot */
.ui-isc__generate {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 8px 0 10px !important;
  border-radius: 8px;
  background: var(--ui-isc-wash) !important;
  box-shadow: inset 0 0 0 0.5px var(--ui-isc-line);
  color: var(--ui-isc-text) !important;
  text-align: left;
  transition: background-color 160ms ease, color 160ms ease;
}
.ui-isc__generate svg { color: var(--ui-isc-icon); transition: color 160ms ease; }
.ui-isc__generate:hover:not(:disabled) { background: var(--ui-isc-fill) !important; color: var(--ui-isc-ink) !important; }
.ui-isc__generate:hover:not(:disabled) svg { color: var(--ui-isc-ink); }
.ui-isc__generate:disabled { cursor: progress; }

/* The key: a field-like row with ghost buttons; a fresh key gets a light green fill */
.ui-isc__key {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 36px;
  padding: 0 4px 0 10px;
  border-radius: 8px;
  background: var(--ui-isc-card);
  box-shadow: var(--ui-isc-shadow);
  transition: background-color 240ms ease;
  animation: ui-isc-in 320ms var(--ui-isc-ease);
}
.ui-isc__key[data-new] { background: var(--ui-isc-ok-soft); box-shadow: none; }
.ui-isc__key code {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--ui-isc-ink);
}
.ui-isc__mini {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--ui-isc-icon) !important;
  transition: background-color 140ms ease, color 140ms ease;
}
.ui-isc__mini:hover { background: var(--ui-isc-wash) !important; color: var(--ui-isc-ink) !important; }
.ui-isc__key[data-new] .ui-isc__mini:hover { background: var(--ui-isc-fill) !important; }
.ui-isc__regen {
  display: grid;
  place-items: center;
  flex: none;
  min-width: 88px;
  height: 28px;
  margin-left: 2px;
  padding: 0 10px !important;
  border-radius: 6px;
  background: var(--ui-isc-card) !important;
  box-shadow: var(--ui-isc-shadow);
  font-size: 13px;
  font-weight: 500;
  color: var(--ui-isc-strong) !important;
  transition: box-shadow 140ms ease;
}
.ui-isc__regen:hover:not(:disabled) { box-shadow: var(--ui-isc-shadow-hover); }
.ui-isc__regen:disabled { cursor: progress; }
.ui-isc__note { margin: 6px 0 0; font-size: 12px; line-height: 16px; color: var(--ui-isc-ok); animation: ui-isc-in 240ms var(--ui-isc-ease); }
.ui-isc__spinner {
  width: 14px;
  height: 14px;
  border: 1.5px solid var(--ui-isc-fill-strong);
  border-top-color: var(--ui-isc-ink);
  border-radius: 50%;
  animation: ui-isc-spin 700ms linear infinite;
}

/* Fields: white with the hairline shadow; invalid gets a light red fill */
.ui-isc__field {
  display: flex;
  align-items: center;
  gap: 2px;
  width: 100%;
  height: 32px;
  padding: 0 8px 0 10px;
  border-radius: 8px;
  background: var(--ui-isc-card);
  box-shadow: var(--ui-isc-shadow);
  transition: box-shadow 160ms ease, background-color 160ms ease;
}
.ui-isc__field:hover { box-shadow: var(--ui-isc-shadow-hover); }
.ui-isc__field:focus-within { outline: 2px solid var(--ui-isc-focus); outline-offset: 1px; }
.ui-isc__field[data-invalid] { background: var(--ui-isc-danger-soft); box-shadow: none; }
.ui-isc__field[data-invalid]:focus-within { outline-color: rgba(229, 72, 77, 0.35); }
.ui-isc__prefix { flex: none; color: var(--ui-isc-faint); }
.ui-isc__field input {
  flex: 1;
  min-width: 0;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  font: inherit;
  color: var(--ui-isc-ink);
}
.ui-isc__field input::placeholder { color: var(--ui-isc-faint); }
.ui-isc__ok { display: grid; flex: none; color: var(--ui-isc-ok); animation: ui-isc-in 240ms var(--ui-isc-ease); }
.ui-isc__hint { overflow-wrap: anywhere; margin: 6px 0 0; font-size: 12px; line-height: 16px; color: var(--ui-isc-muted); }
.ui-isc__hint[data-error] { color: var(--ui-isc-danger); }

/* Time zone: a field-like button and one white popover */
.ui-isc__zone { position: relative; }
.ui-isc__zone-btn { justify-content: space-between; gap: 8px; padding: 0 8px 0 10px !important; text-align: left; background: var(--ui-isc-card) !important; color: var(--ui-isc-ink) !important; }
.ui-isc__zone-btn:focus-visible { outline-offset: 1px; }
.ui-isc__zone-value { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-isc__zone-btn svg { color: var(--ui-isc-icon); }
.ui-isc__menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  z-index: 10;
  padding: 4px;
  border-radius: 10px;
  background: var(--ui-isc-card);
  box-shadow: var(--ui-isc-shadow-pop);
  transform-origin: top center;
  animation: ui-isc-drop 200ms var(--ui-isc-ease);
}
.ui-isc__menu-search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  margin: 0 0 4px;
  padding: 0 8px;
  border-bottom: 0.5px solid var(--ui-isc-line);
  color: var(--ui-isc-icon);
}
.ui-isc__menu-search input {
  flex: 1;
  min-width: 0;
  height: 100%;
  margin: 0;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  font: inherit;
  color: var(--ui-isc-ink);
}
.ui-isc__menu-search input::placeholder { color: var(--ui-isc-faint); }
.ui-isc__menu-list { display: grid; gap: 1px; max-height: 200px; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.ui-isc__option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 32px;
  padding: 0 8px !important;
  border-radius: 6px;
  background: transparent;
  color: var(--ui-isc-ink) !important;
  text-align: left;
  transition: background-color 90ms ease-out;
}
.ui-isc__option:hover { background: var(--ui-isc-fill) !important; }
.ui-isc__option svg { color: var(--ui-isc-accent); animation: ui-isc-pop 260ms var(--ui-isc-ease); }
.ui-isc__menu-empty { margin: 0; padding: 10px 8px; text-align: center; color: var(--ui-isc-muted); }

/* Save bar: the card's last row under a hairline, slides open when something changed */
.ui-isc__save { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: 0fr; transition: grid-template-rows 360ms var(--ui-isc-ease); }
.ui-isc__save[data-open] { grid-template-rows: 1fr; }
.ui-isc__save-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 0;
  overflow: hidden;
  padding: 0 12px 0 16px;
  border-top: 0.5px solid var(--ui-isc-line);
  color: var(--ui-isc-text);
}
.ui-isc__save[data-open] .ui-isc__save-inner { padding-top: 10px; padding-bottom: 10px; }
.ui-isc__save-text { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ui-isc__save-actions { display: flex; flex: none; gap: 6px; }
.ui-isc__btn {
  height: 28px;
  padding: 0 10px !important;
  border-radius: 6px;
  background: var(--ui-isc-card) !important;
  box-shadow: var(--ui-isc-shadow);
  font-size: 13px;
  font-weight: 500;
  color: var(--ui-isc-strong) !important;
  transition: box-shadow 140ms ease, background-color 140ms ease;
}
.ui-isc__btn:hover:not(:disabled) { box-shadow: var(--ui-isc-shadow-hover); }
.ui-isc__btn--primary { min-width: 56px; background: var(--ui-isc-solid) !important; box-shadow: none; color: var(--ui-isc-on-solid) !important; }
.ui-isc__btn--primary:hover:not(:disabled) { background: var(--ui-isc-solid-hover) !important; box-shadow: none; }
.ui-isc__btn--primary:disabled { opacity: 0.4; cursor: default; }

/* Shimmer over the working label – a lighter band runs through the gray text */
.ui-isc__shimmer { position: relative; display: inline-block; }
.ui-isc__shimmer::after {
  content: attr(data-text);
  content: attr(data-text) / "";
  position: absolute;
  inset: 0;
  white-space: nowrap;
  color: transparent;
  background: linear-gradient(90deg, transparent 38%, var(--ui-isc-shine) 50%, transparent 62%) 100% 0 / 300% 100% no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  animation: ui-isc-sweep 1.4s linear infinite;
  pointer-events: none;
}

@keyframes ui-isc-in { from { opacity: 0; transform: translateY(2px); } }
@keyframes ui-isc-drop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } }
@keyframes ui-isc-pop { from { opacity: 0; transform: scale(0.5); } }
@keyframes ui-isc-spin { to { transform: rotate(360deg); } }
@keyframes ui-isc-sweep { from { background-position: 100% 0; } to { background-position: 0% 0; } }

/* Narrow (phones): tighter padding, the key row keeps its buttons */
@container (max-width: 400px) {
  .ui-isc__head { gap: 10px; padding: 14px 14px 14px 12px; }
  .ui-isc__logo { width: 36px; height: 36px; }
  .ui-isc__logo svg { width: 20px; height: 20px; }
  .ui-isc__section { padding: 12px 12px 14px; }
  .ui-isc__regen { min-width: 0; }
  .ui-isc__save-inner { padding: 0 10px 0 12px; }
}
/* Touch screens: bigger targets; 16px text in fields so iOS doesn't zoom in */
@media (hover: none) and (pointer: coarse) {
  .ui-isc__field, .ui-isc__generate { height: 40px; }
  .ui-isc__field input, .ui-isc__menu-search input { font-size: 16px; }
  .ui-isc__key { height: 44px; }
  .ui-isc__mini { width: 36px; height: 36px; }
  .ui-isc__regen, .ui-isc__btn { height: 36px; }
  .ui-isc__menu-search { height: 40px; }
  .ui-isc__option { min-height: 44px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-isc *, .ui-isc *::before, .ui-isc *::after { animation: none !important; transition: none !important; }
}

/* Text fields: no focus box while typing – also against global :focus-visible rules of the host page */
.ui-isc input:not([type="checkbox"]):not([type="radio"]):focus-visible,
.ui-isc textarea:focus-visible,
.ui-isc [contenteditable]:focus-visible { outline: none; }

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-isc {
  --ui-isc-card: #1c1c1e;
  --ui-isc-ink: rgba(255, 255, 255, 0.9);
  --ui-isc-strong: #ffffff;
  --ui-isc-text: rgba(255, 255, 255, 0.62);
  --ui-isc-muted: rgba(255, 255, 255, 0.46);
  --ui-isc-faint: rgba(255, 255, 255, 0.3);
  --ui-isc-icon: rgba(255, 255, 255, 0.5);
  --ui-isc-line: rgba(255, 255, 255, 0.08);
  --ui-isc-fill: rgba(255, 255, 255, 0.08);
  --ui-isc-fill-strong: rgba(255, 255, 255, 0.13);
  --ui-isc-wash: rgba(255, 255, 255, 0.04);
  --ui-isc-accent: #4d8dff;
  --ui-isc-ok: #3ec27a;
  --ui-isc-ok-soft: rgba(62, 194, 122, 0.14);
  --ui-isc-danger: #ff6369;
  --ui-isc-danger-soft: rgba(255, 99, 105, 0.14);
  --ui-isc-solid: rgba(255, 255, 255, 0.9);
  --ui-isc-solid-hover: rgba(255, 255, 255, 0.82);
  --ui-isc-on-solid: #161618;
  --ui-isc-switch-off: rgba(255, 255, 255, 0.16);
  --ui-isc-shine: #ffffff;
  --ui-isc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-isc-shadow-hover: 0 0 0 0.5px rgba(255, 255, 255, 0.16), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-isc-shadow-pop: 0 0 0 0.5px rgba(255, 255, 255, 0.12), 0 12px 28px -10px rgba(0, 0, 0, 0.6);
  --ui-isc-focus: rgba(77, 141, 255, 0.5);
}
:where(.dark, [data-theme="dark"]) .ui-isc__switch span { background: #f4f4f5; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4); }
:where(.dark, [data-theme="dark"]) .ui-isc__menu { background: #232326; }
`;
