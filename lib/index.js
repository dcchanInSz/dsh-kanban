/**
 * dsh-kanban — host half.
 *
 * Owns the board file (`$DSH_HOME/integrations/dsh-kanban/board.json`), the
 * `/api/dsh-kanban` RPC the panel talks to, the `kanban_*` agent tools, and the
 * one-way sync that turns `todo_write` snapshots into board cards.
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
const BOARD_VERSION = 1

const COLUMNS = [
  { id: 'backlog', title: '待办' },
  { id: 'doing', title: '进行中' },
  { id: 'done', title: '已完成' },
]
const COLUMN_IDS = new Set(COLUMNS.map((column) => column.id))
const STATUS_COLUMN = { pending: 'backlog', in_progress: 'doing', completed: 'done' }

// ---------------------------------------------------------------------------
// Board model
// ---------------------------------------------------------------------------

function emptyBoard() {
  return {
    version: BOARD_VERSION,
    revision: 0,
    updatedAt: Date.now(),
    columns: COLUMNS,
    cards: [],
    deleted: [],
    settings: { autoSyncTodos: true },
  }
}

function normalize(raw) {
  const board = emptyBoard()
  if (!raw || typeof raw !== 'object') return board

  board.revision = Number.isInteger(raw.revision) ? raw.revision : 0
  board.updatedAt = Number.isInteger(raw.updatedAt) ? raw.updatedAt : Date.now()
  board.columns = COLUMNS

  if (Array.isArray(raw.cards)) {
    board.cards = raw.cards.filter((card) => card && typeof card.id === 'string'
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
    }))
  }
  if (Array.isArray(raw.deleted)) {
    board.deleted = raw.deleted.filter((entry) => entry && typeof entry.sessionId === 'string'
      && typeof entry.key === 'string').slice(-500)
  }
  if (raw.settings && typeof raw.settings === 'object') {
    board.settings = {
      autoSyncTodos: raw.settings.autoSyncTodos !== false,
    }
  }
  return board
}

function makeCard({ title, note = '', column = 'backlog', source, now = Date.now() }) {
  return {
    id: `c_${randomUUID().slice(0, 8)}`,
    title: sanitize(title, '未命名卡片'),
    note: sanitize(note, ''),
    column: COLUMN_IDS.has(column) ? column : 'backlog',
    createdAt: now,
    updatedAt: now,
    ...(source ? { source } : {}),
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
  const sections = board.columns.map((column) => {
    const cards = board.cards.filter((card) => card.column === column.id)
    const lines = cards.map((card) => `  - [${card.id.slice(2)}] ${card.title}`
      + (card.source?.kind === 'todo' ? '（会话同步）' : ''))
    return `${column.title} (${cards.length})${lines.length > 0 ? `\n${lines.join('\n')}` : ''}`
  })
  const total = board.cards.length
  return `看板共 ${total} 张卡片\n${sections.join('\n')}`
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

function syncSessionTodos(board, sessionId, todos, now = Date.now()) {
  const changed = []
  for (const todo of todos) {
    if (!todo || typeof todo.content !== 'string') continue
    const title = sanitize(todo.content, '')
    if (title.length === 0) continue
    const key = contentKey(title)
    if (board.deleted.some((entry) => entry.sessionId === sessionId && entry.key === key)) continue

    const column = STATUS_COLUMN[todo.status] ?? 'backlog'
    const existing = board.cards.find((card) => card.source?.kind === 'todo'
      && card.source.sessionId === sessionId && card.source.key === key)

    if (!existing) {
      const card = makeCard({
        title,
        column,
        now,
        source: { kind: 'todo', sessionId, key },
      })
      card.todoStatus = todo.status
      board.cards.push(card)
      changed.push(card.id)
      continue
    }

    let touched = false
    if (existing.title !== title) {
      existing.title = title
      touched = true
    }
    if (existing.todoStatus !== todo.status) {
      existing.todoStatus = todo.status
      touched = true
    }
    // A column the reader chose by hand wins over later todo status changes.
    if (!existing.pinned && existing.column !== column) {
      placeCard(board, existing, column, Number.MAX_SAFE_INTEGER)
      touched = true
    }
    if (touched) {
      existing.updatedAt = now
      changed.push(existing.id)
    }
  }
  return changed
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

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export function apply(ctx, config = {}) {
  const store = new BoardStore(resolve(config.boardPath ?? join(dshHome(), 'integrations', 'dsh-kanban', 'board.json')))
  let autoSync = config.autoSyncTodos !== false

  // Keep the runtime flag aligned with the persisted setting on first read.
  store.read().then((board) => { autoSync = board.settings.autoSyncTodos !== false })
    .catch(() => {})

  // --- RPC ---------------------------------------------------------------
  const handlers = {
    async 'board.get'() {
      const board = await store.read()
      return { board }
    },
    async 'board.addCard'({ title, note, column }) {
      const { board, result } = await store.update((draft) => {
        const card = makeCard({ title, note, column })
        placeCard(draft, card, card.column, Number.MAX_SAFE_INTEGER)
        return card
      })
      return { board, card: result }
    },
    async 'board.updateCard'({ id, title, note }) {
      const { board } = await store.update((draft) => {
        const card = findCard(draft, { id })
        if (!card) throw new BoardError('card-not-found', `找不到卡片 ${id}`)
        if (typeof title === 'string' && title.trim().length > 0) card.title = sanitize(title, card.title)
        if (typeof note === 'string') card.note = sanitize(note, '')
        card.pinned = true
        card.updatedAt = Date.now()
        return card
      })
      return { board }
    },
    async 'board.moveCard'({ id, column, position }) {
      const { board } = await store.update((draft) => {
        const card = findCard(draft, { id })
        if (!card) throw new BoardError('card-not-found', `找不到卡片 ${id}`)
        if (!COLUMN_IDS.has(column)) throw new BoardError('bad-column', `未知的列 ${column}`)
        placeCard(draft, card, column, position)
        // A hand-moved synced card keeps its column on later todo updates.
        if (card.source?.kind === 'todo') card.pinned = true
        card.updatedAt = Date.now()
        return card
      })
      return { board }
    },
    async 'board.deleteCard'({ id }) {
      const { board } = await store.update((draft) => {
        const card = findCard(draft, { id })
        if (!card) throw new BoardError('card-not-found', `找不到卡片 ${id}`)
        draft.cards = draft.cards.filter((entry) => entry.id !== card.id)
        if (card.source?.kind === 'todo') {
          draft.deleted = [...draft.deleted.slice(-499), {
            sessionId: card.source.sessionId,
            key: card.source.key,
            at: Date.now(),
          }]
        }
        return card
      })
      return { board }
    },
    async 'board.clearColumn'({ column }) {
      if (!COLUMN_IDS.has(column)) throw new BoardError('bad-column', `未知的列 ${column}`)
      const { board } = await store.update((draft) => {
        const removed = draft.cards.filter((card) => card.column === column)
        draft.cards = draft.cards.filter((card) => card.column !== column)
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
      return { board }
    },
    async 'board.setSettings'({ autoSyncTodos }) {
      const { board } = await store.update((draft) => {
        if (typeof autoSyncTodos === 'boolean') {
          draft.settings.autoSyncTodos = autoSyncTodos
          autoSync = autoSyncTodos
        }
        return draft.settings
      })
      return { board }
    },
  }

  const disposeRpc = registerRpc(ctx, handlers)

  // --- Tools -------------------------------------------------------------
  const toolDisposer = ctx.inject(['tools'], (toolCtx) => toolCtx.tools.register(defineKanbanTool({
    name: 'kanban_list',
    description: '列出任务看板上的所有卡片（按列分组，附带卡片 id）。',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    async run() {
      const board = await store.read()
      return { message: summarize(board) }
    },
  })))

  ctx.inject(['tools'], (toolCtx) => toolCtx.tools.register(defineKanbanTool({
    name: 'kanban_add',
    description: '在看板上新建一张卡片。默认放进「待办」列。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['title'],
      properties: {
        title: { type: 'string', required: true, description: '卡片标题，一句简短的话。' },
        note: { type: 'string', description: '可选的补充说明。' },
        column: { ...COLUMN_ENUM, description: 'backlog（待办）| doing（进行中）| done（已完成）' },
      },
    },
    async run(args) {
      const { result: card } = await store.update((draft) => {
        const created = makeCard({
          title: args.title,
          note: args.note,
          column: args.column,
          source: { kind: 'agent' },
        })
        placeCard(draft, created, created.column, Number.MAX_SAFE_INTEGER)
        return created
      })
      return { message: `已添加卡片 [${card.id.slice(2)}]「${card.title}」到 ${columnTitle(card.column)}。` }
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
      },
    },
    async run(args) {
      const { result: card } = await store.update((draft) => {
        const target = findCard(draft, { id: args.id, title: args.title })
        if (!target) throw new BoardError('card-not-found', '找不到这张卡片，先用 kanban_list 看看 id。')
        placeCard(draft, target, args.column, Number.MAX_SAFE_INTEGER)
        if (target.source?.kind === 'todo') target.pinned = true
        target.updatedAt = Date.now()
        return target
      })
      return { message: `已把「${card.title}」移到 ${columnTitle(card.column)}。` }
    },
  })))

  ctx.inject(['tools'], (toolCtx) => toolCtx.tools.register(defineKanbanTool({
    name: 'kanban_update',
    description: '修改卡片的标题或备注。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', description: '卡片 id（支持前缀）。' },
        title: { type: 'string', description: '用于定位卡片的现有标题。' },
        newTitle: { type: 'string', description: '新的标题。' },
        note: { type: 'string', description: '新的备注，传空字符串可清空。' },
      },
    },
    async run(args) {
      const { result: card } = await store.update((draft) => {
        const target = findCard(draft, { id: args.id, title: args.title })
        if (!target) throw new BoardError('card-not-found', '找不到这张卡片，先用 kanban_list 看看 id。')
        if (typeof args.newTitle === 'string' && args.newTitle.trim().length > 0) {
          target.title = sanitize(args.newTitle, target.title)
        }
        if (typeof args.note === 'string') target.note = sanitize(args.note, '')
        target.pinned = true
        target.updatedAt = Date.now()
        return target
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
      },
    },
    async run(args) {
      const { result: card } = await store.update((draft) => {
        const target = findCard(draft, { id: args.id, title: args.title })
        if (!target) throw new BoardError('card-not-found', '找不到这张卡片。')
        draft.cards = draft.cards.filter((entry) => entry.id !== target.id)
        if (target.source?.kind === 'todo') {
          draft.deleted = [...draft.deleted.slice(-499), {
            sessionId: target.source.sessionId,
            key: target.source.key,
            at: Date.now(),
          }]
        }
        return target
      })
      return { message: `已删除卡片「${card.title}」。` }
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
      return { message: `已同步 ${todos.length} 条 todo 到看板。\n${summarize(board)}` }
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

  return () => {
    disposeRpc?.()
    toolDisposer?.()
  }
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
