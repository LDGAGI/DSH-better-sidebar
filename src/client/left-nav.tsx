/**
 * Left nav: the 会话/目录/Git mode switcher for the app's OWN left sidebar.
 *
 * Geometry (the "fixed switcher" contract):
 * - The switcher sits DIRECTLY under the native 新会话 button, at the same
 *   coordinates in every mode. layout.css reserves that strip by pushing
 *   the [data-slot="sidebar.workspaces"] region down 38px with a
 *   compensating negative bottom margin (net layout shift: zero — the
 *   native footer never moves).
 * - A single absolutely-positioned dock overlays the reserved strip plus
 *   the region's rect: the switcher renders into the strip, and in
 *   explorer/git modes an opaque content body covers the native list area
 *   EXACTLY — header and footer are native, untouched, always visible.
 * - The native sidebar is never unmounted: in sessions mode the dock is
 *   transparent with pointer-events only on the switcher; in content modes
 *   the opaque body simply hides the list behind it, so switching back
 *   restores scroll and expansion state instantly.
 *
 * Anchoring uses the official slot host ([data-slot="sidebar.workspaces"])
 * — never a native class name — and a ResizeObserver keeps the dock glued
 * to the region across sidebar collapse/resize. On the 56px rail the dock
 * hides entirely. Disposal removes every trace (React root, DOM node,
 * inline styles) so the native sidebar restores exactly.
 */
