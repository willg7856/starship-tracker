# Ship 40 Tracker

Live location tracker for SpaceX **Ship 40** (Starship Flight 13), reading the same public telemetry feed that powers [spacex.com’s vehicle tracker](https://www.spacex.com/vehicle-tracker).

## Data source

Directly from SpaceX CDN (no scraping):

```
https://sxcontent9668.azureedge.us/cms-assets/starship_tracker_public.json
```

Mission copy is loaded from SpaceX’s public CMS:

```
https://content.spacex.com/api/spacex-website/missions/starship-flight-13
```

The app polls the tracker about every 10 seconds (matching SpaceX’s own client).

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

## Notes

- Ship 40 is a Starship upper stage, not a maritime recovery ship.
- After Flight 13 splashdown, the feed reports a near-surface fix in the Indian Ocean.
- This project is unofficial and unaffiliated with SpaceX.
