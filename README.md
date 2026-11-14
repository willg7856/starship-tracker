# Starship Tracker

Vanilla JS tracker for the current SpaceX Starship flight. Everything flight-specific is discovered at runtime, so a new flight needs no code change.

## Data sources

- **Flight, ship, T-0, timeline, landing, official webcast** (`api/_flight.ts`, `/api/flight`): SpaceX's website (launch tiles, `future_missions.json`, mission page). The official webcast embeds from `studio.x.com/embed/broadcast/<id>`, as spacex.com does.
- **Live position** (`/api/tracker`): SpaceX's public vehicle tracker (`shipNN`, `boosterNN`).
- **Estimated position when SpaceX publishes none** (`api/_orbit.ts`, `/api/orbit`, `public/js/orbit.js`): the ship's catalogue orbit or SpaceX's orbit for the Starlink batch it deployed (Celestrak), propagated with SGP4; then the planned re-entry path into Starbase and SpaceX's planned catch time. Always labelled as an estimate.
- **Hazard areas** (`api/_hazards.ts`, `/api/hazards`): the flight's Space Notices page, merged per group in the browser. A curated `public/data/flight<N>-hazards.json` overrides it (`scripts/build-hazards-from-space-notices.py`).

Open pages reload themselves when a new version is deployed (`build` in `/api/flight`).

## Stack

- Static ES modules + Leaflet (CDN) in `public/`; vendored `satellite.js` and `polygon-clipping` in `public/js/vendor/`
- Vercel serverless API routes in `api/`

## Deploy (Vercel)

```bash
npm install
npx vercel --prod
```

Attach domain `starship.beyondstagezero.com` in the Vercel project.

## Optional Cloudflare Worker

`npm run deploy:cf` deploys the same API (`worker/index.ts`) to `*.workers.dev` only.
