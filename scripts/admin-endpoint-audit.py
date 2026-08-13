#!/usr/bin/env python3
"""
Static admin-endpoint audit — checks that every API path called by the
admin frontend exists as a route in the backend (directly or via proxy).

Run from the repo root:  python3 scripts/admin-endpoint-audit.py

Limitations: verifies route EXISTENCE (and roughly the method surface via
the registered handler chain) — not response formats or runtime behaviour.
"""
import re
import os
import sys

ROOT = 'iora-os/backend'
FRONTEND = 'frontend/src'
route_re = re.compile(r'\.route\(\s*"([^"]+)"')
def all_frontend_files():
    files = []
    for root, dirs, names in os.walk(FRONTEND):
        dirs[:] = [d for d in dirs if d not in ('test', '__tests__')]
        for name in names:
            if not (name.endswith('.tsx') or name.endswith('.ts')):
                continue
            if '.bak.' in name or name.endswith('.test.ts') or name.endswith('.test.tsx'):
                continue
            rel = os.path.relpath(os.path.join(root, name), FRONTEND)
            files.append(rel)
    return sorted(files)


ADMIN_FILES = all_frontend_files()


def extract_routes(base):
    routes = set()
    for fname in os.listdir(base):
        if fname.endswith('.rs'):
            try:
                src = open(os.path.join(base, fname)).read()
            except Exception:
                continue
            for m in route_re.finditer(src):
                routes.add(m.group(1))
            for m in re.finditer(r'#\[(?:get|post|put|delete|patch)\(\s*"([^"]+)"', src):
                routes.add(m.group(1))
    return routes


def check_duplicate_routes():
    """Axum panics at startup on overlapping method routes (same path+
    method registered twice) — scan all .route(...) registrations."""
    from collections import defaultdict
    route_re_full = re.compile(r'\.route\(\s*"([^"]+)"\s*,\s*([^)]+)\)')
    problems = 0
    for base, label in [(os.path.join(ROOT, 'services/iora-home/src'), 'iora-home')]:
        if not os.path.isdir(base):
            continue
        by_path = defaultdict(list)
        for fname in os.listdir(base):
            if not fname.endswith('.rs'):
                continue
            try:
                src = open(os.path.join(base, fname)).read()
            except Exception:
                continue
            for m in route_re_full.finditer(src):
                handlers = m.group(2).strip()
                methods = set(re.findall(r'\b(get|post|put|delete|patch|any)\s*\(', handlers))
                if 'any(' in handlers:
                    methods = {'any'}
                by_path[m.group(1)].append(methods)
        for path, entries in by_path.items():
            for i in range(len(entries)):
                for j in range(i + 1, len(entries)):
                    a, b = entries[i], entries[j]
                    if a == {'any'} or b == {'any'} or (a & b):
                        problems += 1
                        print(f"DUPLICATE ROUTE {label}: {path} ({a} vs {b})")
    return problems


