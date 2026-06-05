# BloxHop — Master Prompt & Full Architecture Reference

> Full record of what was built, every design decision, every bug & fix, complete stack, and deployment notes. Use this to recreate, extend, or hand off the project to another AI agent.

---

## 1. What Is BloxHop?

BloxHop is a **Blox Fruits server-hop assistant**. Blox Fruits is a Roblox game split into three "seas" (First Sea, Second Sea, Third Sea), each running as a separate Roblox place with hundreds of public server instances at all times. Each sea has timed events (Fruit Spawn, Castle Raid, Fist of Darkness, etc.) that fire based on how long a server has been running.

**The goal:** Scan all public Roblox servers across all three seas every 10 minutes, track each server's age, compute when its next events fire, and serve a live dark-mode dashboard so players can jump directly into the best server for any event.

---

## 2. Full Technology Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 24, TypeScript 5.9 |
| Monorepo | pnpm workspaces |
| API server | Express 5 |
| Database | PostgreSQL (Replit-provisioned, auto-connected via `DATABASE_URL`) |
| ORM | Drizzle ORM (`drizzle-orm/node-postgres`) |
| Validation | Zod v4, `drizzle-zod` |
| Build | esbuild (CJS→ESM bundle via `build.mjs`) |
| Logging | pino + pino-http |
| Deployment | Render (Singapore region, free tier) |
| Source control | GitHub (`nosiopgod320-ux/Blox-fruit-server-hop-`) |

---

## 3. Monorepo Structure

```
artifacts-monorepo/
├── artifacts/
│   └── api-server/               # Main deployable Express app
│       ├── src/
│       │   ├── index.ts          # Entry: ensureSchema BEFORE listen, startPoller, self-ping
│       │   ├── app.ts            # Express setup: CORS, pino-http, routes
│       │   ├── lib/
│       │   │   ├── events.ts     # Event definitions + placeIDs per sea
│       │   │   ├── calculator.ts # Per-server event timer math
│       │   │   ├── roblox-api.ts # Roblox server list fetcher (429 backoff, cookie auth)
│       │   │   ├── scanner.ts    # DB upsert/delete/scanCount logic per sea
│       │   │   ├── poller.ts     # 10-min scan scheduler + warmup flag
│       │   │   └── logger.ts     # Pino singleton logger
│       │   └── routes/
│       │       ├── index.ts      # Mounts servers router at /api
│       │       ├── servers.ts    # /api/stats, /api/servers, /api/best-servers
│       │       └── dashboard.ts  # GET / — fully SSR HTML dashboard
│       ├── build.mjs             # esbuild bundle script
│       └── package.json
├── lib/
│   ├── db/
│   │   └── src/
│   │       ├── index.ts          # drizzle client, ensureSchema(), wipeServers()
│   │       └── schema/
│       │           └── servers.ts    # Drizzle table definition
│   └── api-spec/
│       └── openapi.yaml          # OpenAPI spec (source of truth)
├── scripts/
│   └── src/
│       └── pingbot.ts            # 5-min keepalive ping (unused on Replit)
├── render.yaml                   # Render deployment config
└── pnpm-workspace.yaml
```

---

## 4. Database Schema

Table: `servers`

| Column | Type | Description |
|---|---|---|
| `job_id` | TEXT PK | Roblox server instance UUID |
| `place_id` | BIGINT | Roblox place ID (identifies which sea) |
| `sea` | INTEGER | 1, 2, or 3 |
| `first_seen` | BIGINT | Unix ms timestamp — when WE first spotted this server |
| `last_seen` | BIGINT | Unix ms timestamp — most recent scan that confirmed it |
| `player_count` | INTEGER | Player count at last scan |
| `max_players` | INTEGER | Max capacity at last scan |
| `scan_count` | INTEGER DEFAULT 1 | How many scans have confirmed this server |

**Key design decision — `scan_count`:** A server is only shown in the dashboard once `scan_count >= 2`. This prevents showing servers on the very first scan where we have no confirmation they're real/stable.

**`ensureSchema()`:** Called at server startup BEFORE `app.listen()` — see Bug 11. Uses raw SQL `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` so it's safe to call on every restart, works on fresh databases AND existing ones.

