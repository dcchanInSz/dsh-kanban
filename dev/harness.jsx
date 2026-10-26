/**
 * Standalone harness: mounts the panel with an in-memory board so the UI can be
 * reviewed without installing the plugin. Not shipped in the npm package.
 */

import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { KanbanPanel } from '../src/client/board.jsx'
import { installStyles } from '../src/client/styles.js'

const params = new URLSearchParams(location.search)
const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
document.documentElement.style.colorScheme = theme

installStyles()

const now = Date.now()
const columnIds = ['backlog', 'doing', 'done']
let revision = 3

let board = {
  version: 1,
  revision,
  updatedAt: now,
  columns: [
    { id: 'backlog', title: '待办' },
    { id: 'doing', title: '进行中' },
    { id: 'done', title: '已完成' },
  ],
  cards: [
    {
      id: 'c_a1b2c3d4',
      title: '给看板加「按会话过滤」',
      note: '只显示某个会话同步过来的卡片',
      column: 'backlog',
      createdAt: now - 86_400_000,
      updatedAt: now - 7_200_000,
    },
    {
      id: 'c_e5f6a7b8',
      title: '把 todo 同步做成可开关的',
      note: '',
      column: 'backlog',
      createdAt: now - 3_600_000,
      updatedAt: now - 3_600_000,
      source: { kind: 'agent' },
    },
    {
      id: 'c_c9d0e1f2',
      title: '写 README 和安装说明',
      note: '包含 dsh plugin add 的用法、版本兼容表',
      column: 'doing',
      createdAt: now - 7_200_000,
      updatedAt: now - 600_000,
      source: { kind: 'todo', sessionId: 's_1', key: 'k1' },
      todoStatus: 'in_progress',
    },
    {
      id: 'c_3a4b5c6d',
      title: '给卡片加拖拽排序',
      note: '',
      column: 'done',
      createdAt: now - 172_800_000,
      updatedAt: now - 86_400_000,
      source: { kind: 'todo', sessionId: 's_1', key: 'k2' },
      todoStatus: 'completed',
    },
  ],
  deleted: [],
  settings: { autoSyncTodos: true },
}

function commit(mutator) {
  const draft = structuredClone(board)
  mutator(draft)
  draft.revision = (revision += 1)
  draft.updatedAt = Date.now()
  board = draft
  return { board }
}

const delay = () => new Promise((resolve) => setTimeout(resolve, 40))

const mockApi = {
  async get() { await delay(); return { board } },
  async addCard({ title, note = '', column = 'backlog' }) {
    await delay()
    return commit((draft) => {
      draft.cards.push({
        id: `c_${Math.random().toString(16).slice(2, 10)}`,
        title, note, column,
        createdAt: Date.now(), updatedAt: Date.now(),
      })
    })
  },
  async updateCard({ id, title }) {
    await delay()
    return commit((draft) => {
      const card = draft.cards.find((entry) => entry.id === id)
      if (card) { if (title) card.title = title; card.updatedAt = Date.now() }
    })
  },
  async moveCard({ id, column, position }) {
    await delay()
    return commit((draft) => {
      const card = draft.cards.find((entry) => entry.id === id)
      if (!card) return
      draft.cards = draft.cards.filter((entry) => entry.id !== id)
      const inColumn = draft.cards.filter((entry) => entry.column === column)
      const anchor = Number.isInteger(position) ? inColumn[position] : undefined
      card.column = column
      const index = anchor ? draft.cards.indexOf(anchor) : draft.cards.length
      draft.cards.splice(index, 0, card)
    })
  },
  async deleteCard({ id }) {
    await delay()
    return commit((draft) => { draft.cards = draft.cards.filter((entry) => entry.id !== id) })
  },
  async clearColumn(column) {
    await delay()
    return commit((draft) => { draft.cards = draft.cards.filter((entry) => entry.column !== column) })
  },
  async setSettings(settings) {
    await delay()
    return commit((draft) => { Object.assign(draft.settings, settings) })
  },
}

createRoot(document.getElementById('root')).render(<KanbanPanel api={mockApi} />)
