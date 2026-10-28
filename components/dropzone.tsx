"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";

/*
 * Dropzone – drag files in and watch them upload, in a single self-contained file.
 * Dragging files over the area fans out the little documents and says how many will drop.
 * Every file gets a row with a colored type badge, size, time left and its own progress bar;
 * files that are too large or of the wrong type say so, a failed upload can be retried, any row can be removed.
 * Without `onUpload` the uploads are simulated, so it works as a preview right away.
 * The styles are injected below, so no extra files are needed.
 */

export type UploadStatus = "uploading" | "done" | "error";

export type UploadItem = {
  id: string;
  name: string;
  /** In bytes */
  size: number;
  status: UploadStatus;
  /** 0 to 1 */
  progress: number;
  error?: string;
  /** The real file – missing for the sample files */
  file?: File;
};

export type DropzoneProps = {
  /** Allowed extensions, e.g. [".pdf", ".png"] – any file when left out */
  accept?: string[];
  /** Largest file in bytes */
  maxSize?: number;
  /** Upload a file and report its progress (0–1); throw to mark it as failed. Simulated when left out */
  onUpload?: (file: File, onProgress: (progress: number) => void) => Promise<void>;
  /** Called whenever the list changes */
  onChange?: (items: UploadItem[]) => void;
  /** Text under the title – defaults to the accepted types and size */
  hint?: string;
  /** Plays a sample drop on its own – nice for previews */
  autoplay?: boolean;
  className?: string;
};

type Item = UploadItem & { failAt?: number; retryable?: boolean; startedAt: number; duration: number; removing?: boolean };

const MB = 1024 * 1024;

/* ---------- Helpers ---------- */

const ext = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "");

/** Number and unit joined by a no-break space, so "25 MB" never splits across lines */
const GB = 1024 * MB;
const num = new Intl.NumberFormat("en");
/** Sizes that aren't a real number of bytes count as 0 */
const bytesOf = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
const formatSize = (bytes: number) => {
  const b = bytesOf(bytes);
  if (b < 1024) return `${Math.round(b)}\u00a0B`;
  if (b < MB) return `${num.format(Math.round(b / 1024))}\u00a0KB`;
  if (b < GB) return `${(b / MB).toFixed(b < 10 * MB ? 1 : 0)}\u00a0MB`;
  return `${num.format(Number((b / GB).toFixed(1)))}\u00a0GB`;
};

/** "1.2 of 4.1 MB" – the part sent in the total's unit */
const formatPart = (done: number, total: number) => {
  const t = bytesOf(total);
  const d = Math.min(bytesOf(done), t);
  if (t < 1024) return `${Math.round(d)} of ${formatSize(t)}`;
  if (t < MB) return `${num.format(Math.round(d / 1024))} of ${formatSize(t)}`;
  if (t < GB) return `${(d / MB).toFixed(1)} of ${formatSize(t)}`;
  return `${(d / GB).toFixed(1)} of ${formatSize(t)}`;
};

const formatLeft = (s: number) =>
  !Number.isFinite(s) ? "starting" : s < 1 ? "almost done" : s < 60 ? `${Math.ceil(s)}s left` : s < 3600 ? `${Math.ceil(s / 60)} min left` : s < 86400 ? `${Math.ceil(s / 3600)} h left` : `${Math.ceil(s / 86400)} d left`;
/** Progress between 0 and 1 – anything else counts as no progress */
const clamp01 = (p: number) => (Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0);
/** Long names shorten in the middle, so the end and the extension stay in view – right-to-left names stay whole */
const splitName = (name: string) => (name.length > 24 && !/[\u0590-\u08ff]/.test(name) ? [name.slice(0, -14), name.slice(-14)] : null);

