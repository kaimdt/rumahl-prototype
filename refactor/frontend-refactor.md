# Frontend Refactoring Summary

## File: `frontend/src/contexts/ThemeContext.tsx`

### Task 1: FOUC Protection — sessionStorage CSS Cache
- **Added** `THEME_CSS_CACHE_KEY` constant and two helper functions (`cacheThemeCss`, `applyCachedThemeCss`) near `clearThemeInjections()`.
  - `cacheThemeCss(id, vars)` stores theme ID + CSS variables as JSON in `sessionStorage`.
  - `applyCachedThemeCss()` reads from sessionStorage on init, synchronously applies CSS custom properties to `:root`, sets `data-theme`, and returns the cached theme ID.
- **Modified** the initial `useState` for `theme` to call `applyCachedThemeCss()`. If a cached theme matches `selectedTheme`, it returns the cached value directly — eliminating the flash of unstyled content (FOUC) on reload.
- **Added** a call to `cacheThemeCss(themeResponse.theme_id, themeResponse.css_variables)` in the effect that applies theme CSS variables, ensuring the cache stays fresh.

### Task 2: Profile ID from useAuth()
- **Added** `import { useAuth } from '@/contexts/AuthContext'` to imports.
- **Replaced** the old `useEffect` that read `profileId` from `localStorage.getItem('ha-auth-user')` with:
  ```typescript
  const { user } = useAuth()
  useEffect(() => {
    setProfileId(user?.id || user?.sub || null)
  }, [user?.id, user?.sub])
  ```
  This eliminates a direct localStorage dependency and keeps `profileId` in sync with the auth context.

### Task 3: injectedThemeRef Guard
- **Added** an early-return guard at the top of the big `themeResponse` CSS application effect:
  ```typescript
  if (themeResponse?.theme_id === injectedThemeRef.current) return
  ```
  This prevents redundant DOM manipulation when the theme hasn't actually changed.

### Task 4: Memory Cache Fallback (in `storage.ts`)
- **Added** `private memoryFallback = new Map<string, unknown>()` to `LocalStorageManager`.
- In `get()`: checks memory fallback first before trying localStorage.
- In `set()`: wraps `localStorage.setItem` in its own try-catch; on failure, stores to `this.memoryFallback` instead of losing the value entirely.

### Task 5: setActiveDesignMode Cleanup
- **Added** `const prevModeVarsRef = useRef<Record<string, string>>({})` alongside the other refs.
- **Rewrote** `setActiveDesignMode` to:
  1. Clean up the previous mode's CSS variables (removes them from `:root`).
  2. Track the new mode's variables in `prevModeVarsRef`.
  3. Apply the new mode's variables. Falls back to `{}` if the mode is not found.

### Task 6: AbortController for Custom Settings
- **Added** `const abortRef = useRef<AbortController | null>(null)` alongside the other refs.
- **Refactored** the custom settings effect from `.then()` chains to `async/await` with a `cancelled` flag.
- On re-run: aborts the previous `AbortController`, creates a new one, sets `cancelled = false`, and checks `if (cancelled) return` before calling `setCustomSettings`.
- The cleanup function sets `cancelled = true` and calls `abortRef.current?.abort()`.

### Task 7: CSS Scope Validator in `injectCustomCss`
- **Added** a `process.env.NODE_ENV === 'development'` guard that inspects each line of injected CSS.
- Warns via `console.warn` if a CSS rule contains `{` but doesn't start with `:root[`, `@`, `/*`, `//`, `}`, or `*` — catching unscoped rules that could leak across themes.

---

## File: `frontend/src/lib/storage.ts`

### Task 4: Memory Cache Fallback
- **Added** `private memoryFallback = new Map<string, unknown>()` class field.
- **Modified `get<T>()`**: checks `this.memoryFallback.get(key)` first; if found, returns the cached value. Otherwise falls through to localStorage.
- **Modified `set<T>()`**: wraps `localStorage.setItem` in its own inner `try-catch`. When localStorage is full or unavailable, stores the value in `this.memoryFallback` instead. Notify listeners and sync-to-backend still run.
