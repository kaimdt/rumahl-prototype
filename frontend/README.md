# rumahl Frontend

> React + TypeScript + Vite frontend for rumahl smart home system

## Quick Start

### Development Mode (with HMR)

```bash
npm install
npm run dev
```

Access at: http://localhost:5173

### Production Build

```bash
npm run build
```

Output: `dist/` directory

## Development Workflows

### 1. Frontend Only (Fastest)

Best for UI/component development with instant hot reload:

```bash
npm run dev
```

- ⚡ Instant Hot Module Replacement (HMR)
- 🎨 Perfect for CSS and component work
- 🔄 Sub-second reload times

**Note:** API calls automatically proxy to backend (configured in `vite.config.ts`)

### 2. Frontend + Backend (Integrated)

Best for testing API integration:

```bash
# Terminal 1: Frontend
npm run dev

# Terminal 2: Backend (from project root)
cd rumahl-os/backend/services/rumahl-home
RUMAHL_FRONTEND_DEV_URL=http://localhost:5173 cargo run
```

Access backend at: http://localhost:3001

### 3. All Services (Complete System)

Start all rumahl services together:

```bash
# From project root
npm run dev:all

# Or
cd scripts/dev
node rumahl-dev.mjs
```

Interactive service manager with hot reload support.

## Environment Configuration

### Development (Vite Dev Server)

Create `.env.local` (ignored by git):

```env
# Backend URL for API proxy (default: http://rumahl.local:3001)
VITE_RUMAHL_BACKEND_URL=http://localhost:3001
```

### Backend Integration

To enable frontend dev mode in backend, set:

```bash
# Linux/macOS
export RUMAHL_FRONTEND_DEV_URL=http://localhost:5173

# Windows PowerShell
$env:RUMAHL_FRONTEND_DEV_URL="http://localhost:5173"
```

See [Frontend Hot Reload Documentation](../rumahl-os/docs/frontend-hot-reload.md) for details.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server with HMR |
| `npm run dev:all` | Start all services (frontend + backend) |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |
| `npm test` | Run tests with Bun |

## Project Structure

```
frontend/
├── src/
│   ├── components/     # React components
│   ├── contexts/       # React contexts (theme, auth, etc.)
│   ├── hooks/          # Custom React hooks
│   ├── lib/            # Utilities and helpers
│   ├── i18n/           # Internationalization
│   │   └── locales/    # Translation files (en.json, de.json)
│   ├── App.tsx         # Main application component
│   └── main.tsx        # Application entry point
├── public/             # Static assets
│   └── docs/           # Documentation (copied from /docs)
├── index.html          # HTML entry point
├── vite.config.ts      # Vite configuration
├── tsconfig.json       # TypeScript configuration
└── package.json        # Dependencies and scripts
```

## Tech Stack

- **Framework:** React 19
- **Language:** TypeScript 5.7
- **Build Tool:** Vite 7
- **Styling:** Tailwind CSS 4
- **UI Components:** Radix UI
- **Icons:** Phosphor Icons
- **State Management:** React Context + Hooks
- **i18n:** i18next
- **Charts:** Recharts
- **Testing:** Bun test

## Configuration Files

### vite.config.ts

Vite configuration with:
- React plugin with SWC
- Tailwind CSS plugin
- API proxy configuration
- Build optimization
- Path aliases (`@/` → `src/`)

### tsconfig.json

TypeScript configuration with:
- Strict mode enabled
- Path mapping for `@/`
- React JSX support
- ES2020 target

## API Proxy (Development)

During development, Vite proxies these endpoints to the backend:

- `/api/*` → Backend API
- `/ws/*` → WebSocket connections
- `/health` → Health check
- `/uploads/*` → File uploads

**Backend target:** Configured via `VITE_RUMAHL_BACKEND_URL` (default: `http://rumahl.local:3001`)

## Hot Module Replacement (HMR)

Vite provides instant HMR for:
- ✅ React components
- ✅ CSS/Tailwind classes
- ✅ TypeScript files
- ✅ i18n translations

**Note:** Changes to `vite.config.ts` or `tailwind.config.js` require server restart.

## Production Build

### Build Process

```bash
npm run build
```

Creates optimized bundle in `dist/`:
- Minified JavaScript (with code splitting)
- Optimized CSS
- Compressed assets (gzip + brotli)
- Source maps for debugging

### Build Output

```
dist/
├── index.html           # Entry point
├── assets/
│   ├── index-[hash].js  # Main bundle
│   ├── vendor-*.js      # Vendor chunks
│   └── *.css            # Stylesheets
└── [other assets]
```

### Serving Production Build

The backend (rumahl-home) automatically serves from `dist/` when:
- `RUMAHL_FRONTEND_DEV_URL` is not set
- `dist/index.html` exists

## Internationalization (i18n)

Translations in `src/i18n/locales/`:
- `en.json` — English (default)
- `de.json` — German

### Adding Translations

1. Add key to both `en.json` and `de.json`
2. Use in components: `const { t } = useTranslation()`
3. Translate: `{t('key.path')}`

### Language Detection

Automatic detection via:
1. User preference (stored in localStorage)
2. Browser language
3. Fallback to English

## Troubleshooting

### Vite dev server won't start

```bash
# Check port 5173 is available
lsof -i :5173  # macOS/Linux
netstat -ano | findstr :5173  # Windows

# Try different port
npm run dev -- --port 5174
```

### API calls failing

Check backend is running and proxy is configured:

```typescript
// vite.config.ts
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:3001',  // Must match backend
      changeOrigin: true,
    },
  },
}
```

### HMR not working

1. Access Vite directly: http://localhost:5173
2. Check browser console for WebSocket errors
3. Hard refresh: Ctrl+Shift+R / Cmd+Shift+R

### Build errors

```bash
# Clear cache and rebuild
rm -rf node_modules dist .vite
npm install
npm run build
```

## Related Documentation

- [Frontend Hot Reload Guide](../rumahl-os/docs/frontend-hot-reload.md)
- [rumahl Dev Runner](../scripts/dev/README.md)
- [Backend Development](../rumahl-os/backend/README.md)

## Contributing

1. Use existing component patterns
2. Follow TypeScript strict mode
3. Add translations for all UI text
4. Test in both light and dark themes
5. Ensure responsive design (mobile, tablet, desktop)

## License

MIT License — Part of rumahl smart home system
