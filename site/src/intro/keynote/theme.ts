// Keynote: a near-black editor on a pure black stage. Code is white and grey, with
// indigo for keywords (the one accent) and a warm tone for strings.
import type { IdeTheme } from '../engine/theme'
import type { PreviewTheme } from '../engine/SearchPreview'

const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"
const SANS = "'Inter Variable', Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"

export const keynoteIde: IdeTheme = {
  font: MONO, fontSize: 28, lineHeight: 1.6,
  bg: '#0e0e10', fg: '#e8e8ed', lineNumber: '#3a3a40', activeLine: 'rgba(255,255,255,0.035)',
  cursor: '#a5b4fc', flash: 'rgba(129,140,248,0.26)', border: 'rgba(255,255,255,0.09)',
  tabBar: '#09090b', tabText: '#6e6e73', tabActiveBg: '#0e0e10', tabActiveText: '#f5f5f7',
  popupBg: '#1c1c1f', popupBorder: 'rgba(255,255,255,0.12)', popupSelected: 'rgba(129,140,248,0.24)',
  popupText: '#f5f5f7', popupDetail: '#8e8e93', popupMatch: '#a5b4fc', shadow: '0 30px 80px rgba(0,0,0,0.65)',
  radius: 22, chrome: 'none',
  tokens: {
    comment: '#636366', string: '#f0c48f', keyword: '#a5b4fc', type: '#e0e4ff', number: '#f0c48f',
    fn: '#ffffff', tag: '#a5b4fc', attr: '#c7c7cc', punct: '#8e8e93', plain: '#d1d1d6',
  },
}

export const keynotePreview: PreviewTheme = {
  font: SANS, mono: MONO, bg: '#0e0e10', fg: '#f5f5f7', muted: '#8e8e93', line: 'rgba(255,255,255,0.1)',
  field: '#000000', accent: '#818cf8', ok: '#86efac', err: '#fdba74',
  okSoft: 'rgba(134,239,172,0.12)', errSoft: 'rgba(253,186,116,0.13)', radius: 22,
}
