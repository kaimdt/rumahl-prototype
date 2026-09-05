# rumahl OS design system

The frontend uses the existing theme variables, React components and Radix
primitives as one OS design system. Application behavior, API contracts and window
geometry remain owned by their existing contexts and handlers.

## Sources of truth

- `frontend/src/index.css`: semantic tokens, shared controls, shell materials and
  app layout rules. Theme definitions remain the source of color values.
- `frontend/src/components/ui/`: the existing Button, Input, Textarea, Select,
  Checkbox, RadioGroup, Switch, Slider, Toggle, Tabs, Menu and Dialog APIs.
- `OsAppNavbar`: a titlebar with app identity and window actions, followed by an
  optional wrapping toolbar for leading controls, search and trailing actions.
- `OsAppFrame`: navigation, optional toolbar/sidebar/details and scrollable content.
- `OsWindowFrame`: focus, window bounds, snapping, dragging and resizing.
- `frontend/src/lib/motion.ts`: JavaScript animation presets; the CSS duration
  tokens use the same fast, panel and page timing tiers.

## Surface hierarchy

| Role | Token | Treatment |
| --- | --- | --- |
| Desktop | `--surface-desktop` | Theme background; wallpaper remains user controlled |
| Window | `--surface-window` | Strong border, window radius and active elevation |
| Content | `--surface-base` | Opaque reading surface without independent blur |
| Panel | `--surface-raised` | Quiet contrast for grouped controls |
| Sidebar | `--surface-sidebar` | Theme background with a subtle accent tint |
| Toolbar | `--surface-toolbar` | Subtle separation from content |
| Menu / popover | `--surface-overlay` | Strong border and menu shadow |
| Dialog | `--surface-dialog` | Dialog shadow above a scrim |
| Scrim | `--surface-scrim` | Background isolation for a blocking overlay |

Do not redefine these tokens with fixed dark colors in desktop mode. Light,
night, midnight, evening, sleep and custom themes must all derive their surfaces
from `--background`, `--card`, `--popover` and `--foreground`.

Use `--text-primary`, `--text-secondary`, `--text-muted`, `--border-default`,
`--border-strong`, `--selection` and `--focus-ring` for neutral states. Status colors
use `--success`, `--warning` and `--destructive`. Existing compatibility aliases
remain available to installed themes and apps.

## Controls and layout

Use the existing `Button` variants: default, secondary, outline, ghost,
destructive, link and glass. The glass variant remains supported and uses the
secondary material. Buttons have no independent blur or enlargement animation.
The legacy `rumahl-primary-button`, `rumahl-secondary-button`, small variants and
`rumahl-field` classes share these foundations.

Inputs use an opaque surface, a visible border and the shared focus treatment.
Radix retains its keyboard handling, disabled states, form behavior and selection
semantics. Keep dynamic slider gradients and caller-supplied class names where
they communicate application data or user preferences.

`--density-control`, `--density-row`, `--titlebar-height`, `--toolbar-height`,
`--sidebar-width` and the existing spacing tokens define geometry. Touch controls
use the coarse-pointer density. `--r-xs` through `--r-xl` define the main radius
scale; Tailwind radius tokens and legacy radius aliases refer to that scale.

Normal OS apps fill their available window width. Do not add centered `max-w-7xl`
page wrappers inside application frames. Group related information with sections
and separators; reserve cards for meaningful independent groups. Dashboard widget
layouts, data visualization colors and user-selectable card presets remain
independent features rather than being flattened globally.

## Window and portal behavior

Window titlebars and toolbars are distinct rows. A toolbar can wrap without
shrinking the title or hiding the window controls. Avoid fixed header heights or
positional `nth-child` rules tied to a particular toolbar child count.

Inactive windows use a softer shadow. Do not apply brightness or saturation
filters to the entire window: that changes the meaning and contrast of app data.
Maximized windows remove the floating radius and shadow. Drag/resize geometry
continues to use the existing inline styles; these values are functional state.

The static portal order is defined by `--layer-windows`, `--layer-shell`,
`--layer-flyout`, `--layer-dialog`, `--layer-menu`, `--layer-tooltip` and
`--layer-critical`. Window-to-window ordering still uses the window manager's
dynamic z-index. A select or submenu opened inside a dialog must remain above that
dialog. Accessibility preferences cover reduced motion, reduced transparency,
larger text and high contrast. The existing glass settings also control the new
surface/overlay blur tokens and dock opacity; disabling glass resets blur to zero.

## Migration coverage and boundaries

The consolidation covers the shared primitives, desktop/start/launcher surfaces,
dock menus, notification popover, quick settings, application chrome, Files and
its picker, Settings and its shared helpers, and the Containers, Devices, Images,
Logs, Maintenance, Security, Services, Storage and System applications. Existing
app-frame consumers inherit the same surfaces without changing their handlers.

The local App Store frame, toolbar and handoff surface use these foundations. The
storefront iframe is served by `store.rumahl.com`; its internal document is not
styled by this frontend's stylesheet. Embedded third-party apps and user-authored
themes likewise retain ownership of their content.

## Verification

Run from `frontend`:

```sh
npm run build
node --test src/test/design-system.test.mjs
node node_modules/eslint/bin/eslint.js src/components
node node_modules/typescript/bin/tsc --noEmit --pretty false
```

The production build uses `--noCheck`, so report the separate TypeScript result.
At migration time the full typecheck has 13 existing diagnostics, also present in
the source branch. ESLint reports the same 11 existing warnings and no errors.
The twelve Node regression tests pass, including disabling/re-enabling glass effects.
The new Node regression suite does not require Bun. The
repository's existing Bun tests still require an installed Bun runtime.

Manual visual verification is still required; automated builds and static/SSR
tests do not prove responsive layout, focus visibility or color contrast:

| Scenario | Checks |
| --- | --- |
| Light and dark themes | Window/sidebar separation, text, disabled controls, dialogs |
| Desktop | Open two apps; focus, drag, resize, snap, maximize, restore, minimize |
| Narrow window | Titlebar controls remain reachable; toolbar search wraps |
| Launcher layouts | Search, Enter/Escape, paging, folders, app launch and edit mode |
| Files | Sidebar, table/grid, context menu, picker and confirmation dialogs |
| Settings | Tabs, text fields, switches, selects and retained setting values |
| Portals | Nested select/submenu above dialogs; Escape and focus restoration |
| Accessibility | Keyboard, high contrast, reduced motion/transparency, text scaling |
| Touch | Comfortable targets and usable toolbar wrapping |

During this session the Windows UI automation tool stopped because it could not
reliably identify the browser URL. No visual verification is claimed.

## Shell feedback follow-up

Desktop status controls now sit on an opaque theme surface, so dark light-theme
icons do not disappear against a dark wallpaper. The start menu uses compact app
rows and the same header/content materials as app windows. The launcher returns
to a wallpaper-based icon grid, pill search and rounded widgets, retaining its dock.

Immersive apps fill the viewport without page gutters. Escape and exit controls
return to the active app; window/split/minimize/close transitions clear immersive
state. Maximized windows fill the work area above the desktop taskbar and restore
the prior rectangle even when React replays the state updater. Regression tests
cover this restoration and the work-area/fullscreen bounds. Visual QA is pending.
