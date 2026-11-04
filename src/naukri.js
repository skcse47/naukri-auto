const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { config } = require('./config');

const BASE = 'https://www.naukri.com';
const LOGIN_URL = `${BASE}/nlogin/login`;
const HOME_URL = `${BASE}/mnjuser/homepage`;

// Thrown when Naukri shows a CAPTCHA, OTP or other check. We stop and tell the user; we never try to get past it.
class BlockedError extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const humanPause = () => {
  const { minDelay, maxDelay } = config.limits;
  return sleep(minDelay + Math.random() * (maxDelay - minDelay));
};

async function launch({ headless = config.browser.headless } = {}) {
  // A persistent profile keeps you signed in between runs, so we log in rarely.
  const context = await chromium.launchPersistentContext(config.browser.profileDir, {
    headless,
    viewport: { width: 1366, height: 850 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(30000);
  return { context, page };
}

async function screenshot(page, name) {
  try {
    fs.mkdirSync(config.paths.screenshotsDir, { recursive: true });
    const file = path.join(config.paths.screenshotsDir, `${Date.now()}-${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    return file;
  } catch {
    return null;
  }
}

async function checkBlocked(page) {
  const blockers = [
    'iframe[src*="captcha"]',
    'iframe[title*="reCAPTCHA"]',
    'text=/verify (that )?you are (a )?human/i',
    'text=/enter (the )?otp/i',
    'text=/access denied/i',
  ];
  for (const sel of blockers) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) {
      const shot = await screenshot(page, 'blocked');
      throw new BlockedError(`Naukri is asking for a manual check (${sel}). Screenshot: ${shot || 'n/a'}`);
    }
  }
}

async function isLoggedIn(page) {
  await page.goto(HOME_URL, { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  return !page.url().includes('nlogin');
}

async function ensureLoggedIn(page) {
  if (await isLoggedIn(page)) return;

  console.log('Signing in to Naukri...');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded' });
  await checkBlocked(page);
  await page.fill('#usernameField', config.naukri.email);
  await sleep(800);
  await page.fill('#passwordField', config.naukri.password);
  await sleep(800);
  await page.click('button[type="submit"]');
  await page.waitForLoadState('domcontentloaded');
  await sleep(6000);
  await checkBlocked(page);

  if (!(await isLoggedIn(page))) {
    const shot = await screenshot(page, 'login-failed');
    throw new BlockedError(
      `Sign-in did not work. Check the password, or run "npm run login" to sign in by hand. Screenshot: ${shot || 'n/a'}`
    );
  }
  console.log('Signed in.');
}

// Opens a visible browser so you can sign in yourself (handles OTP/CAPTCHA). The session is saved for later runs.
async function manualLogin() {
  const { context, page } = await launch({ headless: false });
  await page.goto(LOGIN_URL);
  console.log('Sign in in the browser window. Waiting up to 5 minutes...');
  await page.waitForURL(/mnjuser/, { timeout: 5 * 60 * 1000 });
  console.log('Signed in. Session saved to browser-profile/.');
  await context.close();
}

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

function buildSearchUrl(keyword, pageNo) {
  const { locations, experience, jobAgeDays } = config.search;
  let slug = `${slugify(keyword)}-jobs`;
  if (locations.length) slug += `-in-${locations.map(slugify).join('-')}`;
  if (pageNo > 1) slug += `-${pageNo}`;

  const params = new URLSearchParams({ k: keyword });
  if (locations.length) params.set('l', locations.join(', '));
  if (experience) params.set('experience', experience);
  if (jobAgeDays) params.set('jobAge', String(jobAgeDays));
  params.set('sort', 'f'); // f = freshness (newest first)
  return `${BASE}/${slug}?${params.toString()}`;
}

const absolute = (url) => (!url ? '' : url.startsWith('http') ? url : `${BASE}${url.startsWith('/') ? '' : '/'}${url}`);

function fromApiJob(j) {
  const placeholder = (type) => (j.placeholders || []).find((p) => p.type === type)?.label || '';
  return {
    jobId: String(j.jobId || ''),
    title: j.title || '',
    company: j.companyName || '',
    location: placeholder('location'),
    experience: placeholder('experience'),
    salary: placeholder('salary'),
    posted: j.footerPlaceholderLabel || '',
    createdDate: j.createdDate || null,
    skills: (j.tagsAndSkills || '').split(',').map((s) => s.trim()).filter(Boolean),
    snippet: (j.jobDescription || '').replace(/<[^>]+>/g, ' '),
    url: absolute(j.jdURL),
  };
}

// Fallback when the search API response can't be captured: read the job cards on the page.
async function scrapeCards(page) {
  return page.$$eval('.srp-jobtuple-wrapper, article.jobTuple, .cust-job-tuple', (cards) =>
    cards.map((c) => {
      const text = (sel) => c.querySelector(sel)?.textContent.trim() || '';
      const link = c.querySelector('a.title');
      return {
        jobId: c.getAttribute('data-job-id') || link?.href || '',
        title: link?.textContent.trim() || '',
        company: text('.comp-name'),
        location: text('.locWdth, .loc'),
        experience: text('.expwdth, .exp'),
        salary: text('.sal'),
        posted: text('.job-post-day'),
        createdDate: null,
        skills: [...c.querySelectorAll('.tags-gt li, ul.tags li')].map((li) => li.textContent.trim()),
        snippet: text('.job-desc'),
        url: link?.href || '',
      };
    })
  );
}

async function searchJobs(page, keyword) {
  const jobs = [];
  for (let pageNo = 1; pageNo <= config.search.maxPages; pageNo++) {
    const url = buildSearchUrl(keyword, pageNo);
    const apiResponse = page
      .waitForResponse((r) => r.url().includes('/jobapi/v3/search') && r.status() === 200, { timeout: 20000 })
      .then((r) => r.json())
      .catch(() => null);

    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await checkBlocked(page);

    const data = await apiResponse;
    let found = data?.jobDetails?.map(fromApiJob) || [];
    if (!found.length) {
      await page.waitForSelector('.srp-jobtuple-wrapper, article.jobTuple, .cust-job-tuple', { timeout: 15000 }).catch(() => {});
      found = await scrapeCards(page);
    }

    console.log(`  "${keyword}" page ${pageNo}: ${found.length} jobs`);
    jobs.push(...found);
    if (!found.length) break;
    await humanPause();
  }
  return jobs;
}

function matchSkills(job) {
  const haystack = `${job.title} ${job.skills.join(' ')} ${job.snippet}`.toLowerCase();
  return config.search.skills.filter((skill) => {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
  });
}

function isExcluded(job) {
  const title = job.title.toLowerCase();
  return config.search.excludeTitleWords.some((w) => title.includes(w));
}

// True if any of the selectors is visible. Kept as a list because Playwright can't mix text= and CSS in one selector.
async function visible(page, selectors) {
  for (const sel of [].concat(selectors)) {
    if (await page.locator(sel).first().isVisible().catch(() => false)) return true;
  }
  return false;
}

/**
 * Opens the job page and presses Apply.
 * Returns one of: applied | already_applied | external | needs_answers | no_button | failed
 */
async function applyToJob(page, job) {
  await page.goto(job.url, { waitUntil: 'domcontentloaded' });
  await sleep(3000);
  await checkBlocked(page);

  if (await visible(page, ['#already-applied', 'button:text-is("Applied")'])) {
    return { status: 'already_applied' };
  }

  const applyBtn = page.locator('#apply-button, button:has-text("Apply"):not(:has-text("company site"))').first();
  if (!(await applyBtn.isVisible().catch(() => false))) {
    if (await visible(page, '#company-site-button, button:has-text("Apply on company site")')) {
      return { status: 'external', note: 'Apply on company site' };
    }
    return { status: 'no_button', screenshot: await screenshot(page, `no-button-${job.jobId}`) };
  }

  await humanPause();
  await applyBtn.click();
  await sleep(5000);
  await checkBlocked(page);

  // Some recruiters ask questions in a chat panel. We don't guess answers for you; the job is listed so you can finish it.
  if (await visible(page, '[class*="chatbot_Drawer"], [class*="chatbot_MessageContainer"], ._chatBotContainer')) {
    return { status: 'needs_answers', note: 'Recruiter questions must be answered by hand' };
  }

  if (
    await visible(page, [
      'text=/successfully applied/i',
      'text=/you have applied/i',
      '#already-applied',
      'button:text-is("Applied")',
      '[class*="apply-message"]',
    ])
  ) {
    return { status: 'applied' };
  }

  return { status: 'failed', screenshot: await screenshot(page, `unknown-${job.jobId}`) };
}

module.exports = {
  BlockedError,
  launch,
  ensureLoggedIn,
  manualLogin,
  searchJobs,
  matchSkills,
  isExcluded,
  applyToJob,
  humanPause,
};
