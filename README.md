# Novigo Timeline Dashboard

React 18, TypeScript, Vite and MUI v6. Uses the assignment's real backend for login, production timelines and hourly summaries.

[Live app](https://novigo-kappa.vercel.app) · [Demo video](https://novigo-kappa.vercel.app/demo.html)

## Run

Requires Node.js 22+.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Sign in with `analytics_user` / `dashboard123`. Select **Line1 SPI** and a date between **1–7 September 2026**.

The default `/api` URL uses a Vite proxy locally and a serverless proxy on Vercel. Set `BACKEND_BASE_URL` in `.env.local` to change the upstream server.

## Checks

```bash
npm test
npm run build
npm run smoke:api # optional: checks the real backend through the proxy
```

See [NOTES.md](NOTES.md) for implementation decisions and backend quirks, and [QA.md](QA.md) for browser checks and the 20,000-marker benchmark.
