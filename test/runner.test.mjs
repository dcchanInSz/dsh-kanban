import assert from 'node:assert/strict'
import test from 'node:test'

import { createRunner } from '../src/client/runner.js'

function fakeContext(handler, options = {}) {
  const calls = []
  const ctx = {
    uiWorkspace: { openSession: (id) => calls.push({ kind: 'openSession', id }) },
    workspaces: { list: { getSnapshot: () => ({ items: options.workspaces ?? [{ workspaceId: 'ws-1' }] }) } },
    connection: {
      rpc: {
        async call(channel, endpoint, body) {
          calls.push({ kind: 'rpc', channel, endpoint, args: body.args })
          return handler(endpoint, body.args, calls.filter((entry) => entry.kind === 'rpc').length)
        },
      },
    },
    inject(_deps, callback) {
      callback(ctx)
      return () => {}
    },
  }
  return { ctx, calls }
}

test('执行：参数信封先按 { request } 发，成功就记住', async () => {
  const { ctx, calls } = fakeContext((endpoint, args) => {
    if (endpoint === 'session/create') {
      assert.deepEqual(args, { request: { workspaceId: 'ws-1' } })
      return { ok: true, value: { sessionId: 'session-new' } }
    }
    assert.equal(endpoint, 'session/prompt')
    assert.equal(args.request.sessionId, 'session-new')
    assert.equal(args.request.mode, 'queue')
    assert.deepEqual(args.request.content, [{ type: 'text', text: '干活' }])
    return { ok: true, value: { accepted: true } }
  })

  const runner = createRunner(ctx)
  const sessionId = await runner.run('干活')
  assert.equal(sessionId, 'session-new')

  runner.open(sessionId)
  assert.deepEqual(calls.at(-1), { kind: 'openSession', id: 'session-new' })
})

test('执行：wrapped 被拒（参数形状不符）时自动退回摊平形状', async () => {
  let attempt = 0
  const { ctx } = fakeContext((endpoint, args) => {
    attempt += 1
    if (endpoint === 'session/create') {
      if ('request' in args) {
        return {
          ok: false,
          error: {
            code: 'gateway/bad-request',
            message: 'typert gateway: session/create: args fields do not match the descriptor: missing "request"; unexpected "workspaceId"',
          },
        }
      }
      assert.deepEqual(args, { workspaceId: 'ws-1' })
      return { ok: true, value: { sessionId: 'session-flat' } }
    }
    if ('request' in args) {
      return { ok: false, error: { code: 'gateway/bad-request', message: 'args fields do not match the descriptor: missing "request"' } }
    }
    return { ok: true, value: { accepted: true } }
  })

  const runner = createRunner(ctx)
  const sessionId = await runner.run('干活')
  assert.equal(sessionId, 'session-flat')
  assert.ok(attempt >= 4, '两个端点都先试了 wrapped')
})

test('执行：非形状错误会直接抛出，不做无意义的第二次尝试', async () => {
  let attempts = 0
  const { ctx } = fakeContext(() => {
    attempts += 1
    return { ok: false, error: { code: 'workspace/not-found', message: 'workspace "ws-1" not found' } }
  })

  const runner = createRunner(ctx)
  await assert.rejects(() => runner.run('干活'), /not found/)
  assert.equal(attempts, 1)
})

test('执行：没有 workspace 时用宿主默认目录', async () => {
  const { ctx } = fakeContext((endpoint, args) => {
    if (endpoint === 'session/create') {
      assert.deepEqual(args, { request: {} })
      return { ok: true, value: { sessionId: 'session-default' } }
    }
    return { ok: true, value: { accepted: true } }
  }, { workspaces: [] })

  const runner = createRunner(ctx)
  assert.equal(await runner.run('干活'), 'session-default')
})
