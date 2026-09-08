import { useState, useEffect, useCallback, useRef } from "react";
import { tauriApi, type rumahlHomeStatus } from "../lib/tauri";

const POLL_INTERVAL_MS = 30_000;

export function userumahlHome() {
  const [status, setStatus] = useState<rumahlHomeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const s = await tauriApi.getrumahlHomeStatus();
      setStatus(s);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, [fetchStatus]);

  return { status, loading, refresh: fetchStatus };
}
