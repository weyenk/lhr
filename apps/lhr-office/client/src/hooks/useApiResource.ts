import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';

export interface ApiResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
}

export function useApiResource<T>(path: string): ApiResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const failureCountRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<T>(path)
      .then((result) => {
        if (cancelled) return;
        failureCountRef.current = 0;
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        failureCountRef.current += 1;
        // Transient polling failures retry silently; only surface a banner
        // after a few consecutive failures, so a single dropped request
        // doesn't flash an error on every 5s poll.
        if (failureCountRef.current >= 3) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, version]);

  const refetch = useCallback(() => setVersion((v) => v + 1), []);

  return { data, error, loading, refetch };
}
