import assert from 'node:assert/strict'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { apply } from '../lib/index.js'

function fakeContext() {
  const state = { rpc: null, tools: [], listeners: new Map() }
  const ctx = {
    connection: { fetch: { register(spec) { state.rpc = spec; return () => { state.rpc = null } } } },
    inject(_deps, callback) { return callback(ctx) },
    tools: { register(definition) { state.tools.push(definition); return () => {} } },
    on(event, handler) { state.listeners.set(event, handler); return () => state.listeners.delete(event) },
    effect(effect) { return effect() },
    get() { return undefined },
  }
  return { ctx, state }
}

async function call(rpc, method, payload = {}) {
  const request = new Request('http://localhost/api/dsh-kanban', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: 'req-1', method: 'dsh-kanban', payload: { method, payload } }),
  })
  const response = await rpc.fetch(request)
  assert.equal(response.status, 200)
  const message = await response.json()
  assert.equal(message.type, 'server-response')
  assert.equal(message.rpcId, 'req-1')
  return message.result
}

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-kanban-test-'))
  process.env.DSH_HOME = home
  const { ctx, state } = fakeContext()
  const dispose = apply(ctx, { autoSyncTodos: true })
  assert.ok(state.rpc, 'RPC handler registered')
  return { home, state, dispose }
}

