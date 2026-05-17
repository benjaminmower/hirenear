import nodemailer from 'nodemailer';
import { query } from './db.js';

const SUBJECT = "Someone qualified is asking if you're hiring";
let transporter = null;
let transporterInitialized = false;

function getTransporter() {
  if (transporterInitialized) return transporter;
  transporterInitialized = true;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    console.warn('[notifyBusinessIfQualified] SMTP configuration missing; skipping outbound email');
    return null;
  }

  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  return transporter;
}

function buildBody(businessName, fitScore) {
  const baseUrl = process.env.BASE_URL || 'https://hirenear.app';
  return `Hi ${businessName},

Someone nearby reviewed your business on Hirenear and scored ${fitScore}% match for the kind of work you do.

They're asking if you're hiring.

We're sending you this lead for free. If you'd like to keep receiving qualified local candidates, visit:
${baseUrl}/for-businesses

— Hirenear`;
}

export async function notifyBusinessIfQualified(business) {
  try {
    const businessId = business?.id;
    if (!businessId) return;

    const fitScore = Number(business.fitScore ?? business.fit_score ?? 0);
    if (!Number.isFinite(fitScore) || fitScore < 80) return;

    const contactEmail = business.contactEmail || business.contact_email;
    if (!contactEmail) return;

    const existing = await query(
      'SELECT id, name, fit_score, contact_email, notified_at FROM scout_businesses WHERE id = $1',
      [businessId]
    );
    const row = existing.rows[0];
    if (!row || row.notified_at) return;
    if (row.fit_score === null || row.fit_score === undefined || Number(row.fit_score) < 80) return;
    if (!row.contact_email) return;

    const from = process.env.NOTIFY_FROM_EMAIL;
    const activeTransporter = getTransporter();
    if (!from || !activeTransporter) return;

    await activeTransporter.sendMail({
      from,
      to: row.contact_email,
      subject: SUBJECT,
      text: buildBody(row.name, row.fit_score),
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
