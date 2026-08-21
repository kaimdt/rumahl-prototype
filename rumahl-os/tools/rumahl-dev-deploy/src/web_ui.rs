// web_ui.rs — Embedded SPA dashboard for the rumahl-dev-deploy daemon.
//
// Served at /ui on the daemon's HTTP port. This transforms the CLI
// into a full windowed application: auto-discover, SSH token fetch,
// one-click deploy, live service monitor, and log viewer.
//
// The entire UI is a single self-contained HTML page with vanilla JS.
// No npm, no build step, no external dependencies.

/// Returns the complete SPA as a string.
pub fn index_html() -> &'static str {
    include_str!("../web_ui/index.html")
}
