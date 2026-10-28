"use client";

import { cloneElement, isValidElement, memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactElement, type ReactNode, type SyntheticEvent } from "react";

/*
 * Integration Picker – the integrations page of a command menu, in a single self-contained file.
 * A gray tray holds a white card: search on top, the services grouped into Connected and Available on the left,
 * the picked one on the right – your app and the service on two tiles, what it does, three capabilities and a switch.
 * ↑ ↓ move through the list, ↵ connects or disconnects, Esc clears the search or closes, ← in an empty search goes back,
 * ⌘/ (Ctrl / on Windows) jumps into the search from anywhere.
 * The styles are injected below, so no extra files are needed.
 */

export type Integration = {
  id: string;
  name: string;
  /** Shown under the name in the details, e.g. "linear.app" */
  domain: string;
  /** Short label, e.g. "Project management" */
  category: string;
  description: string;
  /** Up to three short capabilities */
  features?: string[];
  /** Brand mark: a single SVG path on a 24 × 24 grid in `color` – or pass your own `icon` */
  path?: string;
  color?: string;
  /** Background of the logo tile – the brand color with a white mark, or white with a colored mark */
  tile?: string;
  icon?: ReactNode;
  connected?: boolean;
};

export type IntegrationPickerProps = {
  integrations?: Integration[];
  /** Your product's name in the details, e.g. "affectUI + Linear" */
  appName?: string;
  /** Your product's mark on the black tile – the affectUI mark by default */
  appIcon?: ReactNode;
  /** Id of the integration that is picked first */
  defaultSelected?: string;
  /** Called with the id and the new state when an integration is switched on or off */
  onToggle?: (id: string, connected: boolean) => void;
  onExplore?: (id: string) => void;
  /** Shows the back button and runs on ← in an empty search */
  onBack?: () => void;
  /** Runs on Esc in an empty search */
  onClose?: () => void;
  className?: string;
};

/* Marks in their own colors on dark tiles – Figma and ClickUp keep their multicolor logos */
const FigmaMark = () => (
  <svg viewBox="0 0 38 57" aria-hidden="true">
    <path d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0Z" fill="#1ABCFE" />
    <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0Z" fill="#0ACF83" />
    <path d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19Z" fill="#FF7262" />
    <path d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5Z" fill="#F24E1E" />
    <path d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5Z" fill="#A259FF" />
  </svg>
);

function ClickUpMark() {
  const id = "ui-ip-cu" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-a`} x1="0" y1="1" x2="1" y2="0">
          <stop stopColor="#8930FD" />
          <stop offset="1" stopColor="#49CCF9" />
        </linearGradient>
        <linearGradient id={`${id}-b`} x1="0" y1="1" x2="1" y2="0">
          <stop stopColor="#FF02F0" />
          <stop offset="1" stopColor="#FFC800" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id}-a)`} d="M2 18.439l3.69-2.828c1.961 2.56 4.044 3.739 6.363 3.739 2.307 0 4.33-1.166 6.203-3.704L22 18.405C19.298 22.065 15.941 24 12.053 24 8.178 24 4.788 22.078 2 18.439z" />
      <path fill={`url(#${id}-b)`} d="M12.04 6.15l-6.568 5.66-3.036-3.52L12.055 0l9.543 8.296-3.05 3.509z" />
    </svg>
  );
}

/* Airtable in its three colors */
const AirtableMark = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#FCB400" d="M11.992 1.966c-.434 0-.87.086-1.28.257L1.779 5.917c-.503.208-.49.908.012 1.116l8.982 3.558a3.266 3.266 0 0 0 2.454 0l8.982-3.558c.503-.196.503-.908.012-1.116l-8.957-3.694a3.255 3.255 0 0 0-1.272-.257z" />
    <path fill="#18BFFF" d="M23.4 8.056a.589.589 0 0 0-.222.045l-10.012 3.877a.612.612 0 0 0-.38.564v8.896a.6.6 0 0 0 .821.552L23.62 18.1a.583.583 0 0 0 .38-.551V8.653a.6.6 0 0 0-.6-.596z" />
    <path fill="#F82B60" d="M.676 8.095a.644.644 0 0 0-.48.19C.086 8.396 0 8.53 0 8.69v8.355c0 .442.515.737.908.54l6.27-3.006.307-.147 2.969-1.436c.466-.22.43-.908-.061-1.092L.883 8.138a.57.57 0 0 0-.207-.044z" />
  </svg>
);

const CUSTOM: Record<string, () => ReactNode> = { figma: () => <FigmaMark />, clickup: () => <ClickUpMark />, airtable: () => <AirtableMark /> };

const count = new Intl.NumberFormat("en");

