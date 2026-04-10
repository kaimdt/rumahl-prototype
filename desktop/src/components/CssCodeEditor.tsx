import { useRef, useEffect, useCallback } from 'react'
import { EditorView, keymap, placeholder as cmPlaceholder, lineNumbers, highlightActiveLineGutter, highlightActiveLine } from '@codemirror/view'
import { EditorState, Compartment } from '@codemirror/state'
import { css } from '@codemirror/lang-css'
import { oneDark } from '@codemirror/theme-one-dark'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, bracketMatching, foldGutter, indentOnInput } from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { autocompletion } from '@codemirror/autocomplete'
import { tags } from '@lezer/highlight'
import { useTheme } from '@/contexts/ThemeContext'

const LIGHT_THEMES = new Set(['day', 'light'])

const lightHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#d32f2f' },
  { tag: tags.atom, color: '#6a1b9a' },
  { tag: tags.number, color: '#1565c0' },
  { tag: tags.string, color: '#2e7d32' },
  { tag: tags.variableName, color: '#0277bd' },
  { tag: tags.comment, color: '#78909c', fontStyle: 'italic' },
  { tag: tags.propertyName, color: '#c62828' },
  { tag: tags.tagName, color: '#6a1b9a' },
  { tag: tags.className, color: '#f57c00' },
  { tag: tags.attributeName, color: '#0277bd' },
  { tag: tags.attributeValue, color: '#2e7d32' },
  { tag: tags.punctuation, color: '#546e7a' },
  { tag: tags.operator, color: '#d32f2f' },
  { tag: tags.definition(tags.variableName), color: '#0277bd' },
])

interface CssCodeEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: string
}

export function CssCodeEditor({ value, onChange, placeholder = '', minHeight = '200px' }: CssCodeEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const { theme: currentTheme } = useTheme()
  const isLight = LIGHT_THEMES.has(currentTheme)

  const createEditor = useCallback(() => {
    if (!containerRef.current) return

    const tooltipBg = isLight ? 'oklch(0.97 0.005 260)' : 'oklch(0.15 0.02 260)'
    const tooltipBorder = isLight ? 'oklch(from var(--foreground) l c h / 0.12)' : 'oklch(from var(--foreground) l c h / 0.15)'

    const theme = EditorView.theme({
      '&': {
        fontSize: '12px',
        backgroundColor: 'transparent',
        minHeight,
      },
      '.cm-content': {
        fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
        padding: '8px 0',
        caretColor: 'var(--accent, #7c3aed)',
        ...(isLight ? { color: '#263238' } : {}),
      },
      '.cm-focused': {
        outline: 'none',
      },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        borderRight: '1px solid oklch(from var(--foreground) l c h / 0.08)',
        color: 'oklch(from var(--foreground) l c h / 0.3)',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'oklch(from var(--foreground) l c h / 0.05)',
        color: 'oklch(from var(--foreground) l c h / 0.6)',
      },
      '.cm-activeLine': {
        backgroundColor: 'oklch(from var(--foreground) l c h / 0.03)',
      },
      '.cm-selectionBackground': {
        backgroundColor: 'oklch(from var(--accent, #7c3aed) l c h / 0.2) !important',
      },
      '.cm-cursor': {
        borderLeftColor: 'var(--accent, #7c3aed)',
      },
      '.cm-matchingBracket': {
        backgroundColor: 'oklch(from var(--accent, #7c3aed) l c h / 0.15)',
        outline: '1px solid oklch(from var(--accent, #7c3aed) l c h / 0.3)',
      },
      '.cm-foldGutter': {
        width: '12px',
      },
      '.cm-tooltip': {
        backgroundColor: tooltipBg,
        border: `1px solid ${tooltipBorder}`,
        borderRadius: '8px',
      },
      '.cm-tooltip-autocomplete': {
        '& > ul > li': {
          padding: '3px 8px',
          fontSize: '11px',
        },
      },
      '.cm-placeholder': {
        color: 'oklch(from var(--foreground) l c h / 0.25)',
        fontStyle: 'italic',
      },
    })

    const readOnlyCompartment = new Compartment()

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        foldGutter(),
        history(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        css(),
        ...(isLight
          ? [syntaxHighlighting(lightHighlightStyle)]
          : [oneDark]),
        theme,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        cmPlaceholder(placeholder),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...closeBracketsKeymap,
          indentWithTab,
        ]),
        readOnlyCompartment.of([]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
      ],
    })

    const view = new EditorView({
      state,
      parent: containerRef.current,
    })

    viewRef.current = view
  }, [isLight]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    createEditor()
    return () => {
      viewRef.current?.destroy()
      viewRef.current = null
    }
  }, [createEditor])

  // Sync external value changes (but not our own edits)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const currentDoc = view.state.doc.toString()
    if (currentDoc !== value) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      })
    }
  }, [value])

  return (
    <div
      ref={containerRef}
      className={`rounded-lg border border-foreground/10 overflow-hidden ${isLight ? 'bg-foreground/[0.04]' : 'bg-foreground/[0.03]'}`}
      style={{ minHeight }}
    />
  )
}
