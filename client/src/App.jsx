import { Suspense, lazy, useRef, useState } from 'react';
import ForBusinessesPage from './components/ForBusinessesPage.jsx';
import PrivacyPage from './components/PrivacyPage.jsx';
import SearchPanel from './components/SearchPanel.jsx';
import { MatchConfirmPage, MatchPage } from './components/MatchPages.jsx';
import ScoutPanel from './components/ScoutPanel.jsx';
import TermsPage from './components/TermsPage.jsx';
import { useMediaQuery } from './hooks/useMediaQuery.js';
import { useScout } from './hooks/useScout.js';

const Map = lazy(() => import('./components/Map.jsx'));

function coordinateLabel(lat, lng) {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function labelFromMapboxFeature(feature) {
  if (!feature) return '';

  const context = feature.context || [];
  const place = context.find(item => item.id?.startsWith('place.'))?.text;
  const region = context.find(item => item.id?.startsWith('region.'));
  const stateCode = region?.short_code?.replace('US-', '');
  const type = feature.place_type?.[0];

  if (type === 'neighborhood' || type === 'locality' || type === 'district') {
    return [feature.text, place].filter(Boolean).join(', ');
  }

  return [feature.text, stateCode].filter(Boolean).join(', ');
}

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
  const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/';

  if (normalizedPath === '/for-businesses') {
    return <ForBusinessesPage />;
  }

  if (normalizedPath === '/privacy') {
    return <PrivacyPage />;
  }

  if (normalizedPath === '/terms') {
    return <TermsPage />;
  }

  const matchRoute = getMatchRoute(window.location.pathname);
  if (matchRoute) {
    return matchRoute.confirm
      ? <MatchConfirmPage token={matchRoute.token} />
      : <MatchPage token={matchRoute.token} />;
  }

  return <ScoutApp />;
}

function ScoutApp() {
  const isMobile = useMediaQuery('(max-width: 700px)');
  const [selectedJob, setSelectedJob] = useState(null);
  const [selectedBusiness, setSelectedBusiness] = useState(null);
  const [geoRadius, setGeoRadius] = useState(1609);
  const scout = useScout();
  const [searchPin, setSearchPin] = useState(null);
  const [searchLocationLabel, setSearchLocationLabel] = useState('');
  const pinRequestRef = useRef(0);
  const [scoutOpen, setScoutOpen] = useState(scout.run?.id || false);

  const handlePinDrop = (lat, lng) => {
    const requestId = pinRequestRef.current + 1;
    pinRequestRef.current = requestId;
    setSelectedJob(null);
    setSelectedBusiness(null);
    setSearchPin({ lat, lng });
    setSearchLocationLabel('Resolving area...');

    fetch(`/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`)
      .then(res => res.ok ? res.json() : null)
      .then(async data => {
        if (pinRequestRef.current !== requestId) return;
        if (data?.locationLabel) {
          setSearchLocationLabel(data.locationLabel);
          return;
        }

        const mapboxToken = window.HIRENEAR_CONFIG?.mapboxToken || import.meta.env.VITE_MAPBOX_TOKEN;
        if (!mapboxToken) {
          setSearchLocationLabel(coordinateLabel(lat, lng));
          return;
        }

        const params = new URLSearchParams({
          access_token: mapboxToken,
          types: 'neighborhood,locality,place,district,region',
          limit: '1',
        });
        const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?${params}`);
        const mapboxData = await res.json();
        if (pinRequestRef.current !== requestId) return;
        setSearchLocationLabel(labelFromMapboxFeature(mapboxData.features?.[0]) || coordinateLabel(lat, lng));
      })
      .catch(() => {
        if (pinRequestRef.current === requestId) setSearchLocationLabel(coordinateLabel(lat, lng));
      });
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

  return (
    <div style={styles.app}>
      {/* Header */}
      <header style={{ ...styles.header, ...(isMobile ? styles.headerMobile : {}) }}>
        <div style={{ ...styles.logo, ...(isMobile ? styles.logoMobile : {}) }}>
          <span style={styles.logoMark} />
          <span style={styles.logoStack}>
            <span style={styles.logoText}>Hire Near</span>
            <span style={styles.logoTagline}>Recruiting intelligence</span>
          </span>
        </div>
        <SearchPanel
          searchPin={searchPin}
          locationLabel={searchLocationLabel}
          scoutStats={scoutStats}
        />
      </header>

      {/* Body */}
      <div style={styles.body}>
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
              locationLabel={searchLocationLabel}
              onSelectJob={setSelectedJob}
              onSelectBusiness={setSelectedBusiness}
              onPinDrop={handlePinDrop}
              onScoutOpen={() => setScoutOpen(true)}
            />
          </Suspense>

          {/* Scout trigger button */}
          {(!searchPin || scout.run?.id) && (
            <button
              style={{ ...styles.scoutTrigger, ...(isMobile ? styles.scoutTriggerMobile : {}) }}
              onClick={() => setScoutOpen(true)}
            >
              {scout.run?.id ? 'View scout run' : 'Scout this area'}
            </button>
          )}

          {/* Footer */}
          <footer style={styles.footer}>
            <a href="/privacy" style={styles.footerLink}>Privacy</a>
            <a href="/terms" style={styles.footerLink}>Terms</a>
            <a href="/for-businesses" style={styles.footerLink}>For Businesses</a>
          </footer>
        </main>
      </div>

      {/* Scout modal */}
      {scoutOpen && (
        <ScoutPanel
          scout={scout}
          searchPin={searchPin}
          locationLabel={searchLocationLabel}
          radius={geoRadius}
          onRadiusChange={setGeoRadius}
          selectedBusiness={selectedBusiness}
          onSelectBusiness={setSelectedBusiness}
          onClose={() => setScoutOpen(false)}
        />
      )}

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
  headerMobile: {
    minHeight: 82,
    alignItems: 'flex-start',
    flexDirection: 'column',
    justifyContent: 'center',
    padding: '12px 14px',
    gap: 8,
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 11,
    flexShrink: 0,
    minWidth: 188,
  },
  logoMobile: {
    minWidth: 0,
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
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  scoutTrigger: {
    position: 'fixed',
    bottom: 24,
    left: 24,
    zIndex: 50,
    background: '#182033',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    padding: '12px 16px',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    boxShadow: '0 8px 24px rgba(24, 32, 51, 0.2)',
    fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  scoutTriggerMobile: {
    left: 14,
    right: 14,
    bottom: 14,
    width: 'auto',
    padding: '14px 16px',
    textAlign: 'center',
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
  footer: {
    position: 'fixed',
    bottom: 24,
    right: 24,
    display: 'flex',
    gap: 14,
    fontSize: 12,
    zIndex: 50,
  },
  footerLink: {
    color: '#8b8173',
    textDecoration: 'none',
    fontWeight: 600,
  },
};
