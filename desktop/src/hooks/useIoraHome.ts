import { useState, useEffect, useCallback, useRef } from "react";
import { tauriApi, type IoraHomeStatus } from "../lib/tauri";

export function useIoraHome() {
  const [status, setStatus] = useState<IoraHomeStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const s = await tauriApi.getIoraHomeStatus();
      setStatus(s);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    pollRef.current = setInterval(fetchStatus, 30_000);
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
    };
  }, [fetchStatus]);

  return { status, loading, refresh: fetchStatus };
}
