/**
 * dsh-kanban — host half.
 *
 * Owns the board file (`$DSH_HOME/integrations/dsh-kanban/board.json`), the
 * `/api/dsh-kanban` RPC the panel talks to, the `kanban_*` agent tools, the
 * todo → card sync, and the auto-complete watcher.
 *
 * Deliberately dependency-free: no `@deepseek-ai/*` imports, because a profile
 * plugin resolves packages from its own node_modules, not from the DSH bundle.
 */

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const name = 'dsh-kanban'
export const inject = ['connection']

const RPC_PATH = '/api/dsh-kanban'
const BOARD_VERSION = 2
const DEFAULT_BOARD_ID = 'b_default'
const DEFAULT_BOARD_NAME = '默认看板'

const COLUMNS = [
  { id: 'backlog', title: '待办' },
  { id: 'doing', title: '进行中' },
  { id: 'done', title: '已完成' },
]
const COLUMN_IDS = new Set(COLUMNS.map((column) => column.id))
const STATUS_COLUMN = { pending: 'backlog', in_progress: 'doing', completed: 'done' }

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

function emptyBoard(name = DEFAULT_BOARD_NAME) {
  return {
    version: BOARD_VERSION,
    revision: 0,
    updatedAt: Date.now(),
    activeBoardId: DEFAULT_BOARD_ID,
    boards: [{
      id: DEFAULT_BOARD_ID,
      name,
      createdAt: Date.now(),
      cards: [],
    }],
    deleted: [],
    settings: { autoSyncTodos: true, autoCompleteOnRun: true },
  }
}

function normalizeCards(rawCards) {
  if (!Array.isArray(rawCards)) return []
  return rawCards.filter((card) => card && typeof card.id === 'string'
    && typeof card.title === 'string' && COLUMN_IDS.has(card.column)).map((card) => ({
    id: card.id,
    title: card.title,
    note: typeof card.note === 'string' ? card.note : '',
    column: card.column,
    createdAt: Number.isInteger(card.createdAt) ? card.createdAt : Date.now(),
    updatedAt: Number.isInteger(card.updatedAt) ? card.updatedAt : Date.now(),
    ...(card.source && typeof card.source === 'object' ? { source: card.source } : {}),
    ...(card.pinned === true ? { pinned: true } : {}),
    ...(typeof card.todoStatus === 'string' ? { todoStatus: card.todoStatus } : {}),
    ...(typeof card.prompt === 'string' && card.prompt.trim().length > 0 ? { prompt: card.prompt.slice(0, 8000) } : {}),
    ...(card.lastRun && typeof card.lastRun === 'object' && typeof card.lastRun.sessionId === 'string'
      ? {
        lastRun: {
          sessionId: card.lastRun.sessionId,
          at: Number.isInteger(card.lastRun.at) ? card.lastRun.at : Date.now(),
          ...(Number.isInteger(card.lastRun.finishedAt) ? { finishedAt: card.lastRun.finishedAt } : {}),
        },
      }
      : {}),
  }))
}

function normalizeBoard(rawBoard, fallbackName) {
  const name = typeof rawBoard?.name === 'string' && rawBoard.name.trim().length > 0
    ? rawBoard.name.trim().slice(0, 60)
    : fallbackName
  return {
    id: typeof rawBoard?.id === 'string' && rawBoard.id.length > 0 ? rawBoard.id : `b_${randomUUID().slice(0, 8)}`,
    name,
    createdAt: Number.isInteger(rawBoard?.createdAt) ? rawBoard.createdAt : Date.now(),
    cards: normalizeCards(rawBoard?.cards),
  }
}

