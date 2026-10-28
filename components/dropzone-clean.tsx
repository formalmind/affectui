"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";

/*
 * Dropzone (Clean) – drag files in and watch them upload, in a single self-contained file.
 * Clean style: no tray – one white card with hairline shadows, a dashed drop area, quiet list rows
 * with 16px file icons and thin blue progress bars, the summary as the card's last row.
 * Dragging files over the area fans out the little documents and says how many will drop.
 * Every file gets a row with a type-tinted file icon, size, time left and its own progress bar;
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
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < MB) return `${num.format(Math.round(b / 1024))} KB`;
  if (b < GB) return `${(b / MB).toFixed(b < 10 * MB ? 1 : 0)} MB`;
  return `${num.format(Number((b / GB).toFixed(1)))} GB`;
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

/** Tint per file type */
const KINDS: { exts: string[]; color: string }[] = [
  { exts: ["pdf"], color: "#e5484d" },
  { exts: ["xls", "xlsx", "csv", "numbers"], color: "#1a9a52" },
  { exts: ["doc", "docx", "txt", "md", "pages", "rtf"], color: "#0060e2" },
  { exts: ["png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "avif"], color: "#5B5BD6" },
  { exts: ["mp4", "mov", "webm", "mp3", "wav"], color: "#e8a20c" },
  { exts: ["ppt", "pptx", "key"], color: "#e8590c" },
];
const kindColor = (name: string) => KINDS.find((k) => k.exts.includes(ext(name)))?.color ?? "#8f8f8f";

/** Simulated speed: about 1.2 MB/s with a floor, so small files still visibly fill */
const simDuration = (size: number) => Math.min(9000, Math.max(2600, (size / (1.2 * MB)) * 1000));

let counter = 0;
const newId = () => `f${Date.now().toString(36)}${(counter++).toString(36)}`;

/* ---------- Icons: 16px, thin lines and solid shapes ---------- */

const Glyph = ({ d, solid, className }: { d: string; solid?: boolean; className?: string }) => (
  <svg
    viewBox={solid ? "0 0 16 16" : "0 0 24 24"}
    className={["ui-dzc__glyph", className].filter(Boolean).join(" ")}
    data-solid={solid || undefined}
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);
const icons = {
  upload: "M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15",
  close: "M7 7l10 10M17 7 7 17",
  retry: "M20 12a8 8 0 1 1-2.34-5.66L20 8.5M20 4v4.5h-4.5",
  /* Solid, 16 grid */
  checkCircle: "M1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0Zm8.9-1.2a.5.5 0 0 0-.8-.6L7.44 9.23 6.35 8.15a.5.5 0 1 0-.7.7l1.5 1.5a.5.5 0 0 0 .76-.06l2.5-3.5Z",
  alertCircle: "M1.5 8a6.5 6.5 0 1 1 13 0 6.5 6.5 0 0 1-13 0ZM8 4.6a.6.6 0 0 0-.6.6v3.2a.6.6 0 0 0 1.2 0V5.2a.6.6 0 0 0-.6-.6Zm0 6.9a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z",
};

/** The 16px file icon of a row: a thin document with a small label in the type's color */
function FileIcon({ name }: { name: string }) {
  return (
    <svg viewBox="0 0 16 16" className="ui-dzc__file" aria-hidden="true">
      <path className="ui-dzc__file-sheet" d="M4 1.75h5l3.25 3.25v8A1.25 1.25 0 0 1 11 14.25H4A1.25 1.25 0 0 1 2.75 13V3A1.25 1.25 0 0 1 4 1.75Z" />
      <path className="ui-dzc__file-fold" d="M9 1.75V4a1 1 0 0 0 1 1h2.25" />
      <rect x="1" y="8.5" width="9" height="4.5" rx="1.25" fill={kindColor(name)} />
    </svg>
  );
}

/** A small document with a folded corner and a type label – on the left, or on the right with `end` (the area's stack) */
function FileBadge({ name, end }: { name: string; end?: boolean }) {
  const label = (ext(name) || "file").slice(0, 4).toUpperCase();
  const width = Math.max(18, label.length * 5.2 + 8);
  const x = end ? 30 - width : 0;
  return (
    <svg viewBox="0 0 30 36" className="ui-dzc__badge" aria-hidden="true">
      <path d="M5 1h14l10 10v20a4 4 0 0 1-4 4H5a4 4 0 0 1-4-4V5a4 4 0 0 1 4-4z" className="ui-dzc__badge-sheet" />
      <path d="M19 1v6a4 4 0 0 0 4 4h6" className="ui-dzc__badge-fold" />
      <rect x={x} y="19" width={width} height="11" rx="3" fill={kindColor(name)} fillOpacity="0.12" />
      <text x={x + 4} y="27.2" className="ui-dzc__badge-text" fill={kindColor(name)}>
        {label}
      </text>
    </svg>
  );
}

/** A PDF and a PNG behind the upload sheet – they fan out while files are dragged over */
function Stack() {
  return (
    <span className="ui-dzc__stack" aria-hidden="true">
      <span className="ui-dzc__sheet ui-dzc__sheet-l">
        <FileBadge name="file.pdf" />
      </span>
      <span className="ui-dzc__sheet ui-dzc__sheet-r">
        <FileBadge name="file.png" end />
      </span>
      <span className="ui-dzc__sheet ui-dzc__sheet-m">
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
  const bodyRef = useRef<HTMLDivElement>(null);
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

  // The content glides to its new height whenever rows come, go or change – the last row stays put
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const inner = innerRef.current;
    if (!body || !inner) return;
    const set = () => (body.style.height = `${inner.offsetHeight}px`);
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
      const label = `Uploading ${num.format(uploading.length)} of ${num.format(visible.length)}`;
      summary = (
        <span className="ui-dzc__summary">
          {/* The working part shimmers, the numbers stay calm */}
          <span className="ui-dzc__shimmer" data-text={label}>
            {label}
          </span>
          <span className="ui-dzc__dot">·</span>
          {formatPart(sent, total)}
        </span>
      );
    } else {
      summary = (
        <span className="ui-dzc__summary ui-dzc__summary-done">
          {failed.length ? (
            <Glyph d={icons.alertCircle} solid className="ui-dzc__warn" />
          ) : (
            <Glyph d={icons.checkCircle} solid className="ui-dzc__ok" />
          )}
          {failed.length
            ? `${num.format(done.length)} of ${num.format(visible.length)} uploaded`
            : `${num.format(done.length)} ${done.length === 1 ? "file" : "files"} uploaded`}
        </span>
      );
    }
  }

  return (
    <div className={["ui-dzc", className].filter(Boolean).join(" ")}>
      {/* React 19 hoists this into <head> once, no matter how many dropzones render */}
      <style href="ui-dropzone-clean" precedence="default">
        {css}
      </style>

      <div className="ui-dzc__card">
        {/* Only the content glides to its new height – the last row below always stays in view */}
        <div ref={bodyRef} className="ui-dzc__body">
          <div ref={innerRef} className="ui-dzc__inner">
            <input
              ref={input}
              id={inputId}
              type="file"
              multiple
              accept={accept?.join(",")}
              className="ui-dzc__input"
              tabIndex={-1}
              onChange={(e) => {
                if (e.target.files) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              className="ui-dzc__area"
              data-dragging={dragging > 0 || undefined}
              aria-describedby={`${inputId}-hint`}
              onClick={() => input.current?.click()}
              onDragEnter={onDragEnter}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onDrop={onDrop}
            >
              <Stack />
              <span className="ui-dzc__title" key={dragging ? "drop" : "idle"}>
                {dragging ? (
                  `Release to upload ${dragging === 1 ? "1 file" : `${num.format(dragging)} files`}`
                ) : (
                  <>
                    {/* Phones can't drag files in – they get a plain "tap" title */}
                    <span className="ui-dzc__for-mouse">
                      Drop files here or <span className="ui-dzc__browse">browse</span>
                    </span>
                    <span className="ui-dzc__for-touch">
                      Tap to <span className="ui-dzc__browse">choose files</span>
                    </span>
                  </>
                )}
              </span>
              <span className="ui-dzc__hint" id={`${inputId}-hint`}>
                {hintText}
              </span>
            </button>

            <ul className="ui-dzc__list" aria-label="Uploads">
              {items.map((i) => {
                const left = i.status === "uploading" ? ((1 - i.progress) * (now - i.startedAt)) / Math.max(0.05, i.progress) / 1000 : 0;
                return (
                  <li key={i.id} className="ui-dzc__row" data-status={i.status} data-removing={i.removing || undefined}>
                    <div className="ui-dzc__row-inner">
                      <FileIcon name={i.name} />
                      <div className="ui-dzc__info">
                        <div className="ui-dzc__line">
                          <span className="ui-dzc__name" title={i.name} dir="auto">
                            {splitName(i.name) ? (
                              <>
                                <span className="ui-dzc__name-head">{splitName(i.name)![0]}</span>
                                <span className="ui-dzc__name-tail">{splitName(i.name)![1]}</span>
                              </>
                            ) : (
                              i.name
                            )}
                          </span>
                          {i.status === "done" && (
                            <span className="ui-dzc__done" aria-label="Uploaded">
                              <Glyph d={icons.checkCircle} solid />
                            </span>
                          )}
                        </div>
                        <div className="ui-dzc__meta" key={i.status}>
                          {i.status === "uploading" && (
                            <>
                              {formatPart(i.size * i.progress, i.size)}
                              <span className="ui-dzc__dot">·</span>
                              {i.progress < 0.04 ? "starting" : formatLeft(left)}
                            </>
                          )}
                          {i.status === "done" && formatSize(i.size)}
                          {i.status === "error" && (
                        <span className="ui-dzc__error" dir="auto">
                          {i.error}
                        </span>
                      )}
                        </div>
                        {/* Stays in place and folds away once done, so the row shrinks smoothly; rejected files never get one */}
                        {(i.status !== "error" || i.retryable) && (
                          <div
                            className="ui-dzc__bar"
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
                      <div className="ui-dzc__actions">
                        {i.status === "error" && i.retryable && (
                          <button type="button" className="ui-dzc__icon-btn ui-dzc__retry" aria-label={`Retry ${i.name}`} onClick={() => retry(i)}>
                            <Glyph d={icons.retry} />
                          </button>
                        )}
                        <button type="button" className="ui-dzc__icon-btn" aria-label={`Remove ${i.name}`} onClick={() => remove(i.id)}>
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

        {/* The last row of the card, under a hairline */}
        <div className="ui-dzc__foot">
          {summary ?? <span className="ui-dzc__foot-idle">No files yet</span>}
          {(done.length > 0 || failed.length > 0) && !uploading.length && (
            <button type="button" className="ui-dzc__clear" onClick={clearDone}>
              Clear
            </button>
          )}
        </div>
      </div>

      <span className="ui-dzc__live" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
/* Colors and motion as variables – override them on .ui-dzc */
.ui-dzc {
  --ui-dzc-card: #ffffff;
  --ui-dzc-ink: rgba(0, 0, 0, 0.88);
  --ui-dzc-strong: #000000;
  --ui-dzc-text: rgba(0, 0, 0, 0.61);
  --ui-dzc-muted: rgba(0, 0, 0, 0.45);
  --ui-dzc-faint: rgba(0, 0, 0, 0.27);
  --ui-dzc-icon: rgba(0, 0, 0, 0.447);
  --ui-dzc-line: rgba(0, 0, 0, 0.06);
  --ui-dzc-dash: rgba(0, 0, 0, 0.12);
  --ui-dzc-dash-hover: rgba(0, 0, 0, 0.2);
  --ui-dzc-sheet-line: rgba(0, 0, 0, 0.14);
  --ui-dzc-track: rgba(0, 0, 0, 0.06);
  --ui-dzc-wash: rgba(0, 0, 0, 0.03);
  --ui-dzc-wash-big: rgba(0, 0, 0, 0.015);
  --ui-dzc-flash: rgba(0, 0, 0, 0.06);
  --ui-dzc-accent: rgba(0, 96, 226, 0.765);
  --ui-dzc-accent-soft: rgba(0, 96, 226, 0.035);
  --ui-dzc-ok: #1a9a52;
  --ui-dzc-warn: #e8a20c;
  --ui-dzc-danger: #e5484d;
  --ui-dzc-shine: rgba(255, 255, 255, 0.82);
  /* Strokes are shadows: a 0.5px hairline plus a soft lift */
  --ui-dzc-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.06), 0 1px 1px -1px rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ui-dzc-focus: rgba(0, 96, 226, 0.35);
  --ui-dzc-ease: cubic-bezier(0.22, 1, 0.36, 1);
  position: relative;
  box-sizing: border-box;
  container-type: inline-size;
  display: grid;
  width: 100%;
  max-width: 520px;
  font-family: "Inter", "InterVariable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  color: var(--ui-dzc-ink);
  -webkit-font-smoothing: antialiased;
}
.ui-dzc *, .ui-dzc *::before, .ui-dzc *::after { box-sizing: border-box; }
:where(.ui-dzc) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; }
:where(.ui-dzc) svg { display: block; flex: none; }
.ui-dzc button:focus-visible { outline: 2px solid var(--ui-dzc-focus); outline-offset: 1px; }
/* 16px icons with thin ~1.1px lines, or solid shapes */
.ui-dzc__glyph { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 1.65; stroke-linecap: round; stroke-linejoin: round; }
.ui-dzc__glyph[data-solid] { fill: currentColor; stroke: none; }

/* One white card – the edge is a shadow, not a border */
.ui-dzc__card { overflow: hidden; border-radius: 10px; background: var(--ui-dzc-card); box-shadow: var(--ui-dzc-shadow); }
.ui-dzc__body { overflow: hidden; transition: height 360ms var(--ui-dzc-ease); }
.ui-dzc__inner { display: flow-root; padding: 8px 8px 4px; }
.ui-dzc__input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

/* The drop area: white with a dashed hairline; blue dashes and a faint blue wash while files are dragged over */
.ui-dzc__area {
  position: relative;
  display: grid;
  justify-items: center;
  width: 100%;
  margin-bottom: 4px;
  padding: 24px 16px 20px;
  border: 1px dashed var(--ui-dzc-dash);
  border-radius: 10px;
  background: var(--ui-dzc-card);
  text-align: center;
  transition: background-color 160ms ease, border-color 160ms ease;
}
.ui-dzc__area:hover { border-color: var(--ui-dzc-dash-hover); background-color: var(--ui-dzc-wash-big); }
.ui-dzc__area[data-dragging] { border-color: var(--ui-dzc-accent); background-color: var(--ui-dzc-accent-soft); }
.ui-dzc__area:focus-visible { outline-offset: 2px; }

/* Three little documents that fan out while files are dragged over */
.ui-dzc__stack { position: relative; width: 64px; height: 44px; margin-bottom: 12px; }
.ui-dzc__sheet {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 30px;
  height: 36px;
  margin-left: -15px;
  border-radius: 6px;
  background: var(--ui-dzc-card);
  box-shadow: var(--ui-dzc-shadow);
  transition: transform 420ms var(--ui-dzc-ease);
}
/* The PDF and PNG behind */
.ui-dzc__sheet-l, .ui-dzc__sheet-r { background: none; box-shadow: none; filter: drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.05)); }
.ui-dzc__sheet .ui-dzc__badge { width: 100%; height: 100%; }
.ui-dzc__sheet-l { transform: translate(-12px, 2px) rotate(-10deg); }
.ui-dzc__sheet-r { transform: translate(12px, 2px) rotate(10deg); }
.ui-dzc__sheet-m { display: grid; place-items: center; transform: translateY(-2px); }
.ui-dzc__sheet-m .ui-dzc__glyph { color: var(--ui-dzc-icon); transition: color 160ms ease; }
.ui-dzc__area:hover .ui-dzc__sheet-m { transform: translateY(-4px); }
.ui-dzc__area:hover .ui-dzc__sheet-m .ui-dzc__glyph { color: var(--ui-dzc-ink); }
.ui-dzc__area[data-dragging] .ui-dzc__sheet-l { transform: translate(-28px, 0) rotate(-16deg); }
.ui-dzc__area[data-dragging] .ui-dzc__sheet-r { transform: translate(28px, 0) rotate(16deg); }
.ui-dzc__area[data-dragging] .ui-dzc__sheet-m { transform: translateY(-8px) scale(1.05); }
.ui-dzc__area[data-dragging] .ui-dzc__sheet-m .ui-dzc__glyph { color: var(--ui-dzc-accent); animation: ui-dzc-bob 900ms ease-in-out infinite; }

.ui-dzc__badge-sheet { fill: var(--ui-dzc-card); stroke: var(--ui-dzc-sheet-line); stroke-width: 0.9; }
.ui-dzc__badge-fold { fill: none; stroke: var(--ui-dzc-sheet-line); stroke-width: 0.9; stroke-linejoin: round; }
.ui-dzc__badge-text { font-family: inherit; font-size: 6.5px; font-weight: 500; letter-spacing: 0.04em; }

.ui-dzc__title { font-size: 13px; line-height: 20px; font-weight: 500; color: var(--ui-dzc-ink); animation: ui-dzc-in 260ms var(--ui-dzc-ease) both; }
.ui-dzc__browse { color: var(--ui-dzc-accent); }
.ui-dzc__hint { font-size: 12px; line-height: 16px; color: var(--ui-dzc-muted); overflow-wrap: anywhere; }

/* File rows: list rows that grow in and fold away when removed */
.ui-dzc__list { display: grid; margin: 0; padding: 0; list-style: none; }
/* A long list scrolls inside the card */
.ui-dzc__list { max-height: 360px; overflow-y: auto; overscroll-behavior: contain; }
.ui-dzc__row { display: grid; grid-template-rows: 1fr; animation: ui-dzc-grow 420ms var(--ui-dzc-ease) both; transition: grid-template-rows 260ms var(--ui-dzc-ease), opacity 200ms ease; }
/* Removing: the row flashes briefly, then folds away */
.ui-dzc__row[data-removing] { grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 260ms var(--ui-dzc-ease) 200ms, opacity 220ms ease 180ms; }
.ui-dzc__row-inner { position: relative; isolation: isolate; display: flex; align-items: center; gap: 10px; min-height: 0; overflow: hidden; padding: 8px 0 8px 8px; }
.ui-dzc__row-inner::before { content: ""; position: absolute; inset: 2px 0; border-radius: 6px; background: var(--ui-dzc-flash); opacity: 0; pointer-events: none; z-index: -1; }
.ui-dzc__row[data-removing] .ui-dzc__row-inner::before { animation: ui-dzc-flash 280ms ease-out both; }
/* A row on its way out no longer reacts – its buttons lose their hover fill right away */
.ui-dzc__row[data-removing] { pointer-events: none; }
.ui-dzc__row[data-removing] .ui-dzc__icon-btn { background: none; }
.ui-dzc__row + .ui-dzc__row .ui-dzc__row-inner { border-top: 0.5px solid var(--ui-dzc-line); }

/* The 16px file icon, aligned with the name */
.ui-dzc__file { align-self: flex-start; width: 16px; height: 16px; margin-top: 2px; overflow: visible; }
.ui-dzc__file-sheet, .ui-dzc__file-fold { fill: none; stroke: var(--ui-dzc-icon); stroke-width: 1.1; stroke-linecap: round; stroke-linejoin: round; }
.ui-dzc__file-sheet { fill: var(--ui-dzc-card); }

.ui-dzc__info { flex: 1; min-width: 0; }
.ui-dzc__line { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ui-dzc__name { overflow: hidden; font-size: 13px; line-height: 20px; font-weight: 500; color: var(--ui-dzc-ink); white-space: nowrap; text-overflow: ellipsis; }
/* A long name shortens in the middle – the end with the extension stays */
.ui-dzc__name:has(> .ui-dzc__name-head) { display: flex; min-width: 0; }
.ui-dzc__name-head { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.ui-dzc__name-tail { flex: none; white-space: pre; }
.ui-dzc__done { display: grid; place-items: center; flex: none; color: var(--ui-dzc-ok); animation: ui-dzc-pop 420ms cubic-bezier(0.34, 1.56, 0.64, 1) both; }
.ui-dzc__done .ui-dzc__glyph { width: 14px; height: 14px; }
.ui-dzc__meta { font-size: 12px; line-height: 16px; font-variant-numeric: tabular-nums; color: var(--ui-dzc-muted); animation: ui-dzc-in 240ms var(--ui-dzc-ease) both; }
.ui-dzc__dot { margin: 0 5px; color: var(--ui-dzc-faint); }
.ui-dzc__error { color: var(--ui-dzc-danger); overflow-wrap: anywhere; }
.ui-dzc__row[data-status="error"] .ui-dzc__row-inner { animation: ui-dzc-shake 380ms ease both; }

/* A thin 2px progress bar in the accent blue */
.ui-dzc__bar {
  position: relative;
  height: 2px;
  margin-top: 6px;
  margin-bottom: 2px;
  overflow: hidden;
  border-radius: 1px;
  background: var(--ui-dzc-track);
  transition: height 320ms var(--ui-dzc-ease) 250ms, margin 320ms var(--ui-dzc-ease) 250ms, opacity 200ms ease 200ms;
}
.ui-dzc__bar[data-hidden] { height: 0; margin-top: 0; margin-bottom: 0; opacity: 0; }
.ui-dzc__bar > span {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--ui-dzc-accent);
  transform-origin: left;
  transition: transform 200ms linear, background-color 200ms ease;
}
.ui-dzc__row[data-status="error"] .ui-dzc__bar > span { background: var(--ui-dzc-danger); }

/* Ghost icon buttons – the hover fill fades in and out quickly */
.ui-dzc__actions { display: flex; flex: none; gap: 2px; }
.ui-dzc__icon-btn { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 6px; color: var(--ui-dzc-icon); transition: background-color 120ms ease, color 120ms ease; }
.ui-dzc__icon-btn:hover { background: var(--ui-dzc-wash); color: var(--ui-dzc-ink); }
.ui-dzc__retry:active .ui-dzc__glyph { transform: rotate(120deg); transition: transform 300ms var(--ui-dzc-ease); }

/* The last row inside the card */
.ui-dzc__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 44px;
  padding: 0 8px 0 16px;
  border-top: 0.5px solid var(--ui-dzc-line);
  font-size: 12px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
  color: var(--ui-dzc-muted);
}
.ui-dzc__foot > span { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; animation: ui-dzc-in 240ms var(--ui-dzc-ease) both; }
.ui-dzc__summary { color: var(--ui-dzc-text); }
.ui-dzc__summary .ui-dzc__dot { color: var(--ui-dzc-faint); }
.ui-dzc__summary-done { display: inline-flex; align-items: center; gap: 6px; color: var(--ui-dzc-ink); }
.ui-dzc__ok { color: var(--ui-dzc-ok); }
.ui-dzc__warn { color: var(--ui-dzc-warn); }
.ui-dzc__summary-done .ui-dzc__glyph { width: 16px; height: 16px; }
/* Clear: the white button with the hairline shadow */
.ui-dzc__clear {
  flex: none;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  background: var(--ui-dzc-card);
  box-shadow: var(--ui-dzc-shadow);
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--ui-dzc-strong);
  transition: background-color 120ms ease;
  animation: ui-dzc-in 240ms var(--ui-dzc-ease) both;
}
.ui-dzc__clear:hover { background: #fafafa; }
.ui-dzc__live { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* Shimmer over the working text – a lighter band runs through it */
.ui-dzc__shimmer { position: relative; }
.ui-dzc__shimmer::after {
  content: attr(data-text);
  content: attr(data-text) / "";
  position: absolute;
  inset: 0;
  white-space: nowrap;
  color: transparent;
  background: linear-gradient(90deg, transparent 38%, var(--ui-dzc-shine) 50%, transparent 62%) 100% 0 / 300% 100% no-repeat;
  -webkit-background-clip: text;
  background-clip: text;
  animation: ui-dzc-sweep 1.6s linear infinite;
  pointer-events: none;
}

@keyframes ui-dzc-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@keyframes ui-dzc-grow { from { grid-template-rows: 0fr; opacity: 0; } to { grid-template-rows: 1fr; opacity: 1; } }
@keyframes ui-dzc-pop { 0% { transform: scale(0.4); } 60% { transform: scale(1.15); } 100% { transform: scale(1); } }
@keyframes ui-dzc-bob { 50% { transform: translateY(-3px); } }
@keyframes ui-dzc-flash { 0% { opacity: 0; } 35% { opacity: 1; } 100% { opacity: 0; } }
@keyframes ui-dzc-shake { 20%, 60% { transform: translateX(-3px); } 40%, 80% { transform: translateX(3px); } }
@keyframes ui-dzc-sweep { from { background-position: 100% 0; } to { background-position: 0% 0; } }

/* Narrow (phones) */
@container (max-width: 420px) {
  .ui-dzc__area { padding: 20px 12px 16px; }
  .ui-dzc__foot { padding-left: 12px; }
}
.ui-dzc__for-touch { display: none; }
/* Touch screens: bigger buttons, and a title that fits tapping */
@media (hover: none) and (pointer: coarse) {
  .ui-dzc__for-mouse { display: none; }
  .ui-dzc__for-touch { display: inline; }
  .ui-dzc__icon-btn { width: 36px; height: 36px; }
  .ui-dzc__foot { height: 52px; }
  .ui-dzc__clear { height: 34px; padding: 0 12px; }
}
@media (prefers-reduced-motion: reduce) {
  .ui-dzc *, .ui-dzc *::before, .ui-dzc *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-dzc {
  --ui-dzc-card: #1c1c1e;
  --ui-dzc-ink: rgba(255, 255, 255, 0.9);
  --ui-dzc-strong: #ffffff;
  --ui-dzc-text: rgba(255, 255, 255, 0.62);
  --ui-dzc-muted: rgba(255, 255, 255, 0.46);
  --ui-dzc-faint: rgba(255, 255, 255, 0.3);
  --ui-dzc-icon: rgba(255, 255, 255, 0.5);
  --ui-dzc-line: rgba(255, 255, 255, 0.08);
  --ui-dzc-dash: rgba(255, 255, 255, 0.16);
  --ui-dzc-dash-hover: rgba(255, 255, 255, 0.26);
  --ui-dzc-sheet-line: rgba(255, 255, 255, 0.2);
  --ui-dzc-track: rgba(255, 255, 255, 0.08);
  --ui-dzc-wash: rgba(255, 255, 255, 0.05);
  --ui-dzc-wash-big: rgba(255, 255, 255, 0.02);
  --ui-dzc-flash: rgba(255, 255, 255, 0.08);
  --ui-dzc-accent: #4d8dff;
  --ui-dzc-accent-soft: rgba(77, 141, 255, 0.07);
  --ui-dzc-ok: #3ec27a;
  --ui-dzc-danger: #ff6369;
  --ui-dzc-shine: rgba(255, 255, 255, 0.82);
  --ui-dzc-shadow: 0 0 0 0.5px rgba(255, 255, 255, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.4);
  --ui-dzc-focus: rgba(77, 141, 255, 0.5);
}
:where(.dark, [data-theme="dark"]) .ui-dzc__clear:hover { background: #232326; }
`;
