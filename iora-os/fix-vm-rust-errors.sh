#!/bin/bash
# Fix Rust compile errors on the VM build host.
# Run on the VM:   bash fix-vm-rust-errors.sh
# Assumes the backend tree is at /home/hermes/ora/iora-os/backend/
#
# Fixes:
#   1. iora-home/src/documentation.rs — E0733 (recursive async fn) → iterative BFS
#   2. iora-cli/Cargo.toml            — duplicate bin target (iora + ora same path)
#   3. iora-cli/Cargo.toml            — clap `env` feature
#   4. iora-supervisor                — futures-util + TryStreamExt (if applicable)

set -euo pipefail

BACKEND="${BACKEND:-/home/hermes/ora/iora-os/backend}"
if [[ ! -d "$BACKEND" ]]; then
  # fallback for WSL path layout
  if [[ -d "/home/hermes/ora/iora-os/backend" ]]; then
    BACKEND="/home/hermes/ora/iora-os/backend"
  else
    echo "ERROR: backend dir not found. Set BACKEND=... and retry." >&2
    exit 1
  fi
fi
echo "[fix] using BACKEND=$BACKEND"

#─────────────────────────────────────────────────────────────────────────
# 1) iora-home/src/documentation.rs — recursive async fn
#─────────────────────────────────────────────────────────────────────────
DOC="$BACKEND/iora-home/src/documentation.rs"
if [[ -f "$DOC" ]]; then
  echo "[fix] patching $DOC (E0733 recursive async)"
  cp "$DOC" "$DOC.bak-$(date +%s)"

  python3 - "$DOC" <<'PYEOF'
import re, sys, pathlib
p = pathlib.Path(sys.argv[1])
src = p.read_text()

# Find the function signature + body. We'll replace the whole fn
# with an iterative BFS that avoids recursion.
pattern = re.compile(
    r'(?ms)^(\s*)(pub\s+)?async\s+fn\s+collect_markdown_files\s*'
    r'\(\s*dir\s*:\s*&FsPath\s*,\s*base\s*:\s*&FsPath\s*\)\s*'
    r'->\s*std::io::Result<Vec<String>>\s*\{.*?^\1\}\s*\n'
)
m = pattern.search(src)
if not m:
    print("collect_markdown_files signature not found — manual fix needed", file=sys.stderr)
    sys.exit(2)

indent = m.group(1)
vis = m.group(2) or ""
replacement = (
    f"{indent}{vis}async fn collect_markdown_files(dir: &FsPath, base: &FsPath) -> std::io::Result<Vec<String>> {{\n"
    f"{indent}    // Iterative BFS — avoids E0733 (recursive async requires boxing).\n"
    f"{indent}    let mut files: Vec<String> = Vec::new();\n"
    f"{indent}    let mut stack: Vec<std::path::PathBuf> = vec![dir.to_path_buf()];\n"
    f"{indent}    while let Some(current) = stack.pop() {{\n"
    f"{indent}        let mut rd = tokio::fs::read_dir(&current).await?;\n"
    f"{indent}        while let Some(entry) = rd.next_entry().await? {{\n"
    f"{indent}            let path = entry.path();\n"
    f"{indent}            let ft = entry.file_type().await?;\n"
    f"{indent}            if ft.is_dir() {{\n"
    f"{indent}                stack.push(path);\n"
    f"{indent}            }} else if ft.is_file() {{\n"
    f"{indent}                if let Some(ext) = path.extension().and_then(|s| s.to_str()) {{\n"
    f"{indent}                    if ext.eq_ignore_ascii_case(\"md\") {{\n"
    f"{indent}                        if let Ok(rel) = path.strip_prefix(base) {{\n"
    f"{indent}                            files.push(rel.to_string_lossy().into_owned());\n"
    f"{indent}                        }}\n"
    f"{indent}                    }}\n"
    f"{indent}                }}\n"
    f"{indent}            }}\n"
    f"{indent}        }}\n"
    f"{indent}    }}\n"
    f"{indent}    Ok(files)\n"
    f"{indent}}}\n"
)

