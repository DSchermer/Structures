# StructureV2 prototype — Demo code

Working prototype for the StructureV2 pitch (see `../prototype-plan.md` and
`../../pitch/PLAN.md` §D1).

Stack: Vite + React + TypeScript + Tailwind (frontend), Cloudflare Pages
Functions (API), Cloudflare D1 / SQLite (database). Free tier only.

## Layout

```
Prototype/
  prototype-plan.md         # phased implementation plan (lives one level up)
  problemstatement.md       # spec (read-only)
  flowcharts/               # engineering diagrams (read-only)
  user-flows/               # product-facing diagrams (read-only)
  Demo/                     # ← all demo code lives here
    DEPLOY.md               # dashboard-click runbook (Dylan ships from here)
    package.json            # root scripts (build, dev)
    app/                    # Vite React app source
    functions/api/          # Pages Functions
    sql/                    # versioned migrations to paste into the D1 console
    scripts/bundle.mjs      # combines app/dist + functions into dist/
    dist/                   # final upload artifact (generated; .gitignored)
```

## Build the deploy artifact

```
cd Prototype/Demo
npm install           # once, after fresh clone (npm workspaces install both root + app/)
npm run build         # writes Prototype/Demo/dist/
```

Then follow `DEPLOY.md` for the dashboard steps.

## Local dev

Two processes, two terminal tabs, both at `Prototype/Demo/`:

```
# tab 1 — Pages Functions + local D1
npx wrangler pages dev dist --d1=DB --port=8788

# tab 2 — Vite (proxies /api to :8788)
npm run dev
```

Open <http://localhost:5173>.

For local D1 seeding, run the `.sql` files via:

```
npx wrangler d1 execute structures --local --file=sql/0001_schema.sql
npx wrangler d1 execute structures --local --file=sql/0002_lookups.sql
```

(Local D1 runs in `.wrangler/`; it's separate from the production D1
attached to the Pages project.)

## Source-of-truth references

This prototype implements behavior described in the source artifacts that
live one level up (`Prototype/problemstatement.md`, `Prototype/flowcharts/`,
`Prototype/user-flows/`). **Do not modify them.** All demo code lives here
under `Demo/`.
