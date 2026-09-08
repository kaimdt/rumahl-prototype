**Comparison target**

- Source visual truth: `C:\Users\kaima\AppData\Local\Temp\codex-clipboard-81c86822-ade6-4bf6-921b-9ab0d3217fa7.png`
- Supporting source: `C:\tmp\home-assistant-dashb\rumahl_os_desktop_replica.html`
- Implementation screenshot: `C:\tmp\home-assistant-dashb\implementation-midnight-hearth.jpg`
- Combined comparison: `C:\tmp\home-assistant-dashb\design-qa-comparison.jpg`
- Viewport and state: 1536 × 1024 CSS px, authenticated Desktop Mode, Files and Admin Center open

**Findings resolved**

- [P0] The previous comparison stopped at authentication. The authenticated desktop state now renders and is captured.
- [P1] The implementation previously looked like a dashboard on a dark background. It now uses the real OS window manager with overlapping, focusable native windows.
- [P1] Admin Center previously used bright dashboard cards and a different information architecture. Desktop Mode now has the reference sidebar, health header, performance chart, service table, and compact graphite surfaces.
- [P1] Desktop content was constrained by the dashboard content container. Desktop and window layers now render at the viewport shell level.
- [P2] Desktop shell geometry, icon scale, task rail, purple accent use, window borders, and the Shell Mode popover were aligned to the reference.
- [P2] Desktop time now includes a compact date line and quick settings open above the bottom task rail.

**Interaction verification**

- Desktop windows are opened through the existing OS window context and retain focus, drag, minimize, maximize, close, and snap behavior.
- Shell Mode exposes Automatic, Desktop, and Launcher without replacing the existing touch launcher.
- Desktop icons open their corresponding OS apps.
- Admin Center navigation and the diagnostics/services controls remain interactive.

**Follow-up polish**

- The workspace and task-switcher overlays shown in the source are transient states; they are not forced into the default desktop state.
- Backend error notifications remain visible during local offline development, but now use the dark shell styling and bottom placement.

**Current multi-app pass**

- Files, System Monitor, Settings, App Store, and Images now share the compact Midnight Hearth desktop application tokens and native window density.
- System Monitor now includes the reference-aligned CPU history chart while preserving the existing live system, disk, process, and network data paths.
- Production build: passed.
- Browser verification is currently blocked because the authenticated preview switched to the rumahl OS session-lock screen before the five app states could be captured.
- Navbar revision: oversized gradient app marks were removed from the shared `OsAppNavbar`; apps now use a small unboxed icon and compact title text in a single 42 px desktop title bar.
- Settings revision: the former card-based settings surface was replaced by an edge-to-edge two-pane structure with a 198 px category rail, a dedicated content heading, compact expandable rows, flat controls, and no decorative icon tiles.
- Latest ESLint, TypeScript no-check build, and Vite production build: passed on 2026-08-29.
- Foundation pass: introduced the semantic Midnight Hearth token contract for surfaces, text, borders, spacing, radii, shadows, blur, motion, and desktop/touch density.
- Foundation pass: introduced `OsAppFrame` as the shared app layout primitive and migrated `OsAppWindow` away from its bespoke gradient icon/titlebar treatment.
- Current preview capture still shows the session-lock screen, so the new frame cannot yet be compared with the authenticated reference state.
- Settings pilot migration: `SettingsPage` now mounts inside `OsAppFrame`, with its Radix tab state preserved across the shared navbar, sidebar, and content regions.
- Settings control rows are now flat, separator-led OS rows instead of nested rounded cards; all existing switches and handlers remain wired.
- Latest Settings pilot ESLint, TypeScript no-check, and production build: passed on 2026-08-29.
- Fullscreen regression resolved: the shared in-app titlebar now delegates to `toggleMaximize` whenever the app is hosted in a desktop window. Browser verification confirmed Files and Settings at 1472 × 1042 inside a 1488 × 1058 viewport, with the action changing to Restore.
- Settings responsive P1 resolved: the category rail is forced to a vertical OS sidebar at desktop shell widths, with fixed 34 px rows instead of inherited full-height Radix tabs.
- Remaining P2: the maximized Settings detail column still leaves more unused horizontal space than Admin Center and several legacy controls remain visually nested. Continue the structural migration before passing design QA.
- Settings detail width now follows the desktop reference density up to 1080 px; the profile summary is flattened, the primary save action is compact, and the inner profile card was removed.
- Fullscreen root cause fixed for hybrid touch desktops: the 640 px responsive navbar rule had moved window controls into an invisible fourth grid row while the global touch rule enlarged them beyond the 42 px titlebar. Desktop window actions now remain in a single row at 28 px; the Launcher touch targets remain unchanged.
- Browser hit-testing and interaction verification now confirm the Settings maximize button changes the window to 610 × 626 and exposes Restore at the current embedded viewport.
- Settings scrolling P0 resolved: the shared content viewport now has a definite 100% height, contained overscroll, and a stable scrollbar gutter. Browser wheel verification moved Appearance from scrollTop 0 to 490 (6851 px total content) and General from 0 to 522.
- Security and Appearance density pass: PIN/passkey actions are compact inline controls, helper copy uses separator-led metadata styling, and theme choices are smaller 88 px system options instead of large dashboard tiles.
- Dashboard density pass: Page Designer and YAML actions now render as compact tool rows with small icons, restrained borders, and Admin Center-scale typography instead of oversized accent cards.
- System density pass: CPU/RAM, backend facts, Home Assistant status, version metadata, and domain counts now use compact resource and information rows rather than a collection of unrelated dashboard cards.
- Browser verification on `/settings/dashboard` and `/settings/system`: category selection remained active, two Dashboard tool rows and eleven System fact rows rendered, System scrolling moved from scrollTop 829 to 1309, and the maximize action changed its title to `Wiederherstellen` while increasing the content viewport from 457 px to 582 px.
- Latest focused ESLint, TypeScript no-check build, and Vite production build: passed on 2026-08-29. The global `npx` shim is broken on this host, so verification used the same locally installed project binaries directly.

