# Frontend Bug Report

Generated: 2026-05-23  
Scope: 127+ .ts/.tsx files in `frontend/src/`  
Severity: **critical** (crashes/data-loss) | **high** (functional bug) | **medium** (UX/tech-debt) | **low** (style/cleanup)

---

## 1. CRITICAL: Duplicate `parseStoredToken` with incompatible implementations

**Files:**
- `contexts/AuthContext.tsx` (lines 44-50)
- `lib/authHelpers.ts` (lines 9-20)

**Issue:** Two different `parseStoredToken` functions exist. The AuthContext version only handles plain strings and JSON-wrapped strings. The authHelpers version also handles `{token: ..., access_token: ...}` objects. Because `readPersistedToken()` in AuthContext calls the local version, tokens stored as objects (e.g., from an older session or direct `.setItem` with an object) will silently return `null`, causing authentication failures.

```typescript
// AuthContext.tsx (lines 44-50)
function parseStoredToken(raw: string | null): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'string' ? parsed : null  // ← Objects become null
  } catch {
    return raw
  }
}

// authHelpers.ts (lines 9-20)
export function parseStoredToken(raw: string | null): string | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string') return parsed
    if (parsed && typeof parsed === 'object') {
      const token = (parsed as Record<string, unknown>).token
      const accessToken = (parsed as Record<string, unknown>).access_token
      if (typeof token === 'string') return token        // ← Handles objects
      if (typeof accessToken === 'string') return accessToken
    }
  } catch {
    return raw
  }
  return null
}
```

**Fix:** Delete the copy in `AuthContext.tsx` and import `parseStoredToken` from `@/lib/authHelpers`. Update `readPersistedToken` and the `verifyToken` function to use the imported version.

---

## 2. CRITICAL: `useGlobalConfig` token evaluated at module scope (non-reactive)

**File:** `hooks/useGlobalConfig.tsx` (lines 68-73)

**Issue:** The authentication token is extracted via an IIFE at component render time, not inside a `useEffect` or as a reactive value. If the user authenticates *after* the GlobalConfigProvider mounts, the `loadConfig` function will never have a token.

```typescript
const token = (() => {
  try {
    const raw = localStorage.getItem('ha-auth-token')
    return raw ? JSON.parse(raw) : ''
  } catch {
    return localStorage.getItem('ha-auth-token') || ''
  }
})()

const loadConfig = useCallback(async () => {
  // ... uses `token` captured at initial render
}, [token])  // token is a stable string, never updates

useEffect(() => {
  loadConfig()
}, []) // run once on mount — token might be empty
```

**Fix:** Use the `useAuth()` hook to get the reactive token, or refactor `loadConfig` to read the token inside the callback each time.

---

## 3. CRITICAL: Token storage serialization mismatch (`useLocalStorage` vs direct `localStorage.setItem`)

**Files:**
- `lib/storage.ts` (lines 32-34) – `set()` always calls `JSON.stringify(value)`
- `contexts/AuthContext.tsx` (line 87) – `localStorage.setItem('ha-auth-token', JSON.stringify(token))`

**Issue:** `useLocalStorage` wraps values in `JSON.stringify` in its `set<T>()` method. If any code uses `useLocalStorage('ha-auth-token', ...)` instead of the direct `localStorage.setItem`, the token will be double-stringified (e.g., `"\"abc123\""`). Calling `JSON.parse` once will return the string `"abc123"` (not `abc123`). Currently this bug is dormant because auth tokens are set via direct `localStorage.setItem`, but any future refactor could trigger it.

Additionally, the `useLocalStorage` hook in `storage.ts` reads with `JSON.parse` — so if auth tokens were ever read through that hook, they'd also fail for the same reason.

**Fix:** Standardize token storage. Either:
- Always use direct `localStorage.setItem/getItem` for auth tokens (current pattern), or
- Store auth tokens via `storage.set/get` and don't double-wrap

---

## 4. HIGH: Theme Editor save button is non-functional