/** The affectUI mark – the default for your app's tile */
const APP_MARK = "M106.447 67.3367C106.447 69.7104 104.523 71.6348 102.149 71.6348H75.928C73.5542 71.6348 71.6299 73.5591 71.6299 75.9329V102.16C71.6299 104.534 69.7056 106.458 67.3318 106.458H35.8198C35.8185 106.458 35.8174 106.459 35.8174 106.46C35.8174 106.462 35.8163 106.463 35.8149 106.463H4.29811C1.92433 106.463 0 104.539 0 102.165V39.1262C0 36.7525 1.92433 34.8281 4.29811 34.8281H30.5193C32.8931 34.8281 34.8174 32.9038 34.8174 30.53V4.29812C34.8174 1.92433 36.7417 0 39.1155 0H102.149C104.523 0 106.447 1.92433 106.447 4.29811V67.3367ZM35.8174 66.3425C35.8174 68.7163 37.7417 70.6406 40.1155 70.6406H66.3318C68.7056 70.6406 70.6299 68.7163 70.6299 66.3425V40.1155C70.6299 37.7417 68.7056 35.8174 66.3318 35.8174H40.1155C37.7417 35.8174 35.8174 37.7417 35.8174 40.1155V66.3425Z";

/** Sample services – company marks from Simple Icons (CC0) */
export const defaultIntegrations: Integration[] = [
  {
    id: "linear",
    name: "Linear",
    domain: "linear.app",
    category: "Project management",
    description: "Turn requests from chat into issues and keep their status in sync both ways.",
    features: ["Create issues from any message", "Two-way status sync", "Link issues to customers"], path: "M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z", color: "#ffffff", tile: "#5E6AD2",
    connected: true,
  },
  {
    id: "figma",
    tile: "#ffffff",
    name: "Figma",
    domain: "figma.com",
    category: "Design",
    description: "Preview frames where you talk about them and link designs to their tasks.",
    features: ["Live frame previews", "Comment threads in one place", "Link frames to tasks"],
    connected: false,
  },
  {
    id: "notion",
    name: "Notion",
    domain: "notion.so",
    category: "Docs & wiki",
    description: "Search your workspace while you write and save answers as pages.",
    features: ["Search pages and databases", "Save answers as pages", "Keep docs in sync"], path: "M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.981-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.841-.046.935-.56.935-1.167V6.354c0-.606-.233-.933-.748-.887l-15.177.887c-.56.047-.747.327-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.139c-.093-.514.28-.887.747-.933zM1.936 1.035l13.31-.98c1.634-.14 2.055-.047 3.082.7l4.249 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.047-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.667c0-.839.374-1.54 1.447-1.632z", color: "currentColor", tile: "#ffffff",
    connected: true,
  },
  {
    id: "stripe",
    name: "Stripe",
    domain: "stripe.com",
    category: "Payments",
    description: "See customers, invoices and subscriptions next to every conversation.",
    features: ["Customer and invoice lookup", "Subscription changes as events", "Revenue per account"], path: "M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z", color: "#ffffff", tile: "#635BFF",
    connected: true,
  },
  {
    id: "hubspot",
    name: "HubSpot",
    domain: "hubspot.com",
    category: "CRM",
    description: "Keep contacts and deals current – notes and calls are logged for you.",
    features: ["Sync contacts and companies", "Log activity on deals", "Trigger workflows"], path: "M18.164 7.93V5.084a2.198 2.198 0 001.267-1.978v-.067A2.2 2.2 0 0017.238.845h-.067a2.2 2.2 0 00-2.193 2.193v.067a2.196 2.196 0 001.252 1.973l.013.006v2.852a6.22 6.22 0 00-2.969 1.31l.012-.01-7.828-6.095A2.497 2.497 0 104.3 4.656l-.012.006 7.697 5.991a6.176 6.176 0 00-1.038 3.446c0 1.343.425 2.588 1.147 3.607l-.013-.02-2.342 2.343a1.968 1.968 0 00-.58-.095h-.002a2.033 2.033 0 102.033 2.033 1.978 1.978 0 00-.1-.595l.005.014 2.317-2.317a6.247 6.247 0 104.782-11.134l-.036-.005zm-.964 9.378a3.206 3.206 0 113.215-3.207v.002a3.206 3.206 0 01-3.207 3.207z", color: "#ffffff", tile: "#FF7A59",
    connected: false,
  },
  {
    id: "shopify",
    name: "Shopify",
    domain: "shopify.com",
    category: "Commerce",
    description: "Answer customer questions with the real order, product and stock in view.",
    features: ["Order and refund lookup", "Low-stock alerts", "Product catalog search"], path: "M15.337 23.979l7.216-1.561s-2.604-17.613-2.625-17.73c-.018-.116-.114-.192-.211-.192s-1.929-.136-1.929-.136-1.275-1.274-1.439-1.411c-.045-.037-.075-.057-.121-.074l-.914 21.104h.023zM11.71 11.305s-.81-.424-1.774-.424c-1.447 0-1.504.906-1.504 1.141 0 1.232 3.24 1.715 3.24 4.629 0 2.295-1.44 3.76-3.406 3.76-2.354 0-3.54-1.465-3.54-1.465l.646-2.086s1.245 1.066 2.28 1.066c.675 0 .975-.545.975-.932 0-1.619-2.654-1.694-2.654-4.359-.034-2.237 1.571-4.416 4.827-4.416 1.257 0 1.875.361 1.875.361l-.945 2.715-.02.01zM11.17.83c.136 0 .271.038.405.135-.984.465-2.064 1.639-2.508 3.992-.656.213-1.293.405-1.889.578C7.697 3.75 8.951.84 11.17.84V.83zm1.235 2.949v.135c-.754.232-1.583.484-2.394.736.466-1.777 1.333-2.645 2.085-2.971.193.501.309 1.176.309 2.1zm.539-2.234c.694.074 1.141.867 1.429 1.755-.349.114-.735.231-1.158.366v-.252c0-.752-.096-1.371-.271-1.871v.002zm2.992 1.289c-.02 0-.06.021-.078.021s-.289.075-.714.21c-.423-1.233-1.176-2.37-2.508-2.37h-.115C12.135.209 11.669 0 11.265 0 8.159 0 6.675 3.877 6.21 5.846c-1.194.365-2.063.636-2.16.674-.675.213-.694.232-.772.87-.075.462-1.83 14.063-1.83 14.063L15.009 24l.927-21.166z", color: "#ffffff", tile: "#95BF47",
    connected: false,
  },
  {
    id: "airtable",
    name: "Airtable",
    domain: "airtable.com",
    category: "Databases",
    description: "Read and update any base – rows and fields stay linked to your projects.",
    features: ["Read and write records", "Watch views for changes", "Map fields to properties"],
    tile: "#ffffff",
    connected: false,
  },
  {
    id: "webflow",
    name: "Webflow",
    domain: "webflow.com",
    category: "Website",
    description: "Publish CMS items and collect form submissions right from your workspace.",
    features: ["Publish CMS items", "Collect form submissions", "Schedule site updates"], path: "m24 4.515-7.658 14.97H9.149l3.205-6.204h-.144C9.566 16.713 5.621 18.973 0 19.485v-6.118s3.596-.213 5.71-2.435H0V4.515h6.417v5.278l.144-.001 2.622-5.277h4.854v5.244h.144l2.72-5.244H24Z", color: "#ffffff", tile: "#146EF5",
    connected: false,
  },
  {
    id: "vercel",
    name: "Vercel",
    domain: "vercel.com",
    category: "Developer tools",
    description: "Follow deployments, previews and failed builds without switching tabs.",
    features: ["Deployment status", "Preview links in threads", "Build failure alerts"], path: "m12 1.608 12 20.784H0Z", color: "currentColor", tile: "#000000",
    connected: false,
  },
  {
    id: "clickup",
    tile: "#ffffff",
    name: "ClickUp",
    domain: "clickup.com",
    category: "Project management",
    description: "Create tasks, assign owners and track due dates across your spaces.",
    features: ["Create and assign tasks", "Due date reminders", "Sync across spaces"],
    connected: false,
  },
];

