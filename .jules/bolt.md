## 2026-05-04 - React Map Allocation on Re-render
**Learning:** O(N) reallocations inside highly interactive React render functions (like the `entitiesById` Map in `LightControlDialog` constructed from `availableEntities` while sliders update rapidly) cause observable performance degradations without `useMemo`.
**Action:** Always wrap `new Map(array.map(...))` inside `useMemo` when rendering interactive components with large dependency arrays.