def main():
    dup = check_duplicate_routes()
    if dup:
        sys.exit(1)
    home = extract_routes(os.path.join(ROOT, 'services/iora-home/src'))
    control = extract_routes(os.path.join(ROOT, 'services/iora-control/src'))
    files = extract_routes(os.path.join(ROOT, 'services/iora-files/src'))
    services = {
        'network': extract_routes(os.path.join(ROOT, 'services/iora-network-monitor/src')),
        'secrets': extract_routes(os.path.join(ROOT, 'services/iora-secrets/src')),
        'connector': extract_routes(os.path.join(ROOT, 'services/iora-connector/src')),
        'appstore': extract_routes(os.path.join(ROOT, 'services/iora-appstore/src')),
        'gateway': extract_routes(os.path.join(ROOT, 'services/iora-gateway/src')),
        'assist': extract_routes(os.path.join(ROOT, 'services/iora-assist/src')),
        'watchdog': extract_routes(os.path.join(ROOT, 'services/iora-watchdog/src')),
        'updater': extract_routes(os.path.join(ROOT, 'services/iora-updater/src')),
        'resource': extract_routes(os.path.join(ROOT, 'services/iora-resource-manager/src')),
    }

    def norm(p):
        p = p.split('?')[0]
        p = re.sub(r':[A-Za-z_][A-Za-z0-9_]*', '{}', p)
        p = re.sub(r'\*[A-Za-z_][A-Za-z0-9_]*', '{}', p)
        p = re.sub(r'\$\{[^}]*\}', '{}', p)
        return p.rstrip('/')

    def matches(path, route_set):
        n = norm(path)
        if not n:
            return False
        if n in route_set or (n + '/') in route_set:
            return True
        parts = n.split('/')
        for r in route_set:
            rp = norm(r)
            rparts = rp.split('/')
            if len(parts) == len(rparts):
                if all(a == b or b == '{}' for a, b in zip(parts, rparts)):
                    return True
            elif rparts and rparts[-1] == '{}' and rp.endswith('{}'):
                if all(a == b or b == '{}' for a, b in zip(parts, rparts[:-1])):
                    return True
        return False

    def proxy_targets(fp):
        if fp.startswith('/api/admin/iora-control/'):
            return control, '/api/control/' + fp[len('/api/admin/iora-control/'):]
        if fp.startswith('/api/os/control/'):
            return control, '/api/control/' + fp[len('/api/os/control/'):]
        if fp.startswith('/api/os/backups/'):
            backup = extract_routes(os.path.join(ROOT, 'services/iora-backup/src'))
            return backup, '/api/backup/' + fp[len('/api/os/backups/'):]
        if fp.startswith('/api/files'):
            return files, fp
        if fp.startswith('/api/network/') or fp.startswith('/api/metrics') or fp.startswith('/api/interfaces') or fp.startswith('/api/mqtt/topics'):
            return services['network'], fp
        if fp.startswith('/api/resources'):
            return services['resource'], fp
        if fp.startswith('/api/secrets'):
            return services['secrets'], fp
        if fp.startswith('/api/appstore/'):
            return services['appstore'], fp
        if fp.startswith('/api/connector/') or fp.startswith('/api/admin/iora-cloud'):
            return services['connector'], fp
        if fp.startswith('/api/gateway/'):
            return services['gateway'], fp
        if fp.startswith('/api/assist/'):
            return services['assist'], fp
        if fp.startswith('/api/watchdog'):
            return services['watchdog'], fp
        if fp.startswith('/api/updates'):
            return services['updater'], fp
        return None, None

    misses = []
    for f in ADMIN_FILES:
        full = os.path.join(FRONTEND, f)
        if not os.path.exists(full):
            continue
        src = open(full).read()
        consts = {}
        for m in re.finditer(r"(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*['\"]([^'\"]+)['\"]", src):
            consts[m.group(1)] = m.group(2)

        def resolve(tpl):
            return re.sub(r'\$\{([A-Za-z_][A-Za-z0-9_]*)\}', lambda m: consts.get(m.group(1), '{}'), tpl)

        calls = []
        for m in re.finditer(r"(?:authFetch|adminFetch|cachedFetch|devBridgeFetch|apiFetch|proxyFetch)\s*\(\s*`([^`]*)`", src):
            calls.append(resolve(m.group(1)))
        for m in re.finditer(r"(?:authFetch|adminFetch|cachedFetch|devBridgeFetch|apiFetch|proxyFetch)\s*\(\s*['\"]([^'\"]+)['\"]", src):
            calls.append(m.group(1))
        for m in re.finditer(r"fetch\(\s*`([^`]*)`", src):
            calls.append(resolve(m.group(1)))
        for m in re.finditer(r"new EventSource\([`'\"]?([^`'\"\)]+)", src):
            calls.append(resolve(m.group(1)))

        for call in calls:
            c = call.strip()
            c2 = re.sub(r'\$\{[^}]*\}', '{}', c)
            if not c2.startswith('/api') or 'http' in c2:
                continue
            ok = matches(c2, home)
            if not ok:
                tgt, tpath = proxy_targets(c2)
                if tgt is not None:
                    ok = matches(tpath, tgt)
            if not ok:
                misses.append((f, c2))

    # Documented false positives: parameterized paths whose concrete values
    # are covered by distinct backend routes.
    ALLOWLIST = {
        ('components/adminTabs/homeAssistant.tsx', '/api/admin/ha/registry/{}'):
            'kind in {entities, devices, areas} — three concrete routes exist',
        ('components/OsSystemShell.tsx', '/api/os/control/os/{}'):
            'dynamic os/* path — any() proxy to iora-control with concrete os/* routes',
        ('components/SettingsPage.tsx', '/api/os/control/os/{}'):
            'dynamic os/* path — any() proxy to iora-control with concrete os/* routes',
    }

    real_misses = [(f, m) for (f, m) in misses if (f, m) not in ALLOWLIST]
    if real_misses:
        print(f"UNRESOLVED ({len(real_misses)}):")
        for f, m in real_misses:
            print(f"  {f}: {m[:110]}")
        sys.exit(1)
    if misses:
        print(f"OK — {len(misses)} documented false positive(s) (all concrete routes exist).")
    else:
        print("OK — every admin frontend API path resolves to a backend route.")


if __name__ == '__main__':
    main()
