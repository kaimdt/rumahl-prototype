#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys


ROOTS = [
    ('apps', 'apps/examples/apps', 'app'),
    ('plugins', 'apps/examples/plugins', 'plugin'),
    ('themes', 'apps/examples/themes', 'theme'),
]


def has_string(value) -> bool:
    return isinstance(value, str) and len(value.strip()) > 0


def manifest_id(manifest):
    return manifest.get('id') or manifest.get('metadata', {}).get('id')


def manifest_name(manifest):
    return manifest.get('name') or manifest.get('metadata', {}).get('name')


def manifest_version(manifest):
    return manifest.get('version') or manifest.get('metadata', {}).get('version')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo-root', default=os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
    args = parser.parse_args()
    repo_root = os.path.abspath(args.repo_root)

    errors: list[str] = []
    warnings: list[str] = []
    checked = 0

    for _, relative_root, expected in ROOTS:
        absolute_root = os.path.join(repo_root, relative_root)
        if not os.path.isdir(absolute_root):
            warnings.append(f'{relative_root}: directory not found; skipping')
            continue

        for entry in sorted(os.listdir(absolute_root)):
            example_dir = os.path.join(absolute_root, entry)
            if not os.path.isdir(example_dir):
                continue

            manifest_path = None
            for manifest_name_candidate in ('manifest.json', 'plugin.json'):
                candidate = os.path.join(example_dir, manifest_name_candidate)
                if os.path.isfile(candidate):
                    manifest_path = candidate
                    break

            rel_dir = os.path.relpath(example_dir, repo_root).replace(os.sep, '/')
            if not manifest_path:
                errors.append(f'{rel_dir}: missing manifest.json or plugin.json')
                continue

            checked += 1
            for build_file in ('build.ps1', 'build.sh'):
                if not os.path.isfile(os.path.join(example_dir, build_file)):
                    errors.append(f'{rel_dir}: missing {build_file}')

            rel_manifest = os.path.relpath(manifest_path, repo_root).replace(os.sep, '/')
            try:
                with open(manifest_path, encoding='utf-8') as handle:
                    manifest = json.load(handle)
            except Exception as error:
                errors.append(f'{rel_manifest}: invalid JSON ({error})')
                continue

            version = manifest_version(manifest)
            if not has_string(manifest_id(manifest)):
                errors.append(f'{rel_manifest}: missing id or metadata.id')
            if not has_string(manifest_name(manifest)):
                errors.append(f'{rel_manifest}: missing name or metadata.name')
            if not has_string(version):
                errors.append(f'{rel_manifest}: missing version or metadata.version')
            elif not re.match(r'^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$', version):
                warnings.append(f'{rel_manifest}: version is not SemVer-like: {version}')

            if expected == 'app' and manifest.get('type') != 'app':
                errors.append(f'{rel_manifest}: app example must use type "app"')
            elif expected == 'theme':
                if manifest.get('plugin_type') != 'theme' or not isinstance(manifest.get('theme'), dict):
                    errors.append(f'{rel_manifest}: theme example must declare plugin_type "theme" and a theme object')
            elif expected == 'plugin':
                plugin_like = manifest.get('type') in ('plugin', 'service') or has_string(manifest.get('entry'))
                if not plugin_like:
                    errors.append(f'{rel_manifest}: plugin example must be plugin-like (type plugin/service or entry)')

    for warning in warnings:
        print(f'WARN: {warning}')

    if not errors:
        print(f'OK: app/plugin/theme examples are structurally valid ({checked} examples).')
        return 0

    print('ERROR: app/plugin/theme example validation failed:')
    for error in errors:
        print(f'  {error}')
    return 1


if __name__ == '__main__':
    sys.exit(main())