**Task-switcher pass**

- Source visual truth: `/var/folders/g9/w0jh8x3s5x1d9h953djdjkw40000gn/T/codex-clipboard-2384145f-a0fa-4169-88d9-0ef824c56994.jpg` (2974 × 1058 px).
- Implementation URL: `http://127.0.0.1:4173/`, 1280 × 720 CSS px at device pixel ratio 2.
- Open windows now take priority in the task switcher, with focused and running states represented explicitly.
- The task switcher is compact and bottom-anchored above the taskbar to match the source's spatial hierarchy.
- Production build, focused ESLint, and `git diff --check`: passed.
- Browser comparison is blocked because the local preview stops at the unauthenticated login screen while the backend is unavailable; the authenticated task-switcher state could not be captured.

**Native switching and taskbar preview pass**

- Implementation state: authenticated Desktop Mode at `http://127.0.0.1:5173/settings`, 1908 × 1216 CSS px at device pixel ratio 1.
- Alt/Option + Tab now keeps an explicit selection index, advances through open windows on repeated presses, and focuses the selected window when the modifier is released.
- Running taskbar apps now expose an interactive window preview with app identity, minimized/running state, window dimensions, focus, minimize, and close controls.
- Browser verification confirmed the authenticated desktop, two overlapping native windows, five taskbar entries, and a visible Files preview measuring 216 × 142.8 CSS px with the expected `Dateien`, `Aktives Fenster`, and `1405 × 641` content.
- First comparison found a P1 overflow defect: the preview existed but was clipped by the taskbar's horizontal scrolling container. The taskbar overflow and stacking layer were corrected; post-fix browser evidence reports the preview visible at full size and opacity 1.
- Primary interactions checked: taskbar hover preview state and focus target. Destructive preview controls were not clicked during QA because they would alter the user's open local session.
- Fonts and typography: compact 10–11 px system hierarchy remains aligned with the existing Midnight Hearth desktop tokens.
- Spacing and layout rhythm: preview is anchored directly above its taskbar app; the switcher uses consistent 11 rem preview columns and compact 5.5 rem window cards.
- Colors and visual tokens: graphite surfaces, restrained purple app accents, borders, and elevation reuse the existing desktop token direction.
- Image quality and asset fidelity: existing real app icons are reused; no replacement raster or approximate icon assets were introduced.
- Copy and content: all new visible labels are localized in English and German.
- Production build, focused ESLint, TypeScript no-check validation, locale JSON parsing, and `git diff --check`: passed on 2026-08-29.
- The source task-switcher image's original temporary path is no longer available as a standalone local artifact. The repository retains the earlier combined comparison, but a strict same-state side-by-side comparison cannot be regenerated in this pass.

**Virtual workspace pass**

- Source visual truth: the workspace control in `C:\tmp\home-assistant-dashb\design-qa-comparison.jpg` (reference side, compact top-center `1`, `2`, `+` strip).
- Implementation state: authenticated Desktop Mode at `http://127.0.0.1:5173/settings`, 1908 × 1216 CSS px at device pixel ratio 1.
- The window manager now persists up to four workspaces, stores a workspace id on every window, restores legacy windows into workspace 1, and keeps geometry/session persistence intact.
- The top-center workspace strip exposes active state, occupied-state dots, add, hover-only remove, and localized accessible labels.
- Dock apps, taskbar previews, Alt/Option-Tab, snap shortcuts, URL focus sync, split view, and the window overlay are scoped to the active workspace.
- Taskbar context menus can move a running window to another workspace; switching to that workspace restores the window and its route.
- Browser interaction evidence: workspace 2 hid the workspace-1 window (`0` rendered windows); switching back restored it (`1` rendered window). Moving Settings from workspace 1 to 2 produced `0` then `1` rendered windows on the destination, and moving it back restored the original state.
- Keyboard evidence: Ctrl+Alt+ArrowRight selected workspace 2 and Ctrl+Alt+ArrowLeft returned to workspace 1.
- P1 iteration: the expanded taskbar context menu initially extended below the viewport. It now uses viewport-safe positioning and a bounded scrolling height; the destination action measured fully inside the viewport at y 1040 with 36 px height.
- P1 iteration: URL-to-window synchronization initially pulled a moved window back into the source workspace. Moving a window now routes the source workspace to the launcher first; the repeated transfer passed in both directions.
- Fonts and typography: compact 10–11 px control hierarchy matches the existing desktop chrome.
- Spacing and layout rhythm: the strip measures 135 × 35.6 CSS px with the same top-center hierarchy as the reference; occupied-state counts were reduced to quiet dots after visual review.
- Colors and visual tokens: workspace chrome derives from the active theme tokens and retains the established violet active state.
- Image quality and asset fidelity: the control uses the existing Phosphor icon system; no approximate image assets were introduced.
- Copy and content: workspace actions and configurable shortcuts are localized in English and German.
- Production build, focused ESLint, TypeScript no-check validation, locale JSON parsing, and `git diff --check`: passed on 2026-08-29.
- Strict design QA remains blocked because the implementation screenshot cannot be stored alongside the source in a same-state combined local comparison artifact during this pass.

