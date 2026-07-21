import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { OnlineProvider } from './lib/online.jsx'
import { requestPersist } from './lib/offlineStore.js'
import { primeInstallCapture } from './lib/installPrompt.js'
import './index.css'

// Best-effort, once at startup: ask the browser to keep our offline downloads
// from being evicted under storage pressure (installed PWAs usually get this
// without a prompt). Fire-and-forget — failure is harmless.
requestPersist()

// Grab the (one, early-firing) beforeinstallprompt event before any component
// mounts, so the shelf's install nudge can re-open it from our own button. Also
// suppresses the browser's default mini-infobar. Harmless where unsupported.
primeInstallCapture()

// Entry point: mount React into #root, wrapped in the router so the browser and
// the player live at their own URLs, and in OnlineProvider so the app knows when
// the server is unreachable (and can fall back to downloaded games).
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <OnlineProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </OnlineProvider>
  </React.StrictMode>,
)
