export default function SearchPanel({
  searchPin,
  scoutStats,
}) {
  const productDescription = 'A new way to job search: walk the neighborhood, choose who to visit, and decide where you want to apply.';
  const scoutStatus = scoutStats?.status === 'complete'
    ? `${scoutStats.strongCount} strong signals from ${scoutStats.businessCount} places`
    : scoutStats?.status === 'running'
      ? `${scoutStats.checkedCount} checked · ${scoutStats.queuedCount} still queued`
      : searchPin
        ? 'Area selected · complete the search brief'
        : productDescription;

  return (
    <div style={styles.panel}>
      <div style={styles.statusGroup}>
        <span style={styles.status}>{scoutStatus}</span>
        {scoutStats?.status === 'running' && <span style={styles.liveDot} aria-label="Scout running" />}
      </div>
    </div>
  );
}

const styles = {
  panel: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  statusGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
  },
  status: {
    color: '#4d5665',
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.4,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#18794e',
    boxShadow: '0 0 0 4px #e5f4ec',
    flexShrink: 0,
  },
};
