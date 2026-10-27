/**
 * 「执行」一张带提示词的卡片：新开一个会话，把提示词作为用户消息发进去，
 * 然后让宿主跳到那个会话。
 *
 * 用的都是公开面（Gateway Remote，端点是 `<namespace>/<method>`，参数包在 args 里）：
 *   POST /api/session/create  { args: { workspaceId? } } → { sessionId }
 *   POST /api/session/prompt  { args: { sessionId, requestId, mode, content, clientTimeZone } }
 *   ctx.uiWorkspace.openSession(id)
 */

export function createRunner(ctx) {
  let uiWorkspace
  let workspaces

  ctx.inject?.(['uiWorkspace'], (scope) => { uiWorkspace = scope.uiWorkspace })
  ctx.inject?.(['workspaces'], (scope) => { workspaces = scope.workspaces })

  async function call(endpoint, args) {
    let result
    try {
      result = await ctx.connection.rpc.call('/api', endpoint, { args })
    } catch (cause) {
      throw new Error(`调用 ${endpoint} 失败，检查一下 DSH 连接。`, { cause })
    }
    if (!result || result.ok !== true) {
      throw new Error(result?.error?.message ?? `${endpoint} 返回了失败结果`)
    }
    return result.value
  }

  /** New sessions need a workspace; fall back to the host default. */
  function pickWorkspaceId() {
    try {
      const snapshot = workspaces?.list?.getSnapshot?.()
      const items = snapshot?.items ?? []
      const usable = items.find((item) => item && typeof item.workspaceId === 'string')
      return usable?.workspaceId
    } catch {
      return undefined
    }
  }

  return {
    canOpenSession: () => typeof uiWorkspace?.openSession === 'function',

    async run(prompt) {
      const workspaceId = pickWorkspaceId()
      const created = workspaceId === undefined
        ? await call('session/create', {})
        : await call('session/create', { workspaceId })
      const sessionId = created?.sessionId
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new Error('会话创建成功但没有拿到 sessionId')
      }

      await call('session/prompt', {
        requestId: crypto.randomUUID(),
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: prompt }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      return sessionId
    },

    open(sessionId) {
      uiWorkspace?.openSession?.(sessionId)
    },
  }
}