import { createElement, useMemo, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import clsx from 'clsx'
import { IconBranchOutline16, IconFolderOpen16, IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '../context-types.ts'
import type { SidebarStore, SidebarTab } from './state.ts'
import { ExplorerView } from './ExplorerView.tsx'
import { GitView } from './GitView.tsx'
import { appendToDraft } from './conversation-draft.ts'
import { relativeTo } from './paths.ts'
import { t } from './locales.ts'
import css from './sidebar.module.css'

/** The three left-column modes; 'sessions' is the untouched native UI. */
export type LeftNavMode = 'sessions' | 'explorer' | 'git'

/** localStorage key persisting the mode across reloads. */
const MODE_KEY = 'dsh-better-sidebar:left-mode'

/** The reserved strip height above the workspaces region (layout.css margin). */
const SWITCH_STRIP = 38

/** Region width below which the native sidebar is a rail and the dock hides. */
const RAIL_MAX = 120

function loadMode(): LeftNavMode {
  try {
    const saved = localStorage.getItem(MODE_KEY)
    if (saved === 'explorer' || saved === 'git') return saved
  } catch { /* storage unavailable */ }
  return 'sessions'
}

function LeftNav(props: { ctx: Context; store: SidebarStore }) {
  const { ctx, store } = props
  const [mode, setMode] = useState<LeftNavMode>(loadMode)
  const [expanded, setExpanded] = useState<string[]>([])

  // The scope follows the runtime sessions feed: switching conversations
  // retargets the tree and git views without any manual refresh.
  const subscribe = useMemo(() => (callback: () => void) => ctx.sessions.list.subscribe(callback), [ctx])
  const getSnapshot = useMemo(() => () => ctx.sessions.list.getSnapshot(), [ctx])
  const list = useSyncExternalStore(subscribe, getSnapshot)
  const sessionId = list.current
  const cwd = sessionId === undefined ? undefined : list.byId[sessionId]?.cwd
  const scope = useMemo(
    () => (sessionId === undefined ? undefined : { sessionId, cwd }),
    [sessionId, cwd],
  )

  const switchMode = (next: LeftNavMode): void => {
    setMode(next)
    try { localStorage.setItem(MODE_KEY, next) } catch { /* storage unavailable */ }
  }

  // Preview/edit is a HIDDEN capability in this fork (the workbench panel
  // is disabled): file and diff clicks stay inert for now. The tree keeps
  // browsing and @-referencing; the open wiring returns with the future
  // editor surface. The parameters stay named so the call sites document
  // the intended wiring.
  const openFile = (_path: string): void => { /* hidden: no editor surface */ }
  const referenceFile = (path: string): void => {
    if (sessionId === undefined || cwd === undefined) return
    appendToDraft(ctx, sessionId, `@${relativeTo(cwd, path)}`)
  }
  const openDiff = (_tab: SidebarTab): void => { /* hidden: no editor surface */ }
  // The store stays in the props contract for the day the panel returns.
  void store

  const toggleDir = (path: string): void => {
    setExpanded(prev => (prev.includes(path) ? prev.filter(item => item !== path) : [...prev, path]))
  }

  const modes = [
    { id: 'sessions' as const, label: () => t('sessions'), icon: IconNewChatOutline16 },
    { id: 'explorer' as const, label: () => t('explorer'), icon: IconFolderOpen16 },
    { id: 'git' as const, label: () => t('git'), icon: IconBranchOutline16 },
  ]

  return (
    <div className={css.leftNav}>
      <div className={css.leftNavSwitch} role="tablist" aria-label={t('leftNavModes')}>
        {modes.map((entry) => {
          const Icon = entry.icon
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={mode === entry.id}
              className={clsx(css.leftNavMode, mode === entry.id && css.leftNavModeActive)}
              onClick={() => switchMode(entry.id)}
            >
              <Icon size={14} />
              <span>{entry.label()}</span>
            </button>
          )
        })}
      </div>
      {mode !== 'sessions' && (
        <div className={css.leftNavBody}>
          {scope === undefined && <div className={css.sessionsEmpty}>{t('noSession')}</div>}
          {scope !== undefined && mode === 'explorer' && (
            <ExplorerView
              sessionId={scope.sessionId}
              cwd={scope.cwd}
              expanded={expanded}
              onToggle={toggleDir}
              onOpenFile={openFile}
              onReferenceFile={referenceFile}
            />
          )}
          {scope !== undefined && mode === 'git' && (
            <GitView scope={scope} onOpenFile={openFile} onOpenDiff={openDiff} />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Inject the left-nav dock and return the disposer. The dock is appended to
 * the AppFrame's sidebar column (the region host's ancestor grid item) and
 * positioned over the reserved switch strip + the workspaces region by
 * direct rect measurement; a ResizeObserver on the region keeps it glued
 * (column resize, rail collapse, window resize). A watcher re-runs the
 * locator across the boot frame swap and re-inserts the dock if the app
 * ever drops the foreign node.
 */
export function mountLeftNav(ctx: Context, store: SidebarStore): () => void {
  let disposed = false
  let root: Root | undefined
  let dock: HTMLDivElement | undefined
  let region: HTMLElement | undefined
  let column: HTMLElement | undefined
  let columnPosition = ''
  let rail = false
  let regionObserver: ResizeObserver | undefined
  let watcher: MutationObserver | undefined

  /** The region's REAL box: the slot host itself can be display:contents
   *  (probe-measured 0×0 while its content renders fine), so a zero host
   *  rect falls back to its first element child — the WorkspaceBrowser's
   *  own root, which always has a real box. */
  const measureRegion = (host: HTMLElement): DOMRect => {
    const rect = host.getBoundingClientRect()
    if (rect.width > 0 || rect.height > 0) return rect
    const child = host.firstElementChild as HTMLElement | null
    return child !== null ? child.getBoundingClientRect() : rect
  }

  /** Glue the dock to the reserved strip + the region's rect. The region
   *  host is RE-QUERIED on every update: React replaces it across the boot
   *  settle, rail transitions and session switches, and a stale reference
   *  measures as 0-wide forever (which previously parked the dock in the
   *  hidden "rail" state permanently). The observer follows the live node. */
  const updateRect = (): void => {
    if (dock === undefined || column === undefined) return
    const host = document.querySelector('#root [data-slot="sidebar.workspaces"]') as HTMLElement | null
    if (host === null) {
      dock.style.display = 'none'
      return
    }
    dock.style.display = ''
    if (region !== host) {
      region = host
      regionObserver?.disconnect()
      regionObserver = new ResizeObserver(updateRect)
      regionObserver.observe(host)
    }
    const rect = measureRegion(host)
    const colRect = column.getBoundingClientRect()
    dock.style.left = `${rect.left - colRect.left}px`
    dock.style.top = `${rect.top - colRect.top - SWITCH_STRIP}px`
    dock.style.width = `${rect.width}px`
    dock.style.height = `${rect.height + SWITCH_STRIP}px`
    const nextRail = rect.width < RAIL_MAX
    if (nextRail !== rail) {
      rail = nextRail
      if (rail) dock.setAttribute('data-rail', '')
      else dock.removeAttribute('data-rail')
    }
  }

  const teardown = (): void => {
    root?.unmount()
    root = undefined
    dock?.remove()
    dock = undefined
    regionObserver?.disconnect()
    regionObserver = undefined
    region = undefined
    if (column !== undefined) column.style.position = columnPosition
    column = undefined
  }

  const locate = (): void => {
    if (disposed || dock !== undefined) return
    const host = document.querySelector('#root [data-slot="sidebar.workspaces"]') as HTMLElement | null
    const col = document.querySelector('#root [data-slot="sidebar"]')?.parentElement as HTMLElement | null | undefined
    if (host === null || col === null || col === undefined) return
    region = host
    column = col
    columnPosition = col.style.position
    if (window.getComputedStyle(col).position === 'static') col.style.position = 'relative'
    dock = document.createElement('div')
    dock.setAttribute('data-dsh-left-nav', '')
    dock.setAttribute('data-mode', loadMode())
    dock.className = css.leftNavDock ?? ''
    col.appendChild(dock)
    root = createRoot(dock)
    root.render(createElement(LeftNav, { ctx, store }))
    rail = false
    updateRect()
    regionObserver = new ResizeObserver(updateRect)
    regionObserver.observe(host)
  }

  locate()
  watcher = new MutationObserver(() => {
    if (disposed) return
    if (dock !== undefined && !dock.isConnected) teardown()
    if (dock === undefined) locate()
    else updateRect()
  })
  const rootEl = document.getElementById('root')
  if (rootEl !== null) watcher.observe(rootEl, { childList: true, subtree: true })
  // Rect positions (not just sizes) shift with the viewport; the region's
  // ResizeObserver alone cannot see pure position changes.
  window.addEventListener('resize', updateRect)

  return () => {
    disposed = true
    watcher?.disconnect()
    window.removeEventListener('resize', updateRect)
    teardown()
  }
}
