# Code review — sarapis/hsd (ATtoOR)

_2026-09-22 · HEAD `c118405` · reviewer: Claude Opus 5.5 · first recorded review of this repo_

## Verdict

Safe as it runs today in the narrow sense: no injection path, every mutating route is gated, and `SYNC_SECRET` is set in production. But it is not healthy. The Airtable sync still exhausts D1's free write quota — confirmed failing on 2026-09-02 and unchanged since — and nothing in the system would tell you: `/health` stays green, cron errors go only to `console.log`, and the homepage renders an API outage as an empty directory. **Fix F1 and rotate the sync secret (F2) before anything else.**

## Scope as executed

Plan approved before deep reading. Read closely, in order: `sync/sync.ts` · `db/queries.ts` · the `/sync/*` admin surface in `index.ts` · `chat/handler.ts` · `routes/*.ts` · `mcp/server.ts` · frontend `app/page.tsx`, list pages and `lib/api.ts` · `worker/tests/`. Skipped deliberately: see _Not reviewed_.

Ran: worker unit suite **73/73 pass** · smoke suite vs production **10/10 pass** · worker `tsc` clean · frontend `tsc` clean · `wrangler deploy --dry-run` builds · frontend `eslint` **fails (18 errors, 2 warnings)** — mostly `no-explicit-any`; nothing enforces it because **there is no CI**.

## Findings

| # | Sev | Claim | Confidence |
|---|---|---|---|
| F1 | **high** | Any org edit reindexes all its services → daily D1 write-quota exhaustion → sync blocked | confirmed |
| F2 | **high** | A real `SYNC_SECRET` is in public git history | confirmed present · liveness **needs checking** |
| F3 | medium | `/health` reports `ok` while the sync is dead | confirmed |
| F4 | medium | Homepage renders an API failure as "0 resources from 0 groups" | confirmed (code path) |
| F5 | medium | The code path behind F1 is untested, and no CI runs any test | confirmed |
| F6 | low | Change detection compares volatile signed attachment URLs | confirmed |
| F7 | low | `GET /organizations?full=true` hydrates every org before paginating | confirmed (measured) |
| F8 | low | Chat accepts a client-supplied `role: "system"` | confirmed |

---

### F1 — high · Any organization edit triggers a reindex of all its services, exhausting D1's write quota

`worker/src/sync/sync.ts:482`, with `sync.ts:260` and `sync.ts:198`

**Failure.** `runFullSync` expands the search reindex to every service under any org in `orgResult.changedIds` (`:482`). An org lands in `changedIds` when *any* field of its raw Airtable JSON differs (`:198`). But the only org input to search tokens is its **name** (`:260`). So editing an org's phone number, notes or a linked record reindexes every service under it. On 2026-09-02 a single run changed 261 orgs, which reindexed all 680 services; three near-full rebuilds that day produced **132,550 writes against the 100,000/day limit**, 94% of them `INSERT INTO search_tokens`. The quota died at 04:16 UTC and syncs were rejected for the next ~20 hours — Airtable edits simply stopped reaching the site.

**Reachable.** The `*/15` cron runs this unconditionally, and ordinary Airtable editing triggers it.

**Evidence.** The code path is traced. The numbers come from the 2026-09-02 scheduled verification run (`attoor-d1-write-check`, recorded on Hub task `df0e2734` as comment `1ab4458f`), which read `wrangler d1 insights` directly. I could not re-pull analytics today — wrangler is authenticated to the wrong Cloudflare account — so **whether the quota still dies every day needs checking**. Nothing has shipped since, so there is no reason to expect it has stopped.

**Note.** This defect is in commit `c118405`, which I wrote. It cut writes ~7× but left over-broad invalidation in place, and the check that caught it has sat unaddressed for three weeks.

**Fix.** Expand only for orgs whose `name` changed: compare old vs new `name` in `syncTable` and report a separate `renamedIds`. With that, an org edit costs one upsert rather than a reindex of its services.

### F2 — high · A real sync secret was committed to a public repository

`worker/scripts/geocode_google.py` — added in `b0485b1` (2026-05-07), removed in `a4fad67` (2026-05-11)

