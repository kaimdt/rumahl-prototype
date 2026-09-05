import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import postcss from 'postcss'

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(resolve(frontend, '../package.json'))
const cache = new Map()

// Compile actual presentation components with the installed compiler. This suite
// runs with Node so the visual foundations can be checked without a Bun runtime.
function component(relativePath) {
  const filename = resolve(frontend, relativePath)
  if (cache.has(filename)) return cache.get(filename)
  const source = readFileSync(filename, 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  })
  const module = { exports: {} }
  const load = (id) => id.startsWith('@/')
    ? component(`${id.slice(2)}${id.endsWith('utils') ? '.ts' : '.tsx'}`)
    : require(id)
  new Script(`(function(require, module, exports) {${outputText}\n})`, { filename })
    .runInThisContext()(load, module, module.exports)
  cache.set(filename, module.exports)
  return module.exports
}

test('Button retains native form semantics and accessible disabled state', () => {
  const { Button } = component('components/ui/button.tsx')
  const html = renderToStaticMarkup(React.createElement(Button, {
    type: 'submit', disabled: true, name: 'action', value: 'save',
    'aria-label': 'Save settings', variant: 'secondary',
  }, 'Save'))
  for (const attribute of ['type="submit"', 'disabled=""', 'name="action"', 'value="save"', 'aria-label="Save settings"']) {
    assert.ok(html.includes(attribute), attribute)
  }
})

test('Button asChild preserves a link instead of nesting interactive elements', () => {
  const { Button } = component('components/ui/button.tsx')
  const html = renderToStaticMarkup(React.createElement(Button, { asChild: true, variant: 'outline' },
    React.createElement('a', { href: '/settings', 'aria-current': 'page' }, 'Settings')))
  assert.match(html, /^<a /)
  assert.match(html, /href="\/settings"/)
  assert.match(html, /aria-current="page"/)
  assert.doesNotMatch(html, /<button/)
})

test('Input and textarea preserve labels, validation and form values', () => {
  const { Input } = component('components/ui/input.tsx')
  const { Textarea } = component('components/ui/textarea.tsx')
  const input = renderToStaticMarkup(React.createElement(Input, {
    type: 'email', name: 'email', defaultValue: 'test@example.invalid', required: true,
    'aria-invalid': true, 'aria-describedby': 'email-error',
  }))
  assert.match(input, /type="email"/)
  assert.match(input, /required=""/)
  assert.match(input, /aria-invalid="true"/)
  assert.match(input, /aria-describedby="email-error"/)
  assert.match(input, /value="test@example.invalid"/)
  const textarea = renderToStaticMarkup(React.createElement(Textarea, {
    name: 'notes', rows: 4, defaultValue: 'Existing notes', 'aria-label': 'Notes',
  }))
  assert.match(textarea, /rows="4"/)
  assert.match(textarea, /aria-label="Notes"/)
  assert.match(textarea, />Existing notes<\/textarea>/)
})

test('App frame keeps all optional regions without creating nested main landmarks', () => {
  const { OsAppFrame } = component('components/OsAppFrame.tsx')
  const html = renderToStaticMarkup(React.createElement(OsAppFrame, {
    navbar: 'Title', toolbar: 'Tools', sidebar: 'Navigation', detail: 'Details',
  }, 'Content'))
  for (const region of ['Title', 'Tools', 'Navigation', 'Details', 'Content']) assert.ok(html.includes(region))
  assert.equal((html.match(/<aside/g) || []).length, 2)
  assert.doesNotMatch(html, /<main/)
})

const css = postcss.parse(readFileSync(resolve(frontend, 'index.css'), 'utf8'))

