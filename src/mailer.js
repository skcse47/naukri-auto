const nodemailer = require('nodemailer');
const { config } = require('./config');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function transporter() {
  const m = config.mail;
  return nodemailer.createTransport({
    host: m.host,
    port: m.port,
    secure: m.secure,
    auth: { user: m.user, pass: m.pass },
  });
}

function table(rows, showStatus) {
  if (!rows.length) return '<p style="color:#666">None.</p>';
  const head = ['#', 'Company', 'Role', 'Location', 'Experience', 'Posted', 'Matched skills']
    .concat(showStatus ? ['Note'] : [])
    .map((h) => `<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #ddd">${h}</th>`)
    .join('');
  const body = rows
    .map(({ job, matched, result }, i) => {
      const cells = [
        i + 1,
        `<b>${esc(job.company)}</b>`,
        `<a href="${esc(job.url)}">${esc(job.title)}</a>`,
        esc(job.location),
        esc(job.experience),
        esc(job.posted),
        esc(matched.join(', ')),
      ];
      if (showStatus) cells.push(esc(result.note || result.status));
      return `<tr>${cells.map((c) => `<td style="padding:6px 8px;border-bottom:1px solid #eee">${c}</td>`).join('')}</tr>`;
    })
    .join('');
  return `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px">
    <thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

async function sendSummary({ applied, manual, failed, startedAt }) {
  if (!applied.length && !manual.length && !failed.length && !config.mail.whenEmpty) {
    console.log('Nothing to report, skipping email.');
    return;
  }
  const when = startedAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const html = `
    <div style="font-family:Arial,sans-serif">
      <h2>Naukri auto-apply: ${applied.length} applied</h2>
      <p style="color:#666">Run started ${esc(when)} IST</p>
      <h3>Applied (${applied.length})</h3>
      ${table(applied, false)}
      <h3>Finish these yourself (${manual.length})</h3>
      <p style="color:#666">They need answers to recruiter questions or apply on the company's own site.</p>
      ${table(manual, true)}
      ${failed.length ? `<h3>Could not apply (${failed.length})</h3>${table(failed, true)}` : ''}
    </div>`;

  await transporter().sendMail({
    from: config.mail.from,
    to: config.mail.to,
    subject: `Naukri: applied to ${applied.length} job${applied.length === 1 ? '' : 's'} (${when})`,
    html,
  });
  console.log(`Summary emailed to ${config.mail.to}.`);
}

async function sendAlert(subject, message) {
  try {
    await transporter().sendMail({
      from: config.mail.from,
      to: config.mail.to,
      subject: `Naukri bot: ${subject}`,
      html: `<p style="font-family:Arial,sans-serif">${esc(message)}</p>`,
    });
  } catch (err) {
    console.error('Could not send alert email:', err.message);
  }
}

module.exports = { sendSummary, sendAlert };
