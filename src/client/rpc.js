/**
 * RPC client for the host half. Mirrors DSH's `/api` JSON-RPC envelope.
 */

const ENDPOINT = 'dsh-kanban'

export function createApi(connection) {
  async function call(method, payload = {}, signal) {
    let result
    try {
      result = await connection.rpc.call('/api', ENDPOINT, { method, payload }, signal)
    } catch (cause) {
      if (signal?.aborted) throw cause
      throw new Error('连不上看板服务，请确认 dsh-kanban 插件已启用并重新加载页面。', { cause })
    }
    if (!result || result.ok !== true) {
      throw new Error(result?.error?.message ?? '看板接口返回了失败结果')
    }
    return result.value
  }

  return {
    get: (signal) => call('board.get', {}, signal),
    addCard: (input) => call('board.addCard', input),
    updateCard: (input) => call('board.updateCard', input),
    setPrompt: (input) => call('board.setPrompt', input),
    markRun: (input) => call('board.markRun', input),
    moveCard: (input) => call('board.moveCard', input),
    deleteCard: (input) => call('board.deleteCard', input),
    clearColumn: (column) => call('board.clearColumn', { column }),
    setSettings: (settings) => call('board.setSettings', settings),
    selectBoard: (id) => call('boards.select', { id }),
    createBoard: (name) => call('boards.create', { name }),
    renameBoard: (input) => call('boards.rename', input),
    deleteBoard: (id) => call('boards.delete', { id }),
  }
}
