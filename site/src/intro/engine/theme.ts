// What an editor look is made of. Each look passes its own (keynote/); these two are
// starting points (a dark and a light editor in the docs' palette).
import type { TokenKind } from './tokenize'

export type IdeTheme = {
  font: string
  fontSize: number
  lineHeight: number
  bg: string
  fg: string
  lineNumber: string
  activeLine: string
  cursor: string
  flash: string
  border: string
  tabBar: string
  tabText: string
  tabActiveBg: string
  tabActiveText: string
  popupBg: string
  popupBorder: string
  popupSelected: string
  popupText: string
  popupDetail: string
  popupMatch: string
  shadow: string
  radius: number
  /** 'mac' draws the three window dots in the tab bar. */
  chrome: 'mac' | 'none'
  tokens: Record<TokenKind, string>
}

const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace"

export const darkIde: IdeTheme = {
  font: MONO, fontSize: 22, lineHeight: 1.65,
  bg: '#0b0d12', fg: '#d6d9e0', lineNumber: '#3d4352', activeLine: 'rgba(255,255,255,0.035)',
  cursor: '#a5b4fc', flash: 'rgba(129,140,248,0.22)', border: 'rgba(255,255,255,0.08)',
  tabBar: '#0f1218', tabText: '#6b7280', tabActiveBg: '#0b0d12', tabActiveText: '#e5e7eb',
  popupBg: '#161a22', popupBorder: 'rgba(255,255,255,0.1)', popupSelected: 'rgba(129,140,248,0.22)',
  popupText: '#e5e7eb', popupDetail: '#8b93a5', popupMatch: '#a5b4fc', shadow: '0 24px 60px rgba(0,0,0,0.45)',
  radius: 18, chrome: 'mac',
  tokens: { comment: '#5f6778', string: '#86efac', keyword: '#c4b5fd', type: '#67e8f9', number: '#fdba74', fn: '#93c5fd', tag: '#f9a8d4', attr: '#fcd34d', punct: '#9aa3b5', plain: '#e2e6ee' },
}

export const lightIde: IdeTheme = {
  font: MONO, fontSize: 22, lineHeight: 1.65,
  bg: '#ffffff', fg: '#1f2330', lineNumber: '#c3c8d2', activeLine: 'rgba(79,70,229,0.04)',
  cursor: '#4f46e5', flash: 'rgba(79,70,229,0.12)', border: '#e6e8ee',
  tabBar: '#f6f7f9', tabText: '#8a90a0', tabActiveBg: '#ffffff', tabActiveText: '#0b0d12',
  popupBg: '#ffffff', popupBorder: '#e1e4ea', popupSelected: '#eef2ff', popupText: '#0b0d12',
  popupDetail: '#6b7280', popupMatch: '#4f46e5', shadow: '0 24px 60px rgba(15,23,42,0.14)',
  radius: 18, chrome: 'mac',
  tokens: { comment: '#9aa1ae', string: '#15803d', keyword: '#7c3aed', type: '#0e7490', number: '#c2410c', fn: '#1d4ed8', tag: '#be185d', attr: '#a16207', punct: '#6b7280', plain: '#1f2330' },
}
