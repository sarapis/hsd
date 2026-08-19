# Contributing to Mutual Aid NYC HSDirectory

Thanks for your interest in contributing! This project bridges Airtable data to the [Human Services Data Specification (HSDS)](https://docs.openreferral.org/) API format and presents it via a Next.js directory.

## Getting Started

To run the full stack locally for development:

1. Fork the repository
2. Clone your fork locally (`git clone https://github.com/sarapis/hsd.git`)
3. Start the API — a Cloudflare Worker backed by D1:
   ```bash
   cd worker
   npm install
   cp .dev.vars.example .dev.vars   # add AIRTABLE_API_KEY and SYNC_SECRET
   npm run db:migrate               # create the local D1 schema
   npm run dev                      # serves on http://localhost:8787
   ```
4. In a second terminal, start the Next.js frontend:
   ```bash
   cd hsdirectory-v2
   npm install
   echo "NEXT_PUBLIC_API_URL=http://localhost:8787" > .env.local
   npm run dev
   ```

Run `npm test` in `worker/` before opening a pull request. It is unit-only
and needs no network. `npm run test:smoke` additionally checks a deployed
environment, and honours `API_URL`.

## How to Contribute

### Bug Reports

Open an issue with:
- Steps to reproduce
- Expected vs. actual behavior
- Browser/OS, and whether it reproduces against the API or only the frontend

### Feature Requests

Open an issue describing the feature and its use case.

### Pull Requests

1. Create a feature branch from `main`
2. Follow [PEP 8](https://peps.python.org/pep-0008/) for Python code
3. Include docstrings for new functions
4. Test your changes locally
5. Submit a PR with a clear description

## Code Style

- **Python**: PEP 8, type hints where practical
- **TypeScript** (HSDirectory frontend): ESLint defaults
- **Commits**: Use conventional commit messages (e.g., `feat:`, `fix:`, `docs:`)

## Questions?

Open an issue or start a discussion. We're happy to help!
