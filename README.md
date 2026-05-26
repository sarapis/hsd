# Mutual Aid NYC — Service Directory

A zero-cost community resource directory built on [HSDS 3.0](https://docs.openreferral.org/), powered by Cloudflare Workers and Vercel. Features natural-language search via LLM chatbot, an MCP server for AI agent access, and Google Geocoding for accurate map pins.

Built for [Mutual Aid NYC](https://mutualaid.nyc) and [Open Referral](https://openreferral.org/).

> **Branch note:** This is the `cloudflare-vercel-v2` branch — a serverless rewrite of the legacy FastAPI/Hetzner stack. Both versions run in parallel. See the `main` branch for the original.

## Architecture

```
┌─────────────┐   cron every 15min   ┌──────────────────────────────────┐
│   Airtable  │ ───────────────────▶ │  Cloudflare Worker (hsds-api)   │
│   (source)  │   incremental sync   │  ├─ Hono router (HSDS 3.0 API) │
└─────────────┘                      │  ├─ D1 database (SQLite edge)  │
                                     │  ├─ Workers AI (Llama 3.3 70B) │
                                     │  ├─ MCP server (Durable Object)│
                                     │  └─ Search token index         │
                                     └───────────┬────────────────────┘
                                                  │
                                     ┌────────────┴───────────────────┐
                                     │  Vercel (hsdirectory-v2)       │
                                     │  ├─ Next.js 15 App Router     │
                                     │  ├─ MapLibre GL interactive   │
                                     │  └─ LLM chat widget           │
                                     └────────────────────────────────┘
```

**Total hosting cost: $0/month** (Cloudflare Free + Vercel Hobby)

## Live URLs

| Component | URL |
|-----------|-----|
| Frontend | https://hsdirectory-v2.vercel.app |
| API | https://hsds-api.devin-d41.workers.dev |
| API Health | https://hsds-api.devin-d41.workers.dev/health |
| MCP Server | https://hsds-api.devin-d41.workers.dev/mcp |

## Key Features

### vs. Legacy (main branch)

| Feature | Legacy (Hetzner) | v2 (Cloudflare + Vercel) |
|---------|-----------------|------------------------|
| Backend | FastAPI (Python) | Cloudflare Worker (TypeScript) |
| Database | SQLite file + FTS5 | Cloudflare D1 (edge SQLite) |
| Search | FTS5 full-text | Token index with stemming + ranking |
| Geocoding | Nominatim (spotty) | Google Geocoding API (98% coverage) |
| AI Chat | None | Workers AI Llama 3.3 70B with RAG |
| MCP | None | 5-tool MCP server for AI agents |
| Hosting | ~$5-10/mo VPS | $0/month |
| Deploy | SSH + Docker | `wrangler deploy` + `vercel --prod` |

### Search

Token-based search with stemming replaces raw `LIKE` queries:
- **Stemming**: "food pantries" matches "food pantry" (37 results vs 1)
- **Relevance ranking**: Name (3x) > Description (2x) > Org name (1x)
- **Indexed**: Prefix matching on the `search_tokens` table
- **Fallback**: Degrades to LIKE when token index is empty

### Sync

Incremental sync compares Airtable's `modifiedTime` against D1's `updated_at`:
- Steady-state: **0-10 writes/cycle** (down from ~2,134)
- Token index + icon cache rebuilt after each sync
- Category icons cached as base64 in D1 (avoids expiring Airtable signed URLs)

---

## Quick Start

### Prerequisites

- **Node.js 18+**
- **Wrangler CLI**: `npm install -g wrangler`
- Airtable Personal Access Token (read-only scope)

### 1. Clone and setup

```bash
git clone https://github.com/MutualAidNYC/hsdirectory.git
cd hsdirectory
git checkout cloudflare-vercel-v2
```

### 2. Worker (API backend)

```bash
cd worker
npm install

# Authenticate with Cloudflare
wrangler login

# Create D1 database
wrangler d1 create hsds-directory

# Update wrangler.toml with your database_id, then:
wrangler d1 execute hsds-directory --local --file=src/db/schema.sql

# Set secrets
wrangler secret put AIRTABLE_API_KEY
wrangler secret put SYNC_SECRET
wrangler secret put GOOGLE_GEOCODING_API_KEY  # optional, for geocoding

# Local dev
npm run dev

# Deploy
wrangler deploy
```

### 3. Frontend

```bash
cd hsdirectory-v2
npm install

# Configure API URL
echo "NEXT_PUBLIC_API_URL=https://hsds-api.YOUR-SUBDOMAIN.workers.dev" > .env.local

# Local dev
npm run dev

# Deploy to Vercel
npx vercel --prod
```

### 4. Initial data seed

```bash
# Trigger Airtable → D1 sync
curl -X POST https://your-worker.workers.dev/sync/trigger \
  -H "Authorization: Bearer YOUR_SYNC_SECRET"

# Cache category icons (run until remaining=0)
curl -X POST https://your-worker.workers.dev/sync/icons \
  -H "Authorization: Bearer YOUR_SYNC_SECRET"

# Geocode addresses (batches of 10, run until remaining=0)
curl -X POST https://your-worker.workers.dev/sync/geocode \
  -H "Authorization: Bearer YOUR_SYNC_SECRET"
```

---

## API Endpoints

### Public

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | API metadata (HSDS 3.0) |
| `GET` | `/health` | Health check with service count |
| `GET` | `/services` | Paginated services (`?search=`, `?page=`, `?per_page=`) |
| `GET` | `/services/:id` | Full service detail with nested relations |
| `GET` | `/organizations` | Paginated organizations |
| `GET` | `/organizations/:id` | Organization detail |
| `GET` | `/map/services` | Services with coordinates + categories for map |
| `GET` | `/icons/:name` | Cached category icons (stable URLs) |
| `POST` | `/api/chat` | LLM chat with RAG (SSE streaming) |
| `ALL` | `/mcp` | MCP server (Streamable HTTP) |

### Admin (requires `Authorization: Bearer SYNC_SECRET`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/sync/trigger` | Full Airtable sync |
| `POST` | `/sync/table/:name` | Sync single table |
| `POST` | `/sync/icons` | Cache category icons (batch of 5) |
| `POST` | `/sync/geocode` | Geocode addresses (batch of 10) |
| `GET` | `/sync/status` | Sync metadata + stats |

---

## Project Structure

```
hsdirectory/
├── worker/                        # Cloudflare Worker (API backend)
│   ├── src/
│   │   ├── index.ts               # Hono app + routes + cron handler
│   │   ├── env.ts                 # Environment bindings type
│   │   ├── mapper.ts              # Airtable → HSDS field mapping
│   │   ├── db/
│   │   │   ├── schema.sql         # D1 schema (17 tables + indexes)
│   │   │   └── queries.ts         # Typed D1 queries + token search
│   │   ├── sync/
│   │   │   ├── sync.ts            # Incremental sync + token/icon cache
│   │   │   └── airtable-client.ts # Paginated Airtable fetcher
│   │   ├── routes/
│   │   │   ├── services.ts        # /services endpoints
│   │   │   ├── organizations.ts   # /organizations endpoints
│   │   │   ├── map.ts             # /map/services (geocoded)
│   │   │   └── ...
│   │   ├── chat/
│   │   │   └── handler.ts         # Workers AI chat with RAG
│   │   └── mcp/
│   │       └── server.ts          # MCP Durable Object (5 tools)
│   ├── wrangler.toml              # Worker config + D1 binding
│   └── package.json
│
├── hsdirectory-v2/                # Next.js frontend (Vercel)
│   ├── src/
│   │   ├── app/                   # App Router pages
│   │   │   ├── page.tsx           # Home (hero + categories)
│   │   │   ├── services/          # Service list + map + detail
│   │   │   └── organizations/     # Org list + detail
│   │   ├── components/
│   │   │   ├── ui/                # Header, SearchBar, Footer, Chat
│   │   │   └── map/               # MapLibre GL map component
│   │   └── lib/
│   │       └── api.ts             # Typed API client
│   └── package.json
│
├── worker/scripts/                # Local utilities
│   └── geocode_google.py          # Bulk geocoding script
│
└── README.md                      # ← you are here
```

---

## Configuration

### Worker Secrets (via `wrangler secret put`)

| Secret | Description |
|--------|-------------|
| `AIRTABLE_API_KEY` | Airtable PAT with `data.records:read` scope |
| `SYNC_SECRET` | Bearer token for admin endpoints |
| `GOOGLE_GEOCODING_API_KEY` | Google Maps Geocoding API key (server-side) |

### Worker Environment (in `wrangler.toml`)

| Variable | Default | Description |
|----------|---------|-------------|
| `AIRTABLE_BASE_ID` | — | Airtable base ID (`appXXX`) |
| `PUBLISHED_STATUS_VALUE` | `Published` | Filter services by status |
| `SYNC_INTERVAL_MINUTES` | `15` | Cron sync interval |

### Frontend Environment (`.env.local`)

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_API_URL` | Worker API URL |

---

## MCP Server

The Worker exposes an MCP server at `/mcp` with 5 tools for AI agents:

| Tool | Description |
|------|-------------|
| `search_services` | Keyword search with pagination |
| `get_service` | Full service detail by ID |
| `list_organizations` | Browse/search organizations |
| `get_organization` | Organization detail by ID |
| `get_directory_stats` | Summary stats + category list |

Connect from any MCP client:

```json
{
  "mcpServers": {
    "mutualaid-nyc": {
      "url": "https://hsds-api.devin-d41.workers.dev/mcp"
    }
  }
}
```

---

## Free Tier Limits

| Resource | Limit | Current Usage |
|----------|-------|---------------|
| Worker requests | 100K/day | Low |
| D1 reads | 5M/day | ~3K/day |
| D1 writes | 100K/day | ~5K/day (incremental) |
| D1 storage | 5 GB | ~2 MB |
| Workers AI | 10K neurons/day | ~100/chat |
| Vercel bandwidth | 100 GB/mo | Low |

---

## Standards Compliance

- [HSDS 3.0 Specification](https://docs.openreferral.org/en/latest/hsds/api_reference.html)
- [Open Referral](https://openreferral.org/)

## License

[MIT](LICENSE)