**File:** `components/ThemeEditor.tsx` (line 713)

**Issue:** The save button's `onClick` handler is a stub:
```tsx
<button onClick={() => {/* TODO: save */}}>  Speichern  </button>
```

**Fix:** Implement the save handler that persists the theme edits to the backend via `authFetch`.

---

## 5. HIGH: `useGlassSettings` / `useNightModeSettings` mount effect uses stale settings

**Files:**
- `hooks/useGlassSettings.ts` (lines 31-33)
- `hooks/useNightModeSettings.ts` (lines 23-25)

**Issue:** Both hooks have a mount effect that calls the apply function with the initial settings:

```typescript
// useGlassSettings.ts line 31-33
useEffect(() => {
  applyGlassSettings(settings)  // `settings` captured from initial render
}, [])  // empty deps — won't re-run if settings change externally
```

If the CSS custom properties set by `applyGlassSettings` are later overridden by another source (e.g., theme capabilities), they won't be re-applied on remount. While this is mostly cosmetic, it means that if the component unmounts and remounts within the same page session, it will re-apply stale glass settings.

**Fix:** Add `settings` to the dependency array, or ensure the first `useEffect` (`[settings]`) already handles the mount case (it does, but both effects run on mount). Consider removing the `[]` effect and relying on the `[settings]` effect which also runs on mount.

---

## 6. HIGH: Unsanitized HTML in DocsPage via `dangerouslySetInnerHTML`

**File:** `components/DocsPageNew.tsx` (line 180)

**Issue:** Markdown-rendered HTML content is injected via `dangerouslySetInnerHTML`. While the content originates from backend docs, if the backend ever serves user-contributed or theme-provided documentation, this becomes an XSS vector.

```tsx
<div className="prose ..." dangerouslySetInnerHTML={{ __html: html }} />
```

Also present in `CustomPageRenderer.tsx` (lines 767, 771, 775) for CSS injection.

**Fix:** 
- Run the HTML through a sanitizer (e.g., DOMPurify) before injection.
- Ensure CSP headers are set on the backend.

---

## 7. HIGH: `useLocalStorage` hook — missing `defaultValue` in `setStorageValue` callback

**File:** `lib/storage.ts` (lines 90-96)

**Issue:** The `useEffect` subscribes to `storage.subscribe` using both `key` and `defaultValue` in the dep array. But `setStorageValue` only has `key` in its deps:

```typescript
const setStorageValue = React.useCallback(
  (newValue: T) => {
    storage.set(key, newValue)
    setValue(newValue)
  },
  [key]  // ← defaultValue missing
)
```