---

## 5. Roblox Place IDs

| Sea | Place ID | Events |
|---|---|---|
| First Sea | 2753915549 | Fruit Spawn, Sword Dealer |
| Second Sea | 4442272183 | Fruit Spawn, Factory Raid, Fist of Darkness, Sword Dealer |
| Third Sea | 7449423635 | Fruit Spawn, Castle Raid, God's Chalice, Sword Dealer |

---

## 6. Event Timer Logic (`calculator.ts`)

Each event fires on a fixed interval measured from the server's `first_seen` timestamp:

| Event | Interval | Alert threshold | Notes |
|---|---|---|---|
| Fruit Spawn | 60 min (45 min weekends) | < 4 min | Weekends detected via `isWeekend()` UTC |
| Castle Raid | 75 min | < 4 min | Sea 3 only |
| Factory Raid | 90 min | < 4 min | Sea 2 only |
| Fist of Darkness | 4 hours | < 4 min | Sea 2 only |
| God's Chalice | 4 hours | < 4 min | Sea 3 only |
| Sword Dealer | spawns at 255m, despawns at 270m | spawns in < 4 min | All seas |

`computeEventTimers(server)` returns an array of `EventTimer` objects:
- `timeUntilSeconds`: null if event has already passed in this cycle
- `timeUntilFormatted`: "4m 30s" style string
- `isAlert`: true if within alert window
- `isActive`: true if the event is currently happening

---

## 7. Scanning Pipeline

### `roblox-api.ts` — Fetch from Roblox
- Calls `https://games.roblox.com/v1/games/{placeId}/servers/Public?limit=100`
- Paginates up to **5 pages = 500 servers per sea** per scan
- Uses `.ROBLOSECURITY` cookie from `ROBLOX_COOKIE` env var for auth
- 3-second delay between pages (with cookie); 10-second (without)
- On 429: exponential backoff 90s → 180s → 270s, then gives up on that page

### `scanner.ts` — DB upsert per sea
- New servers: INSERT with `scan_count = 1`
- Existing servers: UPDATE `player_count`, `max_players`, `last_seen`, increment `scan_count` by 1
- Dead servers (not in live list): DELETE

### `poller.ts` — Schedule
- Scan runs every **10 minutes**
- First scan runs immediately on startup
- `isWarmingUp()` returns true for first 10 minutes OR if there are no confirmed servers yet
- Servers only appear in dashboard after `scan_count >= 2`

---

## 8. API Routes (`/api/*`)

### `GET /api/stats`
```json
{
  "total": 925,
  "seaCounts": { "first": 390, "second": 248, "third": 287 },
  "uptimeSeconds": 68,
  "warmingUp": true
}
```

### `GET /api/servers?limit=200&sea=1`
Returns servers with `scan_count >= 2`, sorted by soonest next event. Each server includes: `jobId`, `placeId`, `sea`, `playerCount`, `maxPlayers`, `ageSeconds`, `nextEventSeconds`, and full `events` array.

### `GET /api/best-servers?event=fruit&within=300`
Returns servers where a specific event fires within `within` seconds (default 300 = 5 min).

---

## 9. Dashboard (`GET /`)

### Architecture: Fully Server-Side Rendered — no JSON.parse in browser

**Evolution of the dashboard (all bugs that led here):**

**v1 (broken):** Client-side `fetch('/api/servers')` hung silently in Replit proxy iframe.

**v2 (broken):** Embedded `<script type="application/json">` blob + client-side `JSON.parse` + `window.*` functions. If `JSON.parse` threw for ANY reason (bad character, bigint serialized wrong, etc.), the entire IIFE crashed silently. Result: empty grid, all buttons broken (onclick handlers never assigned to `window.*`).

**v3 (current — working):** All cards rendered as HTML server-side. Data stored in `data-*` attributes on each card. No `JSON.parse` needed. JS only manipulates existing DOM nodes.

### Current Dashboard Design

