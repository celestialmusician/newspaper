import { toast } from 'sonner'
import { create } from 'zustand'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export const useInstall = create<{ event: BeforeInstallPromptEvent | null; installed: boolean }>(() => ({
  event: null,
  installed: typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches,
}))

export async function promptInstall() {
  const e = useInstall.getState().event
  if (!e) {
    toast.info('Use your browser menu → "Install app" / "Add to Home screen".')
    return
  }
  await e.prompt()
  const { outcome } = await e.userChoice
  if (outcome === 'accepted') useInstall.setState({ event: null, installed: true })
}

export function initPWA() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    useInstall.setState({ event: e as BeforeInstallPromptEvent })
  })
  window.addEventListener('appinstalled', () => useInstall.setState({ event: null, installed: true }))

  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    void import('virtual:pwa-register').then(({ registerSW }) => {
      // A new release is applied at once (the new service worker takes over and the page reloads), so an
      // installed app or an old browser tab never keeps showing a stale version until someone taps "Update".
      const update = registerSW({
        immediate: true,
        onNeedRefresh() {
          toast('Updating NewsRound to the latest version…', { duration: 4000 })
          void update(true)
        },
        onOfflineReady() {
          toast.success('Ready to work offline — your delivery list is available without signal.')
        },
        onRegisteredSW(_url, reg) {
          if (!reg) return
          // Look for a new release when the app is reopened or comes back to the front, and hourly while it stays open.
          const check = () => void reg.update().catch(() => undefined)
          document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check())
          window.setInterval(check, 60 * 60 * 1000)
        },
      })
    })
  }
}

/** Ask permission for push; real subscription happens against the backend VAPID key. */
export async function enablePush(): Promise<NotificationPermission | 'unsupported'> {
  if (!('Notification' in window)) return 'unsupported'
  const perm = await Notification.requestPermission()
  if (perm === 'granted' && 'serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration()
    await reg?.showNotification('Notifications enabled', { body: 'You will be alerted about bills, routes and deliveries.', icon: '/icons/icon-192.png' })
  }
  return perm
}