/** Badge color per file type */
const KINDS: { exts: string[]; color: string }[] = [
  { exts: ["pdf"], color: "#e5484d" },
  { exts: ["xls", "xlsx", "csv", "numbers"], color: "#2f9e5b" },
  { exts: ["doc", "docx", "txt", "md", "pages", "rtf"], color: "#2f6bff" },
  { exts: ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "avif"], color: "#8b5cf6" },
  { exts: ["mp4", "mov", "webm", "mp3", "wav"], color: "#f08c00" },
  { exts: ["ppt", "pptx", "key"], color: "#e8590c" },
];
const kindColor = (name: string) => KINDS.find((k) => k.exts.includes(ext(name)))?.color ?? "#8f8f8f";

/** Simulated speed: about 1.2 MB/s with a floor, so small files still visibly fill */
const simDuration = (size: number) => Math.min(9000, Math.max(2600, (size / (1.2 * MB)) * 1000));

let counter = 0;
const newId = () => `f${Date.now().toString(36)}${(counter++).toString(36)}`;

/* ---------- Icons ---------- */

const Glyph = ({ d, className }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={["ui-dz__glyph", className].filter(Boolean).join(" ")} aria-hidden="true">
    <path d={d} />
  </svg>
);
const icons = {
  upload: "M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15",
  close: "M7 7l10 10M17 7 7 17",
  check: "M5.5 12.5l4 4L18.5 8",
  retry: "M20 12a8 8 0 1 1-2.34-5.66L20 8.5M20 4v4.5h-4.5",
  alert: "M12 8v5M12 16.5h.01M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
};

/** A small document with a folded corner and a colored type label – on the left, or on the right with `end` */
function FileBadge({ name, end }: { name: string; end?: boolean }) {
  const label = (ext(name) || "file").slice(0, 4).toUpperCase();
  const width = Math.max(18, label.length * 5.4 + 8);
  const x = end ? 30 - width : 0;
  return (
    <svg viewBox="0 0 30 36" className="ui-dz__badge" aria-hidden="true">
      <path d="M5 1h14l10 10v20a4 4 0 0 1-4 4H5a4 4 0 0 1-4-4V5a4 4 0 0 1 4-4z" className="ui-dz__badge-sheet" />
      <path d="M19 1v6a4 4 0 0 0 4 4h6" className="ui-dz__badge-fold" />
      <rect x={x} y="19" width={width} height="11" rx="3" fill={kindColor(name)} fillOpacity="0.14" />
      <text x={x + 4} y="27.2" className="ui-dz__badge-text" fill={kindColor(name)}>
        {label}
      </text>
    </svg>
  );
}

/** A PDF and a PNG behind the upload card – they fan out while files are dragged over */
function Stack() {
  return (
    <span className="ui-dz__stack" aria-hidden="true">
      <span className="ui-dz__sheet ui-dz__sheet-l">
        <FileBadge name="file.pdf" />
      </span>
      <span className="ui-dz__sheet ui-dz__sheet-r">
        <FileBadge name="file.png" end />
      </span>
      <span className="ui-dz__sheet ui-dz__sheet-m">
        <Glyph d={icons.upload} />
      </span>
    </span>
  );
}

/* ---------- Sample drop for previews ---------- */

const SAMPLE = [
  { name: "Q3-Board-Report.pdf", size: 4.2 * MB },
  { name: "Hero-Shot.png", size: 2.6 * MB },
  { name: "Budget-2027.xlsx", size: 1.3 * MB, failAt: 0.62 },
  { name: "Product-Demo.mp4", size: 48 * MB },
];

