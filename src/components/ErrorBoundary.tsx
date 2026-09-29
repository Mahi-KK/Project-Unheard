import { Component, type ReactNode } from 'react'

/** Last-resort guard: a rendering error never leaves a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="intro" role="alert">
        <div className="intro__grid">
          <p className="intro__kicker">Unheard · interface error</p>
          <p className="intro__tag">Something in the interface failed to render.</p>
          <p className="intro__facts">{this.state.error.message}</p>
          <button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </main>
    )
  }
}
