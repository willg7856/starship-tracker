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

SpaceX’s public tracker only publishes the live fix plus a short forward prediction — it does not archive the flown ground track. The map path is assembled from:

1. **Flight Club** public Flight 13 Ship (stage 2) simulation for ascent/coast
2. The **FAA Stage 2 reentry hazard corridor** (CADENA / FAA ATO briefing) for the Indian Ocean approach, ending at the first public SpaceX splashdown fix
3. **Drift since landing** compares the live fix to that frozen splashdown position

This is a public reconstruction, not official post-flight telemetry.

## Notes

- Ship 40 is a Starship upper stage, not a maritime recovery ship.
- After Flight 13 splashdown, the feed reports a near-surface fix in the Indian Ocean.
- This project is unofficial and unaffiliated with SpaceX.
