const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const list = (v) =>
  (v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const int = (v, fallback) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
};

const bool = (v, fallback) => (v === undefined || v === '' ? fallback : v.toLowerCase() === 'true');

const ROOT = path.join(__dirname, '..');

const config = {
  naukri: {
    email: process.env.NAUKRI_EMAIL,
    password: process.env.NAUKRI_PASSWORD,
  },
  search: {
    keywords: list(process.env.SEARCH_KEYWORDS),
    skills: list(process.env.SKILLS).map((s) => s.toLowerCase()),
    minSkillMatch: int(process.env.MIN_SKILL_MATCH, 2),
    excludeTitleWords: list(process.env.EXCLUDE_TITLE_WORDS).map((s) => s.toLowerCase()),
    locations: list(process.env.LOCATIONS),
    experience: process.env.EXPERIENCE_YEARS || '',
    jobAgeDays: int(process.env.JOB_AGE_DAYS, 1),
    maxPages: int(process.env.MAX_PAGES_PER_KEYWORD, 2),
  },
  limits: {
    maxApplies: int(process.env.MAX_APPLIES_PER_RUN, 10),
    maxPerDay: int(process.env.MAX_APPLIES_PER_DAY, 40),
    minDelay: int(process.env.MIN_DELAY_MS, 4000),
    maxDelay: int(process.env.MAX_DELAY_MS, 9000),
  },
  browser: {
    headless: bool(process.env.HEADLESS, true),
    profileDir: path.join(ROOT, 'browser-profile'),
  },
  mail: {
    host: process.env.SMTP_HOST,
    port: int(process.env.SMTP_PORT, 465),
    secure: bool(process.env.SMTP_SECURE, true),
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: process.env.MAIL_TO,
    whenEmpty: bool(process.env.MAIL_WHEN_EMPTY, false),
  },
  paths: {
    dataDir: path.join(ROOT, 'data'),
    screenshotsDir: path.join(ROOT, 'screenshots'),
  },
};

function validate() {
  const missing = [];
  if (!config.naukri.email) missing.push('NAUKRI_EMAIL');
  if (!config.naukri.password) missing.push('NAUKRI_PASSWORD');
  if (!config.search.keywords.length) missing.push('SEARCH_KEYWORDS');
  if (!config.search.skills.length) missing.push('SKILLS');
  if (!config.mail.host || !config.mail.user || !config.mail.pass || !config.mail.to) {
    missing.push('SMTP_HOST / SMTP_USER / SMTP_PASS / MAIL_TO');
  }
  if (missing.length) {
    throw new Error(`Missing settings in .env: ${missing.join(', ')}`);
  }
}

module.exports = { config, validate };
