"use client";

/*
 * Analytics – a revenue dashboard, in a single file.
 * Four key figures with mini bars, revenue by channel next to a breakdown with sparklines,
 * then top products and two week-over-week charts filling the rest of the panel.
 * Sits in the affectUI App Shell; uses the KPI Chart and Button from the library, icons from the Hugeicons free set.
 */

import { useState, type CSSProperties } from "react";
import {
  Analytics01Icon,
  Calendar03Icon,
  Download04Icon,
  Home01Icon,
  Invoice01Icon,
  Store01Icon,
  ShoppingBag01Icon,
  UserMultipleIcon,
  Wallet01Icon,
  RepeatIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { KpiChart, type KpiSeries } from "@/components/ui/kpi-chart";
import { AppShell, Icon, MenuButton, useToast, type AppShellProps, type ShellGroup, type ShellNavItem } from "@/components/ui/app-shell";

/** Sample content – replace with your own data */
const nav: ShellNavItem[] = [
  { label: "Home", icon: Home01Icon },
  { label: "Revenue", icon: Analytics01Icon },
  { label: "Invoices", icon: Invoice01Icon, count: 12 },
  { label: "Payouts", icon: Wallet01Icon },
  { label: "Customers", icon: UserMultipleIcon },
];
const groups: ShellGroup[] = [
  {
    label: "Channels",
    items: [
      { label: "Online store", icon: Store01Icon },
      { label: "Marketplace", icon: ShoppingBag01Icon },
      { label: "Wholesale", icon: Wallet01Icon },
      { label: "Subscriptions", icon: RepeatIcon },
    ],
  },
];

const labels = ["Mar 3", "Mar 4", "Mar 5", "Mar 6", "Mar 7", "Mar 8", "Mar 9"];
const tooltipLabels = ["Mon, Mar 3", "Tue, Mar 4", "Wed, Mar 5", "Thu, Mar 6", "Fri, Mar 7", "Sat, Mar 8", "Sun, Mar 9"];
const series: KpiSeries[] = [
  { label: "Organic", color: "#2f6bff", values: [4200, 4700, 3900, 4600, 5400, 5100, 5900] },
  { label: "Paid ads", color: "#ec4899", values: [3600, 3300, 4400, 4800, 4000, 4500, 4200] },
  { label: "Referral", color: "#8b5cf6", values: [1800, 2300, 2000, 1500, 2400, 2200, 2700] },
  { label: "Email", color: "#14b8a6", values: [1200, 1100, 1700, 2100, 1600, 1300, 1500] },
];
const money = (n: number) => (n >= 1000 ? `$${+(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`);

/** This week against last week – for the two small charts */
const compare = (a: number[], b: number[]): KpiSeries[] => [
  { label: "This week", color: "#2f6bff", values: a },
  { label: "Last week", color: "#a5c0ff", values: b },
];
const sessions = compare([1820, 2140, 1960, 2480, 2710, 2390, 2950], [1650, 1720, 1880, 1790, 2010, 1940, 2100]);
const orderValue = compare([118, 124, 121, 132, 129, 137, 141], [112, 115, 119, 117, 121, 120, 124]);

const stats: { label: string; value: string; delta: string; bars: number[] }[] = [
  { label: "Gross revenue", value: "$96,412", delta: "+12.5%", bars: [5, 7, 6, 8, 7, 9, 10] },
  { label: "Active customers", value: "2,847", delta: "+8.2%", bars: [6, 6, 7, 7, 8, 8, 9] },
  { label: "Conversion", value: "3.24%", delta: "+0.4%", bars: [7, 5, 6, 8, 6, 7, 8] },
  { label: "Refund rate", value: "1.8%", delta: "-0.3%", bars: [9, 8, 8, 6, 7, 5, 4] },
];

const breakdown: { label: string; value: string; spark: number[]; tone?: "up" | "down" | "flat" }[] = [
  { label: "Gross sales", value: "$104,210", spark: [3, 5, 4, 6, 5, 7, 8] },
  { label: "Discounts", value: "−$4,180", spark: [4, 3, 5, 4, 3, 4, 3], tone: "down" },
  { label: "Refunds", value: "−$1,734", spark: [5, 4, 4, 3, 3, 2, 2], tone: "down" },
  { label: "Shipping", value: "$2,940", spark: [2, 3, 3, 4, 3, 4, 5] },
  { label: "Taxes", value: "$8,316", spark: [4, 4, 4, 4, 4, 4, 4], tone: "flat" },
  { label: "Net revenue", value: "$96,412", spark: [3, 4, 4, 5, 6, 6, 8] },
];

const products = [
  { label: "Annual plan", value: "$38,400", share: 100 },
  { label: "Team seats", value: "$24,150", share: 63 },
  { label: "Monthly plan", value: "$18,920", share: 49 },
  { label: "Add-ons", value: "$9,640", share: 25 },
];

/** Key figures for the period: money and counts grow with it, rates stay rates */
function statValue(label: string, f: number) {
  if (label === "Gross revenue") return usd(96412 * f);
  if (label === "Active customers") return Math.round(2847 * Math.sqrt(f)).toLocaleString("en-US");
  if (label === "Conversion") return `${(3.24 + (f - 1) * 0.012).toFixed(2)}%`;
  if (label === "Refund rate") return `${(1.8 + (f - 1) * 0.008).toFixed(1)}%`;
  return "";
}

/** Small trend line for the breakdown list – values are spread over its height */
function Spark({ values, tone = "up" }: { values: number[]; tone?: "up" | "down" | "flat" }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 40},${tone === "flat" ? 7 : 13 - ((v - min) / (max - min || 1)) * 12}`)
    .join(" ");
  return (
    <svg className="ui-as-rev__spark" data-tone={tone} viewBox="0 0 40 14" aria-hidden="true">
      <polyline points={pts} />
    </svg>
  );
}

type Period = "7d" | "30d" | "90d";
const periods: { value: Period; label: string }[] = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];
/** Axis labels and how much bigger the totals are for each period – sample data */
const span: Record<Period, { labels: string[]; factor: number }> = {
  "7d": { labels, factor: 1 },
  "30d": { labels: ["Feb 9", "Feb 14", "Feb 19", "Feb 24", "Mar 1", "Mar 5", "Mar 9"], factor: 4.3 },
  "90d": { labels: ["Dec 10", "Dec 25", "Jan 9", "Jan 24", "Feb 8", "Feb 23", "Mar 9"], factor: 12.9 },
};
/** Scales a series to the period, with a little wobble so longer periods don't look like copies */
const scaleSeries = (list: KpiSeries[], period: Period): KpiSeries[] =>
  list.map((s, k) => ({
    ...s,
    values: s.values.map((v, i) => Math.round(v * span[period].factor * (period === "7d" ? 1 : 1 + 0.09 * Math.sin(i * 1.7 + k)))),
  }));
const usd = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

export type AnalyticsScreenProps = Pick<AppShellProps, "onNavigate" | "workspace" | "user" | "className">;

export function AnalyticsScreen(props: AnalyticsScreenProps) {
  const [period, setPeriod] = useState<Period>("7d");
  const [toast, showToast] = useToast();
  const f = span[period].factor;
  const axis = span[period].labels;
  const tips = period === "7d" ? tooltipLabels : axis;
  const channelSeries = scaleSeries(series, period);
  const k = (n: number) => usd(n * f);

  return (
    <AppShell active="Revenue" nav={nav} groups={groups} {...props}>
      <style href="ui-screen-analytics" precedence="default">
        {css}
      </style>
      <div className="ui-as-rev">
        <header className="ui-as-rev__head">
          <h1>
            <Icon icon={Analytics01Icon} size={17} />
            Revenue
          </h1>
          <div className="ui-as-rev__actions">
            <MenuButton value={period} options={periods} onChange={setPeriod} icon={Calendar03Icon} className="ui-as-rev__period" />
            <Button variant="secondary" size="sm" icon={<Icon icon={Download04Icon} size={14} />}>
              Export
            </Button>
            <Button size="sm" onClick={() => showToast("Saved to Reports")}>
              Save as report
            </Button>
          </div>
        </header>

        <div className="ui-as-rev__content" key={period}>
          <div className="ui-as-rev__stats">
            {stats.map((s, i) => (
              <div key={s.label} className="ui-as-rev__card ui-as-rev__stat ui-as-rise" style={{ "--i": i } as CSSProperties}>
                <span className="ui-as-rev__cap">{s.label}</span>
                <div className="ui-as-rev__stat-row">
                  <strong>
                    {statValue(s.label, f) ?? s.value}
                    <em>{s.delta}</em>
                  </strong>
                  <span className="ui-as-rev__minibars" aria-hidden="true">
                    {s.bars.map((b, i) => (
                      <i key={i} style={{ height: `${b * 10}%` }} />
                    ))}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <div className="ui-as-rev__row ui-as-rev__row--main">
            <KpiChart
              className="ui-as-rev__chart ui-as-rev__chart--tall"
              title="Revenue by channel"
              value={money(96400 * f)}
              delta={Math.round(7900 * f)}
              format={money}
              labels={axis}
              tooltipLabels={tips}
              series={channelSeries}
              footer="Top 4 channels"
            />
            <div className="ui-as-rev__card ui-as-rev__breakdown">
              <span className="ui-as-rev__cap">Revenue breakdown</span>
              <ul>
                {breakdown.map((r) => (
                  <li key={r.label}>
                    <span>{r.label}</span>
                    <b>{(r.value.startsWith("−") ? "−" : "") + k(+r.value.replace(/[^\d]/g, ""))}</b>
                    <Spark values={r.spark} tone={r.tone} />
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="ui-as-rev__row ui-as-rev__row--3">
            <div className="ui-as-rev__card ui-as-rev__products">
              <span className="ui-as-rev__cap">Top products</span>
              {products.map((p) => (
                <div key={p.label} className="ui-as-rev__product">
                  <span>
                    {p.label}
                    <b>{k(+p.value.replace(/[^\d]/g, ""))}</b>
                  </span>
                  <i style={{ width: `${p.share}%` }} />
                </div>
              ))}
            </div>
            <KpiChart
              className="ui-as-rev__chart"
              title="Sessions over time"
              value={`${+(16.4 * f).toFixed(1)}k`}
              delta={Math.round(2340 * f)}
              labels={axis}
              tooltipLabels={tips}
              series={scaleSeries(sessions, period)}
              footer={period === "7d" ? "This week vs. last week" : "This period vs. the one before"}
            />
            <KpiChart
              className="ui-as-rev__chart"
              title="Average order value"
              value="$141"
              delta={17}
              format={(n) => `$${Math.round(n)}`}
              labels={axis}
              tooltipLabels={tips}
              series={orderValue}
              footer={period === "7d" ? "This week vs. last week" : "This period vs. the one before"}
            />
          </div>
        </div>
      </div>
      {toast}
    </AppShell>
  );
}

/* ---------- Styles ---------- */

const css = /* css */ `
/* Revenue dashboard: a header, then rows of white cards on the panel */
.ui-as-rev { display: flex; flex-direction: column; min-height: 100%; }
.ui-as-rev__head { display: flex; flex: none; align-items: center; justify-content: space-between; height: 60px; padding: 0 16px 0 24px; }
.ui-as-rev__head h1 { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 16px; font-weight: 500; color: var(--ink); }
.ui-as-rev__actions { display: flex; align-items: center; gap: 6px; }
.ui-as-rev__period { border-radius: 9px; }

.ui-as-rev__content { display: flex; flex: 1; flex-direction: column; gap: 12px; padding: 0 16px 16px; }
.ui-as-rev__card {
  padding: 14px 16px;
  border-radius: 14px;
  background: var(--card);
  box-shadow: 0 0 0 1px var(--line), var(--shadow);
}
/* Card titles with a dotted underline – a hint that there is an explanation */
.ui-as-rev__cap {
  align-self: flex-start;
  font-size: 13px;
  color: var(--muted);
  text-decoration: underline dotted var(--faint);
  text-underline-offset: 3px;
}

.ui-as-rev__stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.ui-as-rev__stat { display: flex; flex-direction: column; gap: 14px; }
.ui-as-rev__stat-row { display: flex; align-items: flex-end; justify-content: space-between; }
.ui-as-rev__stat strong {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 22px;
  font-weight: 500;
  letter-spacing: -0.02em;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}
.ui-as-rev__stat em { font-size: 12px; font-style: normal; font-weight: 500; letter-spacing: 0; color: #16a34a; }
.ui-as-rev__minibars { display: flex; align-items: flex-end; gap: 3px; height: 26px; }
.ui-as-rev__minibars i { width: 5px; border-radius: 2px; background: var(--line); }
.ui-as-rev__minibars i:last-child { background: var(--faint); }

.ui-as-rev__row { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 12px; align-items: stretch; }
/* The revenue chart takes the spare height; the three cards below keep their own */
.ui-as-rev__row--main { flex: 1; }
.ui-as-rev__row--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }

/* Library charts flat, with the same edge as the other cards */
.ui-as-rev .ui-as-rev__chart.ui-kpi {
  --ui-kpi-shadow: 0 0 0 1px var(--line), var(--shadow);
  width: 100%;
  max-width: none;
  border: 0;
  border-radius: 14px;
}

/* Its plot grows with the card */
.ui-as-rev .ui-as-rev__chart--tall.ui-kpi { display: flex; flex-direction: column; }
.ui-as-rev .ui-as-rev__chart--tall .ui-kpi__chart { flex: 1; grid-template-rows: minmax(116px, 1fr) 20px; }

.ui-as-rev__breakdown { display: flex; flex-direction: column; }
.ui-as-rev__breakdown ul { display: flex; flex-direction: column; margin: 12px -6px 0; padding: 0; list-style: none; }
.ui-as-rev__breakdown li {
  display: grid;
  grid-template-columns: 1fr auto 40px;
  align-items: center;
  gap: 12px;
  height: 38px;
  padding: 0 8px;
  border-radius: 8px;
  font-size: 13.5px;
}
.ui-as-rev__breakdown li:nth-child(even) { background: var(--chip); }
.ui-as-rev__breakdown li span { color: var(--muted); }
.ui-as-rev__breakdown li b { font-weight: 500; color: var(--ink); font-variant-numeric: tabular-nums; }
.ui-as-rev__spark { width: 40px; height: 14px; overflow: visible; }
.ui-as-rev__spark polyline { fill: none; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.ui-as-rev__spark[data-tone="up"] polyline { stroke: #16a34a; }
.ui-as-rev__spark[data-tone="down"] polyline { stroke: #dc2626; }
.ui-as-rev__spark[data-tone="flat"] polyline { stroke: var(--faint); }

.ui-as-rev__products { display: flex; flex-direction: column; gap: 14px; }
.ui-as-rev__product { display: flex; flex-direction: column; gap: 7px; }
.ui-as-rev__product span { display: flex; justify-content: space-between; font-size: 13.5px; color: var(--muted); }
.ui-as-rev__product b { font-weight: 500; color: var(--ink); font-variant-numeric: tabular-nums; }
.ui-as-rev__product i { display: block; height: 6px; border-radius: 3px; background: #2f6bff; }

/* Room for the sidebar icon while the sidebar is collapsed */
.ui-as-rev__head { transition: padding-left 420ms var(--ease); }
.ui-as-app[data-collapsed] .ui-as-rev__head { padding-left: 52px; }

/* Narrow panels: stat cards 4 → 2, the rows stack */
@container ui-as-main (max-width: 900px) {
  .ui-as-rev__row { grid-template-columns: minmax(0, 1fr); }
  .ui-as-rev__row--3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ui-as-rev__row--3 > .ui-as-rev__products { grid-column: 1 / -1; }
}
@container ui-as-main (max-width: 820px) {
  .ui-as-rev__stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container ui-as-main (max-width: 560px) {
  .ui-as-rev__row--3 { grid-template-columns: minmax(0, 1fr); }
  .ui-as-rev__stats { gap: 8px; }
  .ui-as-rev__stat { gap: 10px; padding: 12px; }
  .ui-as-rev__stat strong { flex-wrap: wrap; gap: 0 6px; font-size: 19px; }
  .ui-as-rev__minibars { display: none; }
}
@container ui-as (max-width: 900px) {
  .ui-as-rev__head { padding-left: 52px; }
}
@container ui-as (max-width: 600px) {
  /* Title next to the sidebar icon, the actions on a row below */
  .ui-as-rev__head { flex-wrap: wrap; row-gap: 10px; height: auto; padding: 14px 8px 12px 52px; }
  .ui-as-rev__actions { flex-wrap: wrap; gap: 6px 4px; width: calc(100% + 44px); margin-left: -44px; }
  .ui-as-rev__actions > :last-child { margin-left: auto; }
  .ui-as-rev__actions button { white-space: nowrap; }
  .ui-as-rev__content { gap: 8px; padding: 0 8px 8px; }
}
`;