function normalize(raw) {
  const board = emptyBoard()
  if (!raw || typeof raw !== 'object') return board

  board.revision = Number.isInteger(raw.revision) ? raw.revision : 0
  board.updatedAt = Number.isInteger(raw.updatedAt) ? raw.updatedAt : Date.now()

  if (Array.isArray(raw.boards) && raw.boards.length > 0) {
    board.boards = raw.boards.map((entry, index) => normalizeBoard(entry, `看板 ${index + 1}`))
  } else if (Array.isArray(raw.cards)) {
    // v1 → v2: the single board becomes the default one.
    board.boards = [normalizeBoard({ id: DEFAULT_BOARD_ID, name: DEFAULT_BOARD_NAME, cards: raw.cards }, DEFAULT_BOARD_NAME)]
  }

  const active = raw.activeBoardId
  board.activeBoardId = board.boards.some((entry) => entry.id === active) ? active : board.boards[0].id

  if (Array.isArray(raw.deleted)) {
    board.deleted = raw.deleted.filter((entry) => entry && typeof entry.sessionId === 'string'
      && typeof entry.key === 'string').slice(-500)
  }
  if (raw.settings && typeof raw.settings === 'object') {
    board.settings = {
      autoSyncTodos: raw.settings.autoSyncTodos !== false,
      autoCompleteOnRun: raw.settings.autoCompleteOnRun !== false,
    }
  }
  return board
}

function activeBoard(draft) {
  const found = draft.boards.find((entry) => entry.id === draft.activeBoardId)
  if (found) return found
  draft.activeBoardId = draft.boards[0].id
  return draft.boards[0]
}

function boardFor(draft, boardId) {
  if (typeof boardId !== 'string' || boardId.length === 0) return activeBoard(draft)
  const found = draft.boards.find((entry) => entry.id === boardId)
  if (!found) throw new BoardError('board-not-found', `找不到看板 ${boardId}`)
  return found
}

function boardByName(draft, name) {
  const wanted = String(name).trim().toLowerCase()
  return draft.boards.find((entry) => entry.name.toLowerCase() === wanted)
    ?? draft.boards.find((entry) => entry.name.toLowerCase().includes(wanted))
}

function makeCard({ title, note = '', column = 'backlog', prompt, source, now = Date.now() }) {
  const text = typeof prompt === 'string' ? prompt.trim().slice(0, 8000) : ''
  return {
    id: `c_${randomUUID().slice(0, 8)}`,
    title: sanitize(title, '未命名卡片'),
    note: sanitize(note, ''),
    column: COLUMN_IDS.has(column) ? column : 'backlog',
    createdAt: now,
    updatedAt: now,
    ...(source ? { source } : {}),
    ...(text.length > 0 ? { prompt: text } : {}),
  }
}

function sanitize(value, fallback) {
  if (typeof value !== 'string') return fallback
  const text = value.trim()
  return text.length === 0 ? fallback : text.slice(0, 2000)
}

function contentKey(content) {
  return createHash('sha1').update(content.trim()).digest('hex').slice(0, 12)
}

/** Places `card` at `position` among the cards of `column`, keeping one flat list. */
function placeCard(board, card, column, position) {
  const others = board.cards.filter((entry) => entry.id !== card.id)
  const inColumn = others.filter((entry) => entry.column === column)
  card.column = column
  const anchor = Number.isInteger(position) && position >= 0 && position < inColumn.length
    ? inColumn[position]
    : undefined
  if (!anchor) {
    board.cards = [...others, card]
    return
  }
  const index = others.indexOf(anchor)
  board.cards = [...others.slice(0, index), card, ...others.slice(index)]
}

function findCard(board, { id, title }) {
  if (typeof id === 'string' && id.length > 0) {
    const exact = board.cards.find((card) => card.id === id)
    if (exact) return exact
    const prefixed = board.cards.filter((card) => card.id.startsWith(id))
    if (prefixed.length === 1) return prefixed[0]
  }
  if (typeof title === 'string' && title.trim().length > 0) {
    const wanted = title.trim().toLowerCase()
    const exact = board.cards.find((card) => card.title.toLowerCase() === wanted)
    if (exact) return exact
    const partial = board.cards.filter((card) => card.title.toLowerCase().includes(wanted))
    if (partial.length === 1) return partial[0]
  }
  return undefined
}

function summarize(board) {
  const sections = COLUMNS.map((column) => {
    const cards = board.cards.filter((card) => card.column === column.id)
    const lines = cards.map((card) => `  - [${card.id.slice(2)}] ${card.title}`
      + (typeof card.prompt === 'string' && card.prompt.length > 0 ? ' ✨有提示词' : '')
      + (card.source?.kind === 'todo' ? '（会话同步）' : ''))
    return `${column.title} (${cards.length})${lines.length > 0 ? `\n${lines.join('\n')}` : ''}`
  })
  return `看板「${board.name}」共 ${board.cards.length} 张卡片\n${sections.join('\n')}`
}

