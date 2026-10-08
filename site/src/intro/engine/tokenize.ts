// A small TypeScript/TSX tokenizer for the typing animation. It only has to colour
// the code on these slides, and it must cope with half-typed text (an unclosed
// string runs to the end of its line). Deterministic, so every frame is stable.

export type TokenKind = 'comment' | 'string' | 'keyword' | 'type' | 'number' | 'fn' | 'tag' | 'attr' | 'punct' | 'plain'
export type Token = { kind: TokenKind; text: string }

const KEYWORDS = new Set([
  'import', 'from', 'export', 'const', 'let', 'type', 'async', 'await', 'function', 'return',
  'if', 'else', 'true', 'false', 'null', 'undefined', 'new', 'typeof', 'as', 'of', 'in',
])

const RULES: Array<[TokenKind, RegExp]> = [
  ['comment', /^\/\/[^\n]*/],
  ['string', /^'[^'\n]*'?/],
  ['string', /^"[^"\n]*"?/],
  ['string', /^`[^`\n]*`?/],
  ['tag', /^<\/?[A-Za-z][\w.]*/],
  ['number', /^\d[\d_]*(\.\d+)?/],
  ['plain', /^[A-Za-z_$][\w$]*/],
  ['punct', /^[{}()[\];,.:=<>?!&|+\-*/%>]+/],
  ['plain', /^\s+/],
]

/** Tokens for one line of code. */
export function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = []
  let rest = line
  let prev = ''
  while (rest.length) {
    let matched = false
    for (const [kind, re] of RULES) {
      const m = re.exec(rest)
      if (!m) continue
      let k: TokenKind = kind
      const text = m[0]
      if (kind === 'plain' && /^[A-Za-z_$]/.test(text)) {
        if (KEYWORDS.has(text)) k = 'keyword'
        else if (/^[A-Z]/.test(text)) k = 'type'
        else if (/^\s*\(/.test(rest.slice(text.length))) k = 'fn'
        // JSX attribute: `onChange={`, `key={` (no space before '=', unlike `const x =`)
        else if (/^=[{"']/.test(rest.slice(text.length)) && /\s$/.test(prev)) k = 'attr'
      }
      tokens.push({ kind: k, text })
      prev += text
      rest = rest.slice(text.length)
      matched = true
      break
    }
    if (!matched) {
      tokens.push({ kind: 'plain', text: rest[0] })
      prev += rest[0]
      rest = rest.slice(1)
    }
  }
  return tokens
}