test('把看板读写、工具和 todo 同步都走一遍', async (t) => {
  const { home, state, dispose } = await setup()
  t.after(async () => { dispose?.(); await rm(home, { recursive: true, force: true }) })

  await t.test('初始看板是三列空板', async () => {
    const result = await call(state.rpc, 'board.get')
    assert.equal(result.ok, true)
    assert.deepEqual(result.value.board.columns.map((column) => column.id), ['backlog', 'doing', 'done'])
    assert.equal(result.value.board.cards.length, 0)
  })

  let cardId
  await t.test('新建卡片 → 落盘', async () => {
    const result = await call(state.rpc, 'board.addCard', { title: '写文档', note: 'README' })
    assert.equal(result.ok, true)
    cardId = result.value.card.id
    assert.equal(result.value.board.cards.length, 1)

    const raw = JSON.parse(await readFile(join(home, 'integrations', 'dsh-kanban', 'board.json'), 'utf8'))
    assert.equal(raw.cards[0].title, '写文档')
    assert.equal(raw.cards[0].note, 'README')
  })

  await t.test('移动到进行中并改标题', async () => {
    const moved = await call(state.rpc, 'board.moveCard', { id: cardId, column: 'doing' })
    assert.equal(moved.ok, true)
    assert.equal(moved.value.board.cards.find((card) => card.id === cardId).column, 'doing')

    const renamed = await call(state.rpc, 'board.updateCard', { id: cardId, title: '写 README' })
    assert.equal(renamed.value.board.cards.find((card) => card.id === cardId).title, '写 README')
  })

  await t.test('未知卡片返回结构化错误', async () => {
    const result = await call(state.rpc, 'board.moveCard', { id: 'c_missing', column: 'done' })
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'kanban/card-not-found')
  })

  await t.test('坏请求被拒', async () => {
    const request = new Request('http://localhost/api/dsh-kanban', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: 'x', method: 'dsh-kanban', payload: { method: 'nope', payload: {} } }),
    })
    const message = await (await state.rpc.fetch(request)).json()
    assert.equal(message.result.ok, false)
    assert.equal(message.result.error.code, 'kanban/unknown-method')
  })

  await t.test('会话 todo 自动变成卡片，并随状态移动', async () => {
    const handler = state.listeners.get('session/event')
    assert.equal(typeof handler, 'function')

    handler({ id: 'session-1' }, {
      type: 'todo/write',
      data: {
        todos: [
          { content: '拆解需求', status: 'pending' },
          { content: '画原型', status: 'in_progress' },
        ],
      },
    })

    await new Promise((resolve) => setTimeout(resolve, 120))
    let board = (await call(state.rpc, 'board.get')).value.board
    const synced = board.cards.filter((card) => card.source?.kind === 'todo')
    assert.equal(synced.length, 2)
    assert.equal(synced.find((card) => card.title === '拆解需求').column, 'backlog')
    assert.equal(synced.find((card) => card.title === '画原型').column, 'doing')

    // Same content, new status: the card follows the todo.
    handler({ id: 'session-1' }, {
      type: 'todo/write',
      data: {
        todos: [
          { content: '拆解需求', status: 'completed' },
          { content: '画原型', status: 'in_progress' },
        ],
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 120))
    board = (await call(state.rpc, 'board.get')).value.board
    assert.equal(board.cards.find((card) => card.title === '拆解需求').column, 'done')
    assert.equal(board.cards.filter((card) => card.title === '拆解需求').length, 1, '不会重复建卡')
  })

  await t.test('手动移过的同步卡片不会被 todo 状态改回去', async () => {
    const handler = state.listeners.get('session/event')
    let board = (await call(state.rpc, 'board.get')).value.board
    const card = board.cards.find((entry) => entry.title === '画原型')
    await call(state.rpc, 'board.moveCard', { id: card.id, column: 'done' })

    handler({ id: 'session-1' }, {
      type: 'todo/write',
      data: { todos: [{ content: '画原型', status: 'in_progress' }] },
    })
    await new Promise((resolve) => setTimeout(resolve, 120))
    board = (await call(state.rpc, 'board.get')).value.board
    assert.equal(board.cards.find((entry) => entry.title === '画原型').column, 'done')
  })

  await t.test('删除同步卡片后不会被重新创建', async () => {
    const handler = state.listeners.get('session/event')
    let board = (await call(state.rpc, 'board.get')).value.board
    const card = board.cards.find((entry) => entry.title === '画原型')
    await call(state.rpc, 'board.deleteCard', { id: card.id })

    handler({ id: 'session-1' }, {
      type: 'todo/write',
      data: { todos: [{ content: '画原型', status: 'in_progress' }] },
    })
    await new Promise((resolve) => setTimeout(resolve, 120))
    board = (await call(state.rpc, 'board.get')).value.board
    assert.equal(board.cards.some((entry) => entry.title === '画原型'), false)
  })

  await t.test('关闭同步开关后不再自动建卡', async () => {
    await call(state.rpc, 'board.setSettings', { autoSyncTodos: false })
    const handler = state.listeners.get('session/event')
    handler({ id: 'session-2' }, {
      type: 'todo/write',
      data: { todos: [{ content: '不该出现', status: 'pending' }] },
    })
    await new Promise((resolve) => setTimeout(resolve, 120))
    const board = (await call(state.rpc, 'board.get')).value.board
    assert.equal(board.cards.some((entry) => entry.title === '不该出现'), false)
  })

  await t.test('卡片可以带提示词', async () => {
    const created = await call(state.rpc, 'board.addCard', {
      title: '带提示词的任务',
      prompt: '  把 README 的安装章节重写一遍  ',
    })
    assert.equal(created.ok, true)
    const card = created.value.card
    assert.equal(card.prompt, '把 README 的安装章节重写一遍', '提示词会被 trim')

    const cleared = await call(state.rpc, 'board.setPrompt', { id: card.id, prompt: '   ' })
    assert.equal(cleared.value.board.cards.find((entry) => entry.id === card.id).prompt, undefined, '空白提示词会被清掉')

    const rewritten = await call(state.rpc, 'board.setPrompt', { id: card.id, prompt: '凌晨两点跑步' })
    assert.equal(rewritten.value.board.cards.find((entry) => entry.id === card.id).prompt, '凌晨两点跑步')
  })

  await t.test('记录执行：写入会话 id 并移到进行中', async () => {
    const created = await call(state.rpc, 'board.addCard', { title: '要跑的任务', prompt: '跑一下' })
    const id = created.value.card.id

    const ran = await call(state.rpc, 'board.markRun', { id, sessionId: 'session-abc' })
    assert.equal(ran.ok, true)
    const card = ran.value.board.cards.find((entry) => entry.id === id)
    assert.equal(card.column, 'doing', '执行后进「进行中」')
    assert.deepEqual(card.lastRun && { sessionId: card.lastRun.sessionId }, { sessionId: 'session-abc' })
    assert.equal(card.pinned, true, '手动执行过的卡片不再被 todo 同步改列')

    const missing = await call(state.rpc, 'board.markRun', { id, sessionId: '' })
    assert.equal(missing.ok, false)
    assert.equal(missing.error.code, 'kanban/bad-session')
  })

  await t.test('提示词和执行记录能落盘再读回来', async () => {
    const board = (await call(state.rpc, 'board.get')).value.board
    const ran = board.cards.find((card) => card.lastRun?.sessionId === 'session-abc')
    assert.ok(ran)

    const raw = JSON.parse(await readFile(join(home, 'integrations', 'dsh-kanban', 'board.json'), 'utf8'))
    const stored = raw.cards.find((card) => card.id === ran.id)
    assert.equal(stored.prompt, '跑一下')
    assert.equal(stored.lastRun.sessionId, 'session-abc')
  })

  await t.test('agent 工具注册齐全且可用', async () => {
    const names = state.tools.map((tool) => tool.name).sort()
    assert.deepEqual(names, ['kanban_add', 'kanban_delete', 'kanban_list', 'kanban_move', 'kanban_sync_todos', 'kanban_update'])

    for (const tool of state.tools) {
      assert.equal(typeof tool.execute, 'function')
      assert.equal(typeof tool.output.render, 'function')
      assert.equal(tool.parameters.type, 'object')
    }

    const add = state.tools.find((tool) => tool.name === 'kanban_add')
    const added = await add.execute({ title: '来自 agent 的卡片', prompt: '顺便跑个测试' }, {})
    assert.equal(added.ok, true)
    assert.match(added.message, /已添加卡片/)

    const list = state.tools.find((tool) => tool.name === 'kanban_list')
    const listed = await list.execute({}, {})
    assert.match(listed.message, /来自 agent 的卡片/)
    assert.match(listed.message, /✨有提示词/)

    const move = state.tools.find((tool) => tool.name === 'kanban_move')
    const moved = await move.execute({ title: '来自 agent 的卡片', column: 'done' }, {})
    assert.match(moved.message, /已完成/)
  })
})
