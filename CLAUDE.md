# ATtoOR

> Airtable-to-Open Referral — Hono + Cloudflare Worker API (D1) with Next.js frontend on Vercel

## Live Project Data

```
get_workspace_detail("ATtoOR")   → services, URLs, repos, recent commits
list_tasks(workspace="ATtoOR")   → open tasks
search_knowledge(topic="ATtoOR") → hsds_integration KI
```

## Tech Stack

- **Backend**: Hono (TypeScript) on Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite-compatible edge database)
- **Frontend**: Next.js (App Router, Server Components) on Vercel
- **Data source**: Airtable syncing via Cron triggers on Cloudflare Workers

## Repositories & URLs

- **API**: `https://github.com/sarapis/hsd` (Live: `https://services-api.wegov.nyc`)
- **Frontend**: `https://github.com/sarapis/hsd` (Live: `https://services.wegov.nyc`)

## Environment Variables (Critical)

- `NEXT_PUBLIC_API_URL`: Must be set at **build time** for the browser bundles to point to `https://services-api.wegov.nyc`.

## Development & Deployment Process

1. **Develop Locally**
   - Start the local API server using Wrangler (`npm run dev` in `worker/`) and Next.js dev server in `hsdirectory-v2/`.
2. **Build & Deploy for Production (Frontend)**
   - Run local build with production API URL inside `hsdirectory-v2/`:
     ```bash
     NEXT_PUBLIC_API_URL=https://services-api.wegov.nyc npx vercel build --prod --yes --scope devins-projects-1baf43f0
     ```
   - Deploy the compiled prebuilt output to Vercel:
     ```bash
     npx vercel deploy --prebuilt --prod --scope devins-projects-1baf43f0
     ```
3. **Deploy to Production (Backend API)**
   - Deploy the Cloudflare Worker:
     ```bash
     cd worker && npx wrangler deploy
     ```
4. **Push to GitHub**
   - Commit and push code to `sarapis/hsd` (`main` branch).

## Gotchas

- **Vercel Framework Setting**: Ensure the Vercel project's framework preset is set to `nextjs` (not `null`) so that serverless functions are generated instead of static files.
- **HSDS-UK 3.0 Compliance**: All emails and URLs must be sanitised (`sanitiseEmail`, `normaliseUrl`) and IDs must be formatted as UUIDs (`toUuid`) in `mapper.ts`.
- **D1 Sync Limits**: Full Airtable syncs can exceed Cloudflare's free CPU limits. Use per-table `/sync/table/:name` endpoints or let the cron job handle it.
- **UUID Lookups**: All API `/:id` endpoints must support UUID reverse-lookup scans since Airtable IDs are stored as primary keys in the database.