**Failure.** The script defaulted `SYNC_SECRET` to a literal 20-character value (entropy 3.55 bits/char, not a placeholder). `a4fad67` removed it from the tree but not from history, and both `sarapis/hsd` and `MutualAidNYC/hsdirectory` are **public**. If that value is still the production secret, anyone can:
- `POST /sync/geocache` — overwrite the coordinates behind every map pin;
- `POST /sync/geocode` — spend the paid Google Geocoding quota;
- `POST /sync/reindex` — force a full rebuild (~27k writes). Four calls exhaust the daily quota and stall the sync, which is F1's outage on demand. This route did not exist when the secret leaked; it was added in `c118405`, which raises the stakes of an unrotated secret.

**Reachable.** Every route above accepts `Authorization: Bearer <SYNC_SECRET>`.

**Evidence.** Presence in public history: confirmed. Whether it is still live: **needs checking**. I prepared a zero-write probe (send the value to `/sync/geocache` with body `{}` — `400` means live, `401` means rotated), and the permission classifier declined it as credential exploration. `a4fad67`'s message says "remove", not "rotate", which leans toward live.

**Fix.** Rotate it (`npx wrangler secret put SYNC_SECRET` as `devin@wegov.nyc`) — that makes liveness moot. Purging history is optional once rotated.

### F3 — medium · `/health` reports `ok` while the sync is dead

`worker/src/index.ts:120` · `index.ts:520`

**Failure.** `/health` returns `{"status":"ok"}` whenever D1 is *readable*. It never looks at `sync_metadata.last_sync`. The scheduled handler (`:520`) catches everything into `console.log`. So during F1's outage — writes rejected for most of a day — every signal stays green. The 09-02 failure was noticed only because a one-off check happened to be scheduled for that morning.

**Reachable.** Every time the sync fails for any reason: quota, Airtable outage, bad deploy.

**Fix.** Have `/health` return `503` (or `"status":"degraded"`) when the newest `last_sync` is older than ~45 minutes (three cron periods), so the existing uptime checker catches a stalled sync.

### F4 — medium · The homepage renders an API outage as an empty directory

`hsdirectory-v2/src/app/page.tsx:71`

**Failure.** All three homepage fetches sit in one `try`, and the `catch` only logs. On any API error the page renders normally with the defaults: *"Search our directory of 0 resources from 0 groups"* and an empty category grid. The `/services` and `/organizations` pages show an explicit error box on the same failure; the homepage is the odd one out. Because the render completes without throwing, ISR treats it as a good page and serves it until the next revalidation.

**Reachable.** Any 5xx or timeout from `services-api.wegov.nyc` at render or revalidation time. The API has returned 500s before (see the pagination bug fixed in `3921e8e`).

**Evidence.** The code path is confirmed. ISR caching the zero-state is inferred from Next's semantics (the route is static with `revalidate: 60`), not observed.

**Fix.** Let the error propagate so Next keeps serving the last good render, or render an explicit "directory temporarily unavailable" state instead of zeros.

### F5 — medium · The path that caused F1 is untested, and nothing runs the tests

`worker/tests/unit/reindex.test.ts` · no `.github/workflows/`

**Failure.** The reindex tests are real — they assert which statements are issued — but every one hands `reindexSearchTokens` a pre-built scope (`:71, :85, :93, :105, :114`). The bug lives in how that scope is *computed* (`runFullSync` → `servicesForOrganizations`), which has no test. The suite was green when F1 shipped and is green now. There are also zero tests for `requireSyncAuth`, the chat input caps, or `resolveRecordId`. And with no CI, even the tests that exist run only when someone remembers.

**Fix.** Test `runFullSync`'s scope computation with a fake DB, including "org changed but name didn't → no reindex". Add a minimal workflow running `npm test` and `tsc`.

### F6 — low · Change detection compares volatile signed attachment URLs

`worker/src/sync/sync.ts:198` · `sync.ts:372, 396`

**Failure.** `taxonomy_terms` raw fields include `x-icon_dark` attachment arrays. The code's own comments say Airtable signs those URLs with a 2–4 hour expiry. Because `:198` compares the full raw JSON, every icon-bearing term looks "changed" whenever its URL rotates and is rewritten. On 09-02 that was ~555 of 132,550 writes.

