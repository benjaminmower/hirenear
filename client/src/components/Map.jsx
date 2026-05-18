import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { useMediaQuery } from '../hooks/useMediaQuery.js';

mapboxgl.accessToken = window.HIRENEAR_CONFIG?.mapboxToken || import.meta.env.VITE_MAPBOX_TOKEN;

const SALT_LAKE_CITY = {
  lat: 40.7608,
  lng: -111.8910,
};

const CLUSTER_PAINT = {
  'circle-color': [
    'step', ['get', 'point_count'],
    '#4f7cff', 5, '#7a9fff', 20, '#36d399'
  ],
  'circle-radius': ['step', ['get', 'point_count'], 20, 5, 28, 20, 36],
  'circle-opacity': 0.9,
};

const SCOUT_LEGEND = [
  { label: 'Queued', color: '#8b91a8' },
  { label: 'Checking', color: '#fbbd23' },
  { label: 'Strong', color: '#36d399' },
  { label: 'Contact', color: '#4f7cff' },
  { label: 'Skipped', color: '#ffffff' },
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function jobPopupHtml(job) {
  return `
    <div style="font-family: monospace;">
      <div style="font-size:13px; font-weight:600; color:#e8eaf0; margin-bottom:4px; line-height:1.3">${escapeHtml(job.title)}</div>
      <div style="font-size:12px; color:#8b91a8; margin-bottom:8px">${escapeHtml(job.company)} · ${escapeHtml(job.location)}</div>
      ${job.salary ? `<div style="font-size:12px; color:#36d399; margin-bottom:6px">Salary: ${escapeHtml(job.salary)}</div>` : ''}
      ${job.workType ? `<div style="font-size:12px; color:#4f7cff">${escapeHtml(job.workType)}</div>` : ''}
      ${job.applyLink ? `<a href="${escapeHtml(job.applyLink)}" target="_blank" rel="noopener" style="display:inline-block; margin-top:10px; font-size:11px; color:#4f7cff; text-decoration:none; border:1px solid #4f7cff; padding:3px 10px; border-radius:4px;">Apply</a>` : ''}
    </div>
  `;
}

function businessPopupHtml(business) {
  if ('signalStrength' in business || 'inspectionStatus' in business) {
    const evidenceUrl = (business.evidence || []).find(item => item.url)?.url;
    const primaryUrl = evidenceUrl || business.website;
    const primaryLabel = evidenceUrl ? 'View hiring page' : 'View website';
    const signal = business.inspectionStatus === 'checking' ? 'Checking website' : {
      strong: 'Strong hiring signal',
      weak: 'Contact path found',
      none: 'No hiring signal found',
      failed: 'Inspection failed',
      queued: 'Queued',
    }[business.signalStrength] || 'Queued';

    return `
      <div style="font-family: monospace;">
        <div style="font-size:13px; font-weight:600; color:#e8eaf0; margin-bottom:4px; line-height:1.3">${escapeHtml(business.name)}</div>
        <div style="font-size:12px; color:#8b91a8; margin-bottom:8px">${escapeHtml(business.vicinity)}</div>
        <div style="font-size:12px; color:#36d399; margin-bottom:6px">Fit: ${escapeHtml(business.fitScore ?? '--')}</div>
        <div style="font-size:12px; color:#7a9fff; margin-bottom:6px">${escapeHtml(signal)}</div>
        ${business.fitReason ? `<div style="font-size:11px; color:#8b91a8; line-height:1.4; margin-bottom:8px">${escapeHtml(business.fitReason)}</div>` : ''}
        ${primaryUrl ? `<a href="${escapeHtml(primaryUrl)}" target="_blank" rel="noopener" style="font-size:11px; color:#4f7cff; text-decoration:none;">${escapeHtml(primaryLabel)}</a>` : ''}
      </div>
    `;
  }

  const jobs = business.jobs || [];
  const statusText = business.hasJobs
    ? `${jobs.length} jobs found`
    : business.jobSearchStatus === 'no_jobs_found'
      ? 'No jobs found in checked sources'
      : 'Job search not checked yet';
  const jobList = jobs.slice(0, 5).map(job => `
    <div style="border-top:1px solid #2e3349; padding-top:7px; margin-top:7px;">
      <div style="font-size:12px; color:#e8eaf0; line-height:1.3">${escapeHtml(job.title)}</div>
      <div style="font-size:11px; color:#8b91a8; margin-top:2px">${escapeHtml(job.location || job.via || '')}</div>
      ${job.applyLink ? `<a href="${escapeHtml(job.applyLink)}" target="_blank" rel="noopener" style="display:inline-block; margin-top:6px; font-size:11px; color:#4f7cff; text-decoration:none;">Apply</a>` : ''}
    </div>
  `).join('');

  return `
    <div style="font-family: monospace;">
      <div style="font-size:13px; font-weight:600; color:#e8eaf0; margin-bottom:4px; line-height:1.3">${escapeHtml(business.name)}</div>
      <div style="font-size:12px; color:#8b91a8; margin-bottom:8px">${escapeHtml(business.vicinity)}</div>
      <div style="font-size:12px; color:${business.hasJobs ? '#4f7cff' : '#fbbd23'}">${escapeHtml(statusText)}</div>
      ${jobList}
    </div>
  `;
}

export default function Map({
  mode = 'keyword',
  jobs,
  businesses = [],
  searchCenter,
  selectedJob,
  selectedBusiness,
  searchPin,
  locationLabel = '',
  onSelectJob,
  onSelectBusiness,
  onPinDrop,
  onScoutOpen,
}) {
  const isMobile = useMediaQuery('(max-width: 700px)');
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const modeRef = useRef(mode);
  const onPinDropRef = useRef(onPinDrop);
  const onScoutOpenRef = useRef(onScoutOpen);
  const debounceTimerRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [pinScreenPos, setPinScreenPos] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSuggestions, setSearchSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { onPinDropRef.current = onPinDrop; }, [onPinDrop]);
  useEffect(() => { onScoutOpenRef.current = onScoutOpen; }, [onScoutOpen]);

  // Search city with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    const handleSearch = async () => {
      const mapboxToken = window.HIRENEAR_CONFIG?.mapboxToken || import.meta.env.VITE_MAPBOX_TOKEN;
      if (!mapboxToken) return;

      const params = new URLSearchParams({
        access_token: mapboxToken,
        types: 'place,locality,district,region',
        limit: '5',
      });

      try {
        const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?${params}`);
        const data = await res.json();
        if (data.features) {
          setSearchSuggestions(data.features.map(f => ({
            id: f.id,
            place_name: f.place_name,
            center: f.center,
          })));
          setShowSuggestions(true);
        }
      } catch (err) {
        console.error('Geocoding error:', err);
      }
    };

    clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(handleSearch, 300);

    return () => clearTimeout(debounceTimerRef.current);
  }, [searchQuery]);

  // Init map
  useEffect(() => {
    if (mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [SALT_LAKE_CITY.lng, SALT_LAKE_CITY.lat],
      zoom: 11,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      // Source
      map.addSource('jobs', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
        cluster: true,
        clusterMaxZoom: 8,
        clusterRadius: 50,
      });

      map.addSource('businesses', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      map.addSource('search-pin', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });

      // Clusters
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'jobs',
        filter: ['has', 'point_count'],
        paint: CLUSTER_PAINT,
      });

      // Cluster count labels
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'jobs',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
          'text-size': 13,
        },
        paint: { 'text-color': '#fff' },
      });

      // Individual job pins
      map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: 'jobs',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['case',
            ['boolean', ['feature-state', 'selected'], false], '#ffffff',
            '#4f7cff'
          ],
          'circle-radius': 8,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#4f7cff',
          'circle-opacity': 0.95,
        },
      });

      map.addLayer({
        id: 'business-pins',
        type: 'circle',
        source: 'businesses',
        filter: ['!=', ['get', 'hasJobs'], true],
        paint: {
          'circle-color': ['case',
            ['==', ['get', 'inspectionStatus'], 'skipped'], '#ffffff',
            ['==', ['get', 'inspectionStatus'], 'checking'], '#fbbd23',
            ['==', ['get', 'signalStrength'], 'strong'], '#36d399',
            ['==', ['get', 'signalStrength'], 'weak'], '#4f7cff',
            ['==', ['get', 'signalStrength'], 'failed'], '#f87272',
            ['==', ['get', 'signalStrength'], 'none'], '#cbd5e1',
            ['==', ['get', 'jobSearchStatus'], 'no_jobs_found'], '#9ca3af',
            '#8b91a8'
          ],
          'circle-radius': ['case',
            ['boolean', ['get', 'selected'], false], 11,
            ['==', ['get', 'signalStrength'], 'strong'], 10,
            7
          ],
          'circle-stroke-width': ['case',
            ['boolean', ['get', 'selected'], false], 4,
            ['==', ['get', 'inspectionStatus'], 'skipped'], 3,
            2
          ],
          'circle-stroke-color': ['case',
            ['==', ['get', 'inspectionStatus'], 'skipped'], '#8b91a8',
            '#ffffff'
          ],
          'circle-opacity': ['case',
            ['==', ['get', 'inspectionStatus'], 'skipped'], 0.78,
            0.92
          ],
        },
      });

      map.addLayer({
        id: 'hiring-pins',
        type: 'circle',
        source: 'businesses',
        filter: ['==', ['get', 'hasJobs'], true],
        paint: {
          'circle-color': ['case',
            ['boolean', ['get', 'selected'], false], '#2563eb',
            '#4f7cff'
          ],
          'circle-radius': ['case',
            ['boolean', ['get', 'selected'], false], 13,
            11
          ],
          'circle-stroke-width': ['case',
            ['boolean', ['get', 'selected'], false], 4,
            2
          ],
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.95,
        },
      });

      map.addLayer({
        id: 'hiring-counts',
        type: 'symbol',
        source: 'businesses',
        filter: ['==', ['get', 'hasJobs'], true],
        layout: {
          'text-field': ['to-string', ['get', 'jobCount']],
          'text-font': ['DIN Offc Pro Bold', 'Arial Unicode MS Bold'],
          'text-size': 11,
          'text-allow-overlap': true,
          'text-ignore-placement': true,
        },
        paint: {
          'text-color': '#ffffff',
        },
      });

      map.addLayer({
        id: 'search-pin-ring',
        type: 'circle',
        source: 'search-pin',
        paint: {
          'circle-color': '#ffffff',
          'circle-radius': 15,
          'circle-stroke-width': 3,
          'circle-stroke-color': '#111827',
          'circle-opacity': 0.95,
        },
      });

      map.addLayer({
        id: 'search-pin-dot',
        type: 'circle',
        source: 'search-pin',
        paint: {
          'circle-color': '#ef4444',
          'circle-radius': 7,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });

      // Click cluster → zoom in
      map.on('click', 'clusters', (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: ['clusters'] });
        const clusterId = features[0].properties.cluster_id;
        map.getSource('jobs').getClusterExpansionZoom(clusterId, (err, zoom) => {
          if (err) return;
          map.easeTo({ center: features[0].geometry.coordinates, zoom });
        });
      });

      // Click pin → select job
      map.on('click', 'unclustered-point', (e) => {
        const props = e.features[0].properties;
        onSelectJob(JSON.parse(props.job));
      });

      map.on('click', 'hiring-pins', (e) => {
        const props = e.features[0].properties;
        onSelectBusiness(JSON.parse(props.business));
      });

      map.on('click', 'business-pins', (e) => {
        const props = e.features[0].properties;
        onSelectBusiness(JSON.parse(props.business));
      });

      map.on('click', (e) => {
        if (modeRef.current !== 'geo' && modeRef.current !== 'scout') return;
        const hit = map.queryRenderedFeatures(e.point, {
          layers: ['business-pins', 'hiring-pins', 'hiring-counts', 'search-pin-dot', 'clusters', 'unclustered-point'],
        });
        if (hit.length > 0) return;
        onPinDropRef.current?.(e.lngLat.lat, e.lngLat.lng);
      });

      // Cursors
      ['clusters', 'unclustered-point', 'business-pins', 'hiring-pins', 'hiring-counts', 'search-pin-dot'].forEach(layer => {
        map.on('mouseenter', layer, () => map.getCanvas().style.cursor = 'pointer');
        map.on('mouseleave', layer, () => map.getCanvas().style.cursor = '');
      });

      setMapReady(true);
    });

    mapRef.current = map;

    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update job data
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const source = map.getSource('jobs');
    if (!source) return;

    const features = jobs.map(job => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [job.lng, job.lat] },
      properties: { job: JSON.stringify(job), id: job.id },
    }));

    source.setData({ type: 'FeatureCollection', features });

    // Fit bounds if we have results
    if (features.length > 0) {
      const coords = features.map(f => f.geometry.coordinates);
      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new mapboxgl.LngLatBounds(coords[0], coords[0])
      );
      map.fitBounds(bounds, { padding: 80, maxZoom: 8, duration: 800 });
    }
  }, [jobs, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || mode !== 'geo' || businesses.length > 0 || searchCenter) return;
    map.easeTo({ center: [SALT_LAKE_CITY.lng, SALT_LAKE_CITY.lat], zoom: 11, duration: 500 });
  }, [mode, businesses.length, searchCenter, mapReady]);

  // Fly to selected business during scout mode
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || mode !== 'scout' || !selectedBusiness) return;
    map.flyTo({
      center: [selectedBusiness.lng, selectedBusiness.lat],
      zoom: 15,
      duration: 1500,
    });
  }, [selectedBusiness, mode, mapReady]);

  // Update business data
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const source = map.getSource('businesses');
    if (!source) return;

    const features = businesses.map(business => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [business.lng, business.lat] },
      properties: {
        business: JSON.stringify(business),
        id: business.placeId || business.id,
        hasJobs: Boolean(business.hasJobs),
        jobCount: business.jobs?.length || 0,
        jobSearchStatus: business.jobSearchStatus || 'not_checked',
        inspectionStatus: business.inspectionStatus || 'queued',
        signalStrength: business.signalStrength || 'queued',
        selected: (selectedBusiness?.placeId || selectedBusiness?.id) === (business.placeId || business.id),
      },
    }));

    source.setData({ type: 'FeatureCollection', features });

    if (features.length > 0) {
      const coords = features.map(f => f.geometry.coordinates);
      const bounds = coords.reduce(
        (b, c) => b.extend(c),
        new mapboxgl.LngLatBounds(coords[0], coords[0])
      );
      map.fitBounds(bounds, { padding: 90, maxZoom: 14, duration: 800 });
    } else if (searchCenter) {
      map.easeTo({ center: [searchCenter.lng, searchCenter.lat], zoom: 13, duration: 600 });
    }
  }, [businesses, searchCenter, selectedBusiness, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const source = map.getSource('search-pin');
    if (!source) return;

    const features = searchPin ? [{
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [searchPin.lng, searchPin.lat] },
      properties: {},
    }] : [];

    source.setData({ type: 'FeatureCollection', features });

    if (searchPin) {
      map.easeTo({ center: [searchPin.lng, searchPin.lat], zoom: Math.max(map.getZoom(), 13), duration: 350 });
    }
  }, [searchPin, mapReady]);

  // Show popup for selected job
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    if (!selectedJob || !selectedJob.lat) return;

    const popup = new mapboxgl.Popup({ closeButton: false, maxWidth: isMobile ? '260px' : '300px' })
      .setLngLat([selectedJob.lng, selectedJob.lat])
      .setHTML(jobPopupHtml(selectedJob))
      .addTo(map);

    popupRef.current = popup;
    map.easeTo({ center: [selectedJob.lng, selectedJob.lat], duration: 400 });
  }, [selectedJob, isMobile]);

  // Show popup for selected business
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    if (!selectedBusiness || !selectedBusiness.lat) return;

    const popup = new mapboxgl.Popup({ closeButton: false, maxWidth: isMobile ? '260px' : '320px' })
      .setLngLat([selectedBusiness.lng, selectedBusiness.lat])
      .setHTML(businessPopupHtml(selectedBusiness))
      .addTo(map);

    popupRef.current = popup;
    map.easeTo({ center: [selectedBusiness.lng, selectedBusiness.lat], duration: 400 });
  }, [selectedBusiness, isMobile]);

  // Update pin screen position on map move/zoom/resize
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !container || !searchPin || !mapReady) return;

    const updatePinPos = () => {
      const screenPoint = map.project([searchPin.lng, searchPin.lat]);
      const containerWidth = container.offsetWidth;
      const containerHeight = container.offsetHeight;
      const cardWidth = isMobile ? 180 : 220;
      const cardHeight = 75;
      const padding = 12;

      let x = screenPoint.x - cardWidth / 2;
      let y = screenPoint.y - cardHeight - padding;

      x = Math.max(padding, Math.min(x, containerWidth - cardWidth - padding));
      y = Math.max(padding, Math.min(y, containerHeight - cardHeight - padding));

      setPinScreenPos({ x, y });
    };

    updatePinPos();

    map.on('move', updatePinPos);
    map.on('zoom', updatePinPos);

    const resizeObserver = new ResizeObserver(updatePinPos);
    resizeObserver.observe(container);

    return () => {
      map.off('move', updatePinPos);
      map.off('zoom', updatePinPos);
      resizeObserver.disconnect();
    };
  }, [searchPin, mapReady]);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* City search bar */}
      <div style={{
        position: 'absolute',
        top: 14,
        left: 14,
        right: isMobile ? 14 : 'auto',
        zIndex: 40,
        width: isMobile ? 'auto' : 280,
      }}>
        <input
          type="text"
          placeholder="Search for a city..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => searchQuery.trim() && setShowSuggestions(true)}
          style={{
            width: '100%',
            padding: '10px 12px',
            fontSize: 13,
            fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            border: '1px solid rgba(255, 255, 255, 0.2)',
            borderRadius: 6,
            background: 'rgba(24, 32, 51, 0.92)',
            color: '#ffffff',
            backdropFilter: 'blur(4px)',
          }}
        />

        {/* Status text below input */}
        <div style={{
          fontSize: 11,
          color: '#a8b2c1',
          marginTop: 6,
          textAlign: 'left',
          fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontWeight: 500,
          minHeight: 16,
        }}>
          {searchPin ? `Looking near ${locationLabel}` : 'Drop a pin to select the area you want to look for work'}
        </div>

        {/* Suggestions dropdown */}
        {showSuggestions && searchSuggestions.length > 0 && (
          <div style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: 'rgba(24, 32, 51, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: 6,
            maxHeight: 200,
            overflowY: 'auto',
            zIndex: 50,
          }}>
            {searchSuggestions.map((suggestion) => (
              <button
                key={suggestion.id}
                onClick={() => {
                  const map = mapRef.current;
                  if (map) {
                    map.flyTo({
                      center: suggestion.center,
                      zoom: 12,
                      duration: 1000,
                    });
                    onPinDropRef.current?.(suggestion.center[1], suggestion.center[0]);
                  }
                  setSearchQuery('');
                  setShowSuggestions(false);
                }}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                  color: '#e8eaf0',
                  textAlign: 'left',
                  fontSize: 13,
                  cursor: 'pointer',
                  fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                }}
                onMouseEnter={(e) => e.target.style.background = 'rgba(255, 255, 255, 0.08)'}
                onMouseLeave={(e) => e.target.style.background = 'transparent'}
              >
                {suggestion.place_name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Anchored CTA near dropped pin */}
      {searchPin && pinScreenPos && (
        <div style={{
          position: 'absolute',
          left: pinScreenPos.x,
          top: pinScreenPos.y,
          background: '#182033',
          color: '#ffffff',
          padding: isMobile ? '10px 12px' : '12px 14px',
          borderRadius: 8,
          boxShadow: '0 8px 24px rgba(24, 32, 51, 0.3)',
          zIndex: 45,
          fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          cursor: 'pointer',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          transition: 'all 0.3s ease',
          width: isMobile ? 180 : 220,
        }}>
          <div style={{
            fontSize: isMobile ? 13 : 14,
            fontWeight: 700,
            marginBottom: 3,
            lineHeight: 1.2,
          }}>
            Scout this area
          </div>
          <div style={{
            fontSize: isMobile ? 11 : 12,
            fontWeight: 500,
            color: '#a8b2c1',
            lineHeight: 1.2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxHeight: '2em',
          }}>
            {locationLabel}
          </div>
          <button
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              cursor: 'pointer',
              border: 'none',
              background: 'none',
              padding: 0,
            }}
            onClick={() => onScoutOpenRef.current?.()}
            aria-label="Scout this area"
          />
        </div>
      )}

      {/* Footer bar */}
      <footer style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'rgba(24, 32, 51, 0.92)',
        borderTop: '1px solid rgba(255, 255, 255, 0.1)',
        padding: isMobile ? '10px 12px' : '12px 20px',
        display: 'flex',
        gap: isMobile ? 10 : 16,
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 500,
        zIndex: 35,
        backdropFilter: 'blur(4px)',
      }}>
        <a href="/privacy" style={{
          color: '#a8b2c1',
          textDecoration: 'none',
          transition: 'color 0.2s',
        }}
        onMouseEnter={(e) => e.target.style.color = '#e8eaf0'}
        onMouseLeave={(e) => e.target.style.color = '#a8b2c1'}
        >Privacy</a>
        <a href="/terms" style={{
          color: '#a8b2c1',
          textDecoration: 'none',
          transition: 'color 0.2s',
        }}
        onMouseEnter={(e) => e.target.style.color = '#e8eaf0'}
        onMouseLeave={(e) => e.target.style.color = '#a8b2c1'}
        >Terms</a>
        <a href="/for-businesses" style={{
          color: '#a8b2c1',
          textDecoration: 'none',
          transition: 'color 0.2s',
        }}
        onMouseEnter={(e) => e.target.style.color = '#e8eaf0'}
        onMouseLeave={(e) => e.target.style.color = '#a8b2c1'}
        >For businesses ($50/mo)</a>
      </footer>
    </div>
  );
}

const styles = {
  legend: {
    position: 'absolute',
    left: 14,
    bottom: 14,
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    padding: '8px 10px',
    background: 'rgba(26, 29, 39, 0.92)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    color: 'var(--text-secondary)',
    fontSize: 11,
    boxShadow: '0 10px 32px rgba(0,0,0,0.28)',
  },
  legendMobile: {
    left: 10,
    right: 10,
    bottom: 76,
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 7,
    padding: '7px 8px',
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    whiteSpace: 'nowrap',
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.65)',
  },
};
