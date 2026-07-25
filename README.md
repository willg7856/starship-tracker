# Ship 40 Tracker

Live location tracker for SpaceX **Ship 40** (Starship Flight 13), reading the same public telemetry feed that powers [spacex.com’s vehicle tracker](https://www.spacex.com/vehicle-tracker).

**Live:** [starship.beyondstagezero.com](https://starship.beyondstagezero.com)

## Data source

SpaceX’s public tracker feed (no scraping):

```
https://sxcontent9668.azureedge.us/cms-assets/starship_tracker_public.json
```

The browser calls a same-origin `/api/tracker` proxy (Vercel serverless) because Azure CDN blocks cross-origin browser requests from custom domains. The app polls about every 10 seconds.

## Run locally

```bash
npm install
npm run dev
```

Then open the printed localhost URL.

## Build

```bash
npm run build
npm run preview
```

## Flight path

SpaceX’s live tracker only keeps the current fix plus a short forward prediction. The flown Flight 13 ground track comes from the [Space Notices](https://space-notices.com/entry/launch-starship-flight-13) Trajectory layer (seed path + live [`ship-40`](https://data.space-notices.com/space-notices-data/ship-40) feed via `/api/space-notices-ship40`). After the baked tip, the map also extends from that feed and from SpaceX near-surface fixes in the browser.

**Ocean drift** is the distance from the archived splashdown fix to the live SpaceX position.

Rebuild the baked path:

```bash
python3 scripts/rebuild-flight13-path-from-space-notices.py
```

## Notes

- Unofficial and unaffiliated with SpaceX.
