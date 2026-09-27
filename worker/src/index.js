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

// The dashboard form accepts whatever key you type, and this secret went in as
// GITHUB-TOKEN with a hyphen. Cloudflare cannot rename a secret and GitHub shows
// a token exactly once, so insisting on the underscore would mean generating a
// replacement. Both spellings are read; the underscore wins if it is ever added.
function token(env) {
  return env.GITHUB_TOKEN || env['GITHUB-TOKEN'] || '';
}

// "A secret exists" and "the secret is a usable token" are different questions,
// and a truncated paste or a revoked token looks identical to a good one until a
// dispatch silently fails inside the window. This answers the second question
// with a cheap authenticated read that changes nothing.
async function tokenWorks(env) {
  const t = token(env);
  if (!t) return { ok: false, reason: 'no secret set' };
  try {
    const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}`, {
      headers: {
        'Authorization': `Bearer ${t}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': `${OWNER}-njic-refresh-worker`,
      },
    });
    if (res.ok) return { ok: true };
    return { ok: false, reason: `GitHub answered ${res.status}` };
  } catch (err) {
    return { ok: false, reason: `could not reach GitHub: ${err.message}` };
  }
}

async function dispatch(env) {
  const res = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token(env)}`,
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
    if (!token(env)) {
      console.error('no GitHub token secret is set; nothing dispatched');
      return;
    }
    const r = await dispatch(env);
    console.log(r.ok
      ? `dispatched ${WORKFLOW} for ${hour}:00 ET`
      : `dispatch FAILED (${r.status}) ${r.detail}`);
  },

  // Status only. This endpoint reports what the cron would do; it never
  // dispatches. An earlier version fired a real workflow_dispatch on any
  // plain GET, which made the workers.dev URL an unauthenticated build
  // trigger that anyone who found it could hold down through the window.
  // Manual runs belong in the GitHub Actions UI, behind a login.
  async fetch(request, env) {
    const hour = easternHour(new Date());
    const inWindow = hour >= FIRST_HOUR && hour <= LAST_HOUR;
    const check = await tokenWorks(env);
    return Response.json({
      easternHour: hour,
      window: `${FIRST_HOUR}:00-${LAST_HOUR}:00 ET`,
      inWindow,
      hasToken: Boolean(token(env)),
      tokenWorks: check.ok,
      tokenProblem: check.ok ? undefined : check.reason,
      wouldDispatchNow: inWindow && check.ok,
    });
  },
};
