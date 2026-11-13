# Starship Tracker

Vanilla JS tracker for the current SpaceX Starship flight. The flight, ship, T-0 and landing are discovered from SpaceX's website at runtime (`api/_flight.ts`), so a new flight needs no code change.

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
