# ShiftSync architecture

One long-running Node service on Railway, one Postgres.

```mermaid
flowchart TB
    browser["<b>Browser</b><br/>React client components"]

    subgraph nextjs["Next.js"]
        actions["<b>Server Actions</b><br/>app/*/actions.ts"]
        pages["<b>Server Components</b><br/>app/*/page.tsx"]
        routes["<b>Route Handlers</b><br/>/api/events · /api/notifications · /api/health"]
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
    service -. publish .-> bus
    bus -. subscribe .-> routes

    classDef client fill:#a5d8ff,stroke:#1971c2,color:#111827
    classDef app    fill:#d0bfff,stroke:#6741d9,color:#111827
    classDef logic  fill:#b2f2bb,stroke:#2f9e44,color:#111827
    classDef data   fill:#ffd8a8,stroke:#e8590c,color:#111827
    classDef live   fill:#ffdeeb,stroke:#c2255c,color:#111827
    class browser client
    class actions,pages,routes app
    class service logic
    class pg data
    class bus live
```

## The three flows

**Write.** Browser, server action, service, Postgres. Actions are thin wrappers:
they catch errors and revalidate, nothing else. Authorization and every rule
live in the service. The exclusion constraint, not the application, is what
refuses an overlapping or short-rest assignment, so it holds whatever writes to
the table.

**Read.** Server component, service, Postgres, rendered on the server. No page
queries the database directly.

**Realtime.** The stream carries a hint, never data. A client refetches on every
event and on every reconnect, so an event missed while disconnected costs one
redundant query instead of a stale roster.

Schedule changes are published **after** the transaction commits, because an
emitter has no rollback. Notification hints are published **inside** it, which
is safe for the same reason the payload is a hint: if the transaction rolls
back, the client refetches and finds nothing new.

## Known shape

The bus is in-process, so fan-out assumes a single instance. Moving to Postgres
`LISTEN`/`NOTIFY` changes only `lib/realtime/bus.ts`. See
[decisions.md](decisions.md).
