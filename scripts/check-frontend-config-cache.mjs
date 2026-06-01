#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
let repoRoot = path.resolve(scriptDir, '..')
let failOnFinding = false

const args = process.argv.slice(2)
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--repo-root') {
    repoRoot = path.resolve(args[index + 1])
    index += 1
  } else if (arg === '--fail-on-finding') {
    failOnFinding = true
  } else {
    console.error(`Unknown argument: ${arg}`)
    process.exit(2)
  }
}

const frontendSrc = path.join(repoRoot, 'frontend/src')
if (!fs.existsSync(frontendSrc)) {
  console.log('WARN: frontend/src not found; skipping frontend config cache scan.')
  process.exit(0)
}

const findings = []
const declarationPattern = /^\s*(const|let)\s+[A-Za-z0-9_]+\s*=\s*(getBackendUrl|getAssistUrl)\(\)/

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(entryPath)
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      scanFile(entryPath)
    }
  }
}

function stripStrings(line) {
  return line
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

function scanFile(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  let braceDepth = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (braceDepth === 0 && declarationPattern.test(line)) {
      const relative = path.relative(repoRoot, filePath).replace(/\\/g, '/')
      findings.push(`${relative}:${index + 1}: ${line.trim()}`)
    }

    const withoutStrings = stripStrings(line)
    const opens = [...withoutStrings.matchAll(/\{/g)].length
    const closes = [...withoutStrings.matchAll(/\}/g)].length
    braceDepth = Math.max(0, braceDepth + opens - closes)
  }
}

walk(frontendSrc)

if (findings.length === 0) {
  console.log('OK: no obvious module-scope frontend URL caches found.')
  process.exit(0)
}

console.log("WARN: possible frontend URL caches found. Prefer call-time helpers like apiBase() => getBackendUrl() || ''.")
for (const finding of findings) {
  console.log(`  ${finding}`)
}

process.exit(failOnFinding ? 1 : 0)