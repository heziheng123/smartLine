import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import AuthGate from './auth/AuthGate'

const importApp = () => import('./App')
let appPromise: ReturnType<typeof importApp> | undefined
const loadApp = () => {
  appPromise ??= importApp()
  return appPromise
}
const App = lazy(loadApp)

export const AppLoadingFallback = () => {
  return (
    <main className="auth-page">
      <section className="auth-card" aria-live="polite">
        <div className="auth-logo" aria-hidden="true">⌁</div>
        <h1>SmartLine</h1>
        <span className="auth-spin" aria-hidden="true" />
        <p>正在加载工作台…</p>
      </section>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <Suspense fallback={<AppLoadingFallback />}>
        <App />
      </Suspense>
    </AuthGate>
  </StrictMode>,
)

// Download the authenticated workspace in parallel with the session check.
void loadApp()

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  let registrationStarted = false
  let registrationScheduled = false
  let registrationTimer: number | undefined
  let fallbackTimer: number | undefined

  const registerServiceWorker = () => {
    if (registrationStarted) return
    registrationStarted = true
    if (registrationTimer !== undefined) window.clearTimeout(registrationTimer)
    if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer)
    void navigator.serviceWorker.register('/service-worker.js').catch((error) => {
      console.warn('[service-worker] registration failed:', error)
    })
  }

  const scheduleServiceWorkerRegistration = () => {
    if (registrationStarted || registrationScheduled) return
    registrationScheduled = true
    // Give the current view and its first lazy chunks a clear run before the
    // one-time offline precache starts using the connection.
    registrationTimer = window.setTimeout(registerServiceWorker, 2000)
  }

  window.addEventListener('smartline:app-ready', scheduleServiceWorkerRegistration, { once: true })
  window.addEventListener('load', () => {
    // Authentication errors or a failed app chunk should not prevent the shell
    // from becoming available offline, but normal startup gets bandwidth first.
    fallbackTimer = window.setTimeout(registerServiceWorker, 15_000)
  }, { once: true })
}