**Why low.** Taxonomy changes don't trigger a search reindex, so the cost is bounded. But it is the same bug class as the unexplained **org** churn in the 09-02 run (842 upserts against 740 rows) — if orgs carry a volatile field too, F1 turns that into reindex storms. **The org cause needs checking.**

**Fix.** Strip volatile fields (attachment `url`s, `thumbnails`) before comparing and storing, or compare only the fields the mapper actually reads.

### F7 — low · `GET /organizations?full=true` hydrates every org before paginating

`worker/src/routes/organizations.ts:78` vs `:99`

**Failure.** With `full=true`, `buildFullOrganization` runs for every org inside the loop (`:78`), and pagination slices afterwards (`:99`). Each hydration issues up to ~60 sequential queries (capped per-relation loops). Measured against production: `?full=true&per_page=1` took **1.49s versus 0.18s** without, to return a single item.

**Why low.** Unauthenticated and a cheap read-cost amplifier, but the frontend never sends `full=true`.

**Fix.** Paginate first, then hydrate only the page.

### F8 — low · Chat accepts a client-supplied `system` role

`worker/src/chat/handler.ts:165`

**Failure.** Client messages are mapped with `role: m.role as "user" | "assistant"` — a cast, not a check. A caller can send `{"role":"system", ...}` and have it sit alongside the grounding prompt, overriding the "only recommend directory services" rules and using the endpoint as general inference on your bill.

**Why low.** The route is already unauthenticated inference; this only makes steering easier. The edge rate limit is still absent (tracked on `8b05097f`).

**Fix.** Allowlist `user` and `assistant`; drop or reject anything else.

## Checked and sound

- **SQL injection** — every value bound; table names safelisted; search tokens reduced to `[a-z0-9]` before becoming `LIKE` prefixes, so no wildcard injection.
- **Admin auth, code and config** — all eight mutating `/sync/*` routes call `requireSyncAuth`, which fails closed. **The secret is set in production**: verified without credentials (an unauthenticated POST returns `401`, not the `503` an unset secret produces).
- **Open routes** — `GET /sync/status` and `GET /sync/geocache` expose only table names, counts and timestamps, all public-derived.
- **MCP** — five tools, all read-only, `per_page` capped at 20, no Workers AI.
- **Upsert change guard** — `ON CONFLICT … WHERE col IS NOT excluded.col` verified on 09-01: identical re-upserts don't write.
- **UUID lookups** — indexed; backfill complete (0 NULLs on 09-01), so `resolveRecordId`'s transitional scan now runs over zero rows.
- **Pagination parsing** — non-numeric, negative and non-finite input all fall back safely (unit-tested).
- **Chat size caps** — 100 messages / 4,000 chars / 12,000 total, each rejected with `413` before any model or D1 work (verified live on 08-18).
- **`href` safety** — `normaliseUrl` allowlists http/https/mailto/tel.
- **Legacy Python** — 31 tracked `.py` files scanned for Airtable, Google and bearer tokens: none.

## Not reviewed

- **D1 analytics and deployed secrets.** wrangler is authenticated as `devin@sarapis.org` (`a8e2fa07…`); the worker lives under `devin@wegov.nyc` (`d41c4bdf…`). So I could not re-measure F1's current write volume, prove the source of the org churn (F6), or list secrets. **This is why F1's ongoing status and F2's liveness are "needs checking" rather than confirmed.**
- **F2's liveness probe** — declined by the permission classifier; not worked around.
- **Frontend UI components** (`Header`, `Footer`, `Skeletons`, `TagLink`, `MapView`, `ServiceChat`) — render-only, no input handling beyond what the API already validates.
- **The legacy Python root beyond a secrets scan** — retired, unreferenced by anything live.
- **`worker/scripts/geocode_google.py`** beyond its history.
- **Airtable data itself** — whether some org field is volatile (F6) needs the raw `data` column, which requires the D1 access above.

## Themes

