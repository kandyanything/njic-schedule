// Drives the hourly 11 am - 3 pm ET refresh window.
//
// GitHub's own scheduler honours roughly half the slots a workflow asks for -
// scheduled runs sit on shared infrastructure and are delayed or dropped, worst
// during US peak hours, which is precisely this window. Cloudflare's cron fires
// reliably, so this Worker keeps the time and asks GitHub to run the job now via
// workflow_dispatch, which is an ordinary API call and is not rate-limited the
// way the scheduler is. The workflow keeps its own cron as an off-peak fallback.
//
// The trigger is set to 15:00-20:00 UTC, which is one hour wider than the window
// needs, because 11 am ET is 15:00 UTC on daylight time and 16:00 UTC on standard
// time. The Worker asks what hour it currently is in New York and only dispatches
// inside the real window, so the promise does not quietly break when the clocks
// change in November.

const OWNER = 'kandyanything';
const REPO = 'njic-schedule';
const WORKFLOW = 'schedule.yml';
const REF = 'main';
const FIRST_HOUR = 11;   // 11 am ET
const LAST_HOUR = 15;    // 3 pm ET, inclusive

function easternHour(date) {
  const h = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false,
  }).format(date);
  return Number(h) % 24;          // "24" at midnight in some ICU versions
}

async function dispatch(env) {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `${OWNER}-njic-refresh-worker`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: REF }),
    },
  );
  // 204 is success and carries no body; anything else is worth surfacing.
  if (res.status === 204) return { ok: true, status: 204 };
  return { ok: false, status: res.status, detail: (await res.text()).slice(0, 300) };
}

export default {
  async scheduled(event, env, ctx) {
    const hour = easternHour(new Date(event.scheduledTime));
    if (hour < FIRST_HOUR || hour > LAST_HOUR) {
      console.log(`skipped: ${hour}:00 ET is outside the ${FIRST_HOUR}-${LAST_HOUR} window`);
      return;
    }
    if (!env.GITHUB_TOKEN) {
      console.error('GITHUB_TOKEN secret is not set; nothing dispatched');
      return;
    }
    const r = await dispatch(env);
    console.log(r.ok
      ? `dispatched ${WORKFLOW} for ${hour}:00 ET`
      : `dispatch FAILED (${r.status}) ${r.detail}`);
  },

  // Manual check: GET /?dry=1 reports what it would do without dispatching.
  async fetch(request, env) {
    const url = new URL(request.url);
    const hour = easternHour(new Date());
    const inWindow = hour >= FIRST_HOUR && hour <= LAST_HOUR;
    if (url.searchParams.get('dry') === '1') {
      return Response.json({
        easternHour: hour, inWindow, hasToken: Boolean(env.GITHUB_TOKEN),
        wouldDispatch: inWindow && Boolean(env.GITHUB_TOKEN),
      });
    }
    if (!inWindow) return Response.json({ dispatched: false, reason: `outside window (${hour}:00 ET)` });
    const r = await dispatch(env);
    return Response.json({ dispatched: r.ok, ...r }, { status: r.ok ? 200 : 502 });
  },
};
