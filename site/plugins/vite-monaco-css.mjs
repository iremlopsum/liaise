// Monaco's JavaScript imports its own stylesheets (`import './x.css';`, about 110 of them).
// Astro links every stylesheet a page's script can reach, dynamic imports included, in the page's
// <head>: the editor's ~125 kB of CSS would block first paint on every page with the playground,
// though the editor itself loads after it. This turns each of those imports into a <style> that
// the editor's own chunk adds when it runs, so the CSS arrives with the editor and never before.
const MONACO = /[\\/]monaco-editor[\\/]esm[\\/].*\.js$/
const CSS_IMPORT = /^import\s+(['"])([^'"]+\.css)\1;?[ \t]*$/gm
const HELPER = 'virtual:monaco-style'

export default function monacoCssWithEditor() {
  return {
    name: 'liaise:monaco-css-with-editor',
    apply: 'build',
    resolveId: (id) => (id === HELPER ? `\0${HELPER}` : undefined),
    load: (id) =>
      id === `\0${HELPER}`
        ? `export function addStyle(css) { const s = document.createElement('style'); s.textContent = css; document.head.append(s) }`
        : undefined,
    transform(code, id) {
      if (!MONACO.test(id) || !code.includes('.css')) return
      let n = 0
      const out = code.replace(CSS_IMPORT, (_, q, path) => {
        const name = `__monacoCss${n++}`
        return `import ${name} from ${q}${path}?inline${q}; __addMonacoStyle(${name});`
      })
      if (n === 0) return
      return { code: `import { addStyle as __addMonacoStyle } from '${HELPER}';\n${out}`, map: null }
    },
  }
}
