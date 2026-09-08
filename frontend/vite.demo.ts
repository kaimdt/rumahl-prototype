import { defineConfig, loadEnv, type UserConfig } from 'vite'
import baseConfig from './vite.config'
import demoServerPlugin from './mock/demoServer.mjs'

/**
 * Demo Vite config — runs the frontend WITHOUT the rumahl backend / dev VM.
 *
 * Usage:  npm run dev:demo
 *   (= vite --config vite.demo.ts --mode demo  → loads .env.demo)
 *
 * It reuses the base config (aliases, tailwind, react) and adds the mock
 * backend (mock/demoServer.mjs) answering /api/*, /health and /ws. The demo
 * env flags (VITE_DEMO=1) come from .env.demo, read via loadEnv + define so
 * `import.meta.env.VITE_DEMO` is substituted at transform time.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const base = baseConfig as UserConfig
  return {
    ...base,
    plugins: [...(base.plugins || []), demoServerPlugin()],
    server: {
      ...(base.server || {}),
      // No backend proxy — the demo middleware answers everything.
      proxy: {},
    },
    define: {
      ...(base.define || {}),
      'import.meta.env.VITE_DEMO': JSON.stringify(env.VITE_DEMO || '1'),
      'import.meta.env.VITE_BACKEND_URL': JSON.stringify(''),
      'import.meta.env.VITE_rumahl_ASSIST_URL': JSON.stringify(''),
    },
  }
})


