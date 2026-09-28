# Starship Tracker

Vanilla JS tracker for SpaceX Starship Flight 14 / Ship 41.

## Stack

- Static ES modules + Leaflet (CDN) in `public/`
- Vercel serverless API routes in `api/` (SpaceX + Space Notices proxies)

## Deploy (Vercel)

```bash
npm install
npx vercel --prod
```

Attach domain `starship.beyondstagezero.com` (and optionally `ship41.beyondstagezero.com`) in the Vercel project.

## Optional Cloudflare Worker

`npm run deploy:cf` still deploys to `*.workers.dev` only.
