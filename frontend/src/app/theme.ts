import { flushSync } from 'react-dom'
import { create } from 'zustand'

/**
 * Appearance: light / dark / system mode, a colour palette and an effects level.
 * Applied as attributes on <html>; index.html runs the same logic before first paint
 * so there is never a flash of the wrong theme.
 */
export type Mode = 'light' | 'dark' | 'system'
export type Palette = 'vermilion' | 'indigo' | 'forest' | 'saffron' | 'teal' | 'plum'
export type Effects = 'full' | 'lite'

/** Gradient themes: every accent in the app runs `from` -> `to`. */
export const PALETTES: { id: Palette; name: string; from: string; to: string }[] = [
  { id: 'indigo', name: 'Indigo Tide', from: '#4f46e5', to: '#0891b2' },
  { id: 'vermilion', name: 'Sunset', from: '#e11d48', to: '#ea580c' },
  { id: 'plum', name: 'Orchid', from: '#9333ea', to: '#db2777' },
  { id: 'teal', name: 'Ocean', from: '#0891b2', to: '#4f46e5' },
  { id: 'forest', name: 'Emerald', from: '#059669', to: '#65a30d' },
  { id: 'saffron', name: 'Ember', from: '#d97706', to: '#dc2626' },
]

const KEY = 'nap.theme'
interface ThemeState {
  mode: Mode
  palette: Palette
  effects: Effects
}

function load(): ThemeState {
  const fallback: ThemeState = { mode: 'system', palette: 'indigo', effects: 'full' }
  try {
    const raw = localStorage.getItem(KEY)
    const s = raw ? { ...fallback, ...(JSON.parse(raw) as Partial<ThemeState>) } : fallback
    // Palettes from the previous design are no longer offered.
    if (!PALETTES.some((p) => p.id === s.palette)) s.palette = fallback.palette
    // Motion is always on; the old lite switch is gone.
    s.effects = 'full'
    return s
  } catch {
    return fallback
  }
}

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null
export const resolvedDark = (mode: Mode) => mode === 'dark' || (mode === 'system' && !!media?.matches)

export const useTheme = create<ThemeState & { dark: boolean }>(() => {
  const s = load()
  return { ...s, dark: resolvedDark(s.mode) }
})

function apply(s: ThemeState) {
  const root = document.documentElement
  const dark = resolvedDark(s.mode)
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : 'light'
  root.dataset.palette = s.palette
  root.dataset.effects = s.effects
  const meta = document.querySelector('meta[name="theme-color"]')
  meta?.setAttribute('content', dark ? '#080912' : '#f4f5fb')
  useTheme.setState({ ...s, dark })
}

function save(s: ThemeState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* private mode: theme still applies for this visit */
  }
}

/** Runs a theme change inside a View Transition: the new edition wipes across like a turning page. */
function withReveal(change: () => void, origin?: { x: number; y: number }) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } }
  const s = useTheme.getState()
  const reduce = s.effects === 'lite' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!doc.startViewTransition || reduce || document.visibilityState !== 'visible') return change()
  // Wipe from the side the user clicked on.
  const fromRight = (origin?.x ?? window.innerWidth) > window.innerWidth / 2
  const start = fromRight ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)'
  const t = doc.startViewTransition(() => flushSync(change))
  void t.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [start, 'inset(0 0 0 0)'] },
      { duration: 620, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', pseudoElement: '::view-transition-new(root)' },
    )
  })
}

export function setTheme(patch: Partial<ThemeState>, origin?: { x: number; y: number }) {
  const { mode, palette, effects } = useTheme.getState()
  const next = { mode, palette, effects, ...patch }
  save(next)
  const visual = (patch.mode && resolvedDark(patch.mode) !== resolvedDark(mode)) || (patch.palette && patch.palette !== palette)
  if (visual) withReveal(() => apply(next), origin)
  else apply(next)
}

export const toggleDark = (origin?: { x: number; y: number }) => setTheme({ mode: useTheme.getState().dark ? 'light' : 'dark' }, origin)

export function initTheme() {
  apply(load())
  media?.addEventListener('change', () => {
    const s = useTheme.getState()
    if (s.mode === 'system') apply(s)
  })
}

/** True when rich motion (3D tilt, parallax, ambient animation) should run. */
export function useRichMotion() {
  const effects = useTheme((s) => s.effects)
  return effects === 'full' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
