# ShiftSync architecture

One Node service on Railway, one Postgres. Editable source:
[`architecture.excalidraw`](architecture.excalidraw) — open it at
[excalidraw.com](https://excalidraw.com) via *Open*. The diagram below is the
same thing, so it renders here.

```mermaid
flowchart TB
    browser["<b>Browser</b><br/>React client components"]

    subgraph nextjs["Next.js — one long-running Node service"]
        actions["<b>Server Actions</b><br/>app/*/actions.ts"]
        pages["<b>Server Components</b><br/>app/*/page.tsx"]
        routes["<b>Route Handlers</b><br/>/api/events · /api/notifications"]
    end

    service["<b>lib/scheduling/*</b><br/>all business logic, as plain functions"]
    pg[("<b>Postgres</b> via Drizzle<br/>exclusion constraint · version column · audit_log")]
    bus{{"<b>lib/realtime/bus.ts</b><br/>in-process EventEmitter"}}

    browser -- call --> actions
    pages -- "HTML / RSC" --> browser
    routes -. "SSE hint" .-> browser

    actions --> service
    pages --> service
    routes --> service
    service -- "read + write" --> pg
    service -. "publish after commit" .-> bus
    bus -. subscribe .-> routes

    classDef client fill:#a5d8ff,stroke:#1971c2
    classDef app    fill:#d0bfff,stroke:#6741d9
    classDef logic  fill:#b2f2bb,stroke:#2f9e44
    classDef data   fill:#ffd8a8,stroke:#e8590c
    classDef live   fill:#ffdeeb,stroke:#c2255c
    class browser client
    class actions,pages,routes app
    class service logic
    class pg data
    class bus live
```

## The three flows

**Write** — Browser → Server Action → service → Postgres. Actions are thin
wrappers; they authorize nothing and decide nothing. The **constraint**, not the
application, is what refuses an illegal schedule, so it holds no matter what
writes to the table.

**Read** — Server Component → service → Postgres, rendered on the server. Pages
never query directly.

**Realtime** — a hint, never data. The service publishes *after* the transaction
commits, the stream nudges the browser, and the browser refetches the read path
above. A missed event therefore costs one redundant query rather than a stale
roster — and clients refetch on reconnect for the same reason.

The bus is in-process, which assumes a single instance. Swapping it for Postgres
`LISTEN`/`NOTIFY` changes only that one file — the reasoning is under
"Decisions the brief did not raise" in [decisions.md](decisions.md).
