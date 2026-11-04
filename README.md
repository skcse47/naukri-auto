# Naukri auto-apply

Searches Naukri for the newest jobs that match your skills, applies to them, and emails you the list of companies.

> **Risk:** Naukri's terms don't allow automated use. Your account could be limited or banned. Keep the limits low.
> The script never tries to get past a CAPTCHA or OTP. When it sees one, it stops and emails you.

## How it works

1. Signs in once and keeps the session in `browser-profile/`.
2. Runs one search per entry in `SEARCH_KEYWORDS`, newest first, limited to jobs from the last `JOB_AGE_DAYS`.
3. Skips jobs it has seen before, jobs with a title in `EXCLUDE_TITLE_WORDS`, and jobs that mention fewer than `MIN_SKILL_MATCH` of your `SKILLS`.
4. Applies to the newest jobs first, up to `MAX_APPLIES_PER_RUN` per run and `MAX_APPLIES_PER_DAY` per day.
5. Emails you three lists:
   - **Applied**: company, role, location, experience, when it was posted, and which of your skills matched.
   - **Finish these yourself**: jobs where the recruiter asks questions, or where you apply on the company's site.
   - **Could not apply**: anything that failed. Check `screenshots/` for these.

Running it every 30 minutes with `JOB_AGE_DAYS=1` puts you among the first people to apply.

## EC2 setup (Ubuntu 22.04/24.04)

A `t3.small` (2 GB RAM) is enough. Chromium crashes on 1 GB unless you add swap.

```bash
# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Use Indian time so the cron hours and daily limit line up with IST
sudo timedatectl set-timezone Asia/Kolkata
```

Copy this folder to the server (from your Windows machine; don't copy `node_modules` or `browser-profile`):

```bash
scp -r -i your-key.pem naukri-auto-apply/src naukri-auto-apply/package.json naukri-auto-apply/.env.example ubuntu@<EC2-IP>:~/naukri-auto-apply/
```

On the server:

```bash
cd ~/naukri-auto-apply
npm install
npx playwright install --with-deps chromium
cp .env.example .env
nano .env        # your login, skills, SMTP settings
chmod 600 .env
mkdir -p logs
```

### Gmail for notifications

Turn on 2-step verification on the Google account, create an App Password at https://myaccount.google.com/apppasswords, and put it in `SMTP_PASS`. Your normal Gmail password won't work.

## First run

```bash
npm run dry-run    # signs in, searches, lists what it WOULD apply to. Applies to nothing.
```

Check that the list looks right. Tune `SKILLS`, `MIN_SKILL_MATCH` and `EXCLUDE_TITLE_WORDS` until it does. Then:

```bash
npm start
```

### Manual sign-in (when Naukri asks for an OTP or CAPTCHA)

`npm run login` opens a real browser window so you can sign in yourself. On EC2 there's no screen, so show the window on your PC:

1. Install **MobaXterm** on Windows (it includes an X server) and SSH to the EC2 from it.
2. On the server: `sudo apt-get install -y xauth`, then reconnect.
3. Run `npm run login`. A Chromium window opens on your PC. Sign in, including the OTP.
4. The session is saved in `browser-profile/`, and later runs reuse it.

Copying `browser-profile/` from Windows to Linux won't work, because the saved cookies are encrypted differently on each OS.

## Schedule with cron

```bash
which node      # usually /usr/bin/node
crontab -e
```

Every 30 minutes, 8 AM to 10 PM IST:

```cron
*/30 8-22 * * * cd /home/ubuntu/naukri-auto-apply && /usr/bin/node src/index.js >> logs/run.log 2>&1
```

A lock file stops two runs from overlapping. Follow the log with `tail -f logs/run.log`.

## Files it creates

| Path | What |
| --- | --- |
| `browser-profile/` | Saved Naukri session |
| `data/seen-jobs.json` | Every job already handled, with its status. Delete an entry to retry that job |
| `screenshots/` | Pages from failed or blocked attempts |
| `logs/run.log` | Cron output |

## When something breaks

Naukri changes its pages often. If every job comes back `no_button` or `failed`, open a screenshot from `screenshots/` and update the selectors in `src/naukri.js`. Look in `applyToJob` for the Apply button and success message, and in `scrapeCards` for the search results. Search results are read from Naukri's own search API response first, so search usually keeps working after page changes.
