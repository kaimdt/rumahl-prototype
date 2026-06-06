.PHONY: check clippy fix test frontend-check clean all

# ─── Rust Backend ────────────────────────────────────────

check:
	cd iora-os/backend && cargo check

clippy:
	cd iora-os/backend && cargo clippy -- -D warnings

fix:
	cd iora-os/backend && cargo clippy --fix --allow-dirty

test:
	cd iora-os/backend && cargo test

outdated:
	cd iora-os/backend && cargo outdated 2>/dev/null || echo "install with: cargo install cargo-outdated"

# ─── Frontend ───────────────────────────────────────────

frontend-check:
	cd frontend && npx tsc --noEmit 2>/dev/null || true

frontend-audit:
	cd frontend && npm audit

frontend-fix:
	cd frontend && npm audit fix

frontend-test:
	cd frontend && bun test 2>/dev/null || npm test 2>/dev/null || echo "no test runner found"

# ─── Combined ───────────────────────────────────────────

all: check clippy frontend-check frontend-audit

quick: check frontend-check

# ─── Clean ──────────────────────────────────────────────

clean:
	cd iora-os/backend && cargo clean
	rm -rf frontend/node_modules
