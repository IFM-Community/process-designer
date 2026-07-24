import { Component } from 'react'

// A blank white page is the worst failure mode: no clue what broke, and the only
// escape is a manual refresh. This catches any render error below it and shows a
// recoverable screen instead — the message, a Reload, and (for us) the stack in
// the console. It also carries the current workspace link so a reload lands back
// where you were, not on the gallery.
//
// `resetKey` lets the parent clear the error when the user navigates elsewhere
// (e.g. switches process): when it changes, the boundary un-trips itself, so one
// bad process never wedges the whole app.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidUpdate(prev) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error, info) {
    // Real stack for us; the user gets the friendly panel below.
    // eslint-disable-next-line no-console
    console.error('[process-designer] render error:', error, info?.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="pd-crash">
        <div className="pd-crash-card">
          <div className="pd-crash-mark">⚠</div>
          <h1>Something went wrong on this screen</h1>
          <p>Your work is saved. Reloading almost always fixes it.</p>
          <div className="pd-crash-actions">
            <button className="pd-crash-reload" onClick={() => window.location.reload()}>Reload</button>
            {this.props.onReset && (
              <button className="pd-crash-ghost" onClick={() => { this.setState({ error: null }); this.props.onReset() }}>
                Back to a working view
              </button>
            )}
          </div>
          <details className="pd-crash-detail">
            <summary>Technical details</summary>
            <pre>{String(this.state.error?.stack || this.state.error)}</pre>
          </details>
        </div>
      </div>
    )
  }
}
