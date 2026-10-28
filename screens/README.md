# affectUI – screens

Every file is a single, self-contained React component (React is the only dependency).
Copy a file into your project, e.g. `components/ui/`, and import it from there.
Some files import another affectUI component from `@/components/ui/<name>` – copy that one alongside.

- **Agent Chat** (`agent-chat.tsx`) – Chat with an orchestrating agent, the agents at work, and a brief to fill in beside it
- **Agent Run** (`agent-run.tsx`) – One autonomous agent run: the plan ticking through its steps, the tool calls, an approval it waits on and the draft it wrote
- **Analytics** (`analytics.tsx`) – Revenue dashboard: key figures, revenue by channel, breakdown, top products and weekly trends
- **App Shell Inset** (`app-shell.tsx`) – Collapsible sidebar with workspace, menu, projects and account – the frame every screen sits in
- **App Shell Flat** (`app-shell-flat.tsx`) – The App Shell laid flat – gray sidebar and an edge-to-edge page, split by a single hairline
- **App Shell Workspace Inset** (`app-shell-workspace.tsx`) – App Shell Inset with a resizable work area on the right – tools, browser and suggested sources next to the page, like Claude or Codex
- **App Shell Workspace Flat** (`app-shell-workspace-flat.tsx`) – The flat App Shell with a resizable work area on the right – sidebar, page and tools, each split by a hairline
- **Assistant Home** (`assistant-home.tsx`) – AI assistant start page: greeting, prompt box with tools, connected apps and suggestions
- **CRM** (`crm.tsx`) – Company list with pipelines, open views as tabs and an editable data table
- **Evals** (`evals.tsx`) – Prompt evaluation dashboard: pass rate by version, reviewable prompt changes and test cases you can re-run
- **Folders** (`files.tsx`) – Folder overview with tabs, search, sort, grid/list toggle and file templates
- **Folder** (`folder.tsx`) – Inside one folder: breadcrumbs, file cards with previews, and an empty state
- **Integrations** (`integrations.tsx`) – App directory with a sticky header, categories, search and connect states
- **Onboarding** (`onboarding.tsx`) – First-run flow of an AI workspace: workspace setup, tool connections, team invites and a first agent, with a getting-started checklist
- **Settings & Billing** (`settings-billing.tsx`) – Settings page with tabs: workspace, members, API keys and billing with plan, usage, payment method, plan comparison and invoices

Docs and live previews: https://www.affectui.com
