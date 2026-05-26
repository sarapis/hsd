# HSDirectory

A modern, responsive search interface for Human Services Data Specification (HSDS) APIs. Built with Next.js 14, TypeScript, and TailwindCSS.

![HSDirectory](https://via.placeholder.com/800x400/2563eb/ffffff?text=HSDirectory)

## Features

- 🔍 **Full-text search** - Search across all services
- 📋 **Service browsing** - Paginated listing with detail views
- 🏢 **Organizations** - Browse service providers
- 🗺️ **Interactive map** - MapLibre GL powered location view
- 📱 **Mobile responsive** - Works on all devices
- 🌓 **Dark mode** - Automatic dark mode support
- ⚡ **Fast** - Server-side rendering with Next.js App Router

## Quick Start

### Prerequisites

- Node.js 20+
- An HSDS 3.0 compliant API (like [ATtoOR](../))

### Installation

```bash
# Clone/navigate to this directory
cd hsdirectory

# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
# Edit .env.local with your API URL
```

### Configuration

Edit `.env.local`:

```env
# Required: Your HSDS API endpoint
NEXT_PUBLIC_API_URL=http://localhost:8080

# Optional: App branding
NEXT_PUBLIC_APP_NAME=HSDirectory
NEXT_PUBLIC_APP_DESCRIPTION=Find community services and resources
```

### Development

```bash
# Start development server
npm run dev

# Open http://localhost:3000
```

### Production Build

```bash
# Build for production
npm run build

# Start production server
npm start
```

## Project Structure

```
hsdirectory/
├── src/
│   ├── app/                    # Next.js App Router pages
│   │   ├── page.tsx            # Homepage
│   │   ├── services/           # Services listing & detail
│   │   ├── organizations/      # Organizations listing & detail
│   │   ├── map/                # Map view
│   │   └── not-found.tsx       # 404 page
│   ├── components/
│   │   ├── ui/                 # Shared UI components
│   │   ├── services/           # Service-specific components
│   │   ├── organizations/      # Organization components
│   │   └── map/                # Map components
│   └── lib/
│       └── api.ts              # HSDS API client
├── public/                     # Static assets
└── .env.local                  # Environment configuration
```

## API Requirements

This application expects an HSDS 3.0 compliant API with these endpoints:

| Endpoint | Description |
|----------|-------------|
| `GET /` | API metadata |
| `GET /services` | List services (paginated) |
| `GET /services/{id}` | Service details |
| `GET /organizations` | List organizations (paginated) |
| `GET /organizations/{id}` | Organization details |
| `GET /service_at_locations` | Service-location links |

## Deployment

### Vercel (Recommended)

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel
```

### Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

### Static Export

```bash
# Add to next.config.ts: output: 'export'
npm run build
# Deploy 'out' directory to any static host
```

## Technology Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: TailwindCSS
- **Maps**: MapLibre GL
- **Fonts**: Geist Sans & Mono

## License

MIT

## Links

- [HSDS Specification](https://docs.openreferral.org/)
- [Open Referral](https://openreferral.org/)
- [Next.js Documentation](https://nextjs.org/docs)
