import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { initPWAUpdates } from './pwa-update.js'

// fix/actualizacion-pwa (2026-09-16): registra el SW y arranca el chequeo
// periódico de updates. App.jsx se suscribe con subscribeToPWAUpdates.
// El reset por URL (?_reset=1) se procesa en index.html antes de este script,
// así que cuando llegamos aquí ya sabemos que NO estamos en modo reset.
initPWAUpdates()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)