src2 = src[:m.start()] + replacement + src[m.end():]
p.write_text(src2)
print("[ok] collect_markdown_files replaced with iterative version")
PYEOF
else
  echo "[skip] $DOC not present"
fi

#─────────────────────────────────────────────────────────────────────────
# 2) iora-cli/Cargo.toml — make ora a thin shim so no duplicate bin target
#─────────────────────────────────────────────────────────────────────────
CLI_TOML="$BACKEND/iora-cli/Cargo.toml"
CLI_ORA_SRC="$BACKEND/iora-cli/src/bin/ora.rs"
if [[ -f "$CLI_TOML" ]]; then
  if grep -q 'name = "ora"' "$CLI_TOML" && grep -q 'name = "iora"' "$CLI_TOML"; then
    echo "[fix] splitting duplicate bin targets in $CLI_TOML"
    cp "$CLI_TOML" "$CLI_TOML.bak-$(date +%s)"
    mkdir -p "$(dirname "$CLI_ORA_SRC")"
    # Small shim that re-executes the main bin so behaviour stays identical.
    cat > "$CLI_ORA_SRC" <<'RSEOF'
// Alias binary — delegates to the real main() in src/main.rs.
include!("../main.rs");
RSEOF
    python3 - "$CLI_TOML" <<'PYEOF'
import re, sys, pathlib
p = pathlib.Path(sys.argv[1])
src = p.read_text()
# Remove any [[bin]] block whose name = "ora" so only the implicit
# [[bin]] from src/main.rs (= package name "iora-cli") + the new src/bin/ora.rs remain.
src2 = re.sub(
    r'(?ms)\n#[^\n]*\n\[\[bin\]\]\s*\nname\s*=\s*"ora".*?(?=\n\[|\Z)',
    '\n',
    src,
)
src2 = re.sub(
    r'(?ms)\n\[\[bin\]\]\s*\nname\s*=\s*"ora".*?(?=\n\[|\Z)',
    '\n',
    src2,
)
# Also drop the [[bin]] iora block that points at main.rs (to avoid dup with default),
# but keep it if it points at a different path.
# Actually safer: keep iora block; just rely on src/bin/ora.rs for 'ora'.
p.write_text(src2)
print("[ok] removed [[bin]] name=ora from Cargo.toml")
PYEOF
  fi

  # clap env feature
  if grep -q 'clap = { version = "4", features = \["derive"\] }' "$CLI_TOML"; then
    sed -i 's|clap = { version = "4", features = \["derive"\] }|clap = { version = "4", features = ["derive", "env"] }|' "$CLI_TOML"
    echo "[ok] added clap env feature"
  fi
fi

#─────────────────────────────────────────────────────────────────────────
# 3) iora-supervisor — add futures-util + TryStreamExt import (idempotent)
#─────────────────────────────────────────────────────────────────────────
SUP_MAIN="$BACKEND/iora-supervisor/src/main.rs"
SUP_TOML="$BACKEND/iora-supervisor/Cargo.toml"
if [[ -f "$SUP_MAIN" ]] && ! grep -q 'futures_util::stream::TryStreamExt' "$SUP_MAIN"; then
  if grep -q 'try_collect' "$SUP_MAIN"; then
    echo "[fix] inserting TryStreamExt use in $SUP_MAIN"
    sed -i '/^use tracing::/a use futures_util::stream::TryStreamExt;' "$SUP_MAIN"
  fi
fi
if [[ -f "$SUP_TOML" ]] && ! grep -q 'futures-util' "$SUP_TOML"; then
  echo "[fix] adding futures-util to $SUP_TOML"
  # insert after bollard line
  sed -i '/^bollard/a futures-util = "0.3"' "$SUP_TOML"
fi

echo "[done] all fixes applied. Retry: cargo build --release -p iora-home -p iora-cli -p iora-supervisor"
