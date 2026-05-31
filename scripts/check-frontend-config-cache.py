#!/usr/bin/env python3
import argparse
import os
import re
import sys


def strip_strings(line: str) -> str:
    line = re.sub(r'"(?:[^"\\]|\\.)*"', '""', line)
    line = re.sub(r"'(?:[^'\\]|\\.)*'", "''", line)
    line = re.sub(r'`(?:[^`\\]|\\.)*`', '``', line)
    return line


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo-root', default=os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
    parser.add_argument('--fail-on-finding', action='store_true')
    args = parser.parse_args()

    repo_root = os.path.abspath(args.repo_root)
    frontend_src = os.path.join(repo_root, 'frontend', 'src')
    if not os.path.isdir(frontend_src):
        print('WARN: frontend/src not found; skipping frontend config cache scan.')
        return 0

    pattern = re.compile(r'^\s*(const|let)\s+[A-Za-z0-9_]+\s*=\s*(getBackendUrl|getAssistUrl)\(\)')
    findings: list[str] = []

    for root, _, files in os.walk(frontend_src):
        for name in files:
            if not name.endswith(('.ts', '.tsx')):
                continue
            file_path = os.path.join(root, name)
            brace_depth = 0
            with open(file_path, encoding='utf-8') as handle:
                for index, line in enumerate(handle, start=1):
                    if brace_depth == 0 and pattern.search(line):
                        relative = os.path.relpath(file_path, repo_root).replace(os.sep, '/')
                        findings.append(f'{relative}:{index}: {line.strip()}')

                    cleaned = strip_strings(line)
                    brace_depth = max(0, brace_depth + cleaned.count('{') - cleaned.count('}'))

    if not findings:
        print('OK: no obvious module-scope frontend URL caches found.')
        return 0

    print("WARN: possible frontend URL caches found. Prefer call-time helpers like apiBase() => getBackendUrl() || ''.")
    for finding in findings:
        print(f'  {finding}')

    return 1 if args.fail_on_finding else 0


if __name__ == '__main__':
    sys.exit(main())