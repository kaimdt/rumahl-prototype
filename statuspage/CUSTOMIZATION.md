# Status page customization guide

Every status page has independent branding, navigation, footer, languages,
monitor structure and Custom CSS.

## Workflow

1. Open **Admin → Status pages** and edit the desired page.
2. Configure title, description, slug and custom domain under **Settings**.
3. Upload desktop/mobile logos, favicon and optional dark variants under
   **Branding & CSS**.
4. Set colors, content width and corner radius. These structured values are
   applied before Custom CSS.
5. Configure header navigation, language switcher and footer links.
6. Add monitors under **Structure** and choose current status, history or
   history with response times for each monitor.
7. Use **Save** while iterating and **Save and close** when finished.
8. Verify desktop, mobile, light mode and dark mode.

## Stable CSS hooks

| Area | CSS hooks |
| --- | --- |
| Page | `.statuspage-shell`, `.statuspage-main` |
| Header | `.statuspage-header`, `.statuspage-header-inner` |
| Navigation | `.statuspage-navbar`, `.statuspage-nav-link`, `.statuspage-theme-toggle`, `.statuspage-language-switcher` |
| Status | `.statuspage-status-banner`, `.statuspage-status-banner-inner`, `.statuspage-status-message` |
| Monitors | `.statuspage-components`, `.statuspage-component-group`, `.statuspage-component-group-header`, `.statuspage-component-group-body`, `.statuspage-component` |
| Uptime | `.statuspage-uptime-chart`, `.statuspage-uptime-bars` |
| Footer | `.statuspage-footer`, `.statuspage-footer-inner`, `.statuspage-footer-links`, `.statuspage-footer-link` |

Monitor elements expose `data-component-id`, `data-status` and
`data-monitoring`. The overall badge exposes `data-status-badge`.

## Complete example

```css
.statuspage-shell {
  background:
    radial-gradient(circle at 15% 0%, rgb(99 102 241 / 14%), transparent 32rem),
    #090c15;
  color: #f8fafc;
}

.statuspage-main,
.statuspage-header-inner,
.statuspage-footer-inner {
  max-width: 72rem;
}

.statuspage-header {
  background: rgb(9 12 21 / 86%) !important;
  border-bottom-color: rgb(148 163 184 / 14%);
  backdrop-filter: blur(18px);
}

.statuspage-nav-link[aria-current="page"] {
  background: rgb(99 102 241 / 16%);
  color: #c7d2fe;
}

.statuspage-status-banner {
  border: 1px solid rgb(52 211 153 / 24%);
  background: linear-gradient(135deg, rgb(16 185 129 / 14%), rgb(15 20 34 / 92%));
  box-shadow: 0 24px 70px rgb(0 0 0 / 20%);
}

.statuspage-component-group,
.statuspage-component {
  border: 1px solid rgb(148 163 184 / 12%);
  background: rgb(15 20 34 / 88%);
  box-shadow: 0 18px 45px rgb(0 0 0 / 16%);
}

.statuspage-component[data-status="operational"] {
  border-left: 3px solid #34d399;
}

.statuspage-component[data-status="degraded"] {
  border-left: 3px solid #fbbf24;
}

.statuspage-component[data-status="partial_outage"],
.statuspage-component[data-status="major_outage"] {
  border-left: 3px solid #fb7185;
}

.statuspage-component[data-monitoring="disabled"] {
  opacity: 0.62;
  filter: saturate(0.5);
}

.statuspage-footer {
  border-top-color: rgb(148 163 184 / 12%);
  background: rgb(5 8 15 / 72%);
}
```

## Light and dark mode

```css
.statuspage-component {
  background: #ffffff;
  border-color: #dbe3ef;
}

.dark .statuspage-component {
  background: #0f1422;
  border-color: #273244;
}
```

## Style one monitor

Use the service identifier exposed as `data-component-id`:

```css
.statuspage-component[data-component-id="601c7b57-fca2-4c2b-8f5d-3cf3e30ee9a9"] {
  background: linear-gradient(135deg, rgb(99 102 241 / 12%), transparent);
}
```

## Mobile adjustments

```css
@media (max-width: 640px) {
  .statuspage-header-inner { min-height: 4.5rem; }
  .statuspage-navbar { gap: 0.125rem; }
  .statuspage-status-banner { border-radius: 0.875rem; }
  .statuspage-component-group-body { padding-inline: 0.75rem; }
}
```

## External CSS and troubleshooting

The Custom CSS URL must use HTTPS. The inline editor is loaded afterward and
can override the external stylesheet. Everything delivered to a public page is
visible to visitors, so CSS must never contain tokens or internal credentials.

- Confirm the expected classes and data attributes with the browser inspector.
- Prefix selectors with `.statuspage-shell` when more specificity is needed.
- Test light/dark mode and mobile independently.
- Hard reload after external stylesheet changes, or use a version query such as
  `theme.css?v=2`.
