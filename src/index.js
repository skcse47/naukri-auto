const fs = require('fs');
const path = require('path');
const { config, validate } = require('./config');
const naukri = require('./naukri');
const store = require('./store');
const { sendSummary, sendAlert } = require('./mailer');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LOGIN_ONLY = args.includes('--login');

// Stops two cron runs from overlapping and sharing one browser profile.
const LOCK = path.join(config.paths.dataDir, 'run.lock');

function takeLock() {
  fs.mkdirSync(config.paths.dataDir, { recursive: true });
  try {
    fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    const ageMin = (Date.now() - fs.statSync(LOCK).mtimeMs) / 60000;
    if (ageMin > 60) {
      fs.writeFileSync(LOCK, String(process.pid));
      return true;
    }
    return false;
  }
}

// Turns "Just now" / "3 hours ago" / "2 Days Ago" into an age in hours, used to apply to the newest jobs first.
function ageHours(job) {
  if (job.createdDate) return (Date.now() - Number(job.createdDate)) / 36e5;
  const p = (job.posted || '').toLowerCase();
  if (/just now|few hours|today|minute/.test(p)) return 1;
  const n = parseInt(p, 10) || 1;
  if (p.includes('hour')) return n;
  if (p.includes('day')) return n * 24;
  if (p.includes('week')) return n * 24 * 7;
  return 24 * 30;
}

async function run() {
  const startedAt = new Date();
  const seen = store.load();
  const { context, page } = await naukri.launch();
  const applied = [];
  const manual = [];
  const failed = [];

  try {
    await naukri.ensureLoggedIn(page);

    const byKey = new Map();
    for (const keyword of config.search.keywords) {
      console.log(`Searching "${keyword}"...`);
      for (const job of await naukri.searchJobs(page, keyword)) {
        if (job.url) byKey.set(job.jobId || job.url, job);
      }
    }

    const candidates = [...byKey.values()]
      .filter((job) => !store.has(seen, job))
      .filter((job) => !naukri.isExcluded(job))
      .map((job) => ({ job, matched: naukri.matchSkills(job) }))
      .filter(({ matched }) => matched.length >= config.search.minSkillMatch)
      .sort((a, b) => ageHours(a.job) - ageHours(b.job));

    console.log(`${byKey.size} jobs found, ${candidates.length} new jobs match your skills.`);

    if (DRY_RUN) {
      candidates.slice(0, config.limits.maxApplies).forEach(({ job, matched }, i) =>
        console.log(`${i + 1}. ${job.company} | ${job.title} | ${job.posted} | ${matched.join(', ')}\n   ${job.url}`)
      );
      console.log('Dry run: nothing was applied to.');
      return;
    }

    const budget = Math.min(config.limits.maxApplies, config.limits.maxPerDay - store.appliedToday(seen));
    if (budget <= 0) console.log('Daily apply limit reached, not applying this run.');

    for (const candidate of candidates) {
      if (applied.length >= budget) break;
      const { job } = candidate;
      console.log(`Applying: ${job.company} - ${job.title}`);

      let result;
      try {
        result = await naukri.applyToJob(page, job);
      } catch (err) {
        if (err instanceof naukri.BlockedError) throw err;
        result = { status: 'failed', note: err.message };
      }
      console.log(`  -> ${result.status}`);
      store.record(seen, job, result);

      const row = { ...candidate, result };
      if (result.status === 'applied') applied.push(row);
      else if (result.status === 'needs_answers' || result.status === 'external') manual.push(row);
      else if (result.status !== 'already_applied') failed.push(row);

      await naukri.humanPause();
    }
  } catch (err) {
    if (err instanceof naukri.BlockedError) {
      console.error('Stopped:', err.message);
      await sendAlert('needs your attention', `${err.message} Sign in by hand on the server with "npm run login" (see README, "Manual sign-in"). Runs will keep failing until then.`);
    } else {
      throw err;
    }
  } finally {
    await context.close();
    if (!DRY_RUN) await sendSummary({ applied, manual, failed, startedAt });
  }
}

async function main() {
  if (LOGIN_ONLY) return naukri.manualLogin();
  validate();
  if (!takeLock()) {
    console.log('Another run is still going, exiting.');
    return;
  }
  try {
    await run();
  } finally {
    fs.rmSync(LOCK, { force: true });
  }
}

main().catch(async (err) => {
  console.error(err);
  await sendAlert('crashed', err.stack || err.message);
  process.exit(1);
});
