# rumahl Frontend Skill

You are working on the rumahl React frontend (Vite + Tailwind + TypeScript).

## Structure
- `frontend/src/components/` — React components (widgets, UI, pages)
- `frontend/src/contexts/` — React contexts (Auth, Connection, Theme, etc.)
- `frontend/src/hooks/` — Custom hooks (useEntityStore, useAuth, etc.)
- `frontend/src/lib/` — Utility functions (apiBase, wsConnection, types)
- `frontend/src/locales/` — i18n (en.json, de.json)

## Critical Rules
- NEVER use emojis in UI components. Use @phosphor-icons/react or lucide-react
- ALWAYS use `t('key.path')` for visible strings — never hardcode German or English
- Add new i18n keys to BOTH `en.json` AND `de.json`
- Widget icons follow WIDGET_ICON_MAP in `widgetRegistry.ts`

## Common Patterns
- `useEntityStore()` → `{ entities, getEntity, loading, wsConnected, refresh }`
- `usePageNavigation()` → `{ pages, pageLayouts, pageSettings, ... }`
- `getBackendUrl()` / `getAssistUrl()` from `@/lib/config` for API URLs
- API calls go through `apiBase.ts` which handles auth tokens

## State Management
- Entity state via WebSocket updates → `useEntityStore`
- Page configuration via `usePageNavigation`
- Auth via `useAuth` + `AuthContext`
- Theme via `ThemeContext` + `next-themes`

## Build
```bash
cd frontend && npm run build    # production build
cd frontend && npm run dev      # dev server on port 5173
cd frontend && npm run lint     # ESLint
```
