import nodemailer from 'nodemailer';
import { query } from './db.js';

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

let transporter = null;
let transporterKey = '';

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

export async function sendBusinessNotifications(runId) {
  const smtpConfig = getSmtpConfig();
  if (!smtpConfig) {
    console.warn(`[notifier] SMTP not configured; skipping run ${runId}`);
    return;
  }

  const result = await query(
    `SELECT id, business_name, business_contact_email, seeker_email, fit_score
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
    try {
      await smtp.sendMail({
        from: smtpConfig.from,
        to: row.business_contact_email,
        replyTo: row.seeker_email,
        subject: `Someone wants to work at ${row.business_name}`,
        text: `Hi ${row.business_name},

Someone scouted your location on Hirenear and scored ${row.fit_score}% fit for your business. They're interested in hearing from you.

Reply to this email to connect with them directly.

— Hirenear`,
      });

      await query(
        `UPDATE scout_interest
         SET notified_at = now()
         WHERE id = $1`,
        [row.id]
      );
    } catch (err) {
      console.error(`[notifier] Failed to send notification for scout_interest ${row.id}:`, err.message);
    }
  }
}