test('Desktop mode cannot replace theme-aware semantic surfaces with fixed dark colors', () => {
  css.walkRules((rule) => {
    if (rule.selector !== ':root[data-shell-mode="desktop"]') return
    rule.walkDecls((declaration) => {
      if (/^--(?:surface-|os-bg)/.test(declaration.prop)) {
        assert.match(declaration.value, /var\(/, `${rule.selector}: ${declaration.prop}`)
      }
    })
  })
})

test('Titlebar plus toolbar is never constrained to a single fixed header height', () => {
  css.walkRules((rule) => {
    if (!rule.selectors.some((selector) => /(?:^|\s)\.rumahl-app-navbar$/.test(selector))) return
    rule.walkDecls('height', (declaration) => assert.ok(
      ['auto', 'fit-content'].includes(declaration.value), `${rule.selector}: ${declaration.value}`,
    ))
  })
})

test('Inactive window styling does not dim application content with filters', () => {
  css.walkRules((rule) => {
    if (!rule.selector.includes('.rumahl-os-window[data-active="false"]')) return
    rule.walkDecls('filter', (declaration) => assert.equal(declaration.value, 'none'))
  })
})

test('Portaled controls stay above dialogs and below critical overlays', () => {
  const levels = new Map()
  css.walkDecls((declaration) => {
    if (declaration.prop.startsWith('--layer-')) levels.set(declaration.prop, Number(declaration.value))
  })
  const order = ['windows', 'shell', 'flyout', 'dialog', 'menu', 'tooltip', 'critical']
    .map((name) => levels.get(`--layer-${name}`))
  assert.ok(order.every(Number.isFinite))
  assert.ok(order.every((value, index) => index === 0 || value > order[index - 1]))
})

test('Glass settings disable and restore shell effects without freezing theme colors', () => {
  const properties = new Map()
  const attributes = new Map()
  const source = readFileSync(resolve(frontend, 'hooks/useGlassSettings.ts'), 'utf8')
  const { outputText } = ts.transpileModule(`${source}\nexport { applyGlassSettings }`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  })
  const module = { exports: {} }
  const sandbox = {
    module, exports: module.exports,
    require: (id) => id === 'react' ? require(id) : {},
    document: { documentElement: {
      setAttribute: (key, value) => attributes.set(key, value),
      style: {
        setProperty: (key, value) => properties.set(key, value),
        removeProperty: (key) => properties.delete(key),
      },
    } },
    getComputedStyle: () => ({ getPropertyValue: () => 'oklch(0.2 0.01 250 / 0.8)' }),
  }
  new Script(outputText).runInNewContext(sandbox)
  const apply = module.exports.applyGlassSettings
  const settings = { enabled: true, blurIntensity: 40, transparency: 1, cardRadius: 12, borderAlpha: 0.12 }
  apply(settings)
  assert.equal(attributes.get('data-glass'), 'on')
  assert.equal(properties.get('--blur-surface'), '16px')
  assert.equal(properties.get('--blur-overlay'), '24px')
  assert.equal(properties.get('--surface-glass-opacity'), '92%')
  assert.equal(properties.has('--rumahl-glass-bg'), false)
  apply({ ...settings, enabled: false })
  assert.equal(attributes.get('data-glass'), 'off')
  assert.equal(properties.get('--blur-surface'), '0px')
  assert.equal(properties.get('--blur-overlay'), '0px')
  assert.equal(properties.get('--surface-glass-opacity'), '100%')
  apply({ ...settings, transparency: 0.5 })
  assert.equal(properties.get('--surface-glass-opacity'), '46%')
  assert.equal(properties.get('--blur-overlay'), '24px')
  apply(settings)
  assert.equal(properties.has('--rumahl-glass-bg'), false)
})

