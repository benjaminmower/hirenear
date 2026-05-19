import { useCallback, useEffect, useRef, useState } from 'react';

const LAST_RUN_KEY = 'hirenear:lastScoutRunId';

function upsertById(items, next) {
  const index = items.findIndex(item => item.id === next.id);
  if (index === -1) return [...items, next];
  const copy = [...items];
  copy[index] = { ...copy[index], ...next };
  return copy;
}

export function useScout() {
  const [run, setRun] = useState(null);
  const [businesses, setBusinesses] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [matches, setMatches] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [inspectionSteps, setInspectionSteps] = useState([]);
  const [currentInspectionBusiness, setCurrentInspectionBusiness] = useState(null);
  const eventSourceRef = useRef(null);

  const closeEvents = useCallback(() => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, []);

  const loadRun = useCallback(async (runId) => {
    const res = await fetch(`/api/scout-runs/${runId}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to load scout run');
    }
    const data = await res.json();
    setRun(data.run);
    setBusinesses(data.businesses || []);
    setOpportunities(data.opportunities || []);
    setMatches(data.matches || []);
    setSummary(data.run?.summary || null);
    return data;
  }, []);

  const openEvents = useCallback((runId) => {
    closeEvents();
    const source = new EventSource(`/api/scout-runs/${runId}/events`);
    eventSourceRef.current = source;

    source.addEventListener('business_queued', event => {
      const { business } = JSON.parse(event.data);
      setBusinesses(items => upsertById(items, business));
    });

    source.addEventListener('business_update', event => {
      const { business } = JSON.parse(event.data);
      setBusinesses(items => upsertById(items, business));

      // Track which business is being inspected
      if (business.inspectionStatus === 'checking') {
        setCurrentInspectionBusiness(business);
        setInspectionSteps([]);
      } else {
        setCurrentInspectionBusiness(null);
      }
    });

    source.addEventListener('inspection_step', event => {
      const { step } = JSON.parse(event.data);
      setInspectionSteps(items => [...items, step]);
    });

    source.addEventListener('opportunity_found', event => {
      const { opportunity } = JSON.parse(event.data);
      setOpportunities(items => upsertById(items, opportunity));
    });

    source.addEventListener('match_update', event => {
      const { match } = JSON.parse(event.data);
      setMatches(items => upsertById(items, match));
    });

    source.addEventListener('complete', event => {
      const data = JSON.parse(event.data);
      setSummary(data.summary || null);
      setRun(current => current ? { ...current, status: 'complete', summary: data.summary } : current);
      setLoading(false);
      source.close();
    });

    source.addEventListener('error', event => {
      if (event.data) {
        const data = JSON.parse(event.data);
        setError(data.error || 'Scout run failed');
        setRun(current => current ? { ...current, status: 'failed', error: data.error } : current);
        setLoading(false);
      }
    });
  }, [closeEvents]);

  const startScout = useCallback(async ({ resumeText, targetLanes, avoidTerms, lat, lng, radius, locationLabel }) => {
    setLoading(true);
    setError(null);
    setSummary(null);
    setBusinesses([]);
    setOpportunities([]);
    setMatches([]);

    try {
      const res = await fetch('/api/scout-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resumeText, targetLanes, avoidTerms, lat, lng, radius, locationLabel }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to start scout run');
      }
      const { runId } = await res.json();
      localStorage.setItem(LAST_RUN_KEY, runId);
      setRun({ id: runId, status: 'running', lat, lng, radius, locationLabel, resumeText, targetLanes, avoidTerms });
      openEvents(runId);
      return runId;
    } catch (err) {
      setError(err.message);
      setLoading(false);
      return null;
    }
  }, [openEvents]);

  const visitBusiness = useCallback(async (placeId) => {
    if (!run?.id) return;
    const res = await fetch(`/api/scout-runs/${run.id}/visit/${placeId}`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to match business');
    }
  }, [run]);

  const skipBusiness = useCallback(async (placeId) => {
    if (!run?.id) return;
    await fetch(`/api/scout-runs/${run.id}/skip/${placeId}`, { method: 'POST' });
  }, [run]);

  const deleteRun = useCallback(async () => {
    if (!run?.id) return;
    const runId = run.id;
    closeEvents();
    const res = await fetch(`/api/scout-runs/${runId}`, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to delete scout run');
    }
    localStorage.removeItem(LAST_RUN_KEY);
    setRun(null);
    setBusinesses([]);
    setOpportunities([]);
    setMatches([]);
    setSummary(null);
    setError(null);
    setLoading(false);
  }, [closeEvents, run]);

  useEffect(() => {
    const runId = localStorage.getItem(LAST_RUN_KEY);
    if (!runId) return;
    loadRun(runId)
      .then(data => {
        if (data.run?.status === 'running' || data.run?.status === 'queued') {
          setLoading(true);
          openEvents(runId);
        }
      })
      .catch(() => localStorage.removeItem(LAST_RUN_KEY));
    return closeEvents;
  }, [closeEvents, loadRun, openEvents]);

  return {
    run,
    businesses,
    opportunities,
    matches,
    summary,
    loading,
    error,
    inspectionSteps,
    currentInspectionBusiness,
    startScout,
    loadRun,
    deleteRun,
    visitBusiness,
    skipBusiness,
  };
}
