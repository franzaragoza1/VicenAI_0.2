import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Import test utilities for console access
import './utils/test-comparison'

// NOTE: React.StrictMode removed intentionally
// StrictMode causes double-mounting in development, which creates
// duplicate Gemini Live connections (two voices responding simultaneously).
// See: localhost-1769491149382.log lines 73-80 for evidence of the issue.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
)