This is correct behavior (you don't need `defaultValue` to set), but the `subscribe` callback uses `defaultValue`:

```typescript
React.useEffect(() => {
  const unsubscribe = storage.subscribe<T>(key, (newValue) => {
    setValue(newValue ?? defaultValue)  // ← uses defaultValue
  })
  return unsubscribe
}, [key, defaultValue])
```

Each time `defaultValue` changes, a new subscription is created, and the old one remains subscribed until the cleanup runs. While this works functionally, it's inefficient.

**Fix:** Use a ref for `defaultValue` to avoid re-subscribing on default changes:
```typescript
const defaultValueRef = useRef(defaultValue)
defaultValueRef.current = defaultValue
```

---

## 8. MEDIUM: Suppressed lint warnings hiding real hook dependency issues

**Files:** Multiple (12 occurrences)

| File | Line | Issue |
|------|------|-------|
| `PageNavigationContext.tsx` | 776 | `useEffect([], [])` — missing deps |
| `PageNavigationContext.tsx` | 784 | `useEffect([], [])` — missing deps |
| `AdminPanel.tsx` | 5496 | `useEffect([], [])` — missing deps |
| `ConfigurationSettings.tsx` | 52 | `useEffect` missing `setGlobalCardStyle` |
| `CssCodeEditor.tsx` | 152 | `useEffect` missing deps |
| `MapWidget.tsx` | 1089, 1299, 1309, 1538, 1552, 1601 | Multiple effects with missing deps |
| `StreamWidget.tsx` | 394 | `useEffect` missing deps |

**Issue:** These eslint-disable comments may hide legitimate bugs. For example:
- `PageNavigationContext.tsx:776` — the `initSync` function captures `setLocalPages` from closure; if this reference changes, the effect won't re-run.
- `ConfigurationSettings.tsx:52` — `setGlobalCardStyle` is excluded from deps but used inside the effect.

**Fix:** Audit each case. Either add the missing dependencies or use refs for stable callbacks.

---

## 9. MEDIUM: Bare `JSON.parse` calls without try-catch on user/data input

**Files:** Multiple (30+ locations)

**Issue:** Several paths through the code call `JSON.parse` on data that could be malformed (from localStorage, API responses, or user input) without a try-catch. Notable examples:

- `hooks/useAccentColor.ts:20` — `JSON.parse(stored)` — localStorage could be corrupted
- `hooks/useGlassSettings.ts:20` — `JSON.parse(stored)` — same
- `hooks/useNightModeSettings.ts:20` — `JSON.parse(stored)` — same
- `contexts/ConfigurationContext.tsx:299` — parsing widget config from backend
- `components/CustomPageRenderer.tsx:662` — parsing page designer layouts

While many of these have surrounding try-catch blocks in calling code, some are called during initial state initialization (`useState(() => { ... })`) where an exception would crash the component.

**Fix:** Wrap all `JSON.parse` calls that parse external data (localStorage, API, user input) in try-catch with safe defaults.

---

## 10. MEDIUM: LoginModal cannot be dismissed when not authenticated

**File:** `App.tsx` (line 323), `components/LoginModal.tsx`

**Issue:** When the user is not authenticated, `LoginModal` is rendered with `onOpenChange={() => {}}`:

```tsx
<LoginModal open onOpenChange={() => {}} />
```

The empty callback means the user cannot close the login dialog (e.g., to view a public docs page or the about screen). This is intentional but may confuse users who land on the page without credentials.

**Fix:** Consider providing a "guest mode" or a way to browse non-authenticated content.

---

## 11. MEDIUM: Silent catch blocks swallowing errors without logging

**Files:** Widespread pattern (50+ occurrences)

**Issue:** Many `.catch(() => {})` and `.catch(() => null)` callbacks provide no logging at all. While this is acceptable for non-critical operations (fire-and-forget saves, cache priming), some of these hide real errors:

- `App.tsx:221` — `fetch(...).catch(() => {})` — maintenance status check fails silently
- `contexts/ThemeContext.tsx:647-652` — `JSON.parse(stored)` in try/catch with empty catch
- `components/ConfigurationSettings.tsx:51` — `getPreference(...).catch(() => {})` — silently ignores preference loading failures

**Fix:** Add `console.debug` or `console.warn` in catch blocks for operations that might legitimately fail, and `console.error` for unexpected failures.

---

## 12. MEDIUM: PageNavigationContext imports 100+ icons but may only use a subset

**File:** `contexts/PageNavigationContext.tsx` (lines 1-99)

**Issue:** The file imports ~90 individual named exports from `@phosphor-icons/react` at the top level. If tree-shaking isn't working correctly (e.g., in certain bundler configurations), this could impact bundle size. More importantly, many of these icons may be unused — they appear to be available for dynamic icon lookup.

**Fix:** Consider using a dynamic icon registry pattern, e.g.:
```typescript
import * as PhosphorIcons from '@phosphor-icons/react'
// lookup: PhosphorIcons[iconName]
```

---

## 13. MEDIUM: `handlePointerDown` receives unused `e` parameter

**File:** `hooks/useLongPressDialog.ts` (line 20)

**Issue:** The `handlePointerDown` callback accepts `e: React.PointerEvent` but never uses it:
```typescript
const handlePointerDown = useCallback((e: React.PointerEvent) => {
```

**Fix:** Remove the unused parameter or prefix it with `_`:
```typescript
const handlePointerDown = useCallback((_e: React.PointerEvent) => {
```

---

## 14. LOW: Very large files exceeding maintainability thresholds

| File | Lines |
|------|-------|
| `components/AdminPanel.tsx` | 11,730 |
| `components/PageDesigner/WidgetPalette.tsx` | 2,628 |
| `contexts/PageNavigationContext.tsx` | 994 |

**Issue:** `AdminPanel.tsx` at 11,730 lines is extremely large, making it hard to debug, review, and test. It handles dozens of different admin views in a single file.

**Fix:** Split into feature-based chunks:
- `components/AdminPanel/OverviewTab.tsx`
- `components/AdminPanel/SystemTab.tsx`
- `components/AdminPanel/ServicesTab.tsx`
- etc.

---

## 15. LOW: `useLocalStorage` import order — React imported at bottom

**File:** `lib/storage.ts` (lines 106-108)

**Issue:** React is imported at the end of the file, not at the top:
```typescript
// ...
// For compatibility with existing code
import * as React from 'react'

export { useLocalStorage as useKV }
```

While this works, it breaks convention and may confuse linters/formatters.

**Fix:** Move the React import to the top of the file.

---

## 16. LOW: `PageNavigationContext` has duplicate `parseStoredToken` comment but relies on import

**File:** `contexts/PageNavigationContext.tsx` (line 399)

**Issue:** There's a comment:
```typescript
// parseStoredToken and authFetch imported from @/lib/authHelpers
```
But this is placed mid-function in `resolveUsername`. The actual import from `@/lib/authHelpers` at the top of the file is correct. The comment is misleading and redundant.

**Fix:** Remove the comment.

---

## 17. LOW: No i18n keys for hardcoded German strings

**Files:** Multiple

**Issue:** The AGENTS.md mandates that ALL visible strings must use `t('key.path')`. However, many components contain hardcoded German strings:

- `App.tsx` — Labels like "Beleuchtung", "Klima", "Schalter", "Sensoren", "Musiksteuerung", "Keine Medienplayer gefunden"
- `App.tsx` — Dialog strings like "Einstellungen entsperren", "PIN eingeben", "Abbrechen", "Entsperren"
- `components/SettingsPage.tsx` — Various error messages

**Fix:** Move these strings to `i18n/de.json` and `i18n/en.json` and reference them via `t()`.

---

## 18. LOW: `useAccentColor` — `Image` onerror rejects but rejection is silent for non-stale requests

**File:** `hooks/useAccentColor.ts` (lines 65-70)

**Issue:** When an image fails to load, the promise rejects but the only action is:
```typescript
img.onerror = () => reject(new Error('Image load failed'))
```
This rejection is caught in the calling `extractColorFromImage` catch block (line 95), which logs a warning. However, if the extraction was triggered by a rapid series of image changes, the `requestId` check discards the result but the error was already thrown to the Next.js error boundary — which is fine, but it means a transient broken image URL can trigger error boundary fallback.

**Fix:** Use `img.onerror = () => resolve()` instead of `reject()`, or filter invalid URLs before passing them to `extractColorFromImage`.

---

## Summary

| Severity | Count | Categories |
|----------|-------|-----------|
| Critical | 3 | Auth token parsing, non-reactive token, serialization mismatch |
| High | 4 | Non-functional save, stale settings, unsanitized HTML, hook inefficiency |
| Medium | 6 | Suppressed lint warnings, bare JSON.parse, login lock-in, silent errors, unused imports, unused parameter |
| Low | 5 | Large files, import order, comment cleanup, hardcoded strings, image error handling |

### Quick Wins (highest ROI)
1. **Fix #1** — Unify `parseStoredToken` (3-line change, prevents auth failures)
2. **Fix #2** — Make `useGlobalConfig` token reactive (prevents admin settings load failure)
3. **Fix #4** — Implement Theme Editor save (functional gap)
4. **Fix #9** — Add try-catch to state initializer `JSON.parse` calls (prevents white-screen crashes)
