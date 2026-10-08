// The keynote headline beside the editor. When the cue changes, the old title fades out
// fast and the new one comes in word by word: each word rises a few pixels and sharpens
// out of a blur, 40 ms after the one before it. Page-level CSS animation (outside the
// Player), so it starts the moment the deck reports the new cue.
import React, { useEffect, useRef, useState } from 'react'

export type HeadlineCaption = { key: string; title: string; body: string }

const STAGGER = 40

// Words in the body that are code (names from the slides) are set in the mono face.
const CODE = new Set([
  'fetch', 'User', 'q', 'id', 'createApi', 'baseUrl', 'data', 'error', 'error.kind',
  'searchUsers', 'dedupe:', 'true', "'a'", "'ad'", "'ada'", "'abort'",
])

/** Splits a word into what is code and the punctuation after it. */
function codeParts(word: string): [string, string] | null {
  const m = /^(.*?)([.,?]?)$/.exec(word)!
  if (CODE.has(word)) return [word, '']
  if (CODE.has(m[1])) return [m[1], m[2]]
  return null
}

export function Words({ text, className, delay = 0, step = STAGGER, code: mono = false }: { text: string; className: string; delay?: number; step?: number; code?: boolean }) {
  const words = text.split(' ')
  return (
    <>
      {words.map((w, i) => {
        const code = mono ? codeParts(w) : null
        return (
          <React.Fragment key={i}>
            <span className={className} style={{ animationDelay: `${delay + i * step}ms` }}>
              {code ? <><code>{code[0]}</code>{code[1]}</> : w}
            </span>
            {i < words.length - 1 ? ' ' : null}
          </React.Fragment>
        )
      })}
    </>
  )
}

export function wordCount(text: string): number {
  return text.split(' ').length
}

/** A title + body pair that animates in, keyed by `caption.key`. */
function Layer({ caption, leaving }: { caption: HeadlineCaption; leaving: boolean }) {
  const titleWords = wordCount(caption.title)
  return (
    <div className={leaving ? 'cap-layer leaving' : 'cap-layer'} aria-hidden={leaving || undefined}>
      <h2 className="cap-title"><Words text={caption.title} className="w" /></h2>
      <p className="cap-body" style={{ animationDelay: `${titleWords * STAGGER + 120}ms` }}><Words text={caption.body} className="bw" code /></p>
    </div>
  )
}

export function Headline({ caption }: { caption: HeadlineCaption | null }) {
  // The showing caption plus the one fading out. Both stay keyed by caption, so the one
  // leaving keeps its finished words instead of animating them in again.
  const [layers, setLayers] = useState<Array<HeadlineCaption & { leaving: boolean }>>(caption ? [{ ...caption, leaving: false }] : [])
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    setLayers(prev => {
      if (prev.some(l => !l.leaving && l.key === caption?.key)) return prev
      const rest = prev.filter(l => l.key !== caption?.key).map(l => ({ ...l, leaving: true }))
      return caption ? [...rest, { ...caption, leaving: false }] : rest
    })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setLayers(prev => prev.filter(l => !l.leaving)), 260)
    return () => window.clearTimeout(timer.current)
  }, [caption?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="headline" aria-live="polite">
      {layers.map(l => <Layer key={l.key} caption={l} leaving={l.leaving} />)}
    </div>
  )
}