1. **Server-side:** `buildHtml()` renders every card as an HTML string via `renderCard()`:
   - `data-sea` — sea number (for filter)
   - `data-next` — next event in seconds (for sort)
   - `data-age` — server age in seconds (for sort)
   - `data-players` — player count (for sort)
   - `data-events="fruit:300,castle:180,fist:-1,..."` — compact event data for Best Servers tab (-1 = active)
   - `data-place` / `data-job` on Join button — no inline onclick JS

2. **Client-side JS** (safe, no JSON.parse):
   - `setFilter(sea)` — toggles `.hidden` class on cards, re-appends in sorted order
   - `applySort()` — same as filter, different sort key
   - `applyBest()` — reads `data-events` string, marks `.match` on matching cards
   - `switchTab(tab)` — shows/hides panes
   - **Event delegation for Join:** `document.addEventListener('click', ...)` reads `data-place` and `data-job` — no inline `onclick` attributes anywhere

3. **`escAttr(s)` helper:** Always call `String(value)` before `escAttr()`. Drizzle returns `placeId` as a JavaScript `bigint`, not a string — calling `.replace()` on a bigint throws `s.replace is not a function`.

4. **Auto-reload:** `setTimeout(() => location.reload(), 30000)` — page refreshes every 30s.

5. **Card count badge:** Server-side renders `(${cardCount})` into the tab — correct even before any JS runs.

---

## 10. Startup Sequence (`index.ts`)

**CRITICAL ORDER — do not change:**
```
await ensureSchema()    ← MUST be before app.listen()
app.listen(port, () => {
  startSelfPing()
  startPoller()
})
```

If `ensureSchema()` is called inside the `listen` callback (after the port is open), Render's health check or the first browser request arrives before the `scan_count` column is added → `column "scan_count" does not exist` crash on every request.

---

## 11. Render Deployment

File: `render.yaml` in repo root.

```yaml
region: singapore            # critical — Roblox blocks Oregon datacenter IPs
buildCommand: NODE_ENV=development npx --yes pnpm@9 install --no-frozen-lockfile && npx --yes pnpm@9 --filter @workspace/api-server run build
startCommand: node --enable-source-maps artifacts/api-server/dist/index.mjs
```

**Required env vars on Render:**
- `DATABASE_URL` — auto-wired from bloxhop-db PostgreSQL service
- `ROBLOX_COOKIE` — `.ROBLOSECURITY` cookie value (paste in Render dashboard → Environment)
- `PORT` — set to `10000` or leave auto

**Self-ping:** Server pings its own `/api/healthz` every 14 minutes using `RENDER_EXTERNAL_URL` (auto-set by Render). Prevents free-tier spin-down. Silently skipped in all other environments (no `RENDER_EXTERNAL_URL` set).

**Render region is locked on creation.** Cannot change region for an existing service — must delete and recreate.

---

## 12. Replit-Specific Config

**`artifact.toml`** (`artifacts/api-server/.replit-artifact/artifact.toml`):
```toml
kind = "api"
previewPath = "/"

[[services]]
localPort = 8080
paths = ["/", "/api"]
```

Both `/` (dashboard) and `/api` must be listed in `paths`. Without `/`, the Replit proxy returns "Cannot GET /" for the dashboard.

**Secrets required in Replit:**
- `ROBLOX_COOKIE` — for authenticated Roblox API access
- `GITHUB_PAT` — for pushing files via REST API (agent-only)
- `SESSION_SECRET` — stored but not used

---

## 13. All Bugs Encountered & Fixes

### Bug 1: "Cannot GET /api/" in Replit preview
**Cause:** `artifact.toml` had `paths = ["/api"]` and `previewPath = "/api"`, so the dashboard at `/` was never routed.
**Fix:** Changed to `paths = ["/", "/api"]` and `previewPath = "/"`.

### Bug 2: Dashboard permanently stuck at "Loading servers…"
**Cause:** Client-side `fetch('/api/stats')` and `fetch('/api/servers')` hung silently in the Replit proxy iframe and on Render — no error, no response, promise never resolved.
**Fix:** Complete rewrite to server-side rendering. Data baked into HTML before send. No client-side fetch needed.

