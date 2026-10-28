# affectUI – blocks

Every file is a single, self-contained React component (React is the only dependency).
Copy a file into your project, e.g. `components/ui/`, and import it from there.
Some files import another affectUI component from `@/components/ui/<name>` – copy that one alongside.

- **Agent Gallery** (`agent-gallery.tsx`) – Slim gradient panels with one open product screen in the middle – pick a panel and it glides open
- **AI Workspace** (`ai-workspace.tsx`) – Complete assistant app – sidebar, welcome, streaming chat and projects, built on the Chat Composer
- **App Directory** (`app-directory.tsx`) – Browse, search and connect integrations – categories, filters and app cards with a connect flow
- **Client Context** (`client-context.tsx`) – A client workspace with live numbers and a shared context timeline – switch clients, search, filter and add notes or files
- **Invoice & Credit Note** (`invoice-credit.tsx`) – An invoice and its credit note stacked like paper – switch between them, pick lines to credit, adjust amounts and issue
- **KPI Board** (`kpi-board.tsx`) – The top of a dashboard – three trend cards, an overview chart that compares this period with the last, and a focus card; hover shows any day's value and every number rolls when the range changes
- **Logo Marquee** (`logo-marquee.tsx`) – The endless “Trusted by” strip – a seamless loop that eases to a stop on hover, scrubs with inertia and lifts the hovered logo to colour
- **Metrics Dashboard** (`metrics-dashboard.tsx`) – Sales overview – KPI cards pick the metric, one chart switches between dotted line and bars, with top products and channels
- **Pricing Plans** (`pricing-plans.tsx`) – Pricing section with a monthly / yearly switch, three plan cards and collapsible details
- **Task Board** (`task-board.tsx`) – Kanban board with drag and drop, quick add, a detail panel, search, label filters and a compact view
- **Testimonial Wall** (`testimonial-wall.tsx`) – The landing-page wall of quotes – columns that scroll endlessly in opposite directions, ease to a stop on hover and scrub with inertia

Docs and live previews: https://www.affectui.com
