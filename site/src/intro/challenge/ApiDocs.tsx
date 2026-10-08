// The API docs drawer: the site's fake API (endpoints.ts), and what the server switch does.
import React, { useEffect, useRef } from 'react'
import { FAKE_ORIGIN } from '../../playground/fake-server'
import { ENDPOINTS, MODES } from './endpoints'

export function ApiDocs({ open, onClose }: { open: boolean; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)
  const back = useRef<Element | null>(null)
  useEffect(() => {
    if (!open) return
    back.current = document.activeElement
    close.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      ;(back.current as HTMLElement | null)?.focus?.({ preventScroll: true })
    }
  }, [open, onClose])

  return (
    <div className={`drawer-wrap${open ? ' open' : ''}`} aria-hidden={!open || undefined} inert={!open}>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="docs-title">
        <header className="drawer-head">
          <div>
            <p className="eyebrow">Reference</p>
            <h2 id="docs-title">API docs</h2>
          </div>
          <button ref={close} type="button" className="icon-btn" aria-label="Close the API docs" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        <div className="drawer-body">
          <section className="doc-intro">
            <p>The server runs in this page. Point liaise at it:</p>
            <pre className="doc-code">baseUrl: '{FAKE_ORIGIN}'</pre>
            <p>Every answer is JSON. Errors carry <code>{'{ message: string }'}</code>.</p>
          </section>

          <section aria-labelledby="eps">
            <h3 id="eps" className="doc-h">Endpoints</h3>
            <ol className="eps">
              {ENDPOINTS.map(ep => (
                <li key={ep.path} className="ep">
                  <p className="ep-line">
                    <span className="ep-method">{ep.method}</span>
                    <span className="ep-path">{ep.path}</span>
                    {ep.challenge && <span className="ep-tag">The challenge</span>}
                  </p>
                  <p className="ep-what">{ep.what}</p>
                  <dl className="ep-dl">
                    <dt>Params</dt>
                    <dd>{ep.params.length ? ep.params.map(([k, v]) => <span key={k}><code>{k}</code> {v}</span>) : 'None'}</dd>
                    <dt>Returns</dt>
                    <dd><code>{ep.returns}</code></dd>
                    {ep.errors && <><dt>Errors</dt><dd>{ep.errors}</dd></>}
                  </dl>
                  <pre className="doc-code">
                    <span className="dim">{ep.example.request}</span>{'\n'}
                    <span className="ok">{ep.example.status}</span> {ep.example.body}
                  </pre>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="modes">
            <h3 id="modes" className="doc-h">The server switch</h3>
            <dl className="modes">
              {MODES.map(([name, line]) => <React.Fragment key={name}><dt>{name}</dt><dd>{line}</dd></React.Fragment>)}
            </dl>
            <p className="doc-note">Check my code ignores the switch: it runs your code once against Healthy and once against Down.</p>
          </section>
        </div>
      </aside>
    </div>
  )
}
