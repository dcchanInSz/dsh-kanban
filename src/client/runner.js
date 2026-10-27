/**
 * 「执行」一张带提示词的卡片：新开一个会话，把提示词作为用户消息发进去，
 * 然后让宿主跳到那个会话。
 *
 * 用的是 Gateway Remote（公开面）：
 *   POST /api/session/create  → { sessionId }
 *   POST /api/session/prompt
 *   ctx.uiWorkspace.openSession(id)
 *
 * 参数信封：typert 的 descriptor 把这些方法的唯一参数命名为 `request`，
 * 所以正常形状是 `args = { request: <payload> }`；个别版本把它摊平。两个都试，
 * 成功后记住该端点用哪种。
 */

const WRAPPED = 'wrapped'
const FLAT = 'flat'

function isShapeMismatch(message) {
  return /args fields do not match|unexpected "|missing "/.test(String(message ?? ''))
}

export function createRunner(ctx) {
  let uiWorkspace
  let workspaces
  /** 每个插件实例各自记住端点用哪种参数信封。 */
  const shapeMemory = new Map()

  ctx.inject?.(['uiWorkspace'], (scope) => { uiWorkspace = scope.uiWorkspace })
  ctx.inject?.(['workspaces'], (scope) => { workspaces = scope.workspaces })

  async function invoke(endpoint, payload) {
    const remembered = shapeMemory.get(endpoint)
    const attempts = remembered === FLAT
      ? [{ shape: FLAT, args: payload }, { shape: WRAPPED, args: { request: payload } }]
      : [{ shape: WRAPPED, args: { request: payload } }, { shape: FLAT, args: payload }]

    let failure
    for (const attempt of attempts) {
      let result
      try {
        result = await ctx.connection.rpc.call('/api', endpoint, { args: attempt.args })
      } catch (cause) {
        throw new Error(`调用 ${endpoint} 失败：${cause?.message ?? cause}`, { cause })
      }
      if (result?.ok === true) {
        shapeMemory.set(endpoint, attempt.shape)
        return result.value
      }
      failure = result?.error
      if (!isShapeMismatch(failure?.message)) break
    }
    throw new Error(failure?.message ?? `${endpoint} 返回了失败结果`)
  }

  /** New sessions need a workspace; fall back to the host default. */
  function pickWorkspaceId() {
    try {
      const snapshot = workspaces?.list?.getSnapshot?.()
      const items = snapshot?.items ?? []
      return items.find((item) => item && typeof item.workspaceId === 'string')?.workspaceId
    } catch {
      return undefined
    }
  }

  return {
    canOpenSession: () => typeof uiWorkspace?.openSession === 'function',

    async run(prompt) {
      const workspaceId = pickWorkspaceId()
      const created = await invoke('session/create', workspaceId === undefined ? {} : { workspaceId })
      const sessionId = created?.sessionId
      if (typeof sessionId !== 'string' || sessionId.length === 0) {
        throw new Error('会话创建成功但没有拿到 sessionId')
      }

      await invoke('session/prompt', {
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
