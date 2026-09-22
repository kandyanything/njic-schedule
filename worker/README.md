# njic-refresh-trigger

Fires the schedule rebuild hourly from 11 am to 3 pm ET.

## Why this exists

The workflow's own `schedule:` cron asks GitHub for eleven runs a day. GitHub
delivers about half of them: scheduled runs sit on shared infrastructure and are
delayed or silently dropped, worst during US peak hours — which is exactly the
11 am–3 pm window. Measured on 2026-09-21, the window asked for five runs and got
one.

Cloudflare's cron triggers fire on time, and `workflow_dispatch` is an ordinary
API call rather than a queued scheduled run, so it is not subject to the same
throttling. The workflow keeps its own cron as the off-peak fallback; this Worker
only covers the promised hourly window.

## Setup

1. **Mint a GitHub token** — fine-grained, resource owner `kandyanything`,
   repository access *only* `njic-schedule`, permission **Actions: Read and
   write** and nothing else. Copy it; GitHub shows it once.

2. **Store it as a secret** (never in `wrangler.toml`, never in git):

   ```
   cd worker
   npx wrangler secret put GITHUB_TOKEN
   ```

3. **Deploy:**

   ```
   npx wrangler deploy
   ```

## Checking it

`GET https://njic-refresh-trigger.<subdomain>.workers.dev/?dry=1` reports the
current Eastern hour, whether that is inside the window, and whether the token is
present — without dispatching anything.

Hitting the same URL without `?dry=1` dispatches immediately, which is a quick way
to prove the token works end to end.

Cron activity is visible under the Worker's **Logs**, and each dispatched run
appears in the repo's Actions tab as `workflow_dispatch` rather than `schedule`.

## Token expiry

A fine-grained token expires. When it does, the Worker's dispatches start failing
with 401 and the hourly window silently reverts to GitHub's unreliable scheduler —
the site's refresh strip will show the gaps, which is the intended early warning.
Set a calendar reminder for the expiry date.
