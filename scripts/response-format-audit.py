#!/usr/bin/env python3
"""
Response-format audit — compares the JSON fields the frontend expects (from
its TS interfaces) against the fields the backend actually produces
(`json!({...})` literals and serialized struct fields).

Run from the repo root:  python3 scripts/response-format-audit.py

Limitations: field NAMES only; optional (`?`) frontend fields tolerate
missing backend fields; nested/conditional JSON is not fully traced.
"""
import re
import os
import sys

ROOT = 'iora-os/backend'
FRONTEND = 'frontend/src'

# backend_source → frontend file, expected interface/type names
PAIRS = [
    # (backend file, frontend file, [type names])
    ('services/iora-home/src/job_handler.rs', 'components/widgets/OraJobsWidget.tsx', ['OraJob']),
    ('services/iora-home/src/download_handler.rs', 'components/widgets/OraJobsWidget.tsx', ['OraJob']),
    ('services/iora-files/src/main.rs', 'components/widgets/OraRecentFilesWidget.tsx', ['OraFile']),
    ('services/iora-files/src/main.rs', 'components/OsFileExplorer.tsx', ['FileEntry']),
    ('services/iora-files/src/main.rs', 'components/widgets/OraStorageWidget.tsx', ['quota']),
    ('services/iora-network-monitor/src/main.rs', 'components/OsDevicesApp.tsx', ['NetworkDevice']),
    ('services/iora-home/src/device_handler.rs', 'components/OsDevicesApp.tsx', ['RegistryDevice']),
    ('services/iora-control/src/main.rs', 'components/OsServicesApp.tsx', ['SystemdService']),
    ('services/iora-supervisor/src/main.rs', 'hooks/useInstalledApps.ts', ['SupervisorApp']),
    ('services/iora-resource-manager/src/main.rs', 'components/OsContainersApp.tsx', ['ContainerResource']),
    ('services/iora-home/src/media_handler.rs', 'components/widgets/OraMediaWidget.tsx', ['MediaItem']),
    ('services/iora-home/src/logs_handler.rs', 'components/OsLogsApp.tsx', ['LogSource']),
]


def backend_fields(path):
    """Collect JSON keys from json!({...}) literals and serialized struct fields."""
    src = open(path).read()
    fields = set()
    # json!({ "a": ..., "b": ... }) — top-level keys of each json! object
    for m in re.finditer(r'json!\s*\(\s*\{([^}]*)\}', src):
        block = m.group(1)
        for key in re.finditer(r'"([A-Za-z_][A-Za-z0-9_]*)"\s*:', block):
            fields.add(key.group(1))
    # Serialize struct fields (with or without pub): collect every field in
    # struct blocks so nested container types (ports, resources) are covered.
    for m in re.finditer(r'struct\s+[A-Za-z_][A-Za-z0-9_]*\s*\{([^}]*)\}', src):
        block = m.group(1)
        for field in re.finditer(r'(?:pub\s+)?([a-z_][a-z0-9_]*)\s*:', block):
            fields.add(field.group(1))
    # row_to_value-style: json!({"field": row.N, ...})
    return fields


def frontend_fields(path, type_names):
    src = open(path).read()
    found = {}
    for type_name in type_names:
        m = re.search(r'interface\s+' + re.escape(type_name) + r'\b\s*\{', src)
        if not m:
            continue
        # Balanced-brace extraction of the whole interface body.
        start = m.end() - 1
        depth = 1
        i = start + 1
        while i < len(src) and depth > 0:
            if src[i] == '{':
                depth += 1
            elif src[i] == '}':
                depth -= 1
            i += 1
        block = src[start + 1:i - 1]
        # Strip comments — they can contain colon'd text that looks like fields.
        block = re.sub(r'/\*.*?\*/', '', block, flags=re.DOTALL)
        block = re.sub(r'//[^\n]*', '', block)
        # Strip nested object literals so only top-level fields remain.
        for _ in range(4):
            block = re.sub(r'\{[^{}]*\}', '', block)
        required = set()
        optional = set()
        # A field with `|` in its type (union, e.g. string | {…}) or `?` is
        # tolerant — the backend may deliver either form.
        for field in re.finditer(r'([a-zA-Z_][a-zA-Z0-9_]*)(\?)?\s*:([^;\n]+)', block):
            name = field.group(1)
            value_type = field.group(3) or ''
            if field.group(2) or '|' in value_type or value_type.strip().startswith('Array<'):
                optional.add(name)
            else:
                required.add(name)
        found[type_name] = (required, optional)
    return found


def main():
    issues = 0
    for backend, frontend, type_names in PAIRS:
        bpath = os.path.join(ROOT, backend)
        fpath = os.path.join(FRONTEND, frontend)
        if not os.path.exists(bpath) or not os.path.exists(fpath):
            continue
        bfields = backend_fields(bpath)
        if not bfields:
            print(f"? {backend}: no json!()/struct fields found")
            continue
        ffields = frontend_fields(fpath, type_names)
        for type_name, (required, optional) in ffields.items():
            missing_required = required - bfields
            missing_optional = optional - bfields
            if missing_required:
                issues += 1
                print(f"MISSING (required) {frontend}.{type_name}: {sorted(missing_required)}")
                print(f"    backend {backend} has: {sorted(bfields)}")
            elif missing_optional:
                # optional fields tolerate absence — informational only
                pass

    if issues:
        print(f"\n{issues} potential required-field mismatches")
        sys.exit(1)
    print("OK — frontend interfaces are covered by backend JSON fields.")


if __name__ == '__main__':
    main()
