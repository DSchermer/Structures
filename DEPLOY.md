# DEPLOY.md — StructureV2 prototype runbook

This file is appended to at the end of every phase. Each phase section is a
self-contained checklist of dashboard clicks. **Claude does not run deploy
commands** — Dylan ships everything via the Cloudflare web UI.

The single piece of CLI Dylan runs locally is `npm run build` (from the
`Prototype/Demo/` directory), which produces the upload artifact at
`Prototype/Demo/dist/`.

---

## One-time setup (do this once, before Phase 0)

1. **Cloudflare account.** Have a free-tier Cloudflare account ready.
   `https://dash.cloudflare.com`.
2. **Node.js 20+** installed locally (`node --version`).
3. **Install dependencies once.** In a terminal at `Prototype/Demo/`, run:

   ```
   npm run install:all
   ```

   This installs the root scripts plus the Vite app under `app/`.

---

## Phase 0 — Skeleton on Cloudflare

**Goal.** Live URL at `https://structurev2-prototype.pages.dev` shows the
"coming online" page; the health card reports `D1 rows: 6`.

### Step 0.1 — Build the artifact locally

In a terminal at `Prototype/Demo/`:

```
npm run build
```

This runs `vite build` and then `scripts/bundle.mjs`. When it finishes, the
folder `Prototype/Demo/dist/` exists and contains:

```
dist/
  index.html
  assets/…           (compiled JS / CSS)
  functions/
    api/
      health.ts
```

This `dist/` folder is what you'll drag into Cloudflare in Step 0.4.

### Step 0.2 — Create the D1 database

1. In the Cloudflare dashboard, go to **Workers & Pages → D1**.
2. Click **Create database**.
3. Name: `structures`. Region: closest to you (e.g.
   `Western North America`). Click **Create**.
4. You're now on the database page. Note the **Database ID** shown at the top
   right — you don't need to copy it; the binding (Step 0.5) uses the name.

### Step 0.3 — Paste the schema and lookups into D1

Still on the database page:

1. Click the **Console** tab.
2. Open `Prototype/Demo/sql/0001_schema.sql` in your editor, copy the **entire**
   file contents, paste into the Console text area, click **Execute**.
   Expect "Success" with no rows returned (these are DDL statements).
3. Repeat for `Prototype/Demo/sql/0002_lookups.sql`. Expect "Success".
4. (Optional sanity check.) In the Console, run:

   ```
   SELECT COUNT(*) FROM TAG WHERE kind = 'system';
   ```

   You should see `5`. Then:

   ```
   SELECT COUNT(*) FROM USER WHERE username = '__system__';
   ```

   You should see `1`.

### Step 0.4 — Create the Pages project and upload the bundle

1. Dashboard → **Workers & Pages → Create application → Pages → Upload assets**.
2. Project name: `structures`. Click **Create project**.
3. The next screen asks for a folder. **Drag the entire `Prototype/Demo/dist/`
   folder** (the folder itself, not its contents) into the upload area.
   - On macOS Finder: select `dist`, drag it into the browser drop zone.
4. Click **Deploy site**. Wait ~30 seconds for the upload to finish.
5. You'll be shown a `*.pages.dev` URL. **Don't open it yet** — the D1
   binding isn't wired up (Step 0.5).

### Step 0.5 — Wire the D1 binding to the Pages project

1. On the Pages project page, go to **Settings → Functions**.
2. Scroll to **D1 database bindings → Add binding**.
3. Variable name: `DB` (uppercase, exactly).
   Database: select `structures`.
   Click **Save**.
4. Still in **Settings → Functions**, find **Compatibility flags / dates**.
   Set the compatibility date to today (or any date in 2024+) and click
   **Save**.

### Step 0.6 — Redeploy so the binding takes effect

D1 bindings only attach to deployments created **after** the binding was
saved, so we redeploy:

1. Pages project → **Deployments** tab.
2. On the most recent deployment, click the **⋯** menu → **Retry deployment**.
   (Alternatively: re-upload `dist/` via Create deployment → Upload assets.)
3. Wait for the new deployment to go green.

### Step 0.7 — Verify

Open `https://structurev2-prototype.pages.dev` in a browser.

You should see:

- The "StructureV2 prototype — coming online" page.
- A D1 health-check card showing **D1 rows: 6** with a green "healthy" pill.

Also visit `https://structurev2-prototype.pages.dev/api/health` directly —
you should see:

```
{
  "ok": true,
  "d1_rows": 6,
  "checked_at": "2026-…"
}
```

If `d1_rows: 0` appears, the binding is wired but the SQL didn't run — go
back to Step 0.3. If a network error or `"ok": false` shows, the binding
isn't attached to this deployment — repeat Step 0.6.

---

## Phase 0 troubleshooting

| Symptom | Fix |
| --- | --- |
| Health card shows "Network error" | The Pages project doesn't have the `DB` binding, OR the deployment was created *before* the binding was added. Redo Step 0.6 (Retry deployment). |
| Health card shows `"ok": false, "error": "no such table: TAG"` | The schema SQL didn't execute. Re-run `0001_schema.sql` in the D1 Console. |
| Health card shows `d1_rows: 5` (not 6) | Lookup SQL ran partially. Re-run `0002_lookups.sql`. (The `INSERT`s use fixed UUIDs so re-running will fail with a uniqueness error — that's fine, it just means the rows are already there.) |
| Health card shows `d1_rows: 6` but the page is blank | The static assets uploaded but the React bundle errored. Check the browser console; usually means the `dist/` folder was uploaded with a nested level (e.g., `dist/dist/index.html`). Re-do Step 0.4 dragging the contents of `dist/` rather than `dist/` itself. |
| `npm run build` errors locally | Run `npm run install:all` from `Prototype/Demo/` first. Make sure Node ≥ 20. |