final result: blocked

## Admin Center integration and window snap-menu repair — 2026-08-30

**Evidence**
- Source visual truth: `C:/Users/kaima/AppData/Local/Temp/codex-clipboard-c49dc24e-0f32-4990-94bc-c404a53d9fed.png` (1048 × 560 px), Midnight desktop with Files and a visibly collapsed snap-layout menu.
- Implementation target: `http://localhost:5174/`, authenticated frontend demo, Midnight desktop with Files and Admin Center windows.
- Browser-rendered evidence: in-app browser capture at 1912 × 1080 CSS px, device scale 1, showing the redesigned Admin Center overview; the browser surface did not provide a persistent screenshot file path.
- State: Admin Center overview and integrated Services page. The source and implementation states differ because the source documents the snap-menu defect while the implementation screenshot documents the Admin Center result.
- Primary interactions tested: Admin Center overview rendering, Services sidenav selection, embedded Services search and refresh controls, preservation of outer minimize/maximize/close controls.
- Console errors checked: blocked after the browser URL policy rejected subsequent local-page inspection.
- Focused comparison: the broken menu width was traced to the descendant selector `.rumahl-window-actions button`; it forced every snap-menu action to the 28 px titlebar-button width. The selector now targets only direct window-control buttons.

**Findings**
- [Fixed P0] Snap-layout action labels collapsed to one word/character per line because menu descendants inherited the 28 px window-control width.
- [Fixed P1] Desktop Admin Center navigation opened separate applications rather than switching content inside the Admin Center.
- [Fixed P1] Admin overview displayed static sample services and treated a missing health response as healthy.
- [Fixed P1] Hiding embedded app navbars also hid the Admin Center's outer window controls via the existing `:has(.rumahl-app-navbar)` chrome rule.
- [Fixed P2] Admin sidebar and embedded app surfaces used hard-coded dark gradients rather than shared theme tokens.
- [Blocked] The browser URL policy interrupted the multi-page visual pass before Storage, Network, Devices, Containers, Logs, System, Updates, Backups, Users, and the repaired open snap menu could be captured and compared.

**Required fidelity surfaces**
- Typography: Admin Center and embedded apps use the shared Segoe desktop scale; the captured overview shows stable title, caption, table, and sidebar hierarchy.
- Spacing/layout: the captured overview preserves the reference's compact sidebar and content density; embedded Services retains its functional toolbar under the Admin shell.
- Colors/tokens: Admin shell, sidebar, content, cards, borders, focus states, and embedded frames now derive from `--background`, `--card`, `--foreground`, `--border`, and semantic status tokens.
- Image quality: existing Phosphor icons and application assets are preserved; no raster assets were added or approximated.
- Copy/content: new health, check-time, service-state, empty-state, and summary copy is localized in German and English.

**Comparison history**
- Initial source: Files window snap menu visibly collapsed and overlapping.
- Iteration 1: narrowed titlebar sizing selectors to direct controls; centralized Admin Center routing and replaced static service data with API responses.
- Iteration 2: browser capture exposed missing outer controls on the integrated Services page; the Admin Center now always retains its outer titlebar while embedded toolbars keep app-specific controls without duplicate window actions.
- Post-fix evidence: DOM snapshot confirms Admin Center minimize/maximize/close plus Services search, refresh, filters, and empty state coexist in one window.

**Implementation checklist**
- [x] Repair snap-menu descendant sizing.
- [x] Integrate administrative system surfaces into one Admin Center shell.
- [x] Preserve legacy page IDs as Admin Center deep links.
- [x] Remove administrative surfaces from independent launcher/taskbar app registration.
- [x] Replace static overview service rows with live API data.
- [x] Correct health checking and localized timestamps.
- [x] Preserve embedded app operations and outer window controls.
- [x] Pass TypeScript, ESLint, production build, and diff checks.
- [ ] Complete browser captures for every integrated section and the open repaired snap menu when the local URL policy permits it.

final result: blocked

## Command center and keyboard-focus pass — 2026-08-29

**Evidence**
- Source visual truth: the rendered Midnight UI desktop at `http://localhost:5174/`, with compact Windows-like window chrome, monochrome surfaces, thin borders, and white focus accents.
- Implementation target: the same demo with the global rumahl command center opened by Ctrl+K or the configured Spotlight shortcut.
- Viewport and density: 1264 × 712 CSS px at device scale 1; browser capture is also 1264 × 712 px, so no density normalization was required.
- Implementation screenshot: full Midnight UI desktop captured successfully in the in-app browser; the command-center open state could not be captured because the browser-control surface did not expose keyboard injection for this tab.
- Primary interactions inspected: desktop/window rendering, accessible control tree, existing command shortcut wiring, query navigation logic, action execution, focus return, and translated command content.
- Console errors checked: no browser-console capture was available through the attached demo tab.
- Focused comparison: blocked for the open command-center region; the surrounding full desktop was inspected at native size.

**Findings**
- [Fixed P2] The command palette used fixed neutral colors and rounded web-modal geometry instead of shell/theme tokens.
- [Fixed P2] The active command was only visually selected and lacked complete combobox/listbox relationships for assistive technology.
- [Fixed P2] Keyboard navigation did not scroll the selected result into view or return focus to the invoking control after dismissal.
- [Fixed P3] Shortcut discovery was limited to an Escape badge and did not explain navigation or execution keys.
- [Blocked] A captured open-state interaction is still required to verify exact overlay height, footer wrapping, list scrolling, focus ring visibility, and Midnight contrast.

