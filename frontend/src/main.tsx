import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initPWA } from './app/pwa'
import { initTheme } from './app/theme'
import { initCursor } from './app/cursor'
import { initSpark } from './app/spark'
import { initTilt } from './app/tilt'
import { API_MODE } from './services/mode'
import { installRemote } from './services/remote'

initTheme()
initTilt()
initSpark()
initCursor()
if (API_MODE === 'http') installRemote()
initPWA()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Fade out the HTML splash once the app has mounted. setTimeout (not rAF) so it also
// clears when the page loads in a background tab.
setTimeout(() => {
  const s = document.getElementById('splash')
  if (!s) return
  s.style.opacity = '0'
  s.style.pointerEvents = 'none'
  setTimeout(() => s.remove(), 300)
}, 0)
