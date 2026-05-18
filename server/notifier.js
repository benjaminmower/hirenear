import nodemailer from 'nodemailer';
import { query } from './db.js';

const QUALIFIED_SUBJECT = "Someone qualified is asking if you're hiring";

let transporter = null;
let transporterKey = '';

function getBaseUrl() {
  return (process.env.BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.NOTIFY_FROM_EMAIL;

  if (!host || !port || !user || !pass || !from) {
    return null;
  }

  return {
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    from,
  };
}

function getTransporter(config) {
  const key = `${config.host}:${config.port}:${config.auth.user}`;
  if (!transporter || key !== transporterKey) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
    transporterKey = key;
  }
  return transporter;
}

function readFitScore(source) {
  return Number(source?.fitScore ?? source?.fit_score ?? 0);
}

function buildBusinessLeadBody(businessName, fitScore, matchUrl) {
  return `Hi ${businessName},

Someone nearby reviewed your business on Hirenear and scored ${fitScore}% match.

View their match and reach out here:
${matchUrl}

We're sending you this lead for free. If you'd like to keep receiving qualified local candidates, visit:
${getBaseUrl()}/for-businesses

- Hirenear`;
}

function buildDetailedBusinessLeadBody(businessName, fitScore, summary, signals, matchUrl) {
  const positiveSignals = signals
    .filter(item => item && item.weight === 'positive' && item.label)
    .slice(0, 3);
  const bullets = positiveSignals.map(item => `- ${item.label}`).join('\n');

  return `Hi ${businessName},

Someone nearby reviewed your business on Hirenear and scored ${fitScore}% match.

Here's why:
${bullets}

${summary}

View their match and reach out here:
${matchUrl}

We're sending you this lead for free. If you'd like to keep receiving qualified local candidates, visit:
${getBaseUrl()}/for-businesses

- Hirenear`;
}

export async function sendBusinessNotifications(runId) {
  const smtpConfig = getSmtpConfig();
  if (!smtpConfig) {
    console.warn(`[notifier] SMTP not configured; skipping run ${runId}`);
    return;
  }

  const result = await query(
    `SELECT id, business_name, business_contact_email, seeker_email, fit_score, match_token
     FROM scout_interest
     WHERE run_id = $1
       AND notified_at IS NULL
       AND business_contact_email IS NOT NULL
       AND business_contact_email != ''`,
    [runId]
  );

  if (result.rowCount === 0) return;

  const smtp = getTransporter(smtpConfig);

  for (const row of result.rows) {
    const matchUrl = `${getBaseUrl()}/match/${encodeURIComponent(row.match_token)}`;
    const confirmUrl = `${matchUrl}/confirm`;

    try {
      await smtp.sendMail({
        from: smtpConfig.from,
        to: row.business_contact_email,
        replyTo: row.seeker_email,
        subject: QUALIFIED_SUBJECT,
        text: buildBusinessLeadBody(row.business_name, row.fit_score, matchUrl),
      });

      await query(
        `UPDATE scout_interest
         SET notified_at = now()
         WHERE id = $1`,
        [row.id]
      );

      try {
        await smtp.sendMail({
          from: smtpConfig.from,
          to: row.seeker_email,
          subject: 'A business may reach out to you soon',
          text: `Hi,

You expressed interest in ${row.business_name} on Hirenear. We've let them know.

If they reach out, did it go well? Let us know:
${confirmUrl}

- Hirenear`,
        });
      } catch (err) {
        console.error(`[notifier] Failed to send seeker follow-up for scout_interest ${row.id}:`, err.message);
      }
    } catch (err) {
      console.error(`[notifier] Failed to send notification for scout_interest ${row.id}:`, err.message);
    }
  }
}

export async function notifyBusinessIfQualified(business) {
  try {
    const businessId = business?.id;
    if (!businessId) return;

    const fitScore = readFitScore(business);
    if (!Number.isFinite(fitScore) || fitScore < 80) return;

    const contactEmail = business.contactEmail || business.contact_email;
    if (!contactEmail) return;

    const existing = await query(
      'SELECT id, name, fit_score, contact_email, notified_at, match_summary, match_signals FROM scout_businesses WHERE id = $1',
      [businessId]
    );
    const row = existing.rows[0];
    if (!row || row.notified_at) return;
    if (row.fit_score === null || row.fit_score === undefined || readFitScore(row) < 80) return;
    if (!row.contact_email) return;

    const smtpConfig = getSmtpConfig();
    if (!smtpConfig) return;

    const signals = Array.isArray(row.match_signals)
      ? row.match_signals
        .filter(item => item && typeof item.label === 'string' && item.label.trim() && item.weight === 'positive')
        .map(item => ({ label: item.label.trim(), weight: 'positive' }))
      : [];
    const hasSignals = signals.length > 0;
    const hasSummary = typeof row.match_summary === 'string' && row.match_summary.trim();
    const matchUrl = `${getBaseUrl()}/for-businesses`;

    await getTransporter(smtpConfig).sendMail({
      from: smtpConfig.from,
      to: row.contact_email,
      subject: QUALIFIED_SUBJECT,
      text: hasSignals && hasSummary
        ? buildDetailedBusinessLeadBody(row.name, row.fit_score, row.match_summary.trim(), signals, matchUrl)
        : buildBusinessLeadBody(row.name, row.fit_score, matchUrl),
    });

    await query(
      `UPDATE scout_businesses
       SET notified_at = now(), updated_at = now()
       WHERE id = $1 AND notified_at IS NULL`,
      [businessId]
    );
  } catch (err) {
    console.error('[notifyBusinessIfQualified] failed:', err);
  }
}