**Required fidelity surfaces**
- Typography: search, groups, results, descriptions, and keyboard hints use the existing responsive desktop hierarchy; open-state visual verification is blocked.
- Spacing/layout: compact 0.9 rem shell radius, 2.35 rem footer, bounded result list, and native-density rows replace the oversized modal treatment; open-state verification is blocked.
- Colors/tokens: popover, foreground, accent, borders, and system shadows now adapt to Midnight UI and all other themes instead of using fixed neutral colors.
- Image quality: existing app images and Phosphor icons remain unchanged; no new raster assets or substitute glyph art were introduced.
- Copy/content: command title, Midnight action, shortcut hint, navigation, and open labels were added to both German and English locale files.

**Comparison history**
- Captured and inspected the running Midnight desktop demo and its accessible control tree.
- Traced the existing CommandPalette, global shortcut registry, and OsSystemShell keyboard dispatcher before editing.
- Added theme-native material, selection/focus states, focus restoration, selected-result scrolling, combobox/listbox semantics, keyboard help, and a Midnight UI action.
- TypeScript, ESLint, production build, locale parsing, and targeted diff validation passed after the change.

**Implementation checklist**
- [x] Preserve the existing centralized shortcut registry and command behavior.
- [x] Unify the command center with the active theme and desktop material.
- [x] Add focus restoration and selected-result scrolling.
- [x] Add accessible dialog, combobox, listbox, option, active-descendant, and busy semantics.
- [x] Add translated keyboard help and direct Midnight UI activation.
- [ ] Capture the opened command center and verify keyboard interaction visually in the demo.

final result: blocked

## System feedback, loading and progress pass — 2026-08-29

**Evidence**
- Source visual truth: the ongoing Windows-like rumahl desktop direction requested by the user; no normalized source capture is available for a combined comparison.
- Implementation target: `http://127.0.0.1:5173/`, desktop state with Sonner toasts, shared loading panels, inline activity indicators, determinate progress, and offline feedback.
- Intended viewport: 1908 × 1216 and 1366 × 768 CSS px at device scale 1.
- Implementation screenshot: the current browser render was captured successfully, but without the backend it stops at the login screen; authenticated desktop feedback states could not be reached.
- Primary interactions intended for verification: trigger success/warning/error toasts, dismiss or act on a toast, refresh an admin surface, observe inline loading, and inspect determinate progress.
- Console errors checked: unavailable for the authenticated desktop state because no backend session exists.
- Focused comparison: blocked because the source visual and reachable implementation do not represent the same authenticated desktop state.

**Findings**
- [Fixed P2] Toasts, shared loading panels, inline spinners, and progress bars used unrelated density, elevation, and motion treatments.
- [Fixed P2] Toast placement and typography did not consistently follow the responsive desktop type and taskbar geometry.
- [Fixed P2] The shared full-panel loading state lacked explicit status semantics for assistive technology.
- [Blocked] An authenticated desktop capture is required to verify toast stacking, action fit, progress contrast, motion, and taskbar clearance.

**Required fidelity surfaces**
- Typography: toast title, description, actions, and loading labels now use the shared responsive desktop type scale; authenticated screenshot verification is blocked.
- Spacing/layout: feedback uses compact Windows-like radii, restrained padding, taskbar-relative placement, and bounded loading panels; in-app verification is blocked.
- Colors/tokens: semantic accent, success, warning, destructive, foreground, card, and background tokens drive all new status treatments; contrast sampling is blocked.
- Image quality: no bitmap or logo assets were changed; existing Phosphor and Sonner icons remain code-native and appropriate for system feedback.
- Copy/content: existing translated toast and loading strings are preserved; no new visible copy was introduced.

**Comparison history**
- Diagnosed Sonner, Radix progress, and shared Admin loading as the main reusable feedback primitives.
- Added semantic hooks and desktop-scoped styling without changing notification, loading, or progress behavior.
- Added polite live status semantics and reduced-motion handling.
- TypeScript, ESLint, production build, and diff validation passed after the change.

**Implementation checklist**
- [x] Unified toast material, density, semantic edge color, and actions.
- [x] Unified shared loading and inline spinner treatment.
- [x] Unified determinate progress geometry and token usage.
- [x] Added accessible shared loading status and reduced-motion behavior.
- [ ] Capture and test authenticated desktop feedback states with a running backend.

final result: blocked

## Native desktop flyouts pass — 2026-08-29

**Evidence**
- Source visual truth: the ongoing Windows-like native desktop direction requested by the user; no normalized reference capture is available for combined pixel comparison.
- Implementation target: `http://127.0.0.1:5173/`, desktop/light state with Start menu, Quick Settings, and Notification Center open individually.
- Intended viewport: 1908 × 1216 and 1366 × 768 CSS px at device scale 1.
- Implementation screenshot: unavailable in this run. The two claimed in-app browser tabs remain in Chromium crash/connection-error states although the local Vite endpoint responds successfully.
- Primary interactions intended for verification: taskbar launch, backdrop dismissal, search focus, Quick Settings actions, Notification Center scrolling and dismissal.
- Console errors checked: unavailable because no valid current-run page could be attached.
- Focused comparison: blocked with the full-view capture; source and implementation could not be placed in one comparison input.