function windowLogic(name, sandbox) {
  const filename = resolve(frontend, 'contexts/OsWindowContext.tsx')
  const source = readFileSync(filename, 'utf8')
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let snippet
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(ast) === name) {
      snippet = ts.isFunctionDeclaration(node) ? node.getText(ast) : `const ${node.getText(ast)}`
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(snippet, name)
  const { outputText } = ts.transpileModule(`${snippet}; globalThis.result = ${name}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
  new Script(outputText).runInNewContext(sandbox)
  return sandbox.result
}

test('Maximized windows fill the desktop work area edge to edge', () => {
  const sandbox = {
    innerWidth: 1440, innerHeight: 900, SNAP_INSET: 8, SNAP_GAP: 6,
    document: { documentElement: { dataset: { shellMode: 'desktop' } }, querySelector: () => ({ getBoundingClientRect: () => ({ height: 48 }) }) },
  }
  const bounds = windowLogic('screenBounds', sandbox)('maximized')
  assert.deepEqual(JSON.parse(JSON.stringify(bounds)), { x: 0, y: 0, width: 1440, height: 852 })
})

test('Restoring a maximized window survives React replaying the state updater', () => {
  const original = { pageId: 'files', layout: 'window', x: 85, y: 70, width: 800, height: 560, z: 1, minimized: false }
  let state = [original]
  const sandbox = {
    restoreRectsRef: { current: new Map() }, useCallback: (fn) => fn,
    nextZ: () => 2, screenBounds: () => ({ x: 0, y: 0, width: 1440, height: 852 }),
    setWindows: (update) => { update(state); state = update(state) },
  }
  const toggle = windowLogic('toggleMaximize', sandbox)
  toggle('files')
  assert.equal(state[0].layout, 'maximized')
  toggle('files')
  for (const key of ['layout', 'x', 'y', 'width', 'height']) assert.equal(state[0][key], original[key], key)
})

test('Immersive app content escapes page width and padding constraints', () => {
  let fullscreen
  css.walkRules('main[data-immersive="true"]', (rule) => { fullscreen = rule })
  assert.ok(fullscreen)
  const declarations = Object.fromEntries(fullscreen.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]))
  assert.equal(declarations.position, 'fixed')
  assert.equal(declarations.inset, '0')
  assert.equal(declarations['max-width'], 'none')
  assert.equal(declarations.padding, '0')
})

test('Bar preferences retain transparent mode and validate persisted values', () => {
  const source = readFileSync(resolve(frontend, 'hooks/useShellAppearance.ts'), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
  const module = { exports: {} }
  let stored = { material: 'transparent', contrast: 'light', border: false, blur: 12 }
  const root = { dataset: {}, style: { setProperty: () => {} } }
  new Script(outputText).runInNewContext({ module, exports: module.exports, document: { documentElement: root },
    require: (id) => id === 'react' ? { useEffect: (effect) => effect() } : { useLocalStorage: () => [stored, (value) => { stored = value }] },
  })
  const { normalizeShellAppearance, useShellAppearance } = module.exports
  useShellAppearance()
  assert.equal(root.dataset.barMaterial, 'transparent')
  assert.equal(root.dataset.barContrast, 'light')
  assert.equal(root.dataset.barBorder, 'false')
  useShellAppearance().reset()
  useShellAppearance()
  assert.equal(root.dataset.barMaterial, 'solid')
  assert.equal(root.dataset.barContrast, 'auto')
  assert.equal(root.dataset.barBorder, 'true')
  assert.equal(normalizeShellAppearance({ blur: 400 }).blur, 40)
  assert.equal(normalizeShellAppearance({ blur: NaN, material: 'invalid' }).material, 'solid')
  assert.equal(normalizeShellAppearance(null).blur, 20)
})

test('Fully transparent desktop bars have neither fill nor blur', () => {
  let material
  css.walkRules(':root[data-shell-mode="desktop"][data-bar-material="transparent"] .rumahl-system-bar', (rule) => { material = rule })
  assert.ok(material)
  const values = Object.fromEntries(material.nodes.filter((node) => node.type === 'decl').map((node) => [node.prop, node.value]))
  assert.equal(values.background, 'transparent')
  assert.equal(values['backdrop-filter'], 'none')
})

test('Desktop bar personalization labels exist in both root settings locales', () => {
  for (const language of ['de', 'en']) {
    const locale = JSON.parse(readFileSync(resolve(frontend, `i18n/locales/${language}.json`), 'utf8'))
    for (const key of ['title', 'description', 'material', 'solid', 'glass', 'transparent', 'contrast', 'contrastHint', 'auto', 'light', 'dark', 'border', 'blur', 'reset']) {
      assert.equal(typeof locale.settings.shellAppearance[key], 'string', `${language}: ${key}`)
    }
  }
})

function isolatedPresentationModule(path, mocks, globals = {}) {
  const source = readFileSync(resolve(frontend, path), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } })
  const module = { exports: {} }
  new Script(outputText).runInNewContext({ module, exports: module.exports, require: (id) => mocks[id] ?? require(id), ...globals })
  return module.exports
}

test('Color mode dropdown selects working light, dark and automatic theme states', () => {
  const calls = []
  const theme = { selectedTheme: 'day', designModes: [], activeDesignMode: 'default', setSelectedTheme: (value) => calls.push(['theme', value]), setAutoTheme: (value) => calls.push(['auto', value]), setSleepMode: (value) => calls.push(['sleep', value]) }
  const { ThemeColorModeControl } = isolatedPresentationModule('components/settings/ThemeColorModeControl.tsx', {
    '@/contexts/ThemeContext': { useTheme: () => theme },
    'react-i18next': { useTranslation: () => ({ t: (key) => key }) },
    './appr': { ApprSelect: 'select' },
  })
  const dropdown = ThemeColorModeControl()
  assert.equal(dropdown.props.value, 'light')
  theme.selectedTheme = 'day-classic'
  assert.equal(ThemeColorModeControl().props.value, 'dark')
  dropdown.props.onChange('dark')
  assert.deepEqual(calls.pop(), ['theme', 'night'])
  dropdown.props.onChange('auto')
  assert.deepEqual(calls.slice(-3), [['sleep', false], ['auto', true], ['theme', 'auto']])
  dropdown.props.onChange('light')
  assert.deepEqual(calls.pop(), ['theme', 'day'])
})

test('Custom color mode selection preserves its theme and uses declared modes', () => {
  const calls = []
  const { ThemeColorModeControl } = isolatedPresentationModule('components/settings/ThemeColorModeControl.tsx', {
    '@/contexts/ThemeContext': { useTheme: () => ({ selectedTheme: 'custom-theme', activeDesignMode: 'light', designModes: [{ id: 'light', name: 'Light' }, { id: 'dark', name: 'Dark' }], setActiveDesignMode: (value) => calls.push(value) }) },
    'react-i18next': { useTranslation: () => ({ t: (key) => key }) }, './appr': { ApprSelect: 'select' },
  })
  const dropdown = ThemeColorModeControl().props.children[0]
  assert.deepEqual(Array.from(dropdown.props.options, (option) => option.value), ['light', 'dark'])
  dropdown.props.onChange('dark')
  assert.deepEqual(calls, ['dark'])
})

test('Glass style applies stored density, blur and tint and can return to solid', () => {
  const properties = new Map()
  const root = { dataset: {}, style: { setProperty: (key, value) => properties.set(key, value) } }
  let stored = { style: 'glass', opacity: 55, blur: 30, tint: '#224466', tintStrength: 22 }
  const { useSurfaceAppearance, normalizeSurfaceAppearance } = isolatedPresentationModule('hooks/useSurfaceAppearance.ts', {
    react: { useEffect: (effect) => effect() }, '@/lib/storage': { useLocalStorage: () => [stored, (value) => { stored = value }] },
  }, { document: { documentElement: root } })
  useSurfaceAppearance()
  assert.equal(root.dataset.surfaceStyle, 'glass')
  assert.equal(properties.get('--user-glass-opacity'), '55%')
  assert.equal(properties.get('--user-glass-blur'), '30px')
  assert.equal(properties.get('--user-glass-tint'), '#224466')
  useSurfaceAppearance().reset()
  useSurfaceAppearance()
  assert.equal(root.dataset.surfaceStyle, 'solid')
  assert.equal(normalizeSurfaceAppearance({ opacity: -1, blur: Infinity, tint: 'invalid' }).opacity, 20)
  assert.equal(normalizeSurfaceAppearance({ blur: Infinity }).blur, 24)
  for (const language of ['de', 'en']) {
    const locale = JSON.parse(readFileSync(resolve(frontend, `i18n/locales/${language}.json`), 'utf8'))
    assert.ok(locale.settings.surfaceStyle.title)
    assert.ok(locale.settings.colorSupport.switching)
  }
})
