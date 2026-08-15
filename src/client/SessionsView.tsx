/**
 * Sessions mode: the left panel's conversation list, mirroring the app's own
 * sidebar — a full-width "new session" capsule, root sessions grouped by
 * their workspace folder (cwd basename), the current session highlighted,
 * and a running dot for live agents. Subagent children stay out of this
 * list (they belong to the subagent topology tab); opening a row delegates
 * to ctx.sessions.open so the conversation column follows.
 */
import { useMemo } from 'react'
import { useSyncExternalStore } from 'react'
import clsx from 'clsx'
import { IconNewChatOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Context, SidebarSessionSummary } from '../context-types.ts'
import { t } from './locales.ts'
import css from './sidebar.module.css'

/** The workspace group label for one session: its cwd's basename. */
function groupOf(summary: SidebarSessionSummary): string {
  const cwd = summary.cwd ?? ''
  const base = cwd.split(/[\\/]/).filter(Boolean).pop()
  return base ?? t('unknownWorkspace')
}

export function SessionsView(props: { ctx: Context }) {
  const { ctx } = props
  const subscribe = useMemo(() => (callback: () => void) => ctx.sessions.list.subscribe(callback), [ctx])
  const getSnapshot = useMemo(() => () => ctx.sessions.list.getSnapshot(), [ctx])
  const list = useSyncExternalStore(subscribe, getSnapshot)

  // Root sessions only, grouped by workspace, preserving snapshot order
  // (the runtime feed is recency-ordered).
  const groups = useMemo(() => {
    const map = new Map<string, SidebarSessionSummary[]>()
    for (const summary of Object.values(list.byId)) {
      if (summary.origin === 'subagent') continue
      const key = groupOf(summary)
      const rows = map.get(key) ?? []
      rows.push(summary)
      map.set(key, rows)
    }
    return [...map.entries()]
  }, [list.byId])

  return (
    <div className={css.sessions}>
      <div className={css.sessionsHeader}>
        <button
          type="button"
          className={css.sessionNewBtn}
          onClick={() => ctx.workspaces.startSession?.()}
        >
          <IconNewChatOutline16 />
          {t('newSession')}
        </button>
      </div>
      <div className={css.explorerBody}>
        {groups.length === 0 && <div className={css.sessionsEmpty}>{t('noSessions')}</div>}
        {groups.map(([name, rows]) => (
          <div key={name}>
            <div className={css.sessionGroup}>{name}</div>
            {rows.map((summary) => (
              <button
                key={summary.id}
                type="button"
                className={clsx(css.explorerRow, summary.id === list.current && css.sessionRowActive)}
                aria-current={summary.id === list.current ? 'true' : undefined}
                onClick={() => ctx.sessions.open?.(summary.id)}
              >
                <span className={css.explorerName}>{summary.displayTitle}</span>
                {summary.running === true && <span className={css.sessionRunning} aria-label={t('sessionRunning')} />}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