**Findings**
- [Fixed P1] Start menu used a 64rem-wide mobile launcher composition positioned high in the viewport instead of a taskbar-anchored desktop surface.
- [Fixed P2] Quick Settings and Notification Center opened from the top while their triggers live in the bottom taskbar.
- [Fixed P2] Flyout radii, shadows, typography, tile geometry, and compact labels were inconsistent across the three surfaces.
- [Blocked] Current screenshot evidence is required to verify overlap, visual hierarchy, contrast, wrapping, image sharpness, and responsive behavior.

**Required fidelity surfaces**
- Typography: aligned in code to the shared Segoe-based desktop caption, secondary, and body tokens; screenshot verification blocked.
- Spacing/layout: all three flyouts now rise from the responsive taskbar and share bounded desktop widths/heights; screenshot verification blocked.
- Colors/tokens: unified background mixing, borders, blur, and elevation reuse existing theme tokens; screenshot contrast sampling blocked.
- Image quality: existing app raster assets and Phosphor icons are preserved; visual sharpness inspection blocked.
- Copy/content: existing translated strings and behaviors are preserved without new visible copy.

**Comparison history**
- Diagnosed three unrelated overlay geometries and sub-10 px utility text.
- Added semantic component hooks and a shared taskbar-anchored desktop flyout treatment without changing application logic.
- TypeScript, ESLint, production build, and diff validation passed after the change.

**Implementation checklist**
- [x] Taskbar-anchored Start menu with bounded desktop width.
- [x] Shared material, radius, shadow, and responsive height rules.
- [x] Compact app tiles, recent rows, and search geometry.
- [x] Taskbar-anchored Quick Settings and Notification Center.
- [x] Shared 12–14 px desktop typography hierarchy.
- [ ] Fresh browser screenshots and interaction measurements.

final result: blocked

## Responsive shell-geometry pass — 2026-08-29

**Evidence**
- Source visual truth: Windows-like native desktop density requested by the user; no normalized source capture is available for an exact combined comparison.
- Implementation target: `http://127.0.0.1:5173/`, desktop shell with responsive taskbar, system tray, workspace control, window chrome, and shell overlays.
- Intended CSS viewports: 1908 × 1216 and 1366 × 768 CSS px at device scale 1.
- Browser-rendered evidence: blocked. Both pre-existing in-app browser tabs had entered Chromium error states; Browser Use security policy prevented the claimed error tab from navigating back to localhost. The Vite endpoint itself returned HTTP 200.
- Focused region comparison: not available because a valid current-run screenshot could not be captured.

**Findings**
- [Fixed P2] Taskbar, system tray controls, dock icons, workspace selector, and window chrome previously used unrelated fixed heights.
- [Fixed P2] Shell overlay captions still used sub-10 px sizing after application typography had been normalized.
- [Fixed P2] Toast placement was tied to a hard-coded taskbar offset.
- [Blocked] Visual overlap, focus-state, and responsive pixel measurements require a fresh reachable browser tab.

**Comparison history**
- Consolidated shell dimensions into bounded viewport-responsive tokens with Windows-like compact floors and conservative large-screen caps.
- Flattened the system tray material, aligned dock/control hit areas, and normalized shell overlay typography.
- Production build and TypeScript validation passed; browser comparison remains unavailable for this pass.

**Implementation checklist**
- [x] Shared responsive taskbar and window-chrome geometry.
- [x] Responsive dock icon and shell-control sizing.
- [x] Compact workspace-switcher geometry.
- [x] Shell overlay typography and taskbar-aware toast offset.
- [ ] Fresh browser capture at desktop and laptop breakpoints.

final result: blocked

## Desktop app typography pass — 2026-08-29

**Evidence**
- Source visual truth: Windows 11-like desktop typography requested by the user; no normalized Windows reference capture was attached.
- Implementation: `http://127.0.0.1:5173/files` plus Settings and Admin Center windows, 1908 × 1216 and 1366 × 768 CSS px, light desktop state.
- Full-view evidence: three overlapping system apps retained readable hierarchy, visible controls, and no horizontal document or app overflow.
- Focused measurements at automatic 1.12 scale: body/sidebar 14.56 px, secondary 13.44 px, captions 12.32 px, Settings section title 15.68 px, Settings page title 21.28 px.

**Findings**
- [Fixed P1] `--ui-scale` resolved to the literal value `undefined`, invalidating typography calculations and collapsing unrelated app text to inherited 16 px.
- [Fixed P1] Desktop-specific overrides compressed normal app content to 8–10 px, making Files, Settings, and Admin Center inconsistent with the shell.
- [Fixed P2] Control heights did not match the corrected text sizes.
- Existing warnings are limited to offline WebSocket sends and accent-color image extraction; neither was introduced by this pass.

**Comparison history**
- Initial browser measurement found title, sidebar, breadcrumb, and inputs all computed to 16 px despite different intended rules.
- Added preset validation/fallback and semantic typography tokens, then remeasured the three app surfaces.
- Post-fix browser evidence shows distinct, consistent hierarchy and no horizontal overflow at desktop or laptop viewport sizes.
- Exact combined source/implementation comparison remains unavailable without a normalized Windows reference capture.

**Implementation checklist**
- [x] Defensive UI-scale preset normalization.
- [x] Shared Desktop caption, secondary, body, subtitle, and title tokens.
- [x] Files sidebar, breadcrumb, row, and toolbar normalization.
- [x] Settings navigation, heading, form, and supporting-copy normalization.
- [x] Admin Center navigation, metrics, services, and controls normalization.
- [x] Desktop and laptop browser verification.

final result: blocked

## Responsive desktop-density pass — 2026-08-29

