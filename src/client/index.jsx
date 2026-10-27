/**
 * dsh-kanban — client half.
 *
 * Registers a left-sidebar entry and the full-size main panel. The bundle is
 * loaded by DSH's client module loader, which hands us `require` so React comes
 * from the shell instead of a second copy.
 */

import * as React from 'react'
import { KanbanPanel } from './board.jsx'
import { createApi } from './rpc.js'
import { createRunner } from './runner.js'
import { installStyles } from './styles.js'

export const name = 'kanban-client'
export const inject = ['slots', 'connection']

export const PANEL_KEY = 'dsh-kanban'

function KanbanIcon({ size = 16 } = {}) {
  // Three columns at a 1px-ish stroke weight, tinted by `currentColor`.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="1.8" y="2.6" width="3.4" height="10.8" rx="1" />
      <rect x="6.3" y="2.6" width="3.4" height="6.6" rx="1" />
      <rect x="10.8" y="2.6" width="3.4" height="8.6" rx="1" />
    </svg>
  )
}

export function apply(ctx) {
  const api = createApi(ctx.connection)
  const runner = createRunner(ctx)

  // Session titles for the filter menu; falls back to a short id.
  let sessions
  ctx.inject?.(['sessions'], (scope) => { sessions = scope.sessions })
  const sessionTitle = (id) => {
    try {
      const rows = sessions?.list?.getSnapshot?.()?.items ?? []
      const row = rows.find((item) => item.sessionId === id)
      return row?.title || id.slice(0, 8)
    } catch {
      return id.slice(0, 8)
    }
  }

  ctx.effect(() => {
    const disposeStyles = installStyles()

    const stopPanel = ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: PANEL_KEY,
    }, () => <KanbanPanel api={api} runner={runner} sessionTitle={sessionTitle} />))

    const stopSidebar = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_KEY,
      order: 12,
      label: () => '任务看板',
    }, KanbanIcon))

    return () => {
      stopSidebar?.()
      stopPanel?.()
      disposeStyles?.()
    }
  }, 'dsh-kanban: board panel')
}
