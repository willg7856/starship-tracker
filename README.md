# Ship 40 Tracker

Vanilla JS tracker for SpaceX Starship Flight 13 / Ship 40.

## Stack

- Static ES modules + Leaflet (CDN) in `public/`
- Vercel serverless API routes in `api/` (SpaceX + Space Notices proxies)

## Deploy (Vercel)

```bash
npm install
npx vercel --prod
```

Attach domain `starship.beyondstagezero.com` (and optionally `ship40.beyondstagezero.com`) in the Vercel project.

## Optional Cloudflare Worker

`npm run deploy:cf` still deploys to `*.workers.dev` only.