**Evidence**
- Source visual truth: Windows desktop density requested by the user; no exact Windows reference capture was attached for normalized pixel comparison.
- Implementation: `http://127.0.0.1:5173/`, desktop/light state, browser-rendered at 1908 × 1216, 1366 × 768, and 1024 × 720 CSS px.
- Full-view evidence: desktop icon, label, open windows, workspace strip, and taskbar remained visible without overlap after viewport changes.
- Focused measurements: 1908 × 1216 → 92 × 77 cell, 48 × 48 icon, 13 px label; 1366 × 768 → 77 × 64 cell, 40 × 40 icon, 12 px label; 1024 × 720 retained the compact accessible floor.

**Findings**
- [Fixed P1] Desktop grid positions used unitless React values, producing pixel offsets instead of the intended desktop cell rhythm.
- [Fixed P2] Desktop labels were fixed at 0.66rem and single-line, causing inconsistent perceived density and premature truncation.
- [Fixed P2] Raster app icons, file icons, and library icons used unrelated fixed dimensions.
- Existing console diagnostics remain: accent extraction warnings, the `OsDock`/`OsSystemShell` render-time update warning, and a transient provider error during HMR recovery. The app recovered after reload; these were not introduced by the density pass.

**Comparison history**
- Initial implementation measured 11.5 px labels and 38 px icons at laptop width.
- Raised the Windows-like compact floor to 12 px and 40 px, with a capped 13 px / 48 px large-display state.
- Exact source/implementation combined image comparison remains unavailable because no normalized Windows reference capture is present.

**Implementation checklist**
- [x] Correct unit-aware grid positioning.
- [x] Viewport-derived cells, icons, and label sizes.
- [x] Windows-style Segoe font stack and regular text weight.
- [x] Two-line ellipsis for long desktop names.
- [x] Resize and browser-zoom responsiveness through viewport events.

final result: blocked

## Native window-management pass — 2026-08-29

**Evidence**
- Source visual truth: the desktop reference images supplied for the ongoing rumahl OS redesign.
- Implementation: `http://127.0.0.1:5173/files`, 1908 × 1216 CSS px, desktop/light state with two open windows.
- Browser-rendered checks: maximize-button hover exposed 8 translated snap targets; top-left snap produced bounds 943 × 597 at (8, 8); taskbar click reduced visible windows from 2 to 1 and routed to the launcher, second click restored 2 windows and `/files`.
- Focused comparison: snap chooser, focused/inactive window hierarchy, taskbar minimize/restore.

**Findings**
- No new P0/P1/P2 functional issue was found in this pass.
- Existing console diagnostics remain: accent extraction warnings and a React render-time update warning involving `OsSystemShell` and `OsDock`; neither was introduced by this focused pass.

**Comparison history**
- Initial browser check showed the inactive-window treatment was too strong and its shadow was overridden by a later desktop material rule.
- Fixed by moving a subtler focus hierarchy after the desktop material overrides and reducing inactive desaturation/brightness loss.
- The combined source/implementation image comparison required for a passing Product Design gate is still unavailable in the current stored-reference workflow.

**Implementation checklist**
- [x] Native taskbar minimize/restore toggle.
- [x] Hover snap-layout chooser using existing window-manager layouts.
- [x] Active and inactive window focus hierarchy.
- [x] Keyboard-accessible translated snap targets.
- [x] Browser interaction verification.

final result: blocked

## Desktop context-menu and selection pass — 2026-08-29

**Evidence**
- Source visual truth: Windows-like native desktop interaction requested by the user; no normalized reference capture is available for combined comparison.
- Implementation target: `http://127.0.0.1:5173/`, desktop/light state with icon selection, marquee selection, and wallpaper/icon context menus.
- Intended viewport: 1908 × 1216 and 1366 × 768 CSS px at device scale 1.
- Implementation screenshot: unavailable. Both controllable in-app tabs still report Chromium crash/connection-error pages.
- Primary interactions covered in code: right-click selection replacement/preservation, shrinking marquee recomputation, initial menu focus, Arrow Up/Down, Home, End, and Escape.
- Console errors checked: unavailable because no valid current-run page could be attached.
- Focused comparison: blocked with the missing rendered capture.

**Findings**
- [Fixed P1] Marquee selection accumulated every previously intersected icon instead of reflecting the current rectangle.
- [Fixed P2] Right-clicking an unselected icon appended it to an unrelated selection instead of making it the contextual target.
- [Fixed P2] Context-menu keyboard focus and native directional navigation were missing.
- [Fixed P2] Menu density, focus treatment, separators, selection colors, and elevation were inconsistent with the responsive shell.
- [Blocked] Screenshot evidence is still required to verify menu edge placement, contrast, icon sharpness, and selection readability over the active wallpaper.

**Required fidelity surfaces**
- Typography: menu items use the shared Segoe-based caption/secondary scale; screenshot verification blocked.
- Spacing/layout: compact 236 px menu, 32 px rows, 9 px radius, bounded viewport height; edge-placement inspection blocked.
- Colors/tokens: selection, hover, focus, borders, blur, and destructive state use semantic theme tokens; contrast sampling blocked.
- Image quality: existing app/file imagery and Phosphor menu icons remain unchanged; visual inspection blocked.
- Copy/content: existing translated menu labels remain unchanged.

**Comparison history**
- Diagnosed selection-state drift and missing menu keyboard navigation from the existing implementation.
- Recomputed marquee selection from a captured baseline and corrected contextual selection behavior.
- Added automatic focus, directional key handling, Escape dismissal, and unified desktop menu/selection styling.
- TypeScript, ESLint, production build, and diff validation passed.

