## $(date +%Y-%m-%d) - O(1) Entity Lookup in React Components
**Learning:** Using `Array.find()` inside render functions or `useMemo` hooks for frequent lookups against large datasets (like thousands of Home Assistant entities) is a significant performance bottleneck in React. It causes O(N) scans on every render cycle, blocking the main thread.
**Action:** Always maintain an internal `Map` for large datasets in global stores (like `useEntityStore`) and expose a `getEntity(id)` function for O(1) lookups. Refactor components to use this getter instead of `array.find()`.
