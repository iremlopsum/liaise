// Step 10 arrives as its own chunk (the challenge, then Monaco). If that chunk fails to load, offline
// for one, nothing above it catches the error and React unmounts the whole intro. This catches it
// and says so, with the ways on. Its look is keynote.css's: challenge.css comes with the chunk that
// failed. Go to the docs doesn't mark the intro as finished: the reader didn't get to finish it.
import React from 'react'

interface StepBoundaryProps {
  /** Quick start. */
  docsHref: string
  /** Watch again: back to slide 1. */
  onReplay: () => void
  children: React.ReactNode
}

export class StepBoundary extends React.Component<StepBoundaryProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.warn('intro: step 10 did not load.', error)
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="step-failed" role="alert">
        <p className="loading">Step 10 didn't load.</p>
        <div className="step-failed-actions">
          <a className="pill" href={this.props.docsHref}>Go to the docs →</a>
          <button type="button" className="link-btn" onClick={this.props.onReplay}>Watch again</button>
        </div>
      </div>
    )
  }
}
