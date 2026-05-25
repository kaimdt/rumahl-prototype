# Frontend Performance Optimizations — ThemeContext

**File:** `frontend/src/contexts/ThemeContext.tsx`
**Date:** 2026-05-25

## Task 1: Context Splitting (🔴1) — DONE

Created 3 new context objects alongside the existing `ThemeContext`:

| Context | Hook | Contents |
|---------|------|----------|
| `ThemeMetaContext` | `useThemeMeta()` | `availableThemes`, `installedThemes`, `loading`, `refreshThemes` |
| `ThemeActiveContext` | `useThemeActive()` | 23 active state fields (theme, sleepMode, capabilities, animation, nav, modal, etc.) |
| `ThemeActionContext` | `useThemeActions()` | 5 action functions (setSleepMode, setAutoTheme, setSelectedTheme, setActiveDesignMode, updateCustomSetting) |

- Each context value is independently `useMemo`-d with its own dependency array.
- All 4 providers are nested: `ThemeMeta` → `ThemeActive` → `ThemeAction` → `ThemeContext`.
- The original `useTheme()` hook still returns the full context for backward compatibility.
- Components can now subscribe to only the slices they need, preventing re-renders from unrelated state changes.

## Task 2: Fetch Sequence Tracker (🔴2) — DONE

Added a `fetchSeqRef = useRef(0)` that increments on each `fetchThemeData` call. After `authFetch` resolves (or catches), a stale check `if (seq !== fetchSeqRef.current) return` discards outdated responses. This prevents race conditions on rapid theme switching (e.g., user clicks theme A → theme B quickly; theme A's late response won't overwrite theme B's state).

## Task 3: rAF Batching + View Transitions (🟠3) — DONE

The CSS variable application block in the theme response effect now:
- Wraps the `forEach` loop in an `applyVars()` closure.
- Calls `applyVars()` inside `requestAnimationFrame` to batch style writes in a single paint frame.
- If the browser supports the View Transitions API (`startViewTransition`), wraps the rAF in a view transition for smooth cross-theme animations.

## Task 4: Interval Optimization (🟠4) — DONE

Removed `capabilities` from the dependency array of the interval effect that polls theme/time every 60 seconds:
- Before: `[sleepMode, autoTheme, selectedTheme, capabilities]`
- After: `[sleepMode, autoTheme, selectedTheme]`

This prevents the interval from being re-created every time `capabilities` changes (which happens on every theme response update), reducing unnecessary `setInterval`/`clearInterval` cycles.

## Task 5: CSS Text Cache Guard (🟢7) — DONE

In `injectCustomCss()`, added a string comparison before writing to the style element:
```typescript
} else if ((style as HTMLStyleElement).textContent === css) {
  return  // Skip if CSS unchanged
}
```
Prevents redundant DOM writes when the same CSS is injected repeatedly.

## Validation

- All 8 targeted edits applied successfully.
- `grep` confirmed all new identifiers (`ThemeMetaContext`, `ThemeActiveContext`, `ThemeActionContext`, `fetchSeqRef`, `applyVars`, etc.) are in place.
- TypeScript check shows no new errors (all pre-existing `d3-array` lib errors).
- Original `useTheme()` hook and full `contextValue` preserved for backward compatibility.

## Open Risks

- **Backward compatibility**: All existing consumers using `useTheme()` continue to work identically. No consumer was migrated to the split hooks.
- **View Transitions**: Only Chrome 111+ supports `startViewTransition`. Falls back gracefully to `requestAnimationFrame`.
- **Nested providers**: The 4-level nesting adds minimal runtime overhead (4 context lookups instead of 1), offset by render savings from split subscriptions.

## Recommended Next Steps

1. Gradually migrate consumers to the split hooks (`useThemeMeta`, `useThemeActive`, `useThemeActions`) where they only need a subset of the context.
2. Run Lighthouse / React Profiler to measure actual render improvement.
3. Consider the same split-context pattern for other large contexts in the app.
