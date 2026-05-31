#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
let repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--repo-root') {
    repoRoot = path.resolve(args[index + 1])
    index += 1
  } else {
    console.error(`Unknown argument: ${arg}`)
    process.exit(2)
  }
}

const roots = [
  { name: 'apps', dir: 'apps/examples/apps', expected: 'app' },
  { name: 'plugins', dir: 'apps/examples/plugins', expected: 'plugin' },
  { name: 'themes', dir: 'apps/examples/themes', expected: 'theme' },
]

const errors = []
const warnings = []
let checked = 0

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    errors.push(`${path.relative(repoRoot, filePath)}: invalid JSON (${error.message})`)
    return null
  }
}

function hasString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function manifestId(manifest) {
  return manifest?.id ?? manifest?.metadata?.id
}

function manifestName(manifest) {
  return manifest?.name ?? manifest?.metadata?.name
}

function manifestVersion(manifest) {
  return manifest?.version ?? manifest?.metadata?.version
}

function checkBuildScripts(exampleDir) {
  for (const fileName of ['build.ps1', 'build.sh']) {
    if (!fs.existsSync(path.join(exampleDir, fileName))) {
      errors.push(`${path.relative(repoRoot, exampleDir)}: missing ${fileName}`)
    }
  }
}

function checkCommon(manifest, manifestPath) {
  const relative = path.relative(repoRoot, manifestPath)
  if (!hasString(manifestId(manifest))) errors.push(`${relative}: missing id or metadata.id`)
  if (!hasString(manifestName(manifest))) errors.push(`${relative}: missing name or metadata.name`)
  if (!hasString(manifestVersion(manifest))) errors.push(`${relative}: missing version or metadata.version`)
  if (hasString(manifestVersion(manifest)) && !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifestVersion(manifest))) {
    warnings.push(`${relative}: version is not SemVer-like: ${manifestVersion(manifest)}`)
  }
}

function checkType(root, manifest, manifestPath) {
  const relative = path.relative(repoRoot, manifestPath)
  if (root.expected === 'app') {
    if (manifest.type !== 'app') errors.push(`${relative}: app example must use type "app"`)
    return
  }

  if (root.expected === 'theme') {
    if (manifest.plugin_type !== 'theme' || !manifest.theme || typeof manifest.theme !== 'object') {
      errors.push(`${relative}: theme example must declare plugin_type "theme" and a theme object`)
    }
    return
  }

  const pluginLike = manifest.type === 'plugin' || manifest.type === 'service' || hasString(manifest.entry)
  if (!pluginLike) {
    errors.push(`${relative}: plugin example must be plugin-like (type plugin/service or entry)`)
  }
}

for (const root of roots) {
  const absRoot = path.join(repoRoot, root.dir)
  if (!fs.existsSync(absRoot)) {
    warnings.push(`${root.dir}: directory not found; skipping`)
    continue
  }

  for (const entry of fs.readdirSync(absRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const exampleDir = path.join(absRoot, entry.name)
    const manifestPath = ['manifest.json', 'plugin.json']
      .map((fileName) => path.join(exampleDir, fileName))
      .find((candidate) => fs.existsSync(candidate))

    if (!manifestPath) {
      errors.push(`${path.relative(repoRoot, exampleDir)}: missing manifest.json or plugin.json`)
      continue
    }

    checked += 1
    checkBuildScripts(exampleDir)
    const manifest = readJson(manifestPath)
    if (!manifest) continue
    checkCommon(manifest, manifestPath)
    checkType(root, manifest, manifestPath)
  }
}

for (const warning of warnings) {
  console.log(`WARN: ${warning}`)
}

if (errors.length === 0) {
  console.log(`OK: app/plugin/theme examples are structurally valid (${checked} examples).`)
  process.exit(0)
}

console.log('ERROR: app/plugin/theme example validation failed:')
for (const error of errors) {
  console.log(`  ${error}`)
}
process.exit(1)