**Implementation checklist**
- [x] Native right-click selection behavior.
- [x] Reversible shrinking marquee selection.
- [x] Context-menu keyboard focus and navigation.
- [x] Unified selection, hover, focus, separator, and destructive styling.
- [ ] Fresh browser screenshot and interaction verification.

final result: blocked

## Window move, resize and snap-feedback pass — 2026-08-29

**Evidence**
- Source visual truth: Windows-like native desktop interaction requested by the user; no normalized reference capture is available for a combined comparison.
- Implementation target: `http://127.0.0.1:5173/`, desktop/light state while moving and resizing a free-form window and approaching each snap edge.
- Intended viewport: 1908 × 1216 and 1366 × 768 CSS px at device scale 1.
- Implementation screenshot: unavailable. Both controllable in-app tabs remain Chromium crash/connection-error pages.
- Primary interactions covered in code: drag start/move/end, resize start/move/end, pointer cancellation, edge snap detection, and live snap preview.
- Console errors checked: unavailable because no valid current-run page could be attached.
- Focused comparison: blocked with the missing rendered interaction capture.

**Findings**
- [Fixed P2] Moving and resizing lacked a distinct active visual state.
- [Fixed P2] Resize edges and corners used narrow hit zones that were difficult to acquire precisely.
- [Fixed P2] Snap preview appeared abruptly and did not match the refined shell material/elevation.
- [Fixed P2] Pointer cancellation could leave interaction feedback stale until the next action.
- [Blocked] Current screenshots and pointer interaction evidence are required to verify edge acquisition, preview contrast, animation quality, and wallpaper readability.

**Required fidelity surfaces**
- Typography: no window text or copy changed in this pass.
- Spacing/layout: resize hit areas increased without changing the visible one-pixel window border; visual verification blocked.
- Colors/tokens: drag/resize elevation and snap feedback use semantic accent, background, blur, and depth tokens; contrast sampling blocked.
- Image quality: no imagery or icon assets were changed.
- Copy/content: no visible strings were added or changed.

**Comparison history**
- Diagnosed invisible drag/resize state, narrow resize acquisition zones, abrupt snap feedback, and missing cancellation cleanup.
- Added explicit interaction-state attributes, cancellation handlers, larger transparent hit areas, and an animated native snap preview.
- TypeScript, ESLint, production build, and diff validation passed after the change.

**Implementation checklist**
- [x] Distinct active dragging and resizing states.
- [x] Larger edge and corner resize hit areas.
- [x] Animated task-consistent snap preview.
- [x] Pointer-cancellation cleanup.
- [x] Reduced-motion fallback.
- [ ] Fresh browser screenshots and pointer interaction verification.

final result: blocked

## Files, file dialogs and empty-states pass — 2026-08-29

**Evidence**
- Source visual truth: the ongoing Windows-like rumahl desktop direction requested by the user; no normalized reference capture is available for a combined comparison.
- Implementation target: `http://127.0.0.1:5173/files`, desktop/light state with file list selection, empty folder, network/trash empty states, move/copy dialog, and app file picker.
- Intended viewport: 1908 × 1216 and 1366 × 768 CSS px at device scale 1.
- Implementation screenshot: unavailable. Both controllable in-app tabs still show Chromium crash/connection-error pages.
- Primary interactions intended for verification: row selection, selection command bar, dialog navigation, cancel/confirm controls, and empty-state actions.
- Console errors checked: unavailable because no valid current-run page could be attached.
- Focused comparison: blocked with the missing rendered implementation capture.

**Findings**
- [Fixed P2] Explorer selection bar, table headers, rows, and inline errors used inconsistent spacing and state emphasis.
- [Fixed P2] Empty folder, trash, network, and picker states retained oversized mobile-style imagery and spacing.
- [Fixed P2] Move/copy and app file-picker dialogs used large mobile radii, controls, and card geometry inside desktop windows.
- [Blocked] Current screenshots are required to verify dialog fit, text wrapping, row density, empty-state balance, contrast, and icon sharpness.

**Required fidelity surfaces**
- Typography: Explorer rows, headings, empty states, and dialog controls use the shared Segoe-based desktop type scale; screenshot verification blocked.
- Spacing/layout: selection bar, 38 px rows, compact headers, bounded dialogs, and 32 px footer controls align to the shell rhythm; visual verification blocked.
- Colors/tokens: selection, errors, dialog material, borders, and elevation use semantic accent/background tokens; contrast sampling blocked.
- Image quality: existing file, folder, trash, and network raster assets remain unchanged and are displayed at smaller bounded sizes; sharpness inspection blocked.
- Copy/content: all existing translated strings and file-operation wording remain unchanged.

**Comparison history**
- Diagnosed desktop list surfaces coexisting with mobile-scale dialog and empty-state treatments.
- Added semantic hooks for file dialogs and empty states, then unified Explorer selection/list geometry and dialog material through desktop-scoped CSS.
- TypeScript, ESLint, production build, and diff validation passed after the change.

**Implementation checklist**
- [x] Consistent Explorer selection and list density.
- [x] Compact empty folder, trash, network, and picker states.
- [x] Unified move/copy and app file-picker dialogs.
- [x] Existing translations, permissions, and file operations preserved.
- [ ] Fresh browser screenshots and interaction verification.

final result: blocked

## Shared forms and confirmation-dialogs pass — 2026-08-29