export function Dropzone({
  accept,
  maxSize = 25 * MB,
  onUpload,
  onChange,
  hint,
  autoplay = false,
  className,
}: DropzoneProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(0); // number of files over the area, 0 = none
  const [announce, setAnnounce] = useState("");
  const [, setTick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const depth = useRef(0);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const inputId = useId();

  const accepted = accept?.map((a) => a.replace(/^\./, "").toLowerCase());
  const typeText = accepted?.length
    ? accepted.length <= 3
      ? accepted.map((a) => a.toUpperCase()).join(", ")
      : `${accepted.slice(0, 3).map((a) => a.toUpperCase()).join(", ")} and more`
    : "Any file";
  // No real limit (NaN, 0 or less) means any size
  const limit = Number.isFinite(maxSize) && maxSize > 0 ? maxSize : Infinity;
  const hintText = hint ?? (limit < Infinity ? `${typeText} · up to ${formatSize(limit)} each` : typeText);

  useEffect(() => {
    onChange?.(items.filter((i) => !i.removing).map(({ id, name, size, status, progress, error, file }) => ({ id, name, size, status, progress, error, file })));
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  // The card glides to its new height whenever rows come, go or change
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

  const update = (id: string, patch: Partial<Item>) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  /** Checks a file and starts its upload */
  const start = (entry: { name: string; size: number; file?: File; failAt?: number }) => {
    const id = newId();
    let error: string | undefined;
    if (accepted?.length && !accepted.includes(ext(entry.name))) error = ext(entry.name) ? `.${ext(entry.name)} files aren't supported` : "This file type isn't supported";
    else if (entry.size > limit) error = `Too large – max ${formatSize(limit)}`;
    const item: Item = {
      id,
      name: entry.name,
      size: bytesOf(entry.size),
      file: entry.file,
      status: error ? "error" : "uploading",
      progress: 0,
      error,
      failAt: entry.failAt,
      startedAt: performance.now(),
      duration: simDuration(bytesOf(entry.size)),
    };
    setItems((list) => [...list, item]);
    if (error) setAnnounce(`${entry.name}: ${error}`);
    else if (onUpload && entry.file) run(item);
  };

  /** A real upload through `onUpload` */
  const run = (item: Item) => {
    onUpload!(item.file!, (p) =>
      setItems((list) => list.map((i) => (i.id === item.id && i.status === "uploading" ? { ...i, progress: Math.max(i.progress, clamp01(p)) } : i))),
    )
      .then(() => {
        update(item.id, { status: "done", progress: 1 });
        setAnnounce(`${item.name} uploaded`);
      })
      .catch((e: unknown) => {
        const message = e instanceof Error && e.message ? e.message : "Upload failed";
        update(item.id, { status: "error", error: message, retryable: true });
        setAnnounce(`${item.name}: ${message}`);
      });
  };

  const addFiles = (files: FileList | File[]) => Array.from(files).forEach((file) => start({ name: file.name, size: file.size, file }));

  // Simulated uploads move on a single ticker; it also refreshes the "time left"
  const simulated = items.some((i) => i.status === "uploading" && (!onUpload || !i.file));
  useEffect(() => {
    if (!simulated) return;
    const t = window.setInterval(() => {
      const now = performance.now();
      setItems((list) =>
        list.map((i) => {
          if (i.status !== "uploading" || (onUpload && i.file)) return i;
          // Eased with a little jitter, like a real connection
          const raw = Math.min(1, (now - i.startedAt) / i.duration);
          const progress = Math.max(i.progress, raw < 1 ? raw * (0.92 + Math.random() * 0.08) : 1);
          if (i.failAt !== undefined && progress >= i.failAt) {
            setAnnounce(`${i.name}: upload failed`);
            return { ...i, progress: i.failAt, status: "error", error: "Connection lost", retryable: true };
          }
          if (progress >= 1) {
            setAnnounce(`${i.name} uploaded`);
            return { ...i, progress: 1, status: "done" };
          }
          return { ...i, progress };
        }),
      );
    }, 90);
    return () => clearInterval(t);
  }, [simulated, onUpload]);

  // Keeps "time left" fresh for real uploads too
  useEffect(() => {
    if (!items.some((i) => i.status === "uploading")) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [items]);

  // The sample: files are dragged over, then dropped
  useEffect(() => {
    if (!autoplay) return;
    const timers = [
      window.setTimeout(() => setDragging(SAMPLE.length), 700),
      window.setTimeout(() => {
        setDragging(0);
        SAMPLE.forEach((s, n) => window.setTimeout(() => start(s), n * 140));
      }, 1900),
    ];
    return () => timers.forEach(clearTimeout);
  }, [autoplay]); // eslint-disable-line react-hooks/exhaustive-deps

  const retry = (item: Item) => {
    update(item.id, { status: "uploading", progress: 0, error: undefined, retryable: false, failAt: undefined, startedAt: performance.now() });
    if (onUpload && item.file) run({ ...item, progress: 0 });
  };
  const remove = (id: string) => {
    update(id, { removing: true });
    // A short flash, then the row folds away
    window.setTimeout(() => setItems((list) => list.filter((i) => i.id !== id)), 480);
  };
  const clearDone = () => itemsRef.current.filter((i) => i.status !== "uploading").forEach((i) => remove(i.id));

  /* Drag and drop: counts enters and leaves, so moving over children doesn't flicker */
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
  const onDragEnter = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current += 1;
    setDragging(Math.max(1, e.dataTransfer.items.length));
  };
  const onDragOver = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (!depth.current) setDragging(0);
  };
  const onDrop = (e: DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth.current = 0;
    setDragging(0);
    addFiles(e.dataTransfer.files);
  };

  const visible = items.filter((i) => !i.removing);
  const uploading = visible.filter((i) => i.status === "uploading");
  const done = visible.filter((i) => i.status === "done");
  const failed = visible.filter((i) => i.status === "error");
  const now = performance.now();

  let summary: ReactNode = null;
  if (visible.length) {
    if (uploading.length) {
      const total = uploading.reduce((s, i) => s + i.size, 0);
      const sent = uploading.reduce((s, i) => s + i.size * i.progress, 0);
      summary = (
        <span>
          Uploading {num.format(uploading.length)} of {num.format(visible.length)} · {formatPart(sent, total)}
        </span>
      );
    } else {
      summary = (
        <span className="ui-dz__summary-done">
          {failed.length ? (
            <Glyph d={icons.alert} className="ui-dz__warn" />
          ) : (
            <Glyph d={icons.check} className="ui-dz__ok" />
          )}
          {failed.length
            ? `${num.format(done.length)} of ${num.format(visible.length)} uploaded`
            : `${num.format(done.length)} ${done.length === 1 ? "file" : "files"} uploaded`}
        </span>
      );
    }
  }

  return (
    <div className={["ui-dz", className].filter(Boolean).join(" ")}>
      {/* React 19 hoists this into <head> once, no matter how many dropzones render */}
      <style href="ui-dropzone" precedence="default">
        {css}
      </style>

      <div ref={cardRef} className="ui-dz__card">
        <div ref={innerRef} className="ui-dz__inner">
        <input
          ref={input}
          id={inputId}
          type="file"
          multiple
          accept={accept?.join(",")}
          className="ui-dz__input"
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="ui-dz__area"
          data-dragging={dragging > 0 || undefined}
          aria-describedby={`${inputId}-hint`}
          onClick={() => input.current?.click()}
          onDragEnter={onDragEnter}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <Stack />
          <span className="ui-dz__title" key={dragging ? "drop" : "idle"}>
            {dragging ? (
              `Release to upload ${dragging === 1 ? "1 file" : `${num.format(dragging)} files`}`
            ) : (
              <>
                {/* Phones can't drag files in – they get a plain "tap" title */}
                <span className="ui-dz__for-mouse">
                  Drop files here or <span className="ui-dz__browse">browse</span>
                </span>
                <span className="ui-dz__for-touch">
                  Tap to <span className="ui-dz__browse">choose files</span>
                </span>
              </>
            )}
          </span>
          <span className="ui-dz__hint" id={`${inputId}-hint`}>
            {hintText}
          </span>
        </button>

        <ul className="ui-dz__list" aria-label="Uploads">
          {items.map((i) => {
            const left = i.status === "uploading" ? ((1 - i.progress) * (now - i.startedAt)) / Math.max(0.05, i.progress) / 1000 : 0;
            return (
              <li key={i.id} className="ui-dz__row" data-status={i.status} data-removing={i.removing || undefined}>
                <div className="ui-dz__row-inner">
                  <FileBadge name={i.name} />
                  <div className="ui-dz__info">
                    <div className="ui-dz__line">
                      <span className="ui-dz__name" title={i.name} dir="auto">
                        {splitName(i.name) ? (
                          <>
                            <span className="ui-dz__name-head">{splitName(i.name)![0]}</span>
                            <span className="ui-dz__name-tail">{splitName(i.name)![1]}</span>
                          </>
                        ) : (
                          i.name
                        )}
                      </span>
                      {i.status === "done" && (
                        <span className="ui-dz__done" aria-label="Uploaded">
                          <Glyph d={icons.check} />
                        </span>
                      )}
                    </div>
                    <div className="ui-dz__meta" key={i.status}>
                      {i.status === "uploading" && (
                        <>
                          {formatPart(i.size * i.progress, i.size)}
                          <span className="ui-dz__dot">·</span>
                          {i.progress < 0.04 ? "starting" : formatLeft(left)}
                        </>
                      )}
                      {i.status === "done" && formatSize(i.size)}
                      {i.status === "error" && (
                        <span className="ui-dz__error" dir="auto">
                          {i.error}
                        </span>
                      )}
                    </div>
                    {/* Stays in place and folds away once done, so the row shrinks smoothly; rejected files never get one */}
                    {(i.status !== "error" || i.retryable) && (
                      <div
                        className="ui-dz__bar"
                        data-hidden={i.status === "done" || undefined}
                        role="progressbar"
                        aria-label={`${i.name} upload`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(i.progress * 100)}
                      >
                        <span style={{ transform: `scaleX(${i.progress})` }} />
                      </div>
                    )}
                  </div>
                  <div className="ui-dz__actions">
                    {i.status === "error" && i.retryable && (
                      <button type="button" className="ui-dz__icon-btn" aria-label={`Retry ${i.name}`} onClick={() => retry(i)}>
                        <Glyph d={icons.retry} />
                      </button>
                    )}
                    <button type="button" className="ui-dz__icon-btn" aria-label={`Remove ${i.name}`} onClick={() => remove(i.id)}>
                      <Glyph d={icons.close} />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        </div>
      </div>

      {/* The tray below the card */}
      <div className="ui-dz__foot">
        {summary ?? <span className="ui-dz__foot-idle">No files yet</span>}
        {(done.length > 0 || failed.length > 0) && !uploading.length && (
          <button type="button" className="ui-dz__clear" onClick={clearDone}>
            Clear
          </button>
        )}
      </div>

      <span className="ui-dz__live" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-dz */
.ui-dz {
  --ui-dz-tray: #f0f0f0;
  --ui-dz-card: #ffffff;
  --ui-dz-line: #ececec;
  --ui-dz-ink: #171717;
  --ui-dz-text: #404040;
  --ui-dz-muted: #8f8f8f;
  --ui-dz-faint: #b5b5b5;
  --ui-dz-area: #fafafa;
  --ui-dz-dash: #d9d9dc;
  --ui-dz-hover: #e6e6e7;
  --ui-dz-track: #efeff1;
  --ui-dz-flash: #e9e9ec;
  --ui-dz-accent: #2f6bff;
  --ui-dz-accent-soft: rgba(47, 107, 255, 0.06);
  --ui-dz-danger: #e5484d;
  --ui-dz-sheet: #ffffff;
  --ui-dz-focus: rgba(23, 23, 23, 0.22);
  --ui-dz-ease: cubic-bezier(0.22, 1, 0.36, 1);
  box-sizing: border-box;
  container-type: inline-size;
  display: grid;
  width: 100%;
  max-width: 520px;
  padding: 4px;
  border-radius: 20px;
  background: var(--ui-dz-tray);
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--ui-dz-text);
  -webkit-font-smoothing: antialiased;
}
.ui-dz *, .ui-dz *::before, .ui-dz *::after { box-sizing: border-box; }
:where(.ui-dz) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; }
:where(.ui-dz) svg { display: block; flex: none; }
.ui-dz button:focus-visible { outline: 2px solid var(--ui-dz-focus); outline-offset: 2px; }
.ui-dz__glyph { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }

/* The white card */
.ui-dz__card { overflow: hidden; border-radius: 16px; transition: height 360ms var(--ui-dz-ease); background: var(--ui-dz-card); box-shadow: 0 0 0 1px var(--ui-dz-line), 0 1px 2px rgba(0, 0, 0, 0.04); }
.ui-dz__inner { display: flow-root; padding: 6px; }
.ui-dz__input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

/* The drop area */
.ui-dz__area {
  position: relative;
  display: grid;
  justify-items: center;
  width: 100%;
  padding: 26px 20px 22px;
  border-radius: 12px;
  background: var(--ui-dz-area);
  text-align: center;
  transition: background-color 220ms ease, box-shadow 220ms ease;
}
/* The dashed outline turns solid and blue while files are dragged over */
.ui-dz__area::before {
  content: "";
  position: absolute;
  inset: 0;
  border: 1.5px dashed var(--ui-dz-dash);
  border-radius: inherit;
  transition: border-color 220ms ease;
  pointer-events: none;
}
.ui-dz__area:hover::before { border-color: var(--ui-dz-faint); }
.ui-dz__area[data-dragging] { background: var(--ui-dz-accent-soft); }
.ui-dz__area[data-dragging]::before { border-style: solid; border-color: var(--ui-dz-accent); }
.ui-dz__area:focus-visible { outline-offset: 3px; }

/* Three little documents that fan out while files are dragged over */
.ui-dz__stack { position: relative; width: 64px; height: 50px; margin-bottom: 12px; }
.ui-dz__sheet {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 34px;
  height: 42px;
  margin-left: -17px;
  border-radius: 7px;
  background: var(--ui-dz-sheet);
  box-shadow: 0 0 0 1px var(--ui-dz-line), 0 2px 6px rgba(0, 0, 0, 0.06);
  transition: transform 420ms var(--ui-dz-ease);
}
/* The PDF and PNG behind: the same file badges as in the rows */
.ui-dz__sheet-l, .ui-dz__sheet-r { background: none; box-shadow: none; filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.06)); }
.ui-dz__sheet .ui-dz__badge { width: 100%; height: 100%; }
.ui-dz__sheet-l { transform: translate(-9px, 2px) rotate(-10deg); }
.ui-dz__sheet-r { transform: translate(9px, 2px) rotate(10deg); }
.ui-dz__sheet-m { display: grid; place-items: center; transform: translateY(-2px); }
.ui-dz__sheet-m .ui-dz__glyph { width: 18px; height: 18px; color: var(--ui-dz-ink); transition: transform 420ms var(--ui-dz-ease), color 220ms ease; }
.ui-dz__area:hover .ui-dz__sheet-m { transform: translateY(-4px); }
.ui-dz__area[data-dragging] .ui-dz__sheet-l { transform: translate(-30px, 0) rotate(-16deg); }
.ui-dz__area[data-dragging] .ui-dz__sheet-r { transform: translate(30px, 0) rotate(16deg); }
.ui-dz__area[data-dragging] .ui-dz__sheet-m { transform: translateY(-9px) scale(1.06); }
.ui-dz__area[data-dragging] .ui-dz__sheet-m .ui-dz__glyph { color: var(--ui-dz-accent); animation: ui-dz-bob 900ms ease-in-out infinite; }

.ui-dz__title { font-size: 14.5px; font-weight: 500; color: var(--ui-dz-ink); animation: ui-dz-in 260ms var(--ui-dz-ease) both; }
.ui-dz__browse { color: var(--ui-dz-accent); }
.ui-dz__hint { margin-top: 3px; font-size: 12.5px; color: var(--ui-dz-muted); overflow-wrap: anywhere; }

/* File rows: each one grows in and folds away when removed */
.ui-dz__list { display: grid; margin: 0; padding: 0; list-style: none; }
/* A long list scrolls inside the card */
.ui-dz__list { max-height: 360px; overflow-y: auto; overscroll-behavior: contain; }
.ui-dz__row { display: grid; grid-template-rows: 1fr; animation: ui-dz-grow 420ms var(--ui-dz-ease) both; transition: grid-template-rows 260ms var(--ui-dz-ease), opacity 200ms ease; }
/* Removing: the row flashes briefly, like closing a window on a Mac, then folds away */
.ui-dz__row[data-removing] { grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 260ms var(--ui-dz-ease) 200ms, opacity 220ms ease 180ms; }
.ui-dz__row-inner { position: relative; isolation: isolate; display: flex; align-items: center; gap: 12px; min-height: 0; overflow: hidden; padding: 10px 6px 10px 10px; }
.ui-dz__row-inner::before { content: ""; position: absolute; inset: 3px 0; border-radius: 10px; background: var(--ui-dz-flash); opacity: 0; pointer-events: none; z-index: -1; }
.ui-dz__row[data-removing] .ui-dz__row-inner::before { animation: ui-dz-flash 280ms ease-out both; }
/* A row on its way out no longer reacts – its buttons lose their hover fill right away */
.ui-dz__row[data-removing] { pointer-events: none; }
.ui-dz__row[data-removing] .ui-dz__icon-btn { background: none; }
.ui-dz__row:first-child .ui-dz__row-inner { margin-top: 6px; }
.ui-dz__row + .ui-dz__row .ui-dz__row-inner { border-top: 1px solid var(--ui-dz-line); }

.ui-dz__badge { width: 28px; height: 34px; }
.ui-dz__badge-sheet { fill: var(--ui-dz-sheet); stroke: var(--ui-dz-dash); stroke-width: 1.2; }
.ui-dz__badge-fold { fill: none; stroke: var(--ui-dz-dash); stroke-width: 1.2; stroke-linejoin: round; }
.ui-dz__badge-text { font-family: inherit; font-size: 7px; font-weight: 700; letter-spacing: 0.03em; }

.ui-dz__info { flex: 1; min-width: 0; }
.ui-dz__line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ui-dz__name { overflow: hidden; color: var(--ui-dz-ink); font-weight: 500; white-space: nowrap; text-overflow: ellipsis; }
/* A long name shortens in the middle – the end with the extension stays */
.ui-dz__name:has(> .ui-dz__name-head) { display: flex; min-width: 0; }
.ui-dz__name-head { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-dz__name-tail { flex: none; white-space: pre; }
.ui-dz__done { display: grid; place-items: center; flex: none; color: var(--ui-dz-muted); animation: ui-dz-pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
.ui-dz__done .ui-dz__glyph { width: 14px; height: 14px; stroke-width: 2.2; }
.ui-dz__meta { margin-top: 1px; font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--ui-dz-muted); animation: ui-dz-in 240ms var(--ui-dz-ease) both; }
.ui-dz__dot { margin: 0 5px; color: var(--ui-dz-faint); }
.ui-dz__error { color: var(--ui-dz-danger); overflow-wrap: anywhere; }
.ui-dz__row[data-status="error"] .ui-dz__row-inner { animation: ui-dz-shake 380ms ease both; }

.ui-dz__bar {
  position: relative;
  height: 4px;
  margin-top: 7px;
  overflow: hidden;
  border-radius: 2px;
  background: var(--ui-dz-track);
  transition: height 320ms var(--ui-dz-ease) 250ms, margin-top 320ms var(--ui-dz-ease) 250ms, opacity 200ms ease 200ms;
}
.ui-dz__bar[data-hidden] { height: 0; margin-top: 0; opacity: 0; }
.ui-dz__bar > span {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--ui-dz-ink);
  transform-origin: left;
  transition: transform 200ms linear, background-color 200ms ease;
}
.ui-dz__row[data-status="error"] .ui-dz__bar > span { background: var(--ui-dz-danger); }
.ui-dz__actions { display: flex; flex: none; gap: 2px; }
.ui-dz__icon-btn { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; color: var(--ui-dz-muted); transition: background-color 160ms ease, color 160ms ease; }
.ui-dz__icon-btn:hover { background: var(--ui-dz-track); color: var(--ui-dz-ink); }

/* The tray below the card */
.ui-dz__foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 40px; padding: 0 8px 0 12px; font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--ui-dz-muted); }
.ui-dz__foot > span { animation: ui-dz-in 240ms var(--ui-dz-ease) both; }
.ui-dz__summary-done { display: inline-flex; align-items: center; gap: 6px; color: var(--ui-dz-ink); }
.ui-dz__ok { width: 14px; height: 14px; stroke: var(--ui-dz-muted); stroke-width: 2.2; }
.ui-dz__warn { width: 14px; height: 14px; stroke: var(--ui-dz-muted); }
.ui-dz__clear { height: 28px; padding: 0 10px; border-radius: 8px; font-size: 12.5px; color: var(--ui-dz-text); transition: background-color 160ms ease; animation: ui-dz-in 240ms var(--ui-dz-ease) both; }
.ui-dz__clear:hover { background: var(--ui-dz-hover); }
.ui-dz__live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

@keyframes ui-dz-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@keyframes ui-dz-grow { from { grid-template-rows: 0fr; opacity: 0; } to { grid-template-rows: 1fr; opacity: 1; } }
@keyframes ui-dz-pop { 0% { transform: scale(0.4); } 60% { transform: scale(1.15); } 100% { transform: scale(1); } }
@keyframes ui-dz-bob { 50% { transform: translateY(-3px); } }
@keyframes ui-dz-flash { 0% { opacity: 0; } 35% { opacity: 1; } 100% { opacity: 0; } }
@keyframes ui-dz-shake { 20%, 60% { transform: translateX(-3px); } 40%, 80% { transform: translateX(3px); } }

/* Narrow (phones) */
@container (max-width: 420px) {
  .ui-dz__area { padding: 22px 16px 18px; }
  .ui-dz__title { font-size: 14px; }
}
.ui-dz__for-touch { display: none; }
/* Touch screens: bigger buttons, and a title that fits tapping */
@media (hover: none) and (pointer: coarse) {
  .ui-dz__for-mouse { display: none; }
  .ui-dz__for-touch { display: inline; }
  .ui-dz__icon-btn { width: 40px; height: 40px; border-radius: 10px; }
  .ui-dz__actions { margin-right: -4px; }
  .ui-dz__clear { height: 36px; padding: 0 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-dz *, .ui-dz *::before, .ui-dz *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-dz {
  --ui-dz-tray: #111113;
  --ui-dz-card: #19191b;
  --ui-dz-line: #2a2a2e;
  --ui-dz-ink: #ededed;
  --ui-dz-text: #c8c8cc;
  --ui-dz-muted: #8b8b92;
  --ui-dz-faint: #5c5c63;
  --ui-dz-area: #1d1d20;
  --ui-dz-dash: #38383d;
  --ui-dz-hover: #222225;
  --ui-dz-track: #2a2a2e;
  --ui-dz-flash: #2e2e33;
  --ui-dz-accent: #6d8bff;
  --ui-dz-accent-soft: rgba(109, 139, 255, 0.08);
  --ui-dz-danger: #ff6369;
  --ui-dz-sheet: #26262a;
  --ui-dz-focus: rgba(255, 255, 255, 0.3);
}
`;
