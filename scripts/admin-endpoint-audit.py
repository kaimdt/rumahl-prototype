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
ADMIN_FILES = [
    'components/AdminPanel.tsx', 'components/AdminPanelTabs.tsx',
    'components/adminTabs/ai.tsx', 'components/adminTabs/core.tsx',
    'components/adminTabs/homeAssistant.tsx', 'components/adminTabs/iot.tsx',
    'components/adminTabs/network.tsx', 'components/adminTabs/os.tsx',
    'components/adminTabs/services.tsx', 'components/adminTabs/tools.tsx',
    # Native OS apps + widgets (Packages 3/5/6) + OS shell surfaces
    'components/OsStorageApp.tsx', 'components/OsContainersApp.tsx',
    'components/OsLogsApp.tsx', 'components/OsServicesApp.tsx',
    'components/OsDevicesApp.tsx', 'components/OsSystemApp.tsx',
    'components/OsImagesApp.tsx', 'components/OsFileExplorer.tsx',
    'components/JobCenterPanel.tsx', 'components/ClipboardManager.tsx',
    'components/PermissionRequestDialog.tsx', 'components/CommandPalette.tsx',
    'components/OsSystemShell.tsx', 'components/OsTerminal.tsx',
    'components/widgets/OraMediaWidget.tsx', 'components/widgets/OraJobsWidget.tsx',
    'components/widgets/OraStorageWidget.tsx', 'components/widgets/OraSystemWidget.tsx',
    'components/widgets/OraRecentFilesWidget.tsx', 'components/widgets/OraPresenceWidget.tsx',
    'components/settings/SettingsSystem.tsx', 'components/SettingsPage.tsx',
    'contexts/AuthContext.tsx', 'contexts/OsWindowContext.tsx',
]


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
    return routes


def main():
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
            return None, None
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
