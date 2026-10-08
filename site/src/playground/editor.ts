// Monaco, bundled by Vite and served by the site (no CDN). Imported dynamically by
// Playground.astro after first paint.
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
// The editor's features (hover, suggestions, parameter hints, find…). editor.api alone is the bare
// widget: without these, hovers and autocomplete never appear.
import 'monaco-editor/esm/vs/editor/editor.all.js'
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution'
import 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

self.MonacoEnvironment = { getWorker: (_: string, label: string) => (label === 'typescript' || label === 'javascript' ? new TsWorker() : new EditorWorker()) }
export { monaco }

export interface MountOptions {
  /** Each example's TypeScript source, by id. Every example gets its own model, so edits survive a tab switch. */
  sources: Record<string, string>
  /** The example to show first. */
  current: string
  /** The site's base URL (`import.meta.env.BASE_URL`, with its trailing slash). */
  base: string
  /** ⌘↵ / Ctrl+↵ in the editor. */
  onRun: () => void
  /** Called after every edit to the current model, with its text. */
  onChange?: (value: string) => void
}

/** A type error, by line, as the TypeScript worker reports it. */
export interface Diagnostic { line: number; message: string }

export interface MountedEditor {
  /** Shows an example's model. */
  show(id: string): void
  /** True once the current model no longer matches the example as shipped. */
  edited(): boolean
  /** The current model's text. */
  value(): string
  /** Replaces the current model's text as one edit, so Undo brings the old text back. */
  replace(code: string): void
  focus(): void
  /** Disposes the editor and every model it made, so the same ids can be mounted again. */
  dispose(): void
  /** The current model, compiled by the TypeScript worker, with its type errors. */
  compile(): Promise<{ js: string; errors: number; diagnostics: Diagnostic[] }>
}

const ts = monaco.languages.typescript

/** liaise's own type declarations, so hovers, autocomplete and errors are real. */
async function loadTypes(base: string) {
  ts.typescriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.NodeJs,
    strict: true, allowNonTsExtensions: true, lib: ['es2022', 'dom'],
  })
  const files: string[] = await fetch(`${base}liaise/dts.json`).then((r) => r.json())
  await Promise.all(files.map(async (f) =>
    ts.typescriptDefaults.addExtraLib(await fetch(`${base}liaise/${f}`).then((r) => r.text()), `file:///node_modules/liaise/dist/${f}`)))
  ts.typescriptDefaults.addExtraLib(`export * from './dist/index.js'`, 'file:///node_modules/liaise/index.d.ts')
  ts.typescriptDefaults.addExtraLib(`export * from './dist/built-in-middleware.js'`, 'file:///node_modules/liaise/middleware.d.ts')
  ts.typescriptDefaults.addExtraLib(`export * from './dist/testing.js'`, 'file:///node_modules/liaise/testing.d.ts')
}

monaco.editor.defineTheme('liaise', {
  base: 'vs-dark', inherit: true,
  rules: [{ token: 'comment', foreground: '6b7280', fontStyle: 'italic' }],
  colors: {
    'editor.background': '#0b0d12', 'editor.lineHighlightBackground': '#ffffff06', 'editorLineNumber.foreground': '#3b3f4a',
    'editorLineNumber.activeForeground': '#9ca3af', 'editorGutter.background': '#0b0d12', 'editorWidget.background': '#151821',
    'editorHoverWidget.background': '#151821', 'editorHoverWidget.border': '#ffffff1a', 'editorSuggestWidget.background': '#151821',
    'editorSuggestWidget.border': '#ffffff1a', 'scrollbarSlider.background': '#ffffff14',
  },
})

export async function mountEditor(host: HTMLElement, opts: MountOptions): Promise<MountedEditor> {
  await loadTypes(opts.base)
  const models = new Map(Object.entries(opts.sources).map(([id, code]) => {
    const uri = monaco.Uri.parse(`file:///${id}.ts`)
    // A mount that started before the last one was disposed (step 10 left and entered during load) left a model here.
    monaco.editor.getModel(uri)?.dispose()
    return [id, monaco.editor.createModel(code, 'typescript', uri)] as const
  }))
  let current = opts.current
  const codeFont = getComputedStyle(document.documentElement).getPropertyValue('--font-code').trim() + ', ui-monospace, Menlo, monospace'
  const editor = monaco.editor.create(host, {
    model: models.get(current), theme: 'liaise', fontFamily: codeFont, fontSize: 13, lineHeight: 21,
    minimap: { enabled: false }, scrollBeyondLastLine: false, padding: { top: 16, bottom: 16 }, renderLineHighlight: 'line',
    overviewRulerLanes: 0, hideCursorInOverviewRuler: true, scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    automaticLayout: true, tabSize: 2, fixedOverflowWidgets: true, lineNumbersMinChars: 3, glyphMargin: false, folding: false,
    stickyScroll: { enabled: false },
  })
  // Monaco measures glyphs when it is created; measure again once the code font has loaded.
  void document.fonts.ready.then(() => monaco.editor.remeasureFonts())

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, opts.onRun)
  // Ctrl+Space is often taken by the OS or another app on a Mac; ⌘I is VS Code's other way in.
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyI, () => editor.trigger('keyboard', 'editor.action.triggerSuggest', {}))
  editor.onDidChangeModelContent(() => opts.onChange?.(editor.getModel()!.getValue()))

  const model = () => models.get(current)!
  return {
    show(id) { current = id; editor.setModel(model()) },
    edited: () => model().getValue() !== opts.sources[current],
    value: () => model().getValue(),
    replace(code) {
      editor.pushUndoStop()
      editor.executeEdits('liaise', [{ range: model().getFullModelRange(), text: code }])
      editor.pushUndoStop()
    },
    focus: () => editor.focus(),
    dispose() { editor.dispose(); for (const m of models.values()) m.dispose() },
    async compile() {
      const m = model()
      const worker = await (await ts.getTypeScriptWorker())(m.uri)
      const [semantic, syntactic, emit] = await Promise.all([
        worker.getSemanticDiagnostics(m.uri.toString()), worker.getSyntacticDiagnostics(m.uri.toString()), worker.getEmitOutput(m.uri.toString()),
      ])
      const js = emit.outputFiles.find((f) => f.name.endsWith('.js'))?.text ?? ''
      const all = [...syntactic, ...semantic]
      const diagnostics = all.map((d) => ({
        line: d.start === undefined ? 1 : m.getPositionAt(d.start).lineNumber,
        message: typeof d.messageText === 'string' ? d.messageText : d.messageText.messageText,
      }))
      return { js, errors: all.length, diagnostics }
    },
  }
}
