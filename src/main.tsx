import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import CloudGate from './components/CloudGate'
import './styles.css'
import { registerPwa } from './pwa'
import { cloudMode } from './lib/runtime'
import { useTheme } from './hooks/useTheme'

function CountwellRoot() {
  useTheme()
  return cloudMode ? <CloudGate>{(snapshot, navigationReady) => <App initialCloudSnapshot={snapshot} cloudNavigationReady={navigationReady} />}</CloudGate> : <App />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><CountwellRoot /></React.StrictMode>,
)

registerPwa()