**1. Failure degrades into plausible output (F3, F4, and the cron).** A stalled sync yields a green `/health`, an API outage yields a homepage claiming an empty directory, and cron errors vanish into logs. Each would take minutes to fix; together they mean the system can be broken for a day while every surface looks fine. That is exactly what happened on 09-02.

**2. Invalidation keyed on the whole record, not on what the derived data depends on (F1, F6).** The sync asks "did this raw record change?" when the question that matters is "did any field I actually use change?" Organization blobs invalidate search tokens that only read the name; signed attachment URLs invalidate rows whose meaningful content never moved. Fixing the comparison fixes both.

**3. No automated gate (F5).** Tests, typecheck and lint all exist; nothing runs them. The one test that exercises reindexing takes the buggy input as a given.

## Refutation pass

Twelve draft findings went in; eight survived, two of them downgraded.
- **Killed:** "`full=true` list routes will 500 on D1's per-invocation query cap" (both returned 200 live) · "open `/sync/status` leaks sensitive data" (counts and timestamps only) · "unauthenticated MCP is a cost vector" (read-only, bounded, no AI) · "non-constant-time secret comparison" (impractical over the network).
- **Downgraded:** volatile attachment URLs from medium to low (taxonomy changes don't trigger reindex) · chat role injection to low (the route is already open inference).

## Hygiene (not findings)

The repo root still tracks the retired Python/FastAPI backend (31 `.py` files) and a 224KB `map_services.json` snapshot; an untracked `deploy.sh` targets a dead `/opt/mutualaid` box. None of it is referenced by anything live, and it misleads anyone orienting in the repo. `hsdirectory-v2/src/lib/api.ts` `searchServices()` ignores its `query` argument and has no callers — delete it. Frontend lint has 18 errors, mostly `no-explicit-any`. The smoke test "categories have Worker icon URLs" loops over a filtered list and passes vacuously when it is empty.

---

## Resolution — 2026-09-25

All eight findings fixed. Worker deployed as version `ee23a19e-c9b4-4f66-b64b-fc83afe8a56c`; frontend deployed to `services.wegov.nyc`; CI passing on `sarapis/hsd`.

| # | Resolution | Verified |
|---|---|---|
| F1 | `5829718` — reindex expands only for new, renamed or deleted orgs (`computeReindexScope`) | Unit tests, mutation-checked (reintroducing the bug fails 3). **Effect on daily writes not yet measured** — see below |
| F2 | `SYNC_SECRET` rotated to a new 44-char value, stored in the macOS Keychain (service `hsds-api-sync-secret`) | Live: new value authenticates on every edge; random and missing values → 401. The leaked value can no longer work |
| F3 | `9c091f3` — `/health` returns 503 `degraded` when the newest sync is >45 min old | Live: correctly reported the ongoing stall at 635 min on deploy |
| F4 | `cfa7c31` — homepage no longer swallows API errors; new `app/error.tsx` | Browser: unavailable state with API down, real counts against production |
| F5 | `e7adf9f` CI (worker tests + both typechecks); `5829718` and `45cc2bd` tests for the previously untested paths | First CI run passed; 73 → 99 unit tests |
| F6 | `5829718` — change detection fingerprints attachments to id/filename/size/type and ignores key order | Unit tests |
| F7 | `08f00a2` — org list paginates before hydrating | Live: `?full=true&per_page=1` 1.49s → 0.13s |
| F8 | `45cc2bd` — chat rejects any role other than `user`/`assistant` | Live: 8/8 system-role requests → 400 |

**Baseline for F1.** In the 24h before deploy, D1 recorded 85,269 attributable writes — all `INSERT INTO search_tokens` — and the sync had stalled at 04:00 UTC, i.e. the quota died again that day. The deploy landed mid-stall, so 2026-09-26 is the first clean day with the fix. **F1 is not verified until that day's `rows_written` is in hand.**

**One regression introduced and fixed during remediation.** `9c091f3` changed `/health`'s semantics without updating the smoke test that asserted `status: "ok"`; it failed on the first post-deploy run. `2ba92d1` splits it into "service answers correctly" and "data is fresh", which fail independently. I had run only the unit suite before committing F3.

**History not purged.** The leaked value remains in public git history, but it no longer authenticates, so rewriting a shared public history was judged not worth the disruption.
