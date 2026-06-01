# Research: motion.dev (framer-motion v12+ Rebrand)

## Summary

Motion is the independent successor to framer-motion, spun out from Framer in January 2025 under Matt Perry's leadership. The React API (`motion/react`) has **zero breaking changes in v12** — it's a pure rename: `framer-motion` → `motion`, with all the same `motion.div`, `AnimatePresence`, layout animations, and variants intact. The rebrand introduces powerful new vanilla JS APIs, first-class Tailwind CSS v4 integration, CSS variable-driven animations, and a new `AnimateView` (early access) built on the browser's native View Transition API for page-level transitions.

---

## Findings

### 1. Migration: framer-motion → motion (v12) — Zero Breaking Changes

The migration from `framer-motion` v11 to `motion` v12 is trivial:

```bash
npm uninstall framer-motion
npm install motion@latest  # latest: 12.40.0 (May 2026)
```

Then swap imports across every file:

```typescript
// Before (framer-motion v11)
import { motion, AnimatePresence, useAnimation } from "framer-motion"

// After (motion v12)
import { motion, AnimatePresence } from "motion/react"
import { useAnimate } from "motion/react"   // useAnimation → useAnimate
import { LayoutGroup } from "motion/react"
```

**Key points:**
- No React API breaking changes in v12.0. [Source](https://motion.dev/docs/react-upgrade-guide)
- For RSC (React Server Components / Next.js): import from `"motion/react-client"`
- The `m` component (lightweight variant) imports from `"motion/react-m"`
- `exitBeforeEnter` was deprecated in v7.2 and removed in v11.17; use `mode="wait"` instead.
- `AnimateSharedLayout` is removed; `layoutId` now works globally without a wrapper (use `LayoutGroup` for scoping). [Source](https://motion.dev/docs/react-upgrade-guide)
- `useAnimation` renamed to `useAnimationControls` (backwards-compatible alias exists).
- Motion 3D (`framer-motion-3d`) package was removed in v12.5.0.

**Practical migration steps:**
1. Find-and-replace `from "framer-motion"` → `from "motion/react"` in ~10 files
2. Replace any `exitBeforeEnter` with `mode="wait"`
3. Replace any `AnimateSharedLayout` wrappers with `LayoutGroup`
4. Update `useAnimation()` → `useAnimationControls()` (optional, alias still works)

[Source: PR #241 omniscribe migration](https://github.com/Shironex/omniscribe/pull/241) | [Official upgrade guide](https://motion.dev/docs/react-upgrade-guide)

---

### 2. Page Transitions API: AnimatePresence, LayoutGroup & AnimateView

Motion offers three tiers of page transition capabilities:

#### 2a. AnimatePresence (React)

The workhorse for entry/exit animations. Three modes control how entering and exiting elements coordinate:

| Mode | Behavior | Best For |
|------|----------|----------|
| `"sync"` (default) | Both animate simultaneously | Simple fades |
| `"wait"` | Entering waits for exiting to finish | Sequential page transitions |
| `"popLayout"` | Exiting element is removed from layout flow immediately, siblings reflow | List item removal, grids |

```tsx
import { AnimatePresence } from "motion/react"

<AnimatePresence mode="wait" onExitComplete={() => console.log('done')}>
  {show && (
    <motion.div
      key="modal"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", bounce: 0, duration: 0.4 }}
    />
  )}
</AnimatePresence>
```

**Key props & hooks:**
- `custom` — Pass dynamic data through to exit animations via `usePresenceData()`
- `initial={false}` — Skip initial mount animations
- `propagate` — Nested `AnimatePresence` instances can propagate exit animations upward
- `useIsPresent()` — Detect if component is exiting
- `usePresence()` — Returns `[isPresent, safeToRemove]` for manual removal control

[Source](https://motion.dev/docs/react-animate-presence) | [Modes tutorial](https://motion.dev/tutorials/react-animate-presence-modes)

#### 2b. LayoutGroup & Shared Layout Animations

`LayoutGroup` enables coordinated layout animations between sibling components. Essential for tabs, accordions, and reorderable lists.

```tsx
import { LayoutGroup } from "motion/react"

function Tabs({ items }) {
  return (
    <LayoutGroup id="tab-group">
      {items.map(item => (
        <motion.li key={item.id} layout>
          {item.label}
          {item.isSelected && (
            <motion.div
              layoutId="underline"
              className="absolute bottom-0 h-0.5 bg-indigo-600"
              transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
            />
          )}
        </motion.li>
      ))}
    </LayoutGroup>
  )
}
```

**Key concepts:**
- `layout` prop enables size/position animations on re-render
- `layout="position"` — animate position only (ignore size changes)
- `layout="size"` — animate size only
- `layout="x"` / `layout="y"` — single-axis layout animations (v12.36+)
- `layoutId` — globally (or namespace) scoped shared element transitions
- `layoutAnchor` — custom anchor point for resolving relative projections (v12.38+)
- `layoutDependency` — only measure when a specific value changes (performance)
- `layoutScroll` — mark scrollable ancestors for correct measurement

[Source](https://motion.dev/docs/react-layout-group)

#### 2c. AnimateView — Page-Level View Transitions (Motion+ Early Access)

`AnimateView` wraps the browser's native View Transition API into a declarative React component. It's a **3KB component** that enables page wipes, shared element transitions, and crossfades.

```tsx
import { AnimateView } from "motion-plus/animate-view"
import { startTransition } from "react"

function PageTransition({ children, show, direction }) {
  return (
    <AnimateView
      transition={{ type: "spring", visualDuration: 0.4, bounce: 0.3 }}
      enter={{ 
        clipPath: ["inset(0 100% 0 0%)", "inset(0 0% 0 0%)"],
        opacity: 1 
      }}
      exit={{ 
        clipPath: "inset(0 0% 0 100%)",
        opacity: 0 
      }}
    >
      {show && children}
    </AnimateView>
  )
}
// Must wrap state change in startTransition:
startTransition(() => setShow(!show))
```

**AnimateView capabilities:**
- `enter` / `exit` / `update` / `share` animation hooks
- `name` prop for shared element transitions (like layoutId for view transitions)
- Dynamic animations via `addTransitionType("next")` and callback-based `enter={(types) => ...}` 
- `Suspense` integration: animate between fallback and content
- Springs via `import { spring } from "motion"` and `transition={{ type: spring }}`

**Requires:** `motion@12.34.0+`, `react@canary`, and Motion+ membership.

**Trade-off vs layout animations:** View transitions are **not interruptible** — they must complete. Layout animations are interruptible and better for micro-interactions. View transitions excel at page-level route changes where the non-interruptible nature is acceptable. [Source](https://motion.dev/docs/react-animate-view)

Vanilla JS equivalent: `animateView()` function from `"motion"`:
```javascript
import { animateView } from "motion"

animateView(update).enter({ opacity: 1 })
```

[Source: AnimateView docs](https://motion.dev/docs/react-animate-view) | [Blog: View Transition API](https://motion.dev/magazine/reacts-experimental-view-transition-api)

---

### 3. Dynamic Animations & Transitions at Runtime

#### 3a. Dynamic Variants (TargetResolver)

Variants accept functions that receive `custom` data at runtime, enabling directional transitions, staggered delays, and conditional animation targets:

```tsx
const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({
    x: direction > 0 ? -300 : 300,
    opacity: 0,
  }),
}

<AnimatePresence custom={direction} mode="wait">
  <motion.div
    key={page}
    variants={slideVariants}
    initial="enter"
    animate="center"
    exit="exit"
    custom={direction}
    transition={{ type: "spring", bounce: 0, duration: 0.5 }}
  />
</AnimatePresence>
```

[Source](https://www.mintlify.com/motiondivision/motion/api/types/variants)

#### 3b. Imperative Controls (`useAnimate` / `useAnimationControls`)

For programmatic animation control (e.g., triggered by events, not React state):

```tsx
import { useAnimate } from "motion/react"

function SplashScreen() {
  const [scope, animate] = useAnimate()

  useEffect(() => {
    const sequence = async () => {
      await animate(scope.current, 
        { scale: [0.8, 1], opacity: [0, 1] },
        { duration: 0.6, ease: "easeOut" }
      )
      await animate(scope.current,
        { y: -20, opacity: 0 },
        { delay: 1.5, duration: 0.4 }
      )
    }
    sequence()
  }, [scope, animate])

  return <div ref={scope}>My App</div>
}
```

#### 3c. AnimateView Dynamic Transitions

With `addTransitionType` and callback-based animation props, you can build directional transitions:

```tsx
startTransition(() => {
  addTransitionType("next")  // or "prev"
  setPage(newPage)
})

<AnimateView
  key={page}
  exit={(types) => ({
    transform: `translateX(${types.includes("prev") ? 100 : -100}%)`,
  })}
  enter={(types) => ({
    transform: [
      `translateX(${types.includes("next") ? 100 : -100}%)`,
      "none",
    ],
  })}
/>
```

[Source](https://motion.dev/docs/react-animate-view)

#### 3d. Runtime Transition Overrides

Transitions can be defined per-value, inherited, or overridden at any level:

```tsx
<motion.div
  animate={{ x: 100, opacity: 1 }}
  transition={{
    default: { type: "spring", bounce: 0.2 },
    opacity: { ease: "linear", duration: 0.3 },
  }}
/>

// Inheritance via MotionConfig
<MotionConfig transition={{ duration: 0.4, ease: "easeInOut" }}>
  <motion.div
    animate={{ x: 100 }}
    transition={{ inherit: true, ease: "easeOut" }}
  />
</MotionConfig>
```

---

### 4. Theme-Based Animation Systems

#### 4a. CSS Variable-Driven Animations

Motion can animate to/from CSS variables, enabling theme-responsive, breakpoint-aware animations with Tailwind CSS:

```tsx
<motion.div
  className="
    p-8 bg-rose-500 text-white rounded-xl max-w-md mx-auto
    [--entry-distance-y:20px] 
    md:[--entry-distance-y:50px]
  "
  initial={{ opacity: 0, y: "var(--entry-distance-y)" }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ type: "spring", bounce: 0.25 }}
/>
```

On medium screens, `y` starts at `50px`; on small screens, `20px`. The animation interpolates the CSS variable value.

[Source](https://motion.dev/docs/react-tailwind)

#### 4b. Global Theme Configuration via MotionConfig

```tsx
import { MotionConfig } from "motion/react"

function App() {
  return (
    <MotionConfig
      transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
      reducedMotion="user"
    >
      <YourApp />
    </MotionConfig>
  )
}
```

`MotionConfig` supports:
- `transition` — default transition for all children
- `reducedMotion` — respect user preference (`"user"`, `"always"`, `"never"`)
- `skipAnimations` — globally disable for testing (v12.30+)
- `nonce` — CSP nonce for injected styles

#### 4c. Spring Configuration — Complete Parameter Reference

Motion supports two spring configuration modes:

**Physics-based springs** (velocity-preserving, ideal for gesture-driven animations):
```tsx
{ type: "spring", stiffness: 100, damping: 10, mass: 1 }
```

**Duration-based springs** (easier to coordinate, fixed duration):
```tsx
{ type: "spring", bounce: 0.25, duration: 0.8 }
// or:
{ type: "spring", visualDuration: 0.5, bounce: 0.3 }
```

| Parameter | Default | Description |
|-----------|---------|-------------|
| `stiffness` | 1 | Spring strength (higher = snappier) |
| `damping` | 10 | Opposing force (0 = oscillate indefinitely) |
| `mass` | 1 | Inertia (higher = more lethargic) |
| `bounce` | 0.25 | Bounciness: 0 = none, 1 = extreme |
| `duration` | 0.8 | Total animation duration (seconds) |
| `visualDuration` | — | Time to visually appear settled (bulk before, bouncy bit after) |
| `velocity` | — | Initial velocity |
| `restSpeed` | 0.1 | Speed threshold to end animation |
| `restDelta` | 0.01 | Distance threshold to end animation |

#### 4d. CSS Spring Generation (Motion+ / AI Kit)

Motion can generate `linear()` CSS easing functions for pure CSS spring animations — no JS bundle required:

```css
@theme {
  --ease-spring-snappy: linear(0, 0.2375, 0.5904, 0.8358, 0.9599, 1.0061, 1.0152, 1.0116, 1.0062, 1.0025, 1.0006, 0.9999, 1);
  --ease-spring: linear(0, 0.0942, 0.2989, 0.5275, 0.73, 0.8839, 0.9858, 1.0425, ...);
  --ease-spring-soft: linear(0, 0.0332, 0.1241, 0.2583, ...);
}
```

Usage: `<div className="transition-transform duration-700 ease-spring-soft">`

These are generated via AI prompts like "Make a CSS spring curve, snappy but bouncy". [Source](https://motion.dev/docs/studio-generate-css)

#### 4e. springValue — Reactive Spring Motion Values

Attach spring physics to any value, reacting to pointer or scroll input:

```tsx
import { springValue, motionValue, styleEffect } from "motion"

const pointerX = motionValue(0)
const x = springValue(pointerX, { stiffness: 500, damping: 30 })

document.addEventListener("pointerMove", (e) => x.set(e.clientX))
styleEffect("div", { x })
```

This is ideal for cursor-following effects, parallax, and reactive UI elements that need natural-feeling physics. [Source](https://motion.dev/docs/spring-value)

---

### 5. New Features for Splash Screens & Page Transitions

#### 5a. AnimateView — Built for Page Transitions

The most significant feature for splash screens and page routing. `AnimateView` wraps the browser's View Transition API, providing:

- **Full-page wipe/slide effects** with `clipPath` animations
- **Shared element transitions** between pages via `name` prop
- **Suspense integration** — animate from fallback to content
- **Custom transitions** with springs and per-property overrides

```tsx
// Splash screen with AnimateView and Suspense
<AnimateView
  transition={{ type: "spring", visualDuration: 0.6, bounce: 0 }}
  enter={{ opacity: 1, scale: [0.95, 1] }}
  exit={{ opacity: 0, scale: [1, 1.05] }}
>
  <Suspense fallback={<SplashFallback />}>
    <MainContent />
  </Suspense>
</AnimateView>
```

#### 5b. animateView() — Vanilla JS Page Transitions

The vanilla `animateView()` function (Motion+ Early Access) supports the same capabilities outside React:

```javascript
animateView(update)
  .enter({ opacity: 1, clipPath: ["inset(0 100% 0 0%)", "inset(0 0% 0 0%)"] })
```

Features include layout animation, shared element transitions, and page effects (wipes, slides, crossfades). [Source](https://motion.dev/docs/animate-view)

#### 5c. `popLayout` Mode — Smooth List Transitions

The `mode="popLayout"` on `AnimatePresence` removes the exiting element from layout flow immediately, allowing siblings to instantly reflow. Combined with the `layout` prop, this creates fluid list item removal animations:

```tsx
<AnimatePresence mode="popLayout">
  {items.map(item => (
    <motion.li 
      key={item.id} 
      layout 
      exit={{ opacity: 0, x: -50 }}
      transition={{ type: "spring", bounce: 0, duration: 0.3 }}
    />
  ))}
</AnimatePresence>
```

#### 5d. `layoutAnchor` — Custom Projection Reference Points

New in v12.38.0, `layoutAnchor` lets you customize the anchor point used for resolving relative layout projections. This is useful when parent and child animate with different transitions:

```tsx
<motion.li
  layout
  layoutAnchor={{ x: 1, y: 0 }}  // Anchor to bottom-right
  transition={{ delay: 1 }}
/>
```

Setting `layoutAnchor={false}` disables relative projection — elements animate relative to their page-absolute position change.

#### 5e. Recent CHANGELOG Highlights (v12.33–12.40)

- **v12.40** (May 2026): `path` option for transitions, `arc()` for motion along an arc
- **v12.39** (May 2026): `repeatType` and `repeatDelay` in sequences; variant keyframe replay; drag fixes with React 19 reordering
- **v12.38** (March 2026): `layoutAnchor` prop; `oklch`/`oklab`/`lch`/`light-dark` color type support
- **v12.36** (March 2026): Axis-locked layout animations (`layout="x"`, `layout="y"`); `dragSnapToOrigin` accepts `"x"`/`"y"`; `skipInitialAnimation` for `useSpring`
- **v12.34** (Feb 2026): Hardware-accelerated `useScroll` animations; `AnimatePresence` mode-change support
- **v12.33** (Feb 2026): `<motion />` `propagate.tap` prop to prevent tap gesture propagation
- **v12.30** (Feb 2026): `MotionConfig` `skipAnimations` global option

[Source: Full CHANGELOG](https://github.com/motiondivision/motion/blob/main/CHANGELOG.md)

---

## Sources

- **Kept**: Motion Upgrade Guide (https://motion.dev/docs/react-upgrade-guide) — Official v12 migration documentation with zero-breaking-changes confirmation
- **Kept**: Motion Independence Announcement (https://motion.dev/blog/framer-motion-is-now-independent-introducing-motion) — Context on the rebrand, new vanilla APIs, and project direction
- **Kept**: AnimatePresence Docs (https://motion.dev/docs/react-animate-presence) — Complete API reference for exit animations and modes
- **Kept**: AnimateView Docs (https://motion.dev/docs/react-animate-view) — Early access page transition component with code examples
- **Kept**: View Animations Docs (https://motion.dev/docs/animate-view) — Vanilla JS animateView() function reference
- **Kept**: Tailwind CSS Integration (https://motion.dev/docs/react-tailwind) — CSS variable animations, responsive animations, CSS spring generation
- **Kept**: Spring Docs (https://motion.dev/docs/spring) — JS/CSS spring generation, all configuration options
- **Kept**: React Transitions Docs (https://motion.dev/docs/react-transitions) — Complete transition type reference with all parameters
- **Kept**: LayoutGroup Docs (https://motion.dev/docs/react-layout-group) — Layout grouping and namespace scoping
- **Kept**: springValue Docs (https://motion.dev/docs/spring-value) — Attaching springs to motion values
- **Kept**: Motion CHANGELOG (https://github.com/motiondivision/motion/blob/main/CHANGELOG.md) — Full version history through v12.40.0
- **Kept**: React View Transition API Blog (https://motion.dev/magazine/reacts-experimental-view-transition-api) — Deep dive on view transitions and AnimateView design rationale
- **Kept**: Motion Component Docs (https://motion.dev/docs/react-motion-component) — Complete prop reference for all motion components
- **Kept**: Motion+ Page (https://motion.dev/plus) — Early access features list and membership details

- **Dropped**: checklist.day registry page — Thin auto-generated summary, no primary value beyond npm metadata
- **Dropped**: npmx.dev package page — Only confirms latest version number; official docs are better

---

## Gaps

1. **AnimateView is early access** — requires Motion+ membership and `react@canary`. The production API may change. Cannot recommend for production use until it exits early access (~610 days per the docs counter).

2. **Vue support** — The `motion-v` package exists but was not researched. This brief focuses on React/vanilla JS.

3. **Bundle size comparisons** — The research didn't quantify the exact bundle size differences between `motion` (full), `motion/react-m` (mini), and `motion/react-client` (RSC). The full bundle is approximately 33KB for the `motion` component; the mini `animate()` is 2.3KB.

4. **Real-world splash screen patterns** — While the APIs support splash screens well (AnimatePresence for mount/unmount, AnimateView for page-level transitions, useAnimate for imperative sequences), concrete multi-step splash screen examples (loading → ready → dismiss) were not found. Suggested next step: build a custom pattern combining `useAnimate` with CSS variables.
