import { useCallback, useState } from 'react';

const SALT_LAKE_CITY = {
  lat: 40.7608,
  lng: -111.8910,
};

export function useGeoJobs() {
  const [businesses, setBusinesses] = useState([]);
  const [searchCenter, setSearchCenter] = useState(null);
  const [radius, setRadius] = useState(1000);
  const [checkedBusinessCount, setCheckedBusinessCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [locationStatus, setLocationStatus] = useState('idle');

  const geoSearch = useCallback(async (lat, lng, nextRadius = radius) => {
    setLoading(true);
    setError(null);
    setRadius(nextRadius);
    setLocationStatus('searching');

    try {
      const params = new URLSearchParams({
        lat: String(lat),
        lng: String(lng),
        radius: String(nextRadius),
      });

      const res = await fetch(`/api/nearby-jobs?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Nearby search failed');
      }

      const data = await res.json();
      setBusinesses(data.businesses || []);
      setCheckedBusinessCount(data.checkedBusinessCount || 0);
      setSearchCenter(data.searchCenter || { lat, lng });
      setLocationStatus('found');
      return data;
    } catch (err) {
      setError(err.message);
      setBusinesses([]);
      setCheckedBusinessCount(0);
      setLocationStatus('error');
      return null;
    } finally {
      setLoading(false);
    }
  }, [radius]);

  const searchSaltLakeCity = useCallback((nextRadius = radius) => {
    return geoSearch(SALT_LAKE_CITY.lat, SALT_LAKE_CITY.lng, nextRadius);
  }, [geoSearch, radius]);

  return {
    businesses,
    searchCenter,
    radius,
    checkedBusinessCount,
    loading,
    error,
    locationStatus,
    searchSaltLakeCity,
    geoSearch,
  };
}
