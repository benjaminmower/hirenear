import { Resend } from 'resend';
import { query } from './db.js';
import { logError, logInfo, logWarn } from './logger.js';

const QUALIFIED_SUBJECT = "Someone qualified is asking if you're hiring";
const BUSINESS_SIGNUP_TO = 'hello@hirenear.app';

let resendClient = null;

function getBaseUrl() {
  return (process.env.BASE_URL || 'http://localhost:5173').replace(/\/+$/, '');
}

function getResendConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.NOTIFY_FROM_EMAIL;
  const replyTo = process.env.REPLY_TO_EMAIL || 'hello@hirenear.app';

  if (!apiKey || !from) {
    return null;
  }

  return { apiKey, from, replyTo };
}

function getResend(config) {
  if (!resendClient) {
    resendClient = new Resend(config.apiKey);
  }
  return resendClient;
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

- Hirenear

---
To stop receiving these emails, reply with UNSUBSCRIBE.
Hire Near, Salt Lake City, Utah`;
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

- Hirenear

---
To stop receiving these emails, reply with UNSUBSCRIBE.
Hire Near, Salt Lake City, Utah`;
}

function buildBusinessSignupBody(signup) {
  return `New Hire Near business signup

Business: ${signup.businessName}
Contact: ${signup.contactName}
Email: ${signup.email}
Location: ${signup.city}, ${signup.state}
Hiring categories: ${(signup.hiringCategories || []).join(', ') || 'None provided'}
Current hiring channel: ${signup.currentHiringChannel || 'Not provided'}
Hires per year: ${signup.hiresPerYear || 'Not provided'}
Source: ${signup.source || 'Not provided'}

Follow up within 48 hours.`;
}

export async function sendBusinessSignupAlert(signup) {
  const resendConfig = getResendConfig();
  if (!resendConfig) {
    logWarn('business_signup_alert_skipped', { reason: 'resend_not_configured', email: signup?.email });
    return { configured: false, sent: false, reason: 'resend_not_configured' };
  }

  try {
    const resend = getResend(resendConfig);
    await resend.emails.send({
      from: resendConfig.from,
      to: BUSINESS_SIGNUP_TO,
      replyTo: signup.email || resendConfig.replyTo,
      subject: `New business signup: ${signup.businessName}`,
      text: buildBusinessSignupBody(signup),
    });
    logInfo('business_signup_alert_sent', {
      businessName: signup.businessName,
      email: signup.email,
      city: signup.city,
      state: signup.state,
    });
    return { configured: true, sent: true };
  } catch (err) {
    logError('business_signup_alert_failed', { businessName: signup?.businessName, email: signup?.email, error: err });
    return { configured: true, sent: false, reason: 'send_failed' };
  }
}