### Bug 3: Dashboard JS (filters, sort, tabs) entirely broken — silent failure
**Cause (first version):** JSON embedded in `<script>` tag with `let allServers = ${JSON.stringify(data)}`. Could fail if data contained `</script>` or other special characters.
**Cause (second version):** `JSON.parse` in IIFE threw silently. Because `window.setFilter`, `window.render`, etc. were assigned AFTER the `JSON.parse` call inside the IIFE, a parse exception meant none of the onclick handlers ever got bound to `window.*`. Every button click showed "setFilter is not a function".
**Fix:** Eliminated JSON.parse entirely. Cards are rendered server-side as HTML with `data-*` attributes. All JS only does DOM manipulation on pre-rendered cards — no data deserialization needed.

### Bug 4: Server age shown on first scan
**Cause:** All servers inserted on scan 1 immediately showed an age, giving false confidence.
**Fix:** Added `scan_count` column. Servers only shown after `scan_count >= 2`.

### Bug 5: Stuck at ~523 servers max
**Cause:** `MAX_PAGES_PER_SEA = 3` meant only 300 servers/sea.
**Fix:** Increased to `MAX_PAGES_PER_SEA = 5` (500/sea → 1,500 total).

### Bug 6: Render build failed — "EROFS: read-only file system"
**Cause:** Render's build environment doesn't allow writing to `/usr/bin` (corepack tries to install pnpm there).
**Fix:** `NODE_ENV=development npx --yes pnpm@9 install --no-frozen-lockfile` — bypasses corepack, uses npx directly.

### Bug 7: "relation servers does not exist" crash on Render
**Cause:** DB schema wasn't created before the poller ran.
**Fix:** `ensureSchema()` called at server startup before `startPoller()`.

### Bug 8: Render blocked by Roblox (Oregon datacenter IP ban)
**Cause:** Roblox hard-blocks Oregon (`us-west`) Render/AWS datacenter IPs.
**Fix:** Changed Render region to `singapore` in `render.yaml`.

### Bug 9: 370KB JSON payload
**Cause:** `/api/servers` returning all servers with full event timers.
**Fix:** Limited to top 300 sorted by soonest next event.

### Bug 10: `scan_count` column missing on existing Render DB
**Cause:** `CREATE TABLE IF NOT EXISTS` skips if table exists, so the new column was never added to an already-running production database.
**Fix:** Added `ALTER TABLE servers ADD COLUMN IF NOT EXISTS scan_count INTEGER NOT NULL DEFAULT 1` in `ensureSchema()` after the CREATE TABLE statement.

### Bug 11: Race condition — `scan_count` column not ready when first request arrives
**Cause:** `ensureSchema()` was called inside the `app.listen()` callback, AFTER the server was already accepting connections. Render's health check (or user's first browser request) arrived before `ensureSchema()` completed → `column "scan_count" does not exist`.
**Fix:** Moved `ensureSchema()` to a top-level `await` BEFORE `app.listen()`. Server only starts listening once the schema is guaranteed to be ready.

### Bug 12: `s.replace is not a function` in `escAttr()`
**Cause:** Drizzle ORM returns `placeId` as a JavaScript `bigint` (not a string). Calling `escAttr(s.placeId)` where `escAttr` calls `s.replace(...)` throws because `bigint` has no `.replace` method.
**Fix:** Always `String(value)` before `escAttr()`: `escAttr(String(s.placeId))` and `escAttr(String(s.jobId))`.

---

## 14. Key Architecture Decisions & Rationale

| Decision | Rationale |
|---|---|
| Sequential sea scans (not parallel) | Parallel scans flood Roblox rate limits; sequential is slower but reliable |
| Cookie auth (`.ROBLOSECURITY`) | Unauthenticated requests 429 on Sea 2/3 almost immediately |
| Fully SSR dashboard — no JSON.parse | Any JSON.parse failure in an IIFE silently kills ALL onclick handlers; SSR is immune |
| `data-*` attributes for filter/sort | Cards rendered once server-side; JS only reads attributes and reorders DOM nodes |
| Event delegation for Join button | No inline `onclick` = no risk of attribute escaping bugs or quote injection |
| `escAttr()` on all user-data values | Prevents HTML injection; must call `String()` first for bigint fields |
| `ensureSchema()` before `app.listen()` | Prevents race condition where health checks/requests arrive before column migration runs |
| `scan_count >= 2` filter | Prevents phantom/unstable servers; ensures all shown servers have confirmed uptime |
| Singapore Render region | Oregon is on Roblox's datacenter IP blocklist; Singapore is not |
| 5 pages/sea (500 servers/sea) | Balances coverage vs rate limit risk; ~15s per sea with cookie auth |
| 30s page reload (not live fetch) | Avoids all client-side fetch reliability issues in proxy environments |

