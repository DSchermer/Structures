# StructureV2 prototype — Demo code

Working prototype for the StructureV2 pitch (see `../prototype-plan.md` and
the source docs in `../`).

Stack: Vite + React + TypeScript + Tailwind (frontend), Cloudflare Pages
Functions (API), Cloudflare D1 / SQLite (database). Free tier only.

Deployed continuously from `main` to Cloudflare Pages.

## Layout

```
Demo/
  package.json           # single root package (no workspaces)
  vite.config.ts         # Vite config (proxies /api → :8788 in dev)
  index.html             # Vite entry
  src/                   # React app source
    main.tsx  App.tsx  index.css
  functions/             # Pages Functions — Cloudflare auto-discovers
    api/health.ts
  sql/                   # versioned migrations (paste into D1 console)
    0001_schema.sql
    0002_lookups.sql
  wrangler.jsonc         # tells Cloudflare this is a Pages deployment
  README.md              # this file
  dist/                  # vite build output (gitignored)
```

## Build & deploy

Pushed to `main` → Cloudflare builds + deploys automatically. To test locally:

```
npm install
npm run build         # writes dist/
```

## Local dev

Two terminal tabs:

```
# tab 1 — Pages Functions + local D1
npx wrangler pages dev dist --d1=DB --port=8788

# tab 2 — Vite (proxies /api to :8788)
npm run dev
```

Open <http://localhost:5173>.

For local D1 seeding:

```
npx wrangler d1 execute structures --local --file=sql/0001_schema.sql
npx wrangler d1 execute structures --local --file=sql/0002_lookups.sql
```
