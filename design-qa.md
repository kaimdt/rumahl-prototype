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

final result: blocked
