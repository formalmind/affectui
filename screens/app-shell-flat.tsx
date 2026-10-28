"use client";

import { MoreHorizontalIcon, Share08Icon } from "@hugeicons/core-free-icons";
import { AppShell, BarTitle, Icon, type AppShellProps } from "@/components/ui/app-shell";

/*
 * App Shell Flat – the same frame as App Shell Inset, laid flat.
 * No rounded panel: the sidebar keeps its gray fill and the main area runs edge to edge next to it, split by a single hairline.
 * A header runs across the top, like Claude's: sidebar toggle and search, the page's title and actions, one line under it.
 * Everything else – menu, projects, what's new, onboarding progress, user menu, collapsing, resizing, the optional
 * work area on the right, the drawers on narrow screens and dark mode – comes from App Shell Inset, so screens built
 * on either look the same inside.
 */

/** The header Flat starts with: the open page's name as its title, share and more on the right – pass your own, or false for none */
const defaultHeader = (active?: string): AppShellProps["header"] => ({
  title: <BarTitle>{active ?? "Home"}</BarTitle>,
  actions: (
    <>
      <button className="ui-as-icon-btn" type="button" aria-label="Share">
        <Icon icon={Share08Icon} size={16} />
      </button>
      <button className="ui-as-icon-btn" type="button" aria-label="More">
        <Icon icon={MoreHorizontalIcon} size={16} />
      </button>
    </>
  ),
});

export function AppShellFlat({ className, header, ...props }: AppShellProps) {
  return (
    <>
      <style href="ui-app-shell-flat" precedence="default">
        {css}
      </style>
      <AppShell {...props} header={header ?? defaultHeader(props.active)} className={["ui-asf", className].filter(Boolean).join(" ")} />
    </>
  );
}

// Two classes on every rule, so they win over App Shell Inset's own styles whichever loads first
const css = /* css */ `
.ui-asf.ui-as-app { --frame-gap: 0px; }
.ui-asf.ui-as-app > * { --frame-gap: 0px; }

/* Main area: no panel – it fills the rest of the app, a hairline on its left is the only edge */
.ui-asf.ui-as-app > .ui-as-main {
  margin: 0;
  border: 0;
  border-left: 1px solid var(--line);
  border-radius: 0;
  background: var(--panel);
}
/* Sidebar collapsed: nothing is left to divide */
.ui-asf.ui-as-app[data-collapsed] > .ui-as-main { margin-left: 0; border-left-color: transparent; }

/* Work area on the right: flat too – a hairline on the main area's right is its edge */
.ui-asf.ui-as-app[data-panel="open"] > .ui-as-main { border-right: 1px solid var(--line); }
.ui-asf.ui-as-app > .ui-as-panel { padding: 10px 10px 10px 10px; }
.ui-asf.ui-as-app > .ui-as-panel-open { top: 10px; right: 12px; }

/* Header across the app: the page's and the work area's parts are white like the page, the sidebar's stays gray; one hairline runs under all of it
   and the page's side lines run on up through the bar */
.ui-asf.ui-as-app[data-header] > .ui-as-bar { border-bottom: 1px solid var(--line); }
.ui-asf.ui-as-app[data-header] > .ui-as-bar--main { background: var(--panel); border-left: 1px solid var(--line); transition: padding 420ms var(--ease), border-color 260ms ease; }
.ui-asf.ui-as-app[data-header][data-collapsed] > .ui-as-bar--main { border-left-color: transparent; }
.ui-asf.ui-as-app[data-header][data-panel="open"] > .ui-as-bar--main { border-right: 1px solid var(--line); }
/* The work area's part of the bar is white like the page's – only the sidebar's part stays gray */
.ui-asf.ui-as-app[data-header] > .ui-as-bar--panel { background: var(--panel); }
.ui-asf.ui-as-app[data-header] > .ui-as-side { padding-top: 12px; }
.ui-asf.ui-as-app[data-header] > .ui-as-panel { padding-top: 12px; }

/* The sidebar's rows line up with a page's 46px title on top */
.ui-asf.ui-as-app > .ui-as-side { padding: 10px 10px 10px 10px; }

/* The icon that brings the sidebar back sits where the collapse icon was */
.ui-asf.ui-as-app > .ui-as-side-open { top: 10px; left: 12px; }

@container ui-as (max-width: 900px) {
  /* Narrow: the main area is the whole app; the drawer slides in flat with a hairline edge */
  .ui-asf.ui-as-app > .ui-as-main { margin: 0; border-left: 0; }
  .ui-asf.ui-as-app > .ui-as-side {
    border-radius: 0;
    box-shadow: 1px 0 0 var(--line), 0 24px 48px -12px rgba(0, 0, 0, 0.22);
  }
  .ui-asf.ui-as-app > .ui-as-side-open { left: 12px; }
  .ui-asf.ui-as-app[data-panel] > .ui-as-main { margin: 0; border-right: 0; }
  .ui-asf.ui-as-app > .ui-as-panel {
    border-radius: 0;
    box-shadow: -1px 0 0 var(--line), 0 24px 48px -12px rgba(0, 0, 0, 0.22);
  }
  .ui-asf.ui-as-app > .ui-as-panel-open { right: 12px; }
  .ui-asf.ui-as-app[data-header] > .ui-as-bar--main { border-left: 0; border-right: 0; }
}
@container ui-as (max-width: 600px) {
  .ui-asf.ui-as-app > .ui-as-main { border-radius: 0; }
}
`;