/**
 * Three kinds of logo tile: the brand color with a white mark (stays the same in dark mode),
 * a light tile with the colored mark, and an ink tile (black in light mode) – the last two swap in dark mode.
 */
const tone = (item: Integration) => {
  const t = (item.tile ?? "").toLowerCase();
  if (!t || t === "#000" || t === "#000000") return "ink";
  if (t === "#fff" || t === "#ffffff") return "light";
  return "brand";
};
const tileProps = (item: Integration) => {
  const kind = tone(item);
  return { "data-tone": kind, style: kind === "brand" ? ({ "--ui-ip-brand": item.tile } as CSSProperties) : undefined };
};

/** First letter or digit of the name – the tile when there is no mark or the logo image fails */
const initial = (name: string) => (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();

function Mark({ item }: { item: Integration }) {
  const [failed, setFailed] = useState(false);
  const letter = <span className="ui-ip__letter">{initial(item.name)}</span>;
  if (failed) return letter;
  if (item.icon) {
    // An <img> logo that doesn't load falls back to the letter
    if (isValidElement(item.icon) && item.icon.type === "img") {
      const img = item.icon as ReactElement<{ onError?: (e: SyntheticEvent<HTMLImageElement>) => void }>;
      return cloneElement(img, {
        onError: (e: SyntheticEvent<HTMLImageElement>) => {
          img.props.onError?.(e);
          setFailed(true);
        },
      });
    }
    return <>{item.icon}</>;
  }
  const custom = CUSTOM[item.id];
  if (custom && !item.path) return <>{custom()}</>;
  if (!item.path) return letter;
  return (
    <svg viewBox="0 0 24 24" fill={item.color ?? "#fff"} aria-hidden="true">
      <path d={item.path} />
    </svg>
  );
}

/** One row of the list – memoized, so typing or moving with the arrows only re-renders the rows that change */
const Row = memo(function Row({ item, picked, optionId, onPick }: { item: Integration; picked: boolean; optionId: string; onPick: (id: string) => void }) {
  return (
    <button
      id={optionId}
      data-id={item.id}
      type="button"
      role="option"
      aria-selected={picked}
      className="ui-ip__item"
      tabIndex={-1}
      onClick={() => onPick(item.id)}
    >
      <span className="ui-ip__logo" {...tileProps(item)}>
        <Mark item={item} />
      </span>
      <span className="ui-ip__name">
        <b dir="auto" title={item.name}>
          {item.name}
        </b>
        {item.category && (
          <small dir="auto" title={item.category}>
            {item.category}
          </small>
        )}
      </span>
    </button>
  );
});

export function IntegrationPicker({
  integrations = defaultIntegrations,
  appName = "affectUI",
  appIcon,
  defaultSelected,
  onToggle,
  onExplore,
  onBack,
  onClose,
  className,
}: IntegrationPickerProps) {
  const id = "ui-ip" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(defaultSelected ?? integrations[0]?.id);
  const [connected, setConnected] = useState(() => new Set(integrations.filter((i) => i.connected).map((i) => i.id)));
  // Group membership is taken when the list is opened or searched, so a row doesn't jump away while you switch it
  const [grouped, setGrouped] = useState(connected);
  const [pill, setPill] = useState<{ y: number; h: number } | null>(null);
  // Swap animations only run once the pick has changed – the first render shows everything at once
  const [swapped, setSwapped] = useState(false);
  const firstPick = useRef<string | undefined>(undefined);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => integrations.filter((i) => !q || `${i.name} ${i.domain} ${i.category}`.toLowerCase().includes(q)),
    [integrations, q],
  );
  const groups = [
    { label: "Connected", items: matches.filter((i) => grouped.has(i.id)) },
    { label: "Available", items: matches.filter((i) => !grouped.has(i.id)) },
  ].filter((g) => g.items.length);
  const order = groups.flatMap((g) => g.items);
  const current = order.find((i) => i.id === selected) ?? order[0];
  const on = current ? connected.has(current.id) : false;

  useLayoutEffect(() => {
    if (firstPick.current === undefined) firstPick.current = current?.id;
    else if (current?.id !== firstPick.current) setSwapped(true);
  }, [current?.id]);

  useEffect(() => setGrouped(new Set(connected)), [q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard moves keep the picked row in view; clicks never scroll the list or the page
  const byKeyboard = useRef(false);

  // The gray highlight glides to the picked row
  useLayoutEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-id="${current?.id}"]`);
    if (!list || !row) return setPill(null);
    setPill({ y: row.offsetTop, h: row.offsetHeight });
    if (!byKeyboard.current) return;
    byKeyboard.current = false;
    const pad = 8;
    const label = row.previousElementSibling?.classList.contains("ui-ip__label") ? (row.previousElementSibling as HTMLElement).offsetHeight : 0;
    const top = row.offsetTop - pad - label;
    const bottom = row.offsetTop + row.offsetHeight + pad;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [current?.id, order.length, groups.length]);

  // ⌘/ or Ctrl+/ jumps into the search from anywhere on the page
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The rings only pulse while the picker is on screen
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => el.toggleAttribute("data-paused", !e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const pick = useCallback((itemId: string) => {
    setSelected(itemId);
    input.current?.focus({ preventScroll: true });
  }, []);

  const toggle = (item: Integration) => {
    const next = !connected.has(item.id);
    setConnected((prev) => {
      const set = new Set(prev);
      if (next) set.add(item.id);
      else set.delete(item.id);
      return set;
    });
    onToggle?.(item.id, next);
  };

  const move = (step: number) => {
    if (!order.length || !current) return;
    byKeyboard.current = true;
    const i = order.findIndex((x) => x.id === current.id);
    setSelected(order[(i + step + order.length) % order.length].id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter" && current) {
      e.preventDefault();
      toggle(current);
    } else if (e.key === "Escape") {
      if (query) setQuery("");
      else onClose?.();
    } else if (e.key === "ArrowLeft" && !query && onBack) {
      e.preventDefault();
      onBack();
    }
  };

  return (
    <div ref={root} className={["ui-ip", className].filter(Boolean).join(" ")} data-on={on || undefined} data-swapped={swapped || undefined}>
      {/* React 19 hoists this into <head> once, no matter how many instances render */}
      <style href="ui-integration-picker" precedence="default">
        {css}
      </style>

      {/* The tray: where you are and how many are connected */}
      <header className="ui-ip__head">
        {onBack && (
          <button type="button" className="ui-ip__back" aria-label="Back" onClick={onBack}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
        )}
        <span className="ui-ip__crumb">Integrations</span>
        <span className="ui-ip__count">
          {count.format(connected.size)} of {count.format(integrations.length)} connected
        </span>
      </header>

      <div className="ui-ip__card">
        <label className="ui-ip__search">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            ref={input}
            value={query}
            placeholder="Search integrations"
            aria-label="Search integrations"
            aria-controls={`${id}-list`}
            aria-activedescendant={current ? `${id}-${current.id}` : undefined}
            role="combobox"
            aria-expanded="true"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd>⌘/</kbd>
        </label>

        <div className="ui-ip__body">
          <div ref={listRef} id={`${id}-list`} className="ui-ip__list" role="listbox" aria-label="Integrations">
            {pill && <span className="ui-ip__pill" style={{ transform: `translateY(${pill.y}px)`, height: pill.h }} aria-hidden="true" />}
            {groups.map((group) => (
              <div key={group.label} role="group" aria-label={group.label} className="ui-ip__group">
                <span className="ui-ip__label">{group.label}</span>
                {group.items.map((item) => (
                  <Row key={item.id} item={item} picked={item.id === current?.id} optionId={`${id}-${item.id}`} onPick={pick} />
                ))}
              </div>
            ))}
            {!groups.length && (
              <p className="ui-ip__empty">
                No integrations match <b>“{query}”</b>
              </p>
            )}
          </div>

          <section className="ui-ip__detail" aria-live="polite">
            {current ? (
              <>
                <div className="ui-ip__art" aria-hidden="true">
                  <span className="ui-ip__rings">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="ui-ip__tile ui-ip__tile--app">
                    {appIcon ?? (
                      <svg viewBox="0 0 107 107" className="ui-ip__mark" fill="currentColor">
                        <path d={APP_MARK} />
                      </svg>
                    )}
                  </span>
                  <span className="ui-ip__link">
                    <svg viewBox="0 0 24 24">
                      <path d="M4 9h15m-4-4 4 4-4 4M20 15H5m4 4-4-4 4-4" />
                    </svg>
                  </span>
                  <span key={current.id} className="ui-ip__tile ui-ip__tile--brand" {...tileProps(current)}>
                    <Mark item={current} />
                  </span>
                </div>

                <div className="ui-ip__info" key={`info-${current.id}`}>
                  <div className="ui-ip__title">
                    <div>
                      <h3 dir="auto" title={`${appName} + ${current.name}`}>
                        {appName} + {current.name}
                      </h3>
                      <span className="ui-ip__domain">{current.domain}</span>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={`${on ? "Disconnect" : "Connect"} ${current.name}`}
                      className="ui-ip__switch"
                      onClick={() => toggle(current)}
                    />
                  </div>
                  <p className="ui-ip__desc" dir="auto" title={current.description}>
                    {current.description}
                  </p>
                  {current.features?.length ? (
                    <ul className="ui-ip__features">
                      {current.features.slice(0, 3).map((f, i) => (
                        <li key={i} dir="auto">
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m5 12.5 4.5 4.5L19 7.5" />
                          </svg>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <button type="button" className="ui-ip__explore" onClick={() => onExplore?.(current.id)}>
                    Explore integration
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                </div>
              </>
            ) : (
              <p className="ui-ip__empty ui-ip__empty--detail">Pick an integration to see what it does</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
.ui-ip {
  --ui-ip-tray: #f0f0f0;
  --ui-ip-card: #ffffff;
  --ui-ip-soft: #fafafa;
  --ui-ip-line: #ececec;
  --ui-ip-ink: #171717;
  --ui-ip-text: #404040;
  --ui-ip-muted: #8f8f8f;
  --ui-ip-faint: #b5b5b5;
  --ui-ip-hover: #f0f0f1;
  --ui-ip-hover-soft: #f7f7f8;
  --ui-ip-light: #ffffff;
  --ui-ip-light-ring: rgba(0, 0, 0, 0.09);
  --ui-ip-ink-tile: #000000;
  --ui-ip-ink-mark: #ffffff;
  --ui-ip-app: #000000;
  --ui-ip-app-ink: #ffffff;
  --ui-ip-app-ring: rgba(255, 255, 255, 0.08);
  --ui-ip-tile-shadow: 0 12px 14px -10px rgba(0, 0, 0, 0.18);
  --ui-ip-ring: rgba(0, 0, 0, 0.06);
  --ui-ip-accent: #2f6bff;
  --ui-ip-switch-off: #d9d9d9;
  --ui-ip-ok: #1f8a4c;
  --ui-ip-ease: cubic-bezier(0.22, 1, 0.36, 1);
  box-sizing: border-box;
  container-type: inline-size;
  display: grid;
  grid-template-rows: auto auto;
  width: 100%;
  max-width: 660px;
  padding: 0 4px 4px;
  border-radius: 20px;
  background: var(--ui-ip-tray);
  font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13.5px;
  color: var(--ui-ip-text);
  -webkit-font-smoothing: antialiased;
}
.ui-ip *, .ui-ip *::before, .ui-ip *::after { box-sizing: border-box; }
/* Low-priority reset, so the parts below can set their own margins and colors */
:where(.ui-ip) button { margin: 0; padding: 0; border: 0; background: none; font: inherit; color: inherit; cursor: pointer; }
:where(.ui-ip) svg { display: block; flex: none; }
.ui-ip button:focus-visible { outline: 2px solid var(--ui-ip-accent); outline-offset: 2px; }

/* The gray tray around the card: where you are and how many are connected */
.ui-ip__head { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 10px 0 12px; }
.ui-ip__back {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  margin-left: -4px;
  border-radius: 8px;
  color: var(--ui-ip-muted);
  transition: background-color 140ms ease, color 140ms ease;
}
.ui-ip__back:hover { background: rgba(0, 0, 0, 0.05); color: var(--ui-ip-ink); }
.ui-ip__back svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.ui-ip__crumb { font-size: 13.5px; font-weight: 500; color: var(--ui-ip-ink); }
.ui-ip__count { margin-left: auto; font-size: 12.5px; color: var(--ui-ip-muted); font-variant-numeric: tabular-nums; }

/* The white card */
.ui-ip__card {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-height: 0;
  overflow: hidden;
  border-radius: 16px;
  background: var(--ui-ip-card);
  box-shadow: 0 0 0 1px var(--ui-ip-line), 0 1px 2px rgba(0, 0, 0, 0.04);
}

/* Search */
.ui-ip__search { display: flex; align-items: center; gap: 10px; height: 46px; padding: 0 14px; border-bottom: 1px solid var(--ui-ip-line); cursor: text; }
.ui-ip__search > svg { width: 17px; height: 17px; fill: none; stroke: var(--ui-ip-muted); stroke-width: 1.8; stroke-linecap: round; }
.ui-ip__search input { flex: 1; min-width: 0; padding: 0; border: 0; background: transparent; font: inherit; font-size: 14px; color: var(--ui-ip-ink); outline: none; }
.ui-ip__search input::placeholder { color: var(--ui-ip-faint); }
.ui-ip__search input:focus-visible { outline: none; }
.ui-ip__search kbd { font-family: inherit; font-size: 12.5px; color: var(--ui-ip-faint); }

/* Body: list on the left, the picked integration on the right */
/* Fixed height on wide layouts, so the picker doesn't jump while you browse */
.ui-ip__body { display: grid; grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr); height: 350px; min-height: 0; }
.ui-ip__list { position: relative; min-height: 0; padding: 6px 8px 10px; overflow-y: auto; border-right: 1px solid var(--ui-ip-line); scrollbar-width: thin; }
.ui-ip__group { display: flex; flex-direction: column; gap: 2px; }
.ui-ip__label { padding: 10px 8px 6px; font-size: 12px; font-weight: 500; color: var(--ui-ip-faint); }
.ui-ip__pill {
  position: absolute;
  top: 0;
  left: 8px;
  right: 8px;
  border-radius: 10px;
  background: var(--ui-ip-hover);
  transition: transform 260ms var(--ui-ip-ease), height 260ms var(--ui-ip-ease);
}
.ui-ip__item { position: relative; display: flex; flex: none; align-items: center; gap: 10px; height: 42px; padding: 0 8px; border-radius: 10px; text-align: left; }
.ui-ip__item:not([aria-selected="true"]):hover { background: var(--ui-ip-hover-soft); }
.ui-ip__item { transition: background-color 140ms ease; }
.ui-ip__name { display: grid; min-width: 0; line-height: 17px; }
.ui-ip__name b { overflow: hidden; text-align: start; font-weight: 500; color: var(--ui-ip-ink); white-space: nowrap; text-overflow: ellipsis; }
.ui-ip__name small { overflow: hidden; text-align: start; font-size: 12.5px; color: var(--ui-ip-muted); white-space: nowrap; text-overflow: ellipsis; }
/* Brand marks in their own colors on a dark tile */
.ui-ip__logo {
  display: grid;
  place-items: center;
  flex: none;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  box-shadow: inset 0 0 0 1px var(--ui-ip-mark-ring), 0 1px 2px rgba(0, 0, 0, 0.08);
}
/* Tile tones: brand color with a white mark · light with the colored mark · ink, the reverse of the page */
:is(.ui-ip__logo, .ui-ip__tile--brand)[data-tone="brand"] { --ui-ip-mark-ring: rgba(255, 255, 255, 0.14); background: var(--ui-ip-brand); color: #fff; }
:is(.ui-ip__logo, .ui-ip__tile--brand)[data-tone="light"] { --ui-ip-mark-ring: var(--ui-ip-light-ring); background: var(--ui-ip-light); color: var(--ui-ip-ink); }
:is(.ui-ip__logo, .ui-ip__tile--brand)[data-tone="ink"] { --ui-ip-mark-ring: rgba(255, 255, 255, 0.1); background: var(--ui-ip-ink-tile); color: var(--ui-ip-ink-mark); }
.ui-ip__logo svg { width: 14px; height: 14px; }
/* Image logos of any shape fit their tile; the letter stands in when there is no mark or the image fails */
:is(.ui-ip__logo, .ui-ip__tile) > img { width: 100%; height: 100%; border-radius: inherit; object-fit: contain; }
.ui-ip__letter { font-size: 13px; font-weight: 600; line-height: 1; }
.ui-ip__tile .ui-ip__letter { font-size: 19px; }
.ui-ip__empty { margin: 0; padding: 18px 10px; overflow-wrap: anywhere; font-size: 13.5px; color: var(--ui-ip-muted); }
.ui-ip__empty b { font-weight: 500; color: var(--ui-ip-ink); }
.ui-ip__empty--detail { display: grid; place-items: center; height: 100%; }

/* Everything fits on wide layouts – no scrolling in the details */
.ui-ip__detail { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }

/* Illustration: your app and the service on two tiles, rings behind them */
.ui-ip__art {
  position: relative;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  gap: 18px;
  height: 104px;
  overflow: hidden;
  margin: 8px 8px 0;
  border-radius: 12px;
  background: var(--ui-ip-soft);
  box-shadow: inset 0 0 0 1px var(--ui-ip-line);
}
.ui-ip__rings { position: absolute; inset: 0; display: grid; place-items: center; pointer-events: none; }
.ui-ip__rings i { position: absolute; width: calc(90px + var(--n, 0) * 56px); aspect-ratio: 1; border-radius: 50%; border: 1px solid var(--ui-ip-ring); }
.ui-ip__rings i:nth-child(2) { --n: 1; }
.ui-ip__rings i:nth-child(3) { --n: 2; }
/* One ring keeps spreading out from the middle while connected */
.ui-ip__rings i:nth-child(4) { opacity: 0; }
.ui-ip[data-on] .ui-ip__rings i:nth-child(4) { animation: ui-ip-spread 2.8s var(--ui-ip-ease) infinite; }
.ui-ip[data-paused] .ui-ip__rings i { animation-play-state: paused; }
@keyframes ui-ip-spread {
  0% { opacity: 0.9; transform: scale(0.9); }
  100% { opacity: 0; transform: scale(2.6); }
}
.ui-ip__tile {
  position: relative;
  z-index: 1;
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: 12px;
  box-shadow: inset 0 0 0 1px var(--ui-ip-mark-ring), var(--ui-ip-tile-shadow);
}
.ui-ip__tile svg { width: 22px; height: 22px; }
.ui-ip__tile--app { background: var(--ui-ip-app); box-shadow: inset 0 0 0 1px var(--ui-ip-app-ring), var(--ui-ip-tile-shadow); color: var(--ui-ip-app-ink); }
.ui-ip__tile--app .ui-ip__mark { width: 20px; height: 20px; }
.ui-ip[data-swapped] .ui-ip__tile--brand { animation: ui-ip-swap 420ms var(--ui-ip-ease); }
@keyframes ui-ip-swap {
  from { opacity: 0; transform: translateY(6px) scale(0.92); filter: blur(4px); }
  to { opacity: 1; transform: none; filter: none; }
}
.ui-ip__link { position: relative; z-index: 1; display: grid; place-items: center; width: 30px; height: 30px; color: var(--ui-ip-faint); transition: color 300ms ease, transform 500ms var(--ui-ip-ease); }
.ui-ip__link svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
/* Connected: the arrows turn once and take the accent color */
.ui-ip[data-on] .ui-ip__link { color: var(--ui-ip-accent); transform: rotate(180deg); }

/* Details */
/* Only very long details scroll here, so the button never drops out of reach */
.ui-ip__info { display: flex; flex: 1; flex-direction: column; min-height: 0; overflow-x: hidden; overflow-y: auto; scrollbar-width: thin; padding: 12px 16px 14px; }
.ui-ip[data-swapped] .ui-ip__info { animation: ui-ip-in 360ms var(--ui-ip-ease); }
@keyframes ui-ip-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.ui-ip__title { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.ui-ip__title > div { display: grid; min-width: 0; }
/* A long name wraps to a second line, so the service in "App + Service" stays readable */
.ui-ip__title h3 { display: -webkit-box; margin: 0; overflow: hidden; font-size: 15px; font-weight: 600; line-height: 22px; letter-spacing: -0.01em; color: var(--ui-ip-ink); text-align: start; overflow-wrap: anywhere; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.ui-ip__domain { min-width: 0; font-size: 13px; color: var(--ui-ip-muted); overflow-wrap: anywhere; }
/* Up to four lines – the whole text is in the tooltip, and the button below always stays in view */
.ui-ip__desc { display: -webkit-box; flex: none; margin: 8px 0 0; overflow: hidden; font-size: 13px; line-height: 19px; color: var(--ui-ip-text); text-align: start; overflow-wrap: anywhere; white-space: pre-line; -webkit-line-clamp: 4; -webkit-box-orient: vertical; }
.ui-ip__features { display: grid; gap: 4px; margin: 10px 0 0; padding: 0; list-style: none; }
.ui-ip__features li { display: flex; align-items: flex-start; min-width: 0; gap: 7px; font-size: 12.5px; line-height: 18px; color: var(--ui-ip-muted); }
.ui-ip__features li > span { min-width: 0; text-align: start; overflow-wrap: anywhere; }
.ui-ip__features svg { margin-top: 2.5px; width: 13px; height: 13px; fill: none; stroke: var(--ui-ip-faint); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
.ui-ip__switch { position: relative; flex: none; width: 38px; height: 22px; margin-top: 1px; border-radius: 999px; background: var(--ui-ip-switch-off); transition: background-color 220ms ease; }
.ui-ip__switch::after {
  content: "";
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.22);
  transition: transform 260ms var(--ui-ip-ease);
}
.ui-ip__switch[aria-checked="true"] { background: var(--ui-ip-accent); }
.ui-ip__switch[aria-checked="true"]::after { transform: translateX(16px); }
.ui-ip__explore {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 34px;
  margin-top: auto;
  border-radius: 9px;
  background: var(--ui-ip-card);
  box-shadow: 0 0 0 1px var(--ui-ip-line), 0 1px 2px rgba(0, 0, 0, 0.05);
  font-size: 13px;
  font-weight: 500;
  color: var(--ui-ip-ink);
  transition: box-shadow 140ms ease, background-color 140ms ease;
}
/* The button sits at the bottom, at least 16px below the text */
.ui-ip__info > :nth-last-child(2) { margin-bottom: 16px; }
.ui-ip__explore svg { width: 15px; height: 15px; fill: none; stroke: var(--ui-ip-muted); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; transition: transform 200ms var(--ui-ip-ease); }
.ui-ip__explore:hover { background: var(--ui-ip-soft); box-shadow: 0 0 0 1px #dcdcdc, 0 1px 2px rgba(0, 0, 0, 0.06); }
.ui-ip__explore:hover svg { transform: translateX(2px); }

/* Narrow (phones): list on top in a short scrolling area, details below; the whole picker grows with its content */
@container (max-width: 560px) {
  .ui-ip__body { grid-template-columns: minmax(0, 1fr); height: auto; }
  .ui-ip__list { max-height: 196px; border-right: 0; border-bottom: 1px solid var(--ui-ip-line); }
  .ui-ip__art { height: 88px; }
  .ui-ip__detail { overflow: visible; }
  .ui-ip__info > :nth-last-child(2) { margin-bottom: 14px; }
  .ui-ip__count { display: none; }
}
@container (max-width: 400px) {
  .ui-ip__features { display: none; }
  .ui-ip__search kbd { display: none; }
}

@media (prefers-reduced-motion: reduce) {
  .ui-ip *, .ui-ip *::before, .ui-ip *::after { animation: none !important; transition: none !important; }
}

/* Dark mode: follows a .dark class or data-theme="dark" on any ancestor, e.g. <html> */
:where(.dark, [data-theme="dark"]) .ui-ip {
  --ui-ip-tray: #111113;
  --ui-ip-card: #19191b;
  --ui-ip-soft: #151517;
  --ui-ip-line: #2a2a2e;
  --ui-ip-ink: #ededed;
  --ui-ip-text: #c8c8cc;
  --ui-ip-muted: #8b8b92;
  --ui-ip-faint: #5c5c63;
  --ui-ip-hover: #26262a;
  --ui-ip-hover-soft: #1f1f22;
  --ui-ip-light: #26262a;
  --ui-ip-light-ring: rgba(255, 255, 255, 0.1);
  --ui-ip-ink-tile: #f4f4f5;
  --ui-ip-ink-mark: #111113;
  --ui-ip-app: #000000;
  --ui-ip-app-ink: #ffffff;
  --ui-ip-app-ring: rgba(255, 255, 255, 0.14);
  --ui-ip-tile-shadow: 0 14px 16px -10px rgba(0, 0, 0, 0.6);
  --ui-ip-ring: rgba(255, 255, 255, 0.07);
  --ui-ip-accent: #6d8bff;
  --ui-ip-switch-off: #3a3a3f;
  --ui-ip-ok: #3ec27a;
}
:where(.dark, [data-theme="dark"]) .ui-ip__back:hover { background: rgba(255, 255, 255, 0.06); }
`;
