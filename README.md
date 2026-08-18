# StructureV2 — prototype

Working prototype for the StructureV2 pitch. The domain it implements is
specified in `../problemstatement.md`; `../flowcharts/` is the engineering
reference and `../user-flows/` the product-facing one.
`../IMPLEMENTATION-STATUS.md` records what is built versus specified.

Stack: Vite + React + TypeScript + Tailwind, served by a Cloudflare **Worker**
with static assets, backed by D1 (SQLite). Free tier throughout.

## Layout

```
src/
  App.tsx              # micro-router: / /structures/:id /drafts/:id /assignments/:id /inbox /prices
  worker/index.ts      # the entire API — every /api/* route
  lib/
    money.ts           # exact money (integer e4); see §5.5
    backsolve.ts       # commissioned-margin back-solve + G4pr cap assertion
  pages/               # one file per route
  components/          # Dialog, shared chips/badges, NewStructureDialog
sql/                   # numbered migrations, applied in order
wrangler.jsonc         # Worker + assets + D1 binding
```

## Deploy

Push to `main`. Cloudflare Workers Builds builds and deploys automatically —
there is no GitHub Actions workflow.

**Migrations do not run themselves.** Apply any new `sql/` file to production
*before* pushing code that reads it, or the deploy breaks on a missing column:

```
npx wrangler d1 execute structures --remote --file=sql/0009_money_exact.sql
```

## Local development

```
npm install
npm run build

# seed a local database (first time only)
for f in sql/000*.sql; do npx wrangler d1 execute structures --local --file="$f"; done

npx wrangler dev --local     # serves the API and the built assets together
```

`npm run dev` runs Vite alone with no API, which is rarely what you want.

## Resetting the local or remote database

`_reset_wipe.sql` clears all data (keeping schema), then re-run the seeds and
`_reset_backfill.sql`, which re-applies everything the numbered migrations added
on top of the seed — CR snapshots, structure descriptions, the component
catalog, and the exact-money columns:

```
sql/_reset_wipe.sql → 0002 → 0003 → 0004 → sql/_reset_backfill.sql
```
