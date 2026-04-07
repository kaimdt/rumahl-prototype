import { useState, useEffect, useCallback } from "react";
import { tauriApi, type Model, type ConnectionResult, type AppConfig } from "../lib/tauri";

export function useLmStudio() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [status, setStatus] = useState<ConnectionResult>({ connected: false });
  const [loading, setLoading] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load config on mount
  useEffect(() => {
    tauriApi.getConfig().then(setConfig).catch((e) => setError(String(e)));
  }, []);

  const testConnection = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await tauriApi.testConnection();
      setStatus(result);
    } catch (e) {
      setStatus({ connected: false, error: String(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadModels = useCallback(async () => {
    setModelsLoading(true);
    setError(null);
    try {
      const list = await tauriApi.listModels();
      setModels(list);
    } catch (e) {
      setError(String(e));
      setModels([]);
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
    loading,
    modelsLoading,
    error,
    testConnection,
    loadModels,
    saveConfig,
  };
}
