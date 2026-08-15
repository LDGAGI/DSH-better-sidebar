/**
 * Left nav: the three-mode switcher injected INTO the app's own left
 * sidebar column — 会话 / 目录 / Git. The native sidebar is never
 * re-implemented and never unmounted:
 *
 * - sessions mode: the dock is a small floating pill at the column's bottom
 *   center; the native session list keeps rendering untouched behind it.
 * - explorer/git modes: the dock expands to an opaque full-column overlay
 *   (bar on top, content below) that COVERS the native sidebar without
 *   unmounting it — switching back restores it instantly, with its scroll
 *   and expansion state intact.
 *
 * Wiring: tree file clicks open the editor tab through openSidebarFile
 * (the same path the chat file-open interception uses), git rows open diff
 * tabs through the betterSidebar service; both auto-expand the workbench
 * panel so the open never lands out of sight. The scope (sessionId + cwd)
 * follows the runtime sessions feed, so switching conversations retargets
 * the tree and git views automatically. On a collapsed (rail) sidebar the
 * dock hides itself entirely — the native rail owns that width.
 */
import { createElement, useEffect, useMemo, useState } from 'react'
import { useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import clsx from 'clsx'
import { IconBranchOutline16, IconFolderOpen16, IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context } from '../context-types.ts'
import { togglePanel, type SidebarStore, type SidebarTab } from './state.ts'
import { ExplorerView } from './ExplorerView.tsx'
import { GitView } from './GitView.tsx'
import { openSidebarFile } from './intercept.tsx'
import { appendToDraft } from './conversation-draft.ts'
import { relativeTo } from './paths.ts'
import { t } from './locales.ts'
import css from './sidebar.module.css'

/** The three left-column modes; 'sessions' is the untouched native UI. */
export type LeftNavMode = 'sessions' | 'explorer' | 'git'

/** localStorage key persisting the mode across reloads. */
const MODE_KEY = 'dsh-better-sidebar:left-mode'

/** Column width below which the native sidebar is a rail and the dock hides. */
const RAIL_MAX = 120

function loadMode(): LeftNavMode {
  try {
    const saved = localStorage.getItem(MODE_KEY)
    if (saved === 'explorer' || saved === 'git') return saved
  } catch { /* storage unavailable */ }
  return 'sessions'
}

function LeftNav(props: { ctx: Context; store: SidebarStore; dock: HTMLElement }) {
  const { ctx, store, dock } = props
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

  // The dock element's geometry is mode-driven (pill vs full overlay) and
  // lives outside React — keep the attribute in sync here.
  useEffect(() => {
    dock.setAttribute('data-mode', mode)
  }, [dock, mode])

  const switchMode = (next: LeftNavMode): void => {
    setMode(next)
    try { localStorage.setItem(MODE_KEY, next) } catch { /* storage unavailable */ }
  }

  /** A content open must never land out of sight: expand the workbench. */
  const ensurePanel = (): void => {
    const state = store.getSnapshot().state
    if (state !== undefined && !state.panelOpen) store.reduce(togglePanel)
  }

  const openFile = (path: string): void => {
    if (sessionId === undefined) return
    openSidebarFile(ctx, store, sessionId, path)
    ensurePanel()
  }
  const referenceFile = (path: string): void => {
    if (sessionId === undefined || cwd === undefined) return
    appendToDraft(ctx, sessionId, `@${relativeTo(cwd, path)}`)
  }
  const openDiff = (tab: SidebarTab): void => {
    ctx.betterSidebar?.openTab({ type: 'diff', id: tab.id, title: tab.title, diff: tab.diff })
    ensurePanel()
  }
  const toggleDir = (path: string): void => {
    setExpanded(prev => (prev.includes(path) ? prev.filter(item => item !== path) : [...prev, path]))
  }

  const modes = [
    { id: 'sessions' as const, label: () => t('sessions'), icon: IconNewChatOutline16 },
    { id: 'explorer' as const, label: () => t('explorer'), icon: IconFolderOpen16 },
    { id: 'git' as const, label: () => t('git'), icon: IconBranchOutline16 },
  ]

  return (
    <div className={clsx(css.leftNav, mode !== 'sessions' && css.leftNavFull)}>
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
 * Inject the left-nav dock into the app's sidebar column and return the
 * disposer. The dock is a sibling of the native [data-slot="sidebar"] host
 * inside the AppFrame's sidebar grid item; the column becomes
 * position:relative so the dock can overlay it in content modes. A watcher
 * re-runs the locator across the boot frame swap and re-inserts the dock if
 * the app ever drops the foreign node. Disposal removes every trace
 * (React root, DOM node, inline styles) so the native sidebar restores
 * exactly.
 */
export function mountLeftNav(ctx: Context, store: SidebarStore): () => void {
  let disposed = false
  let root: Root | undefined
  let dock: HTMLDivElement | undefined
  let column: HTMLElement | undefined
  let columnPosition = ''
  let rail = false
  let railObserver: ResizeObserver | undefined
  let watcher: MutationObserver | undefined

  const teardown = (): void => {
    root?.unmount()
    root = undefined
    dock?.remove()
    dock = undefined
    railObserver?.disconnect()
    railObserver = undefined
    if (column !== undefined) column.style.position = columnPosition
    column = undefined
  }

  const locate = (): void => {
    if (disposed || dock !== undefined) return
    const host = document.querySelector('#root [data-slot="sidebar"]') as HTMLElement | null
    const col = host?.parentElement
    if (host === null || col === null || col === undefined) return
    column = col
    columnPosition = col.style.position
    if (window.getComputedStyle(col).position === 'static') col.style.position = 'relative'
    dock = document.createElement('div')
    dock.setAttribute('data-dsh-left-nav', '')
    dock.setAttribute('data-mode', loadMode())
    dock.className = css.leftNavDock ?? ''
    col.appendChild(dock)
    root = createRoot(dock)
    root.render(createElement(LeftNav, { ctx, store, dock }))
    // Rail adaptation: below RAIL_MAX the native icon rail owns the column —
    // the dock hides (CSS on [data-rail]) instead of squeezing the modes.
    rail = col.getBoundingClientRect().width < RAIL_MAX
    if (rail) dock.setAttribute('data-rail', '')
    railObserver = new ResizeObserver(() => {
      if (dock === undefined || column === undefined) return
      const next = column.getBoundingClientRect().width < RAIL_MAX
      if (next === rail) return
      rail = next
      if (rail) dock.setAttribute('data-rail', '')
      else dock.removeAttribute('data-rail')
    })
    railObserver.observe(col)
  }

  locate()
  watcher = new MutationObserver(() => {
    if (disposed) return
    if (dock !== undefined && !dock.isConnected) teardown()
    if (dock === undefined) locate()
  })
  const rootEl = document.getElementById('root')
  if (rootEl !== null) watcher.observe(rootEl, { childList: true, subtree: true })

  return () => {
    disposed = true
    watcher?.disconnect()
    teardown()
  }
}
