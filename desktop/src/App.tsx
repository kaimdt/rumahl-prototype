import React, { useEffect, useState } from "react";
import { useLmStudio } from "./hooks/useLmStudio";
import { useAuth } from "./hooks/useAuth";
import { ConnectionStatus } from "./components/ConnectionStatus";
import { SettingsForm } from "./components/SettingsForm";
import { LoginScreen } from "./components/LoginScreen";
import { IoraHomePanel } from "./components/IoraHomePanel";
import { DesktopNavigation, type NavId } from "./components/DesktopNavigation";
import { TitleBar } from "./components/TitleBar";
import { motion } from "framer-motion";

const DEFAULT_BACKGROUND_URL = "https://images.unsplash.com/photo-1519681393784-d120267933ba?w=1920&q=80";

export default function App() {
  const { user, loading: authLoading, error: authError, login, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<NavId>("settings");
  const [sleepMode, setSleepMode] = useState(false);

  const {
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
  } = useLmStudio();

  useEffect(() => {
    if (user) testConnection();
  }, [user, testConnection]);

  const lastCheckedLabel = lastChecked
    ? `Zuletzt geprüft: ${lastChecked.toLocaleTimeString("de-DE")}`
    : "";

  // Auth gate - Settings tab is always accessible, others require login
  const requiresAuth = activeTab !== "settings";

  if (authLoading) {
    return (
      <div className="flex flex-col h-screen bg-background">
        <TitleBar />
        <div className="flex-1 flex items-center justify-center">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            className="text-accent"
          >
            <span className="text-3xl">⟳</span>
          </motion.div>
        </div>
      </div>
    );
  }

  // Only show login screen if not on settings tab and not logged in
  if (!user && requiresAuth) {
    return <LoginScreen
      onLogin={login}
      onSkipToSettings={() => setActiveTab("settings")}
      error={authError}
      loading={authLoading}
    />;
  }

  const initials = user
    ? (user.display_name
        ? user.display_name.slice(0, 2).toUpperCase()
        : user.username.slice(0, 2).toUpperCase())
    : "??";

  return (
    <div className={`min-h-screen relative theme-transition overflow-hidden${sleepMode ? ' sleep-mode' : ''}`}>
      <TitleBar />

      {/* Background */}
      <div
        className="fixed inset-0 bg-cover bg-center bg-no-repeat theme-transition z-0 pointer-events-none"
        style={{
          backgroundImage: `url('${DEFAULT_BACKGROUND_URL}')`,
          backgroundAttachment: 'fixed',
          filter: sleepMode
            ? 'brightness(0.02) grayscale(1) saturate(0)'
            : 'brightness(0.75)',
          opacity: sleepMode ? 0.15 : 1,
        }}
      />

      {/* Gradient overlay */}
      <div
        className="fixed inset-0 z-10 pointer-events-none"
        style={{
          background: sleepMode
            ? 'black'
            : 'linear-gradient(to bottom, rgba(0,0,0,0.4), rgba(0,0,0,0.2), rgba(0,0,0,0.6))',
          opacity: sleepMode ? 0.92 : 1,
          transition: 'opacity 0.6s ease, background 0.6s ease',
        }}
      />

      <div
        className="relative z-20"
        style={{
          filter: sleepMode ? 'saturate(0.25) brightness(0.65)' : 'none',
          transition: 'filter 0.6s ease',
        }}
      >
        {/* Header */}
        <header className="glass-header theme-transition">
          <div className="max-w-[1500px] mx-auto px-4 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-accent" style={{ boxShadow: '0 0 8px oklch(from var(--accent) l c h / 0.5)' }} />
              <h1 className="text-sm font-medium tracking-[0.15em] uppercase">IORA</h1>
              <span className="text-[9px] font-medium tracking-[0.1em] uppercase text-foreground/25">
                Desktop
              </span>
            </div>
            <div className="flex items-center gap-4">
              {clientInfo && (
                <span className="text-[11px] text-foreground/40 font-light tracking-wider">
                  {clientInfo.client_name}
                </span>
              )}
              {user && (
                <div className="flex items-center gap-2">
                  <div
                    className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-accent text-white text-[11px] font-bold flex items-center justify-center"
                    title={user.username}
                  >
                    {initials}
                  </div>
                  <span className="text-xs text-foreground/60">{user.display_name ?? user.username}</span>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Main content */}
        <main className="max-w-[1500px] mx-auto px-4 pt-6 pb-32">
          {activeTab === "ai" && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="space-y-6"
            >
              <div className="mb-4">
                <ConnectionStatus status={status} loading={loading} />
              </div>
              {config ? (
                <SettingsForm
                  config={config}
                  models={models}
                  modelsLoading={modelsLoading}
                  onSave={saveConfig}
                  onLoadModels={loadModels}
                />
              ) : (
                <div className="text-center text-muted-foreground py-10">
                  Lade Einstellungen…
                </div>
              )}
            </motion.div>
          )}

          {activeTab === "iora-home" && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <IoraHomePanel />
            </motion.div>
          )}

          {activeTab === "settings" && config && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
            >
              <SettingsForm
                config={config}
                models={models}
                modelsLoading={modelsLoading}
                onSave={saveConfig}
                onLoadModels={loadModels}
              />
            </motion.div>
          )}
        </main>
      </div>

      {/* Bottom Navigation */}
      <DesktopNavigation
        active={activeTab}
        onChange={setActiveTab}
        sleepMode={sleepMode}
        onSleepModeToggle={() => setSleepMode(!sleepMode)}
        user={user}
        onUserClick={logout}
      />
    </div>
  );
}
