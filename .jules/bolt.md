## 2024-06-15 - React Component Re-renders & O(N) Map Lookups
**Learning:** During high-frequency 60fps state updates (like slider dragging in `LightControlDialog`), creating a `new Map()` derived from props (`availableEntities`) directly in the render function causes significant GC pressure and performance degradation.
**Action:** Always memoize derived `Map` or `Record` lookups with `useMemo` when they depend on prop arrays, particularly inside heavily interactive UI elements to avoid O(N) allocation on every frame.
