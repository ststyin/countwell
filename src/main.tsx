import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import CloudGate from './components/CloudGate'
import './styles.css'
import { registerPwa } from './pwa'
import { cloudMode } from './lib/runtime'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{cloudMode ? <CloudGate><App /></CloudGate> : <App />}</React.StrictMode>,
)

registerPwa()
