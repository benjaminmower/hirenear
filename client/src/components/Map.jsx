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
  onSelectJob,
  onSelectBusiness,
  onPinDrop,
}) {
  const isMobile = useMediaQuery('(max-width: 700px)');
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const modeRef = useRef(mode);
  const onPinDropRef = useRef(onPinDrop);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { onPinDropRef.current = onPinDrop; }, [onPinDrop]);

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

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
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