/** What the panel receives: the active board flattened, plus the switcher list. */
function view(draft) {
  const board = activeBoard(draft)
  return {
    revision: draft.revision,
    updatedAt: draft.updatedAt,
    activeBoardId: board.id,
    activeBoardName: board.name,
    boards: draft.boards.map((entry) => ({
      id: entry.id,
      name: entry.name,
      cardCount: entry.cards.length,
      active: entry.id === board.id,
    })),
    columns: COLUMNS,
    cards: board.cards,
    settings: draft.settings,
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

class BoardStore {
  #path
  #writes = Promise.resolve()
  #cache

  constructor(path) {
    this.#path = path
  }

  get path() {
    return this.#path
  }

  async read() {
    try {
      const raw = await readFile(this.#path, 'utf8')
      const board = normalize(JSON.parse(raw))
      this.#cache = board
      return board
    } catch (error) {
      if (error?.code === 'ENOENT') {
        const board = emptyBoard()
        this.#cache = board
        return board
      }
      if (this.#cache) {
        console.warn('[dsh-kanban] board.json 读取失败，沿用内存中的副本：', error?.message ?? error)
        return this.#cache
      }
      throw error
    }
  }

  /** Serialized read-modify-write; the mutator receives a private draft. */
  async update(mutator) {
    const run = this.#writes.then(async () => {
      const board = await this.read()
      const draft = structuredClone(board)
      const result = await mutator(draft)
      draft.revision = (draft.revision ?? 0) + 1
      draft.updatedAt = Date.now()
      await this.#save(draft)
      this.#cache = draft
      return { board: draft, result }
    })
    this.#writes = run.then(() => {}, () => {})
    return run
  }

  async #save(board) {
    await mkdir(dirname(this.#path), { recursive: true })
    const temporary = `${this.#path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(board, null, 2)}\n`, 'utf8')
    await rename(temporary, this.#path)
  }
}

function dshHome() {
  return resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'))
}

// ---------------------------------------------------------------------------
// Todo → board sync
// ---------------------------------------------------------------------------

/** Finds the card owned by one todo, anywhere in the document. */
function findTodoCard(draft, sessionId, key) {
  for (const board of draft.boards) {
    const card = board.cards.find((entry) => entry.source?.kind === 'todo'
      && entry.source.sessionId === sessionId && entry.source.key === key)
    if (card) return { board, card }
  }
  return undefined
}

function syncSessionTodos(draft, sessionId, todos, now = Date.now()) {
  const target = activeBoard(draft)
  const changed = []
  for (const todo of todos) {
    if (!todo || typeof todo.content !== 'string') continue
    const title = sanitize(todo.content, '')
    if (title.length === 0) continue
    const key = contentKey(title)
    if (draft.deleted.some((entry) => entry.sessionId === sessionId && entry.key === key)) continue

    const column = STATUS_COLUMN[todo.status] ?? 'backlog'
    const existing = findTodoCard(draft, sessionId, key)

    if (!existing) {
      const card = makeCard({ title, column, now, source: { kind: 'todo', sessionId, key } })
      card.todoStatus = todo.status
      target.cards.push(card)
      changed.push(card.id)
      continue
    }

    let touched = false
    if (existing.card.title !== title) {
      existing.card.title = title
      touched = true
    }
    if (existing.card.todoStatus !== todo.status) {
      existing.card.todoStatus = todo.status
      touched = true
    }
    if (!existing.card.pinned && existing.card.column !== column) {
      placeCard(existing.board, existing.card, column, Number.MAX_SAFE_INTEGER)
      touched = true
    }
    if (touched) {
      existing.card.updatedAt = now
      changed.push(existing.card.id)
    }
  }
  return changed
}

/** Moves every card launched from `sessionId` into 「已完成」. */
function completeCardsForSession(draft, sessionId, now = Date.now()) {
  const completed = []
  for (const board of draft.boards) {
    for (const card of board.cards) {
      if (card.lastRun?.sessionId !== sessionId) continue
      if (card.lastRun.finishedAt !== undefined && card.column === 'done') continue
      card.lastRun = { ...card.lastRun, finishedAt: now }
      card.updatedAt = now
      if (card.column !== 'done') placeCard(board, card, 'done', Number.MAX_SAFE_INTEGER)
      completed.push(card.id)
    }
  }
  return completed
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

function textOutput(properties = {}) {
  return {
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['ok', 'message'],
      properties: {
        ok: { type: 'boolean', required: true },
        message: { type: 'string', required: true },
        ...properties,
      },
    },
    render: (_args, value) => [{ type: 'text', text: value.message }],
  }
}

function defineKanbanTool({ name: toolName, description, parameters, run }) {
  return {
    name: toolName,
    description,
    parameters,
    output: textOutput(),
    async execute(args, exec) {
      const context = { sessionId: exec?.agent?.session?.id }
      const { message } = await run(args ?? {}, context)
      return { ok: true, message }
    },
  }
}

const COLUMN_ENUM = { type: 'string', enum: COLUMNS.map((column) => column.id) }
const BOARD_PARAM = { type: 'string', description: '可选：看板名称（不写就用当前看板）。' }

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function apply(ctx, config = {}) {
  const store = new BoardStore(resolve(config.boardPath ?? join(dshHome(), 'integrations', 'dsh-kanban', 'board.json')))
  let autoSync = config.autoSyncTodos !== false
  let autoComplete = config.autoCompleteOnRun !== false
  /** Sessions observed running; a later idle for the same id means a turn ended. */
  const runningSessions = new Set()

  store.read().then((board) => {
    autoSync = board.settings.autoSyncTodos !== false
    autoComplete = board.settings.autoCompleteOnRun !== false
  }).catch(() => {})

  // --- RPC ---------------------------------------------------------------
  const handlers = {
    async 'board.get'() {
      const board = await store.read()
      return { board: view(board) }
    },

    async 'board.addCard'({ boardId, title, note, column, prompt }) {
      const { board, result } = await store.update((draft) => {
        const target = boardFor(draft, boardId)
        const card = makeCard({ title, note, column, prompt })
        placeCard(target, card, card.column, Number.MAX_SAFE_INTEGER)
        return card
      })
      return { board: view(board), card: result }
    },

    async 'board.updateCard'({ boardId, id, title, note }) {
      const { board } = await store.update((draft) => {
        const target = boardFor(draft, boardId)
        const card = findCard(target, { id })
        if (!card) throw new BoardError('card-not-found', `找不到卡片 ${id}`)
        if (typeof title === 'string' && title.trim().length > 0) card.title = sanitize(title, card.title)
        if (typeof note === 'string') card.note = sanitize(note, '')
        card.pinned = true
        card.updatedAt = Date.now()
        return card
      })
      return { board: view(board) }
    },

    async 'board.setPrompt'({ boardId, id, prompt }) {
      const { board } = await store.update((draft) => {
        const target = boardFor(draft, boardId)
        const card = findCard(target, { id })
        if (!card) throw new BoardError('card-not-found', `找不到卡片 ${id}`)
        const text = typeof prompt === 'string' ? prompt.trim().slice(0, 8000) : ''
        if (text.length > 0) card.prompt = text
        else delete card.prompt
        card.pinned = true
        card.updatedAt = Date.now()
        return card
      })
      return { board: view(board) }
    },

    /** Records a run and pulls the card into 「进行中」. */
    async 'board.markRun'({ boardId, id, sessionId }) {
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new BoardError('bad-session', '缺少会话 id，无法记录执行')
      }
      const { board } = await store.update((draft) => {
        const target = boardFor(draft, boardId)
        const card = findCard(target, { id })
        if (!card) throw new BoardError('card-not-found', `找不到卡片 ${id}`)
        card.lastRun = { sessionId, at: Date.now() }
        card.pinned = true
        card.updatedAt = Date.now()
        if (card.column !== 'doing') placeCard(target, card, 'doing', Number.MAX_SAFE_INTEGER)
        return card
      })
      return { board: view(board) }
    },

    async 'board.moveCard'({ boardId, id, column, position }) {
      const { board } = await store.update((draft) => {
        const target = boardFor(draft, boardId)
        const card = findCard(target, { id })
        if (!card) throw new BoardError('card-not-found', `找不到卡片 ${id}`)
        if (!COLUMN_IDS.has(column)) throw new BoardError('bad-column', `未知的列 ${column}`)
        placeCard(target, card, column, position)
        if (card.source?.kind === 'todo') card.pinned = true
        card.updatedAt = Date.now()
        return card
      })
      return { board: view(board) }
    },

    async 'board.deleteCard'({ boardId, id }) {
      const { board } = await store.update((draft) => {
        const target = boardFor(draft, boardId)
        const card = findCard(target, { id })
        if (!card) throw new BoardError('card-not-found', `找不到卡片 ${id}`)
        target.cards = target.cards.filter((entry) => entry.id !== card.id)
        if (card.source?.kind === 'todo') {
          draft.deleted = [...draft.deleted.slice(-499), {
            sessionId: card.source.sessionId,
            key: card.source.key,
            at: Date.now(),
          }]
        }
        return card
      })
      return { board: view(board) }
    },

    async 'board.clearColumn'({ boardId, column }) {
      if (!COLUMN_IDS.has(column)) throw new BoardError('bad-column', `未知的列 ${column}`)
      const { board } = await store.update((draft) => {
        const target = boardFor(draft, boardId)
        const removed = target.cards.filter((card) => card.column === column)
        target.cards = target.cards.filter((card) => card.column !== column)
        for (const card of removed) {
          if (card.source?.kind === 'todo') {
            draft.deleted = [...draft.deleted.slice(-499), {
              sessionId: card.source.sessionId,
              key: card.source.key,
              at: Date.now(),
            }]
          }
        }
        return removed.length
      })
      return { board: view(board) }
    },

    async 'board.setSettings'({ autoSyncTodos, autoCompleteOnRun }) {
      const { board } = await store.update((draft) => {
        if (typeof autoSyncTodos === 'boolean') {
          draft.settings.autoSyncTodos = autoSyncTodos
          autoSync = autoSyncTodos
        }
        if (typeof autoCompleteOnRun === 'boolean') {
          draft.settings.autoCompleteOnRun = autoCompleteOnRun
          autoComplete = autoCompleteOnRun
        }
        return draft.settings
      })
      return { board: view(board) }
    },

    // --- boards -----------------------------------------------------------
    async 'boards.select'({ id }) {
      const { board } = await store.update((draft) => {
        if (!draft.boards.some((entry) => entry.id === id)) throw new BoardError('board-not-found', `找不到看板 ${id}`)
        draft.activeBoardId = id
        return id
      })
      return { board: view(board) }
    },

    async 'boards.create'({ name }) {
      const { board } = await store.update((draft) => {
        const created = {
          id: `b_${randomUUID().slice(0, 8)}`,
          name: sanitize(name, `看板 ${draft.boards.length + 1}`).slice(0, 60),
          createdAt: Date.now(),
          cards: [],
        }
        draft.boards.push(created)
        draft.activeBoardId = created.id
        return created
      })
      return { board: view(board) }
    },

    async 'boards.rename'({ id, name }) {
      const { board } = await store.update((draft) => {
        const target = draft.boards.find((entry) => entry.id === id)
        if (!target) throw new BoardError('board-not-found', `找不到看板 ${id}`)
        target.name = sanitize(name, target.name).slice(0, 60)
        return target
      })
      return { board: view(board) }
    },

    async 'boards.delete'({ id }) {
      const { board } = await store.update((draft) => {
        if (draft.boards.length <= 1) throw new BoardError('last-board', '至少要保留一块看板')
        const index = draft.boards.findIndex((entry) => entry.id === id)
        if (index < 0) throw new BoardError('board-not-found', `找不到看板 ${id}`)
        draft.boards.splice(index, 1)
        if (!draft.boards.some((entry) => entry.id === draft.activeBoardId)) {
          draft.activeBoardId = draft.boards[Math.max(0, index - 1)].id
        }
        return id
      })
      return { board: view(board) }
    },
  }

  const disposeRpc = registerRpc(ctx, handlers)

  // --- Tools -------------------------------------------------------------
  const toolDisposer = ctx.inject(['tools'], (toolCtx) => toolCtx.tools.register(defineKanbanTool({
    name: 'kanban_list',
    description: '列出任务看板上的卡片（按列分组，附带卡片 id）。默认列出当前看板，也可以指定看板名称。',
    parameters: { type: 'object', additionalProperties: false, properties: { board: BOARD_PARAM } },
    async run(args) {
      const document = await store.read()
      const target = typeof args.board === 'string' && args.board.trim().length > 0
        ? boardByName(document, args.board)
        : activeBoard(document)
      if (!target) return { message: `没有找到看板「${args.board}」。` }
      const others = document.boards.filter((entry) => entry.id !== target.id)
        .map((entry) => `${entry.name}(${entry.cards.length})`)
      const suffix = others.length > 0 ? `\n其他看板：${others.join('、')}` : ''
      return { message: summarize(target) + suffix }
    },
  })))

  ctx.inject(['tools'], (toolCtx) => toolCtx.tools.register(defineKanbanTool({
    name: 'kanban_add',
    description: '在看板上新建一张卡片。默认放进当前看板的「待办」列。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['title'],
      properties: {
        title: { type: 'string', required: true, description: '卡片标题，一句简短的话。' },
        note: { type: 'string', description: '可选的补充说明。' },
        prompt: { type: 'string', description: '可选：这张卡片的提示词。人点「执行」时会把这段原文发进一个新会话让 agent 跑。' },
        column: { ...COLUMN_ENUM, description: 'backlog（待办）| doing（进行中）| done（已完成）' },
        board: BOARD_PARAM,
      },
    },
    async run(args) {
      const { result: card } = await store.update((draft) => {
        const target = typeof args.board === 'string' && args.board.trim().length > 0
          ? boardByName(draft, args.board)
          : activeBoard(draft)
        if (!target) throw new BoardError('board-not-found', `没有找到看板「${args.board}」`)
        const created = makeCard({
          title: args.title,
          note: args.note,
          column: args.column,
          prompt: args.prompt,
          source: { kind: 'agent' },
        })
        placeCard(target, created, created.column, Number.MAX_SAFE_INTEGER)
        return created
      })
      return { message: `已添加卡片 [${card.id.slice(2)}]「${card.title}」到「${columnTitle(card.column)}」。` }
    },
  })))

  ctx.inject(['tools'], (toolCtx) => toolCtx.tools.register(defineKanbanTool({
    name: 'kanban_move',
    description: '把一张卡片移动到另一列（也可用来在列内调整顺序）。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['column'],
      properties: {
        id: { type: 'string', description: '卡片 id（支持前缀），或用 title 指定。' },
        title: { type: 'string', description: '卡片标题（支持唯一的部分匹配）。' },
        column: { ...COLUMN_ENUM, required: true, description: '目标列。' },
        board: BOARD_PARAM,
      },
    },
    async run(args) {
      const { result: card } = await store.update((draft) => {
        const target = boardFor(draft, boardIdFor(draft, args.board))
        const found = findCard(target, { id: args.id, title: args.title })
        if (!found) throw new BoardError('card-not-found', '找不到这张卡片，先用 kanban_list 看看 id。')
        placeCard(target, found, args.column, Number.MAX_SAFE_INTEGER)
        if (found.source?.kind === 'todo') found.pinned = true
        found.updatedAt = Date.now()
        return found
      })
      return { message: `已把「${card.title}」移到 ${columnTitle(card.column)}。` }
    },
  })))

  ctx.inject(['tools'], (toolCtx) => toolCtx.tools.register(defineKanbanTool({
    name: 'kanban_update',
    description: '修改卡片的标题、备注或提示词。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: '卡片 id（支持前缀）。' },
        title: { type: 'string', description: '用于定位卡片的现有标题。' },
        newTitle: { type: 'string', description: '新的标题。' },
        note: { type: 'string', description: '新的备注，传空字符串可清空。' },
        prompt: { type: 'string', description: '新的提示词，传空字符串可清空。' },
        board: BOARD_PARAM,
      },
    },
    async run(args) {
      const { result: card } = await store.update((draft) => {
        const target = boardFor(draft, boardIdFor(draft, args.board))
        const found = findCard(target, { id: args.id, title: args.title })
        if (!found) throw new BoardError('card-not-found', '找不到这张卡片，先用 kanban_list 看看 id。')
        if (typeof args.newTitle === 'string' && args.newTitle.trim().length > 0) {
          found.title = sanitize(args.newTitle, found.title)
        }
        if (typeof args.note === 'string') found.note = sanitize(args.note, '')
        if (typeof args.prompt === 'string') {
          const text = args.prompt.trim().slice(0, 8000)
          if (text.length > 0) found.prompt = text
          else delete found.prompt
        }
        found.pinned = true
        found.updatedAt = Date.now()
        return found
      })
      return { message: `已更新卡片「${card.title}」。` }
    },
  })))

  ctx.inject(['tools'], (toolCtx) => toolCtx.tools.register(defineKanbanTool({
    name: 'kanban_delete',
    description: '从看板上删除一张卡片。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: '卡片 id（支持前缀）。' },
        title: { type: 'string', description: '用于定位卡片的标题。' },
        board: BOARD_PARAM,
      },
    },
    async run(args) {
      const { result: card } = await store.update((draft) => {
        const target = boardFor(draft, boardIdFor(draft, args.board))
        const found = findCard(target, { id: args.id, title: args.title })
        if (!found) throw new BoardError('card-not-found', '找不到这张卡片。')
        target.cards = target.cards.filter((entry) => entry.id !== found.id)
        if (found.source?.kind === 'todo') {
          draft.deleted = [...draft.deleted.slice(-499), {
            sessionId: found.source.sessionId,
            key: found.source.key,
            at: Date.now(),
          }]
        }
        return found
      })
      return { message: `已删除卡片「${card.title}」。` }
    },
  })))

  ctx.inject(['tools'], (toolCtx) => toolCtx.tools.register(defineKanbanTool({
    name: 'kanban_boards',
    description: '列出所有看板，或新建/切换看板。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        action: { type: 'string', enum: ['list', 'create', 'select'], description: '默认 list。' },
        name: { type: 'string', description: 'create 时的看板名，或 select 时要切换到的看板名。' },
      },
    },
    async run(args) {
      const action = args.action ?? 'list'
      if (action === 'list') {
        const document = await store.read()
        const lines = document.boards.map((entry) => `- ${entry.name}（${entry.cards.length} 张）${entry.id === document.activeBoardId ? ' ← 当前' : ''}`)
        return { message: `共 ${document.boards.length} 块看板：\n${lines.join('\n')}` }
      }
      if (action === 'create') {
        const { result: created } = await store.update((draft) => {
          const board = {
            id: `b_${randomUUID().slice(0, 8)}`,
            name: sanitize(args.name, `看板 ${draft.boards.length + 1}`).slice(0, 60),
            createdAt: Date.now(),
            cards: [],
          }
          draft.boards.push(board)
          draft.activeBoardId = board.id
          return board
        })
        return { message: `已新建并切换到看板「${created.name}」。` }
      }
      const { result: selected } = await store.update((draft) => {
        const target = boardByName(draft, args.name ?? '')
        if (!target) throw new BoardError('board-not-found', `没有找到看板「${args.name}」。`)
        draft.activeBoardId = target.id
        return target
      })
      return { message: `已切换到看板「${selected.name}」。` }
    },
  })))

  ctx.inject(['tools', 'sessionProjections'], (toolCtx) => toolCtx.tools.register(defineKanbanTool({
    name: 'kanban_sync_todos',
    description: '把当前会话的 todo 列表同步到看板（未完成的进「待办/进行中」，已完成进「已完成」）。',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    async run(_args, context) {
      const session = context.sessionId
      if (!session) return { message: '当前没有会话，无法同步 todo。' }
      const todos = readSessionTodos(toolCtx, session)
      if (!todos || todos.length === 0) return { message: '当前会话还没有 todo 列表。' }
      const { board } = await store.update((draft) => syncSessionTodos(draft, session, todos))
      return { message: `已同步 ${todos.length} 条 todo 到看板「${activeBoard(board).name}」。\n${summarize(activeBoard(board))}` }
    },
  })))

  // --- Session todo → board ---------------------------------------------
  ctx.on('session/event', (session, event) => {
    if (!autoSync) return
    if (event?.type !== 'todo/write') return
    const todos = event.data?.todos
    if (!Array.isArray(todos) || todos.length === 0) return
    const sessionId = session?.id
    if (typeof sessionId !== 'string') return
    store.update((draft) => syncSessionTodos(draft, sessionId, todos))
      .catch((error) => console.warn('[dsh-kanban] todo 同步失败：', error?.message ?? error))
  })

  // --- Auto complete ------------------------------------------------------
  ctx.on('agent/status', ({ agent, status } = {}) => {
    if (!autoComplete) return
    const sessionId = agent?.id ?? agent?.session?.id
    if (typeof sessionId !== 'string') return
    // Only a running → idle transition counts, so a session that goes idle
    // before the prompt lands cannot tick a card off by accident.
    if (status === 'running') {
      runningSessions.add(sessionId)
      return
    }
    if (status !== 'idle' || !runningSessions.delete(sessionId)) return
    autoCompleteCards(sessionId)
  })

  async function autoCompleteCards(sessionId) {
    try {
      const document = await store.read()
      const relevant = document.boards.some((entry) => entry.cards.some((card) => card.lastRun?.sessionId === sessionId
        && card.column !== 'done'))
      if (!relevant) return
      const { result } = await store.update((draft) => completeCardsForSession(draft, sessionId))
      if (result.length > 0) {
        console.log(`[dsh-kanban] 会话 ${sessionId.slice(0, 8)} 结束，${result.length} 张卡片进入「已完成」`)
      }
    } catch (error) {
      console.warn('[dsh-kanban] 自动完成失败：', error?.message ?? error)
    }
  }

  return () => {
    disposeRpc?.()
    toolDisposer?.()
  }
}

