const fs = require('fs');
const path = require('path');
const { config } = require('./config');

// Remembers every job we have already handled so later runs don't open it again.
const FILE = path.join(config.paths.dataDir, 'seen-jobs.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function save(seen) {
  fs.mkdirSync(config.paths.dataDir, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(seen, null, 2));
  fs.renameSync(tmp, FILE);
}

const keyOf = (job) => job.jobId || job.url;

function has(seen, job) {
  return Boolean(seen[keyOf(job)]);
}

function record(seen, job, result) {
  seen[keyOf(job)] = {
    title: job.title,
    company: job.company,
    url: job.url,
    status: result.status,
    at: new Date().toISOString(),
  };
  save(seen);
}

const istDay = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

function appliedToday(seen) {
  const today = istDay(Date.now());
  return Object.values(seen).filter((e) => e.status === 'applied' && istDay(e.at) === today).length;
}

module.exports = { load, has, record, appliedToday };
