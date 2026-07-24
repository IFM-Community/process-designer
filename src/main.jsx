import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Note: React 18 StrictMode double-mounts in dev, which can leave React Flow's
// node-measurement (ResizeObserver) uninitialised so edges never render. Render
// without StrictMode so the canvas measures nodes correctly.
ReactDOM.createRoot(document.getElementById('root')).render(<App />)