function boardIdFor(draft, name) {
  if (typeof name !== 'string' || name.trim().length === 0) return undefined
  const found = boardByName(draft, name)
  if (!found) throw new BoardError('board-not-found', `没有找到看板「${name}」`)
  return found.id
}

function columnTitle(id) {
  return COLUMNS.find((column) => column.id === id)?.title ?? id
}

function readSessionTodos(ctx, sessionId) {
  try {
    const store = ctx?.get?.('sessionProjections')
    const session = ctx?.sessions?.get?.(sessionId)
    if (!store || !session) return null
    return store.stateOf(session, 'todos')
  } catch {
    return null
  }
}

class BoardError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// RPC wiring
// ---------------------------------------------------------------------------

function registerRpc(ctx, handlers) {
  const register = ctx?.connection?.fetch?.register
  if (typeof register !== 'function') {
    console.warn('[dsh-kanban] connection.fetch 不可用，面板将无法读写看板')
    return undefined
  }

  return register.call(ctx.connection.fetch, {
    path: RPC_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    async fetch(request) {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 })
      const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
      if (contentType !== 'application/json') return new Response('content type must be application/json', { status: 415 })

      let message
      try { message = await request.json() } catch { return new Response('body is not JSON', { status: 400 }) }

      const rpcId = typeof message?.rpcId === 'string' ? message.rpcId : 'invalid-request'
      const call = message?.payload
      if (!message || message.type !== 'client-request' || typeof message.rpcId !== 'string'
        || message.method !== 'dsh-kanban' || !call || typeof call !== 'object'
        || typeof call.method !== 'string' || !Object.hasOwn(call, 'payload')) {
        return reply(rpcId, { ok: false, error: { code: 'kanban/bad-request', message: 'Invalid kanban request.' } })
      }

      const handler = handlers[call.method]
      if (typeof handler !== 'function') {
        return reply(rpcId, { ok: false, error: { code: 'kanban/unknown-method', message: `未知方法 ${call.method}` } })
      }

      try {
        const value = await handler(call.payload ?? {})
        return reply(rpcId, { ok: true, value })
      } catch (error) {
        const code = error instanceof BoardError ? `kanban/${error.code}` : 'kanban/internal'
        return reply(rpcId, { ok: false, error: { code, message: error?.message ?? String(error) } })
      }
    },
  })
}

function reply(rpcId, result) {
  return Response.json({ type: 'server-response', rpcId, result })
}
