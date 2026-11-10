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
      const update = registerSW({
        onNeedRefresh() {
          toast('A new version of NewsRound is ready.', { duration: Infinity, action: { label: 'Update', onClick: () => void update(true) } })
        },
        onOfflineReady() {
          toast.success('Ready to work offline — your delivery list is available without signal.')
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
