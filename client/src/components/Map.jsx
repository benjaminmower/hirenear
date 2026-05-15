import { useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

const CLUSTER_PAINT = {
  'circle-color': [
    'step', ['get', 'point_count'],
    '#4f7cff', 5, '#7a9fff', 20, '#36d399'
  ],
  'circle-radius': ['step', ['get', 'point_count'], 20, 5, 28, 20, 36],
  'circle-opacity': 0.9,
};

export default function Map({ jobs, selectedJob, onSelectJob }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const popupRef = useRef(null);

  // Init map
  useEffect(() => {
    if (mapRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [-95, 38],
      zoom: 3.5,
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

      // Cursors
      ['clusters', 'unclustered-point'].forEach(layer => {
        map.on('mouseenter', layer, () => map.getCanvas().style.cursor = 'pointer');
        map.on('mouseleave', layer, () => map.getCanvas().style.cursor = '');
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update job data
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

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
  }, [jobs]);

  // Show popup for selected job
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (popupRef.current) { popupRef.current.remove(); popupRef.current = null; }
    if (!selectedJob || !selectedJob.lat) return;

    const popup = new mapboxgl.Popup({ closeButton: false, maxWidth: '300px' })
      .setLngLat([selectedJob.lng, selectedJob.lat])
      .setHTML(`
        <div style="font-family: monospace;">
          <div style="font-size:13px; font-weight:600; color:#e8eaf0; margin-bottom:4px; line-height:1.3">${selectedJob.title}</div>
          <div style="font-size:12px; color:#8b91a8; margin-bottom:8px">${selectedJob.company} · ${selectedJob.location}</div>
          ${selectedJob.salary ? `<div style="font-size:12px; color:#36d399; margin-bottom:6px">💰 ${selectedJob.salary}</div>` : ''}
          ${selectedJob.workType ? `<div style="font-size:12px; color:#4f7cff">${selectedJob.workType}</div>` : ''}
          ${selectedJob.applyLink ? `<a href="${selectedJob.applyLink}" target="_blank" rel="noopener" style="display:inline-block; margin-top:10px; font-size:11px; color:#4f7cff; text-decoration:none; border:1px solid #4f7cff; padding:3px 10px; border-radius:4px;">Apply →</a>` : ''}
        </div>
      `)
      .addTo(map);

    popupRef.current = popup;
    map.easeTo({ center: [selectedJob.lng, selectedJob.lat], duration: 400 });
  }, [selectedJob]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