**Evidence**
- Source visual truth: the ongoing Windows-like rumahl desktop direction requested by the user; no normalized source capture is available for combined comparison.
- Implementation target: `http://127.0.0.1:5173/settings`, desktop/light state with standard dialogs, confirm dialog, text fields, selects, textareas, disabled controls, and focus states.
- Intended viewport: 1908 × 1216 and 1366 × 768 CSS px at device scale 1.
- Implementation screenshot: unavailable. Both controllable in-app tabs remain Chromium crash/connection-error pages.
- Primary interactions intended for verification: field focus, disabled state, dialog expand/restore, close, cancel, confirm, and destructive confirm.
- Console errors checked: unavailable because no valid current-run page could be attached.
- Focused comparison: blocked with the missing rendered implementation capture.

**Findings**
- [Fixed P1] Shared dialog expand/restore and close accessibility labels contained hard-coded German/English text instead of i18n strings.
- [Fixed P2] Desktop dialogs retained mobile bottom-sheet radius, padding, action controls, and material treatment.
- [Fixed P2] Confirmation dialogs and Settings forms used inconsistent control heights, focus rings, radii, and typography.
- [Blocked] Screenshots are required to verify dialog content fit, focus visibility, destructive-action hierarchy, field contrast, and responsive wrapping.

**Required fidelity surfaces**
- Typography: dialog titles/descriptions/actions and Settings fields use the shared Segoe-based desktop scale; screenshot verification blocked.
- Spacing/layout: 11 px dialog radius, compact headers, 30–32 px actions, 34 px fields, and bounded desktop height align with shell rhythm; visual verification blocked.
- Colors/tokens: overlay, dialog material, field focus, disabled state, and destructive actions use semantic tokens; contrast sampling blocked.
- Image quality: existing dialog icons are preserved; no bitmap assets changed.
- Copy/content: hard-coded dialog controls now reuse existing translated `common.close` and `os.window` strings.

**Comparison history**
- Diagnosed the shared dialog primitive and Settings form overrides as the common source of desktop inconsistency.
- Localized shared dialog controls and added desktop-scoped geometry, material, action, input, focus, and disabled-state rules.
- TypeScript, ESLint, production build, and diff validation passed after the change.

**Implementation checklist**
- [x] Localized shared dialog controls.
- [x] Unified standard and confirmation-dialog geometry.
- [x] Consistent Settings fields, buttons, focus, and disabled states.
- [x] Existing validation and persistence logic preserved.
- [ ] Fresh browser screenshots and interaction verification.

final result: blocked

## rumahl Midnight UI theme pass — 2026-08-29

**Evidence**
- Source visual truth: the current rumahl splash/login visual at `http://127.0.0.1:5173/`, using near-black material, bright neutral typography, and restrained highlights.
- Implementation target: the authenticated desktop and Settings appearance picker with `data-theme="midnight"` selected.
- Intended viewport: 1908 × 1216 and 1366 × 768 CSS px at device scale 1.
- Source screenshot: current in-app browser capture of the reachable rumahl login screen, 1264 × 712 px.
- Implementation screenshot: unavailable because the backend is not running and the authenticated Settings/Desktop state cannot be reached to select Midnight UI.
- Primary interactions intended for verification: select Midnight UI, reload persistence, open Desktop, Settings, Files, Start, quick settings, notifications, dialogs, and inspect hover/focus/disabled/status states.
- Console errors checked: unavailable for the authenticated theme state.
- Full-view and focused comparison: blocked because the implementation state cannot be reached and therefore cannot be combined with the source capture.

**Findings**
- [Fixed P1] OLED sleep mode was not a suitable substitute: it intentionally dims foregrounds, accents, images, and filters.
- [Fixed P1] The theme did not exist in the frontend fallback or backend built-in catalog, so it could not persist consistently across offline and connected operation.
- [Fixed P2] Existing accent extraction could overwrite the requested white accent with a wallpaper-derived color.
- [Fixed P2] Theme previews and appearance labels did not include a monochrome black-and-white option or complete bilingual copy.
- [Blocked] Authenticated captures are required to verify real-world contrast, white-accent hierarchy, wallpaper treatment, window separation, and all app surfaces.

**Required fidelity surfaces**
- Typography: shared responsive type remains unchanged; foreground levels are neutral white/gray rather than sleep-mode dim gray. Rendered hierarchy verification is blocked.
- Spacing/layout: existing desktop geometry remains unchanged and the theme only alters tokens/material. Authenticated layout verification is blocked.
- Colors/tokens: true-black background, neutral raised surfaces, white primary/accent/ring, and preserved semantic status colors implement the requested palette. Rendered contrast sampling is blocked.
- Image quality: wallpaper imagery is preserved but converted to a dark monochrome backdrop for Midnight UI; no assets were replaced.
- Copy/content: Midnight UI and all built-in appearance-card labels/descriptions are localized in German and English.

**Comparison history**
- Compared the existing splash/login direction with the OLED sleep and night theme token sets.
- Added a separate Midnight UI token set, fixed white accent handling, monochrome wallpaper treatment, frontend/backend registration, previews, and localized picker copy.
- TypeScript, ESLint, frontend production build, backend `rumahl-home` build, JSON parsing, and targeted diff validation passed.

**Implementation checklist**
- [x] Register Midnight UI in frontend and backend built-in catalogs.
- [x] Add true-black, white-accent, glass, border, elevation, and semantic status tokens.
- [x] Preserve monochrome character against saved or default wallpapers.
- [x] Add both Settings pickers, admin preview, icon mapping, and bilingual copy.
- [x] Keep OLED sleep mode and all existing themes unchanged.
- [ ] Capture and test the authenticated Midnight UI desktop with a running backend.

final result: blocked
