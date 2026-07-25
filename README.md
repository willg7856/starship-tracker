# Ship 40 Tracker

Live location tracker for SpaceX **Ship 40** (Starship Flight 13), reading the same public telemetry feed that powers [spacex.com’s vehicle tracker](https://www.spacex.com/vehicle-tracker).

**Live:** [starship.beyondstagezero.com](https://starship.beyondstagezero.com)

## Data source

SpaceX’s public tracker feed (no scraping):

```
https://sxcontent9668.azureedge.us/cms-assets/starship_tracker_public.json
```

Mission copy from SpaceX’s public CMS:

```
https://content.spacex.com/api/spacex-website/missions/starship-flight-13
```

The browser calls same-origin `/api/tracker` and `/api/mission` proxies (Vercel serverless) because Azure CDN blocks cross-origin browser requests from custom domains. The app polls about every 10 seconds (matching SpaceX’s own client).

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

SpaceX’s live tracker only keeps the current fix plus a short forward prediction. The full Flight 13 ground track on the map comes from the archived SpaceX vehicle-tracker series published by [Space Notices](https://space-notices.com/entry/launch-starship-flight-13) (liftoff → splashdown), along with the associated AHA / nav-warning polygons.

**Ocean drift** is the great-circle distance from that archived splashdown fix to the live SpaceX position.

## Notes

- Ship 40 is a Starship upper stage, not a maritime recovery ship.
- After Flight 13 splashdown, the feed reports a near-surface fix in the Indian Ocean.
- This project is unofficial and unaffiliated with SpaceX.