---

## 15. Environment Variables

| Variable | Required | Where | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Yes | All envs | PostgreSQL connection string |
| `ROBLOX_COOKIE` | Yes | All envs | `.ROBLOSECURITY` cookie for Roblox API auth |
| `PORT` | Yes (auto) | All envs | Port to listen on (set by Replit/Render automatically) |
| `RENDER_EXTERNAL_URL` | No | Render only | Auto-set by Render; triggers self-ping keepalive |
| `GITHUB_PAT` | Agent only | Replit | For pushing files to GitHub via REST API |
| `SESSION_SECRET` | Stored | Replit | Not used in current app logic |

---

## 16. GitHub Push Pattern (Agent Use)

```bash
FILE_CONTENT=$(base64 -w 0 path/to/file)
SHA=$(curl -s -H "Authorization: token $GITHUB_PAT" \
  "https://api.github.com/repos/nosiopgod320-ux/Blox-fruit-server-hop-/contents/path/to/file" \
  | grep '"sha"' | head -1 | sed 's/.*"sha": *"\([^"]*\)".*/\1/')
curl -X PUT -H "Authorization: token $GITHUB_PAT" -H "Content-Type: application/json" \
  "https://api.github.com/repos/nosiopgod320-ux/Blox-fruit-server-hop-/contents/path/to/file" \
  -d "{\"message\":\"commit message\",\"content\":\"$FILE_CONTENT\",\"sha\":\"$SHA\"}"
```

**CRITICAL:** Always push files **sequentially** (never parallel). Parallel pushes fetch the same SHA before any write completes → "is at X but expected Y" conflict errors.

---

## 17. DB Wipe Procedure

```bash
node --input-type=module <<'EOF'
import pg from '/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query('DELETE FROM servers');
console.log('done');
await pool.end();
EOF
```

On Render: use the Render PostgreSQL dashboard shell → `DELETE FROM servers;`

---

## 18. Run Commands

```bash
# Start API server locally
pnpm --filter @workspace/api-server run dev

# Push DB schema (dev only — use ensureSchema() for production)
pnpm --filter @workspace/db run push

# Full typecheck
pnpm run typecheck

# Regenerate API hooks from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen
```

---

## 19. First-Time Setup Checklist

1. Clone the GitHub repo
2. Run `pnpm install`
3. Set `DATABASE_URL` (auto-set on Replit; link to bloxhop-db on Render)
4. Set `ROBLOX_COOKIE` secret (`.ROBLOSECURITY` cookie from your Roblox account's browser cookies)
5. Start the server — `ensureSchema()` creates the table automatically on first boot
6. Wait ~10 minutes for two full scans to complete
7. Warming-up banner disappears; dashboard shows confirmed servers with event timers

---

## 20. Known Limitations

- **Server age ≠ true Roblox server age**: `first_seen` is when BloxHop first spotted the server. Actual Roblox server may be older.
- **Player count is stale**: Updated every 10 minutes. Not real-time.
- **Join button behavior**: `roblox://` deep link works on desktop Roblox client. Mobile behavior varies. Cross-sea transfers depend on Roblox client, not BloxHop.
- **Render free tier**: Self-ping every 14 min prevents spin-down, but Render free tier has monthly hour limits.
- **Max 1,500 servers**: 500/sea × 3 seas. If a sea has >500 live servers (unlikely), the remainder are not tracked.
- **Cookie expiry**: `.ROBLOSECURITY` cookies expire. If Sea 2/3 scans start returning empty results, get a fresh cookie from browser DevTools on roblox.com.
