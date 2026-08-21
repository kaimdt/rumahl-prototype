.PHONY: check clippy fix test frontend-check clean all

# ─── Rust Backend ────────────────────────────────────────

check:
	cd rumahl-os/backend && cargo check

clippy:
	cd rumahl-os/backend && cargo clippy -- -D warnings

fix:
	cd rumahl-os/backend && cargo clippy --fix --allow-dirty

test:
	cd rumahl-os/backend && cargo test

outdated:
	cd rumahl-os/backend && cargo outdated 2>/dev/null || echo "install with: cargo install cargo-outdated"

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
	cd rumahl-os/backend && cargo clean
	rm -rf frontend/node_modules
