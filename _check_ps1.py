import re

with open('rumahl-os/dev-local.ps1', 'r', encoding='utf-8-sig') as f:
    lines = f.readlines()

# Count braces (rough, ignores strings/comments)
depth = 0
min_depth = 0
for i, line in enumerate(lines, 1):
    stripped = line.strip()
    if stripped.startswith('#'):
        continue
    for ch in stripped:
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth < min_depth:
                min_depth = depth
                print(f'  Negative depth at line {i}: {stripped[:80]}')

print(f'Final brace depth: {depth} (should be 0)')
print(f'Min depth: {min_depth}')
print(f'Total lines: {len(lines)}')
print()

# Show key sections
for i, line in enumerate(lines, 1):
    lower = line.lower()
    if 'cargo_jobs' in lower and 'math' in lower:
        print(f'CARGO_JOBS:   L{i}: {line.rstrip()}')
    elif 'cargoprofilerelease_lto' in lower or 'releaseprofile' in lower or 'release-fast' in line:
        print(f'BUILD_PROFILE: L{i}: {line.rstrip()}')
    elif 'deployorabins' in lower and 'rumahl-core' in line:
        print(f'DEPLOY_BINS:  L{i}: {line.rstrip()[:100]}')
    elif 'deploycmds = @' in line:
        print(f'DEPLOY_CMDS:  L{i}: {line.rstrip()[:100]}')
    elif 'src=/home/ora' in line and 'ForEach' not in line:
        print(f'DEPLOY_CMD:   L{i}: {line.rstrip()[:120]}')
    elif 'frontenddir' in lower and 'node' in line:
        print(f'FRONTEND:     L{i}: {line.rstrip()[:100]}')
    elif 'inliner ssh' in lower:
        print(f'INLINE_SSH:   L{i}: {line.rstrip()[:100]}')
