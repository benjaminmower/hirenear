import { useCallback, useEffect, useRef, useState } from 'react';

const LAST_RUN_KEY = 'hirenear:lastScoutRunId';
const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
const VISIBILITY_RESYNC_MIN_GAP_MS = 30_000;

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
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const lastEventAtRef = useRef(0);
  const activeRunIdRef = useRef(null);
  const stoppedRef = useRef(false);

  const cancelReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const closeEvents = useCallback(() => {
    cancelReconnect();
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
  }, [cancelReconnect]);

  const markEvent = useCallback(() => {
    lastEventAtRef.current = Date.now();
    reconnectAttemptsRef.current = 0;
  }, []);

  const loadRun = useCallback(async (runId) => {
    const res = await fetch(`/api/scout-runs/${runId}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const wrapped = new Error(err.error || 'Failed to load scout run');
      wrapped.status = res.status;
      throw wrapped;
    }
    const data = await res.json();
    setRun(data.run);
    setBusinesses(data.businesses || []);
    setOpportunities(data.opportunities || []);
    setMatches(data.matches || []);
    setSummary(data.run?.summary || null);
    return data;
  }, []);

  // Forward-declared so openEvents can schedule it
  const scheduleReconnectRef = useRef(null);

  const openEvents = useCallback((runId) => {
    cancelReconnect();
    eventSourceRef.current?.close();
    activeRunIdRef.current = runId;
    stoppedRef.current = false;

    const source = new EventSource(`/api/scout-runs/${runId}/events`);
    eventSourceRef.current = source;

    source.addEventListener('connected', () => {
      markEvent();
    });

    source.addEventListener('heartbeat', () => {
      markEvent();
    });

    source.addEventListener('business_queued', event => {
      markEvent();
      const { business } = JSON.parse(event.data);
      setBusinesses(items => upsertById(items, business));
    });

    source.addEventListener('business_update', event => {
      markEvent();
      const { business } = JSON.parse(event.data);
      setBusinesses(items => upsertById(items, business));

      if (business.inspectionStatus === 'checking') {
        setCurrentInspectionBusiness(business);
        setInspectionSteps([]);
      } else {
        setCurrentInspectionBusiness(null);
      }
    });

    source.addEventListener('inspection_step', event => {
      markEvent();
      const { step } = JSON.parse(event.data);
      setInspectionSteps(items => [...items, step]);
    });

    source.addEventListener('opportunity_found', event => {
      markEvent();
      const { opportunity } = JSON.parse(event.data);
      setOpportunities(items => upsertById(items, opportunity));
    });

    source.addEventListener('match_update', event => {
      markEvent();
      const { match } = JSON.parse(event.data);
      setMatches(items => upsertById(items, match));
    });

    source.addEventListener('complete', event => {
      markEvent();
      const data = JSON.parse(event.data);
      setSummary(data.summary || null);
      setRun(current => current ? { ...current, status: 'complete', summary: data.summary } : current);
      setLoading(false);
      stoppedRef.current = true;
      closeEvents();
    });

    // App-level run failure. Stop reconnecting.
    source.addEventListener('error', event => {
      if (event.data) {
        const data = JSON.parse(event.data);
        setError(data.error || 'Scout run failed');
        setRun(current => current ? { ...current, status: 'failed', error: data.error } : current);
        setLoading(false);
        stoppedRef.current = true;
        closeEvents();
      }
      // If no event.data, this is a native EventSource transport error — handled by onerror below.
    });

    // Non-fatal TTL close from the server. Reconnect.
    source.addEventListener('stream_error', () => {
      source.close();
      eventSourceRef.current = null;
      scheduleReconnectRef.current?.(runId);
    });

    // Native transport error. Close the browser-managed retry loop so our
    // reconnect path can resync with loadRun before reopening the stream.
    source.onerror = () => {
      if (stoppedRef.current) return;
      source.close();
      eventSourceRef.current = null;
      scheduleReconnectRef.current?.(runId);
    };
  }, [cancelReconnect, closeEvents, markEvent]);

  const scheduleReconnect = useCallback((runId) => {
    if (stoppedRef.current) return;
    if (activeRunIdRef.current !== runId) return;
    cancelReconnect();
    const attempt = reconnectAttemptsRef.current;
    const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
    reconnectAttemptsRef.current = attempt + 1;
    reconnectTimerRef.current = setTimeout(async () => {
      reconnectTimerRef.current = null;
      if (stoppedRef.current) return;
      if (activeRunIdRef.current !== runId) return;
      try {
        const data = await loadRun(runId);
        // If the run terminated while we were disconnected, don't reopen.
        if (data.run?.status === 'complete' || data.run?.status === 'failed') {
          stoppedRef.current = true;
          setLoading(false);
          return;
        }
        openEvents(runId);
      } catch (err) {
        if (err?.status === 404) {
          stoppedRef.current = true;
          localStorage.removeItem(LAST_RUN_KEY);
          setLoading(false);
          return;
        }
        // Transient resync failure; try again on backoff.
        scheduleReconnect(runId);
      }
    }, delay);
  }, [cancelReconnect, loadRun, openEvents]);

  // Wire the forward ref so openEvents can call scheduleReconnect without a cycle.
  useEffect(() => {
    scheduleReconnectRef.current = scheduleReconnect;
  }, [scheduleReconnect]);

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
    const res = await fetch(`/api/scout-runs/${run.id}/skip/${placeId}`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to skip business');
    }
  }, [run]);

  const deleteRun = useCallback(async () => {
    if (!run?.id) return;
    const runId = run.id;
    stoppedRef.current = true;
    activeRunIdRef.current = null;
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

  // Cancel reconnects whenever the active run id changes (or is cleared).
  useEffect(() => {
    if (!run?.id) {
      stoppedRef.current = true;
      cancelReconnect();
      return;
    }
    if (activeRunIdRef.current && activeRunIdRef.current !== run.id) {
      cancelReconnect();
    }
  }, [cancelReconnect, run?.id]);

  // Resume the last run on mount.
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

  // Resync on tab focus if the stream has been silent for a while.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const runId = activeRunIdRef.current;
      if (!runId) return;
      if (stoppedRef.current) return;
      const status = run?.status;
      if (status !== 'running' && status !== 'queued') return;
      const silentFor = Date.now() - (lastEventAtRef.current || 0);
      if (silentFor < VISIBILITY_RESYNC_MIN_GAP_MS) return;
      cancelReconnect();
      loadRun(runId)
        .then(data => {
          if (data.run?.status === 'complete' || data.run?.status === 'failed') {
            stoppedRef.current = true;
            setLoading(false);
            return;
          }
          if (!eventSourceRef.current) {
            openEvents(runId);
          }
        })
        .catch(err => {
          if (err?.status === 404) {
            stoppedRef.current = true;
            localStorage.removeItem(LAST_RUN_KEY);
            return;
          }
          scheduleReconnectRef.current?.(runId);
        });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [cancelReconnect, loadRun, openEvents, run?.status]);

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
