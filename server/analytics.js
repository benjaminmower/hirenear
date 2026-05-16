import { query } from './db.js';

function formatRate(numerator, denominator) {
  if (!denominator) return '0%';
  return `${Math.round((numerator / denominator) * 100)}%`;
}

export async function getFunnelStats() {
  const result = await query(
    `SELECT
       COUNT(*)::int AS total_interests,
       COUNT(*) FILTER (WHERE notified_at IS NOT NULL)::int AS notified,
       COUNT(*) FILTER (WHERE opened_at IS NOT NULL)::int AS opened,
       COUNT(*) FILTER (WHERE contacted_at IS NOT NULL)::int AS contacted,
       COUNT(*) FILTER (WHERE seeker_confirmed_at IS NOT NULL)::int AS seeker_confirmed
     FROM scout_interest`
  );

  const row = result.rows[0] || {};
  const totalInterests = Number(row.total_interests || 0);
  const notified = Number(row.notified || 0);
  const opened = Number(row.opened || 0);
  const contacted = Number(row.contacted || 0);
  const seekerConfirmed = Number(row.seeker_confirmed || 0);

  return {
    totalInterests,
    notified,
    opened,
    contacted,
    seekerConfirmed,
    notificationOpenRate: formatRate(opened, notified),
    openToContactRate: formatRate(contacted, opened),
    contactToConfirmRate: formatRate(seekerConfirmed, contacted),
  };
}