export async function sendBusinessNotifications(runId) {
  const resendConfig = getResendConfig();
  if (!resendConfig) {
    logWarn('interest_notifications_skipped', { runId, reason: 'resend_not_configured' });
    return { configured: false, attempted: 0, sent: 0, seekerFollowupsSent: 0, failed: 0, reason: 'resend_not_configured' };
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

  if (result.rowCount === 0) {
    logInfo('interest_notifications_empty', { runId });
    return { configured: true, attempted: 0, sent: 0, seekerFollowupsSent: 0, failed: 0 };
  }

  const resend = getResend(resendConfig);
  logInfo('interest_notifications_started', { runId, count: result.rowCount });
  const summary = {
    configured: true,
    attempted: result.rowCount,
    sent: 0,
    seekerFollowupsSent: 0,
    failed: 0,
  };

  for (const row of result.rows) {
    const matchUrl = `${getBaseUrl()}/match/${encodeURIComponent(row.match_token)}`;
    const confirmUrl = `${matchUrl}/confirm`;

    try {
      await resend.emails.send({
        from: resendConfig.from,
        to: row.business_contact_email,
        replyTo: resendConfig.replyTo,
        subject: QUALIFIED_SUBJECT,
        text: buildBusinessLeadBody(row.business_name, row.fit_score, matchUrl),
      });

      await query(
        `UPDATE scout_interest
         SET notified_at = now()
         WHERE id = $1`,
        [row.id]
      );
      logInfo('interest_business_notification_sent', {
        runId,
        scoutInterestId: row.id,
        businessName: row.business_name,
        fitScore: row.fit_score,
      });
      summary.sent += 1;

      try {
        await resend.emails.send({
          from: resendConfig.from,
          to: row.seeker_email,
          replyTo: resendConfig.replyTo,
          subject: 'A business may reach out to you soon',
          text: `Hi,

You expressed interest in ${row.business_name} on Hirenear. We've let them know.

If they reach out, did it go well? Let us know:
${confirmUrl}

- Hirenear`,
        });
        logInfo('interest_seeker_followup_sent', { runId, scoutInterestId: row.id });
        summary.seekerFollowupsSent += 1;
      } catch (err) {
        logError('interest_seeker_followup_failed', { runId, scoutInterestId: row.id, error: err });
      }
    } catch (err) {
      summary.failed += 1;
      logError('interest_business_notification_failed', { runId, scoutInterestId: row.id, error: err });
    }
  }
  return summary;
}

export async function notifyBusinessIfQualified(business) {
  try {
    const businessId = business?.id;
    if (!businessId) return;

    const fitScore = readFitScore(business);
    if (!Number.isFinite(fitScore) || fitScore < 80) {
      logInfo('qualified_business_notification_skipped', { businessId, reason: 'fit_score_below_threshold', fitScore });
      return;
    }

    const contactEmail = business.contactEmail || business.contact_email;
    if (!contactEmail) {
      logInfo('qualified_business_notification_skipped', { businessId, reason: 'missing_contact_email', fitScore });
      return;
    }

    const existing = await query(
      'SELECT id, name, fit_score, contact_email, notified_at, match_summary, match_signals FROM scout_businesses WHERE id = $1',
      [businessId]
    );
    const row = existing.rows[0];
    if (!row) {
      logWarn('qualified_business_notification_skipped', { businessId, reason: 'business_not_found' });
      return;
    }
    if (row.notified_at) {
      logInfo('qualified_business_notification_skipped', { businessId, reason: 'already_notified' });
      return;
    }
    if (row.fit_score === null || row.fit_score === undefined || readFitScore(row) < 80) {
      logInfo('qualified_business_notification_skipped', { businessId, reason: 'stored_fit_score_below_threshold', fitScore: readFitScore(row) });
      return;
    }
    if (!row.contact_email) {
      logInfo('qualified_business_notification_skipped', { businessId, reason: 'stored_contact_email_missing' });
      return;
    }

    const resendConfig = getResendConfig();
    if (!resendConfig) {
      logWarn('qualified_business_notification_skipped', { businessId, reason: 'resend_not_configured' });
      return;
    }

    const signals = Array.isArray(row.match_signals)
      ? row.match_signals
        .filter(item => item && typeof item.label === 'string' && item.label.trim() && item.weight === 'positive')
        .map(item => ({ label: item.label.trim(), weight: 'positive' }))
      : [];
    const hasSignals = signals.length > 0;
    const hasSummary = typeof row.match_summary === 'string' && row.match_summary.trim();
    const matchUrl = `${getBaseUrl()}/for-businesses`;

    const resend = getResend(resendConfig);
    await resend.emails.send({
      from: resendConfig.from,
      to: row.contact_email,
      replyTo: resendConfig.replyTo,
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
    logInfo('qualified_business_notification_sent', {
      businessId,
      businessName: row.name,
      fitScore: row.fit_score,
      signalCount: signals.length,
      hasSummary,
    });
  } catch (err) {
    logError('qualified_business_notification_failed', { businessId: business?.id, error: err });
  }
}
