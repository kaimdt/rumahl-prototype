import { useState, useEffect, useCallback, useRef } from "react";
import {
  tauriApi,
  type Model,
  type ConnectionResult,
  type AppConfig,
  type ClientInfo,
} from "../lib/tauri";

export function useLmStudio() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [status, setStatus] = useState<ConnectionResult>({ connected: false });
  const [clientInfo, setClientInfo] = useState<ClientInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load config and client info on mount
  useEffect(() => {
    tauriApi.getConfig().then(setConfig).catch((e) => setError(String(e)));
    tauriApi
      .getClientInfo()
      .then(setClientInfo)
      .catch(() => {});
  }, []);

  const testConnection = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await tauriApi.testConnection();
      setStatus(result);
      setLastChecked(new Date());
      // Refresh client info after a connection test
      tauriApi
        .getClientInfo()
        .then(setClientInfo)
        .catch(() => {});
    } catch (e) {
      setStatus({ connected: false, error: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh the cached status (no network call) — used by the auto-poller
  const refreshStatus = useCallback(async () => {
    try {
      const result = await tauriApi.getStatus();
      setStatus(result);
      setLastChecked(new Date());
    } catch {
      // silently ignore background refresh errors
    }
  }, []);

  // Auto-poll every 30 s so the UI stays in sync with background health monitor
  useEffect(() => {
    // Initial status read
    refreshStatus();

    pollIntervalRef.current = setInterval(refreshStatus, 30_000);
    return () => {
      if (pollIntervalRef.current !== null) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [refreshStatus]);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    setError(null);
    try {
      const list = await tauriApi.listModels();
      setModels(list);
      setStatus({ connected: true });
    } catch (e) {
      const msg = String(e);
      setError(msg);
      setModels([]);
      // A failed model list means LM Studio is offline
      if (msg.toLowerCase().includes("offline")) {
        setStatus({ connected: false, error: msg });
      }
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const saveConfig = useCallback(async (newConfig: AppConfig) => {
    try {
      await tauriApi.saveConfig(newConfig);
      setConfig(newConfig);
    } catch (e) {
      setError(String(e));
      throw e;
    }
  }, []);

  return {
    config,
    models,
    status,
    clientInfo,
    loading,
    modelsLoading,
    error,
    lastChecked,
    testConnection,
    loadModels,
    saveConfig,
  };
}
