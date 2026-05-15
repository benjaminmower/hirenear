import { useState } from 'react';
import Map from './components/Map.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import JobList from './components/JobList.jsx';
import { useJobs } from './hooks/useJobs.js';

export default function App() {
  const [selectedJob, setSelectedJob] = useState(null);
  const { jobs, mappableJobs, unmappableJobs, loading, error, search } = useJobs();

  const handleSearch = (params) => {
    setSelectedJob(null);
    search(params);
  };

  return (
    <div style={styles.app}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoMark}>⬡</span>
          <span style={styles.logoText}>jobmap</span>
          <span style={styles.logoTagline}>find jobs on a map</span>
        </div>
        <SearchPanel onSearch={handleSearch} loading={loading} />
        <a
          href="https://github.com/yourusername/jobmap"
          target="_blank"
          rel="noopener"
          style={styles.ghLink}
        >
          ★ GitHub
        </a>
      </header>

      {/* Body */}
      <div style={styles.body}>
        {/* Sidebar */}
        <aside style={styles.sidebar}>
          <JobList
            jobs={jobs}
            mappableJobs={mappableJobs}
            unmappableJobs={unmappableJobs}
            selectedJob={selectedJob}
            onSelectJob={setSelectedJob}
            loading={loading}
            error={error}
          />
        </aside>

        {/* Map */}
        <main style={styles.mapContainer}>
          <Map
            jobs={mappableJobs}
            selectedJob={selectedJob}
            onSelectJob={setSelectedJob}
          />
        </main>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input:hover, input:focus { border-color: var(--accent) !important; }
        select:hover, select:focus { border-color: var(--accent) !important; }
        button:hover:not(:disabled) { opacity: 0.85; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        .job-card:hover { background: var(--bg-hover); }
      `}</style>
    </div>
  );
}

const styles = {
  app: {
    display: 'flex',
    flexDirection: 'column',
    height: '100dvh',
    background: 'var(--bg)',
  },
  header: {
    height: 'var(--header-height)',
    background: 'var(--bg-panel)',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    padding: '0 16px',
    gap: 12,
    flexShrink: 0,
  },
  logo: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    flexShrink: 0,
  },
  logoMark: {
    fontSize: 20,
    color: 'var(--accent)',
  },
  logoText: {
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text-primary)',
    letterSpacing: '-0.02em',
  },
  logoTagline: {
    fontSize: 11,
    color: 'var(--text-muted)',
    display: 'none', // hidden on small screens
  },
  ghLink: {
    fontSize: 12,
    color: 'var(--text-secondary)',
    textDecoration: 'none',
    flexShrink: 0,
    padding: '6px 10px',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    transition: 'color 0.15s',
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  sidebar: {
    width: 'var(--panel-width)',
    background: 'var(--bg-panel)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    flexShrink: 0,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
};
