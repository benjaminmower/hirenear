import { Suspense, lazy, useState } from 'react';
import SearchPanel from './components/SearchPanel.jsx';
import { MatchConfirmPage, MatchPage } from './components/MatchPages.jsx';
import ScoutPanel from './components/ScoutPanel.jsx';
import { useScout } from './hooks/useScout.js';

const Map = lazy(() => import('./components/Map.jsx'));

function getMatchRoute(pathname) {
  const match = pathname.match(/^\/match\/([^/]+)(?:\/(confirm))?\/?$/);
  if (!match) return null;
  try {
    return {
      token: decodeURIComponent(match[1]),
      confirm: match[2] === 'confirm',
    };
  } catch {
    return {
      token: match[1],
      confirm: match[2] === 'confirm',
    };
  }
}

export default function App() {
  const matchRoute = getMatchRoute(window.location.pathname);
  if (matchRoute) {
    return matchRoute.confirm
      ? <MatchConfirmPage token={matchRoute.token} />
      : <MatchPage token={matchRoute.token} />;
  }

  return <ScoutApp />;
}

function ScoutApp() {
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [geoRadius, setGeoRadius] = useState(1000);
  const scout = useScout();
  const [searchPin, setSearchPin] = useState(null);

  const handlePinDrop = (lat, lng) => {
    setSelectedJob(null);
    setSelectedBusiness(null);
    setSearchPin({ lat, lng });
  };

  const scoutStats = {
    businessCount: scout.businesses.length,
    queuedCount: scout.businesses.filter(business => business.inspectionStatus === 'queued').length,
    checkedCount: scout.businesses.filter(business =>
      ['done', 'failed', 'skipped'].includes(business.inspectionStatus)
    ).length,
    strongCount: scout.businesses.filter(business => business.signalStrength === 'strong').length,
    status: scout.run?.status,
  };
  const showScoutSetup = !scout.run?.id && !scout.loading;

  return (
    <div style={styles.app}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.logo}>
          <span style={styles.logoMark} />
          <span style={styles.logoStack}>
            <span style={styles.logoText}>Hire Near</span>
            <span style={styles.logoTagline}>Recruiting intelligence</span>
          </span>
        </div>
        <SearchPanel
          searchPin={searchPin}
          scoutStats={scoutStats}
        />
      </header>

      {/* Body */}
      <div style={styles.body}>
        {/* Sidebar */}
        <aside style={{ ...styles.sidebar, ...(showScoutSetup ? styles.setupSidebar : {}) }}>
          <ScoutPanel
            scout={scout}
            searchPin={searchPin}
            radius={geoRadius}
            onRadiusChange={setGeoRadius}
            selectedBusiness={selectedBusiness}
            onSelectBusiness={setSelectedBusiness}
          />
        </aside>

        {/* Map */}
        <main style={styles.mapContainer}>
          <Suspense fallback={<div style={styles.mapFallback}>Loading map...</div>}>
            <Map
              mode="scout"
              jobs={[]}
              businesses={scout.businesses}
              searchCenter={searchPin}
              selectedJob={selectedJob}
              selectedBusiness={selectedBusiness}
              searchPin={searchPin}
              onSelectJob={setSelectedJob}
              onSelectBusiness={setSelectedBusiness}
              onPinDrop={handlePinDrop}
            />
          </Suspense>
        </main>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 0.55; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.15); } }
        input:hover, input:focus { border-color: #b56d2a !important; }
        select:hover, select:focus { border-color: #b56d2a !important; }
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
    background: '#f7f8f5',
  },
  header: {
    minHeight: 68,
    background: '#ffffff',
    borderBottom: '1px solid #d9d3c9',
    display: 'flex',
    alignItems: 'center',
    padding: '0 22px',
    gap: 20,
    flexShrink: 0,
    boxShadow: '0 8px 22px rgba(24, 32, 51, 0.06)',
    zIndex: 2,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    flexShrink: 0,
    minWidth: 188,
  },
  logoMark: {
    width: 22,
    height: 22,
    border: '2px solid #182033',
    borderRadius: '50%',
    boxShadow: 'inset 0 0 0 5px #ffffff, inset 0 0 0 7px #b56d2a',
    background: '#182033',
    display: 'inline-block',
  },
  logoStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  logoText: {
    fontFamily: 'Georgia, "Times New Roman", serif',
    fontSize: 22,
    fontWeight: 800,
    color: '#182033',
    lineHeight: 1,
  },
  logoTagline: {
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontSize: 10,
    fontWeight: 800,
    color: '#8b8173',
    textTransform: 'uppercase',
  },
  body: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  sidebar: {
    width: 'var(--panel-width)',
    background: '#f7f8f5',
    borderRight: '1px solid #d9d3c9',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    flexShrink: 0,
  },
  setupSidebar: {
    width: 'min(560px, 44vw)',
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  mapFallback: {
    width: '100%',
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg)',
    color: 'var(--text-secondary)',
    fontSize: 13,
  },
};
