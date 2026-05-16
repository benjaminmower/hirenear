export default function JobList({
  jobs,
  mappableJobs,
  unmappableJobs,
  businesses = [],
  checkedBusinessCount = 0,
  mode = 'keyword',
  selectedJob,
  selectedBusiness,
  onSelectJob,
  onSelectBusiness,
  loading,
  error,
}) {
  if (loading) return (
    <div style={styles.empty}>
      <div style={styles.spinner} />
      <p style={styles.emptyText}>{mode === 'geo' ? 'Searching nearby businesses...' : 'Searching jobs...'}</p>
    </div>
  );

  if (error) return (
    <div style={styles.empty}>
      <p style={{ color: 'var(--red)', fontSize: 13 }}>⚠ {error}</p>
    </div>
  );

  if (mode === 'geo') {
    if (businesses.length === 0) return (
      <div style={styles.empty}>
        <p style={styles.emptyText}>Search Salt Lake City to find nearby businesses</p>
      </div>
    );

    const hiringCount = businesses.filter(business => business.hasJobs).length;

    return (
      <div style={styles.container}>
        <div style={styles.stats}>
          <span style={styles.stat}>{businesses.length} businesses</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>·</span>
          <span style={styles.stat}>{hiringCount} hiring</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>·</span>
          <span style={styles.stat}>{checkedBusinessCount} checked</span>
        </div>

        <div style={styles.list}>
          {businesses.map(business => (
            <BusinessCard
              key={business.placeId}
              business={business}
              selected={selectedBusiness?.placeId === business.placeId}
              onSelect={() => onSelectBusiness(selectedBusiness?.placeId === business.placeId ? null : business)}
            />
          ))}
        </div>
      </div>
    );
  }

  if (jobs.length === 0) return (
    <div style={styles.empty}>
      <p style={styles.emptyText}>Search for jobs above to see them on the map</p>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
        Try: "software engineer", "product manager NYC", "data scientist remote"
      </p>
    </div>
  );

  return (
    <div style={styles.container}>
      <div style={styles.stats}>
        <span style={styles.stat}>{jobs.length} results</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>·</span>
        <span style={styles.stat}>{mappableJobs.length} on map</span>
        {unmappableJobs.length > 0 && (
          <span style={{ ...styles.stat, color: 'var(--text-muted)' }}>
            +{unmappableJobs.length} remote/unlocated
          </span>
        )}
      </div>

      <div style={styles.list}>
        {jobs.map(job => (
          <JobCard
            key={job.id}
            job={job}
            selected={selectedJob?.id === job.id}
            onSelect={() => onSelectJob(selectedJob?.id === job.id ? null : job)}
          />
        ))}
      </div>
    </div>
  );
}

function BusinessCard({ business, selected, onSelect }) {
  const jobs = business.jobs || [];
  const badgeText = business.hasJobs
    ? `${jobs.length} jobs found`
    : business.jobSearchStatus === 'no_jobs_found'
      ? 'No jobs found'
      : 'Not checked';

  return (
    <div
      onClick={onSelect}
      style={{
        ...styles.card,
        ...(selected ? styles.cardSelected : {}),
        ...(!business.hasJobs ? styles.cardRemote : {}),
      }}
    >
      <div style={styles.cardHeader}>
        <span style={styles.title}>{business.name}</span>
        {business.hasJobs ? (
          <span style={styles.badge}>{badgeText}</span>
        ) : (
          <span style={styles.badgeGray}>{badgeText}</span>
        )}
      </div>
      <div style={styles.company}>{business.vicinity}</div>
      <div style={styles.meta}>
        {business.rating && <span style={styles.location}>★ {business.rating}</span>}
        <span style={styles.location}>{business.userRatingsTotal || 0} ratings</span>
      </div>
      {selected && jobs.length > 0 && (
        <div style={styles.nestedJobs}>
          {jobs.map(job => (
            <div key={job.id} style={styles.nestedJob}>
              <div style={styles.nestedTitle}>{job.title}</div>
              <div style={styles.postedAt}>{job.location || job.via}</div>
              {job.applyLink && (
                <a
                  href={job.applyLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  style={styles.applyLink}
                >
                  Apply →
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function JobCard({ job, selected, onSelect }) {
  return (
    <div
      onClick={onSelect}
      style={{
        ...styles.card,
        ...(selected ? styles.cardSelected : {}),
        ...(!job.hasCoords ? styles.cardRemote : {}),
      }}
    >
      <div style={styles.cardHeader}>
        <span style={styles.title}>{job.title}</span>
        {job.workType === 'Remote' && <span style={styles.badge}>Remote</span>}
        {!job.hasCoords && job.workType !== 'Remote' && <span style={styles.badgeGray}>Unlocated</span>}
      </div>
      <div style={styles.company}>{job.company}</div>
      <div style={styles.meta}>
        <span style={styles.location}>◎ {job.location}</span>
        {job.salary && <span style={styles.salary}>💰 {job.salary}</span>}
      </div>
      {job.postedAt && <div style={styles.postedAt}>{job.postedAt} · via {job.via}</div>}
      {job.applyLink && (
        <a
          href={job.applyLink}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={styles.applyLink}
        >
          Apply →
        </a>
      )}
    </div>
  );
}

const styles = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },
  stats: {
    display: 'flex',
    gap: 8,
    padding: '10px 14px',
    borderBottom: '1px solid var(--border)',
    alignItems: 'center',
    flexShrink: 0,
  },
  stat: { fontSize: 12, color: 'var(--text-secondary)' },
  list: { overflowY: 'auto', flex: 1, padding: '8px 0' },
  card: {
    padding: '12px 14px',
    borderBottom: '1px solid var(--border)',
    cursor: 'pointer',
    transition: 'background 0.1s',
    borderLeft: '3px solid transparent',
  },
  cardSelected: {
    background: 'var(--accent-dim)',
    borderLeft: '3px solid var(--accent)',
  },
  cardRemote: { opacity: 0.7 },
  cardHeader: { display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 4 },
  title: { fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', flex: 1, lineHeight: 1.3 },
  badge: {
    fontSize: 10, background: 'var(--green-dim)', color: 'var(--green)',
    padding: '1px 6px', borderRadius: 4, flexShrink: 0, fontWeight: 500,
  },
  badgeGray: {
    fontSize: 10, background: 'var(--bg-card)', color: 'var(--text-muted)',
    padding: '1px 6px', borderRadius: 4, flexShrink: 0,
  },
  company: { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 },
  meta: { display: 'flex', gap: 10, alignItems: 'center', marginBottom: 4 },
  location: { fontSize: 11, color: 'var(--text-muted)' },
  salary: { fontSize: 11, color: 'var(--green)' },
  postedAt: { fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 },
  applyLink: {
    display: 'inline-block',
    fontSize: 11, color: 'var(--accent)',
    textDecoration: 'none', border: '1px solid var(--accent)',
    padding: '2px 8px', borderRadius: 4, marginTop: 2,
  },
  nestedJobs: {
    marginTop: 10,
    borderTop: '1px solid var(--border)',
    paddingTop: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  nestedJob: {
    paddingLeft: 8,
    borderLeft: '2px solid var(--accent)',
  },
  nestedTitle: {
    fontSize: 12,
    color: 'var(--text-primary)',
    lineHeight: 1.35,
    marginBottom: 3,
  },
  empty: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: '100%', padding: 24, textAlign: 'center',
  },
  emptyText: { fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 },
  spinner: {
    width: 24, height: 24, borderRadius: '50%',
    border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
    animation: 'spin 0.8s linear infinite', marginBottom: 12,
  },
};
