/**
 * Standalone harness: mounts the panel with an in-memory v2 document so the UI
 * can be reviewed without installing the plugin. Not shipped in the npm package.
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
let revision = 3

let doc = {
  version: 2,
  revision,
  updatedAt: now,
  activeBoardId: 'b_default',
  boards: [
    {
      id: 'b_default',
      name: '默认看板',
      createdAt: now - 86_400_000,
      cards: [
        {
          id: 'c_a1b2c3d4',
          title: '给看板加「按会话过滤」',
          note: '只显示某个会话同步过来的卡片',
          column: 'backlog',
          createdAt: now - 86_400_000,
          updatedAt: now - 7_200_000,
          source: { kind: 'todo', sessionId: 's_demo_1', key: 'k0' },
        },
        {
          id: 'c_e5f6a7b8',
          title: '把 todo 同步做成可开关的',
          column: 'backlog',
          createdAt: now - 3_600_000,
          updatedAt: now - 3_600_000,
          source: { kind: 'agent' },
        },
        {
          id: 'c_c9d0e1f2',
          title: '写 README 和安装说明',
          note: '包含 dsh plugin add 的用法、版本兼容表',
          prompt: '把 README 补完：安装两种方式、同步规则表、kanban_* 工具说明，中文为主。',
          column: 'doing',
          createdAt: now - 7_200_000,
          updatedAt: now - 600_000,
          source: { kind: 'todo', sessionId: 's_demo_1', key: 'k1' },
          todoStatus: 'in_progress',
          lastRun: { sessionId: 's_demo_2', at: now - 600_000 },
        },
        {
          id: 'c_3a4b5c6d',
          title: '给卡片加拖拽排序',
          column: 'done',
          createdAt: now - 172_800_000,
          updatedAt: now - 86_400_000,
          source: { kind: 'todo', sessionId: 's_demo_3', key: 'k2' },
          todoStatus: 'completed',
          lastRun: { sessionId: 's_demo_2', at: now - 86_400_000, finishedAt: now - 86_300_000 },
        },
      ],
    },
    {
      id: 'b_demo2',
      name: '项目 A',
      createdAt: now - 3_600_000,
      cards: [
        {
          id: 'c_9f8e7d6c',
          title: '整理接口文档',
          column: 'backlog',
          createdAt: now - 3_600_000,
          updatedAt: now - 3_600_000,
        },
      ],
    },
  ],
  deleted: [],
  settings: { autoSyncTodos: true, autoCompleteOnRun: true },
}

const sessionTitles = {
  s_demo_1: '搭一个任务看板',
  s_demo_2: '验证执行链路',
  s_demo_3: '给卡片加拖拽',
}

function view() {
  const active = doc.boards.find((entry) => entry.id === doc.activeBoardId) ?? doc.boards[0]
  return {
    revision: doc.revision,
    updatedAt: doc.updatedAt,
    activeBoardId: active.id,
    activeBoardName: active.name,
    boards: doc.boards.map((entry) => ({
      id: entry.id,
      name: entry.name,
      cardCount: entry.cards.length,
      active: entry.id === active.id,
    })),
    columns: [
      { id: 'backlog', title: '待办' },
      { id: 'doing', title: '进行中' },
      { id: 'done', title: '已完成' },
    ],
    cards: active.cards,
    settings: doc.settings,
  }
}

function commit(mutator) {
  const draft = structuredClone(doc)
  mutator(draft)
  draft.revision = (revision += 1)
  draft.updatedAt = Date.now()
  doc = draft
  return { board: view() }
}

const active = () => doc.boards.find((entry) => entry.id === doc.activeBoardId) ?? doc.boards[0]
const delay = () => new Promise((resolve) => setTimeout(resolve, 40))

const mockApi = {
  async get() { await delay(); return { board: view() } },
  async addCard({ title, note = '', column = 'backlog', prompt }) {
    await delay()
    return commit((draft) => {
      const board = draft.boards.find((entry) => entry.id === draft.activeBoardId)
      board.cards.push({
        id: `c_${Math.random().toString(16).slice(2, 10)}`,
        title, note, column,
        createdAt: Date.now(), updatedAt: Date.now(),
        ...(prompt && prompt.trim() ? { prompt: prompt.trim() } : {}),
      })
    })
  },
  async updateCard({ id, title }) {
    await delay()
    return commit((draft) => {
      const card = draft.boards.find((entry) => entry.id === draft.activeBoardId).cards.find((entry) => entry.id === id)
      if (card) { if (title) card.title = title; card.updatedAt = Date.now() }
    })
  },
  async setPrompt({ id, prompt }) {
    await delay()
    return commit((draft) => {
      const card = draft.boards.find((entry) => entry.id === draft.activeBoardId).cards.find((entry) => entry.id === id)
      if (!card) return
      if (prompt && prompt.trim()) card.prompt = prompt.trim()
      else delete card.prompt
      card.updatedAt = Date.now()
    })
  },
  async markRun({ id, sessionId }) {
    await delay()
    return commit((draft) => {
      const board = draft.boards.find((entry) => entry.id === draft.activeBoardId)
      const card = board.cards.find((entry) => entry.id === id)
      if (!card) return
      card.lastRun = { sessionId, at: Date.now() }
      card.column = 'doing'
      card.updatedAt = Date.now()
    })
  },
  async moveCard({ id, column, position }) {
    await delay()
    return commit((draft) => {
      const board = draft.boards.find((entry) => entry.id === draft.activeBoardId)
      const card = board.cards.find((entry) => entry.id === id)
      if (!card) return
      board.cards = board.cards.filter((entry) => entry.id !== id)
      const inColumn = board.cards.filter((entry) => entry.column === column)
      const anchor = Number.isInteger(position) ? inColumn[position] : undefined
      card.column = column
      const index = anchor ? board.cards.indexOf(anchor) : board.cards.length
      board.cards.splice(index, 0, card)
    })
  },
  async deleteCard({ id }) {
    await delay()
    return commit((draft) => {
      const board = draft.boards.find((entry) => entry.id === draft.activeBoardId)
      board.cards = board.cards.filter((entry) => entry.id !== id)
    })
  },
  async clearColumn(column) {
    await delay()
    return commit((draft) => {
      const board = draft.boards.find((entry) => entry.id === draft.activeBoardId)
      board.cards = board.cards.filter((entry) => entry.column !== column)
    })
  },
  async setSettings(settings) {
    await delay()
    return commit((draft) => { Object.assign(draft.settings, settings) })
  },
  async selectBoard(id) {
    await delay()
    return commit((draft) => { draft.activeBoardId = id })
  },
  async createBoard(name) {
    await delay()
    return commit((draft) => {
      const board = { id: `b_${Math.random().toString(16).slice(2, 8)}`, name: name || '新看板', createdAt: Date.now(), cards: [] }
      draft.boards.push(board)
      draft.activeBoardId = board.id
    })
  },
  async renameBoard({ id, name }) {
    await delay()
    return commit((draft) => {
      const board = draft.boards.find((entry) => entry.id === id)
      if (board && name) board.name = name
    })
  },
  async deleteBoard(id) {
    await delay()
    return commit((draft) => {
      if (draft.boards.length <= 1) return
      draft.boards = draft.boards.filter((entry) => entry.id !== id)
      if (!draft.boards.some((entry) => entry.id === draft.activeBoardId)) {
        draft.activeBoardId = draft.boards[0].id
      }
    })
  },
}

const mockRunner = {
  canOpenSession: () => true,
  async run(prompt) {
    await new Promise((resolve) => setTimeout(resolve, 400))
    console.log('[harness] 会发进新会话的提示词：', prompt)
    return `s_${Math.random().toString(16).slice(2, 10)}`
  },
  open(sessionId) { console.log('[harness] 打开会话', sessionId) },
}

createRoot(document.getElementById('root')).render(
  <KanbanPanel
    api={mockApi}
    runner={mockRunner}
    sessionTitle={(id) => sessionTitles[id] ?? id.slice(0, 8)}
  />,
)
