import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './index.css'

// Build marker — lets us confirm from the deployed bundle which build is actually
// live (grep the served JS for this token). Bump when verifying a deploy landed.
console.log('PD_BUILD_MARKER_NOGAPS_A1')

// Note: React 18 StrictMode double-mounts in dev, which can leave React Flow's
// node-measurement (ResizeObserver) uninitialised so edges never render. Render
// without StrictMode so the canvas measures nodes correctly.
//
// The ErrorBoundary means a render crash shows a recoverable panel (with the
// stack in the console) instead of the blank white page it used to.
ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
)
