import { useState, useCallback } from 'react';

export function useJobs() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastQuery, setLastQuery] = useState(null);

  const search = useCallback(async ({ query, location, dateFilter }) => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);
    setLastQuery({ query, location, dateFilter });

    try {
      const params = new URLSearchParams({ query });
      if (location) params.set('location', location);
      if (dateFilter) params.set('chips', `date_posted:${dateFilter}`);

      const res = await fetch(`/api/jobs?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Search failed');
      }

      const data = await res.json();
      setJobs(data.jobs);
    } catch (err) {
      setError(err.message);
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const mappableJobs = jobs.filter(j => j.hasCoords);
  const unmappableJobs = jobs.filter(j => !j.hasCoords);

  return {
    jobs,
    mappableJobs,
    unmappableJobs,
    loading,
    error,
    lastQuery,
    search,
  };
}
