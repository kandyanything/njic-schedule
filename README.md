# NJIC Conference Schedule

The aggregated athletic schedule for the **North Jersey Interscholastic
Conference (NJIC)** — all 35 member schools, every sport, one site. Filter it,
print it, and subscribe from Google / Apple / Outlook calendars or RSS.

Static site (HTML/CSS/JS, no build step). Schedules are read from each school's
**DigitalSports** feed and rebuilt every few hours by a GitHub Action.

## Run locally
Requires Node.js 18+. No install needed:
```
node scripts/preview-server.js 9400
```
Then open http://localhost:9400.

## How it updates
- `scripts/build-schedule.js` — pulls all 35 schools from DigitalSports (`scripts/ds-schools.json`) → `data/schedule.json`
- `scripts/split-schedule.js` — per-month files the calendar loads → `data/schedule/`
- `scripts/build-feeds.js` — subscribable `.ics` calendars (whole conference, per school, per sport, per sport+level) + RSS → `feeds/`

`.github/workflows/schedule.yml` runs all three every 3 hours and commits the
result. (Node built-ins only — no `npm install`.) The repo's **Settings →
Actions → General → Workflow permissions** must be **"Read and write."**

## Deploy
**Cloudflare Pages** — connect this repo, no build command, output directory `/`.
Cloudflare doesn't meter per-deploy, so the every-3-hours commits are free.
`_headers` sets the calendar-feed content types.

## Adding / changing a school
Edit `scripts/ds-schools.json` (name, slug, DigitalSports URL). Logos live in
`images/logos/optimized/<slug>.png`; the matcher is `scripts/school-logos.js`.
