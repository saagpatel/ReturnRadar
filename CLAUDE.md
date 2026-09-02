# Return Radar

Local-first macOS desktop app tracking purchase return windows, mail-in rebate deadlines, and warranty expiry dates. Deadlines auto-calculate on purchase entry; native macOS notifications fire 7 and 1 day before expiry. All data lives in local SQLite — no cloud, no accounts.

## Stack

- Tauri 2.x · React 19.x (hooks only) · TypeScript 5.x (strict mode)
- SQLite via tauri-plugin-sql 2.x
- Tailwind CSS 4.x · shadcn/ui (Radix UI primitives)
- date-fns 4.x — deadline math and formatting
- Vite 6.x · vitest 4.x — unit testing

## Build / Test / Run

```bash
npm run tauri dev   # development mode
npm test            # run unit tests
npm run tauri build # production build
```

Receipt and policy capture runs locally with macOS Vision and PDFKit. It requires no API key and must retain the explicit review-and-confirmation gate before writing a deadline.

## Architecture Decisions

| Decision | Choice | Why |
|---|---|---|
| Notifications when app closed | launchd login agent plist | No daemon required; plist opens app at login to check deadlines |
| Rebate tracking | status field only, no doc upload | Core value without scope creep |
| Warranty tracking | Full CRUD (active/expiring/expired/claimed) + notifications | Shipped in v1.0 |
| Receipt/policy capture | On-device Vision/PDFKit extraction + deterministic confidence gate | No upload; explicit confirmation required |
| Retailer defaults | Pre-seeded SQLite table, top 20 retailers | Eliminates common entry friction |
| Styling | Tailwind + shadcn/ui | Fast component assembly |

## Conventions

- TypeScript strict mode — type with `unknown` + narrowing, not `any`
- Kebab-case filenames, PascalCase React components
- Conventional commits: `feat:`, `fix:`, `chore:`, `refactor:`
- Prices stored as integer cents (never floats); dates as ISO strings `YYYY-MM-DD` (no Date objects in DB layer)
- Write vitest unit tests for all deadline math and DB transforms before committing

## Gotchas

- Check `notification_log` before firing any notification — duplicate suppression is required
- Schema changes must go through the migration runner — version-gate from day one
- Keep `README.md`, `IMPLEMENTATION-ROADMAP.md`, and behavior-changing source updates aligned
- Keep changes scoped to the current roadmap rather than scaffolding speculative features
