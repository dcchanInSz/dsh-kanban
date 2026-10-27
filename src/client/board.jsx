/**
 * The board itself: three columns, draggable cards, prompts and one-click runs.
 */

import * as React from 'react'

const { useCallback, useEffect, useMemo, useRef, useState } = React

const POLL_MS = 3000
const DELETE_ARM_MS = 2600

function relativeTime(timestamp) {
  if (!Number.isFinite(timestamp)) return ''
  const delta = Date.now() - timestamp
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  return `${Math.floor(delta / 86_400_000)} 天前`
}

function DropLine() {
  return <div className="dkb-drop-line" />
}

function PromptEditor({ value, onSave, onCancel }) {
  const [text, setText] = useState(value ?? '')
  const input = useRef(null)

  useEffect(() => { input.current?.focus() }, [])

  return (
    <div className="dkb-prompt-editor" onClick={(event) => event.stopPropagation()}>
      <textarea
        ref={input}
        value={text}
        placeholder="写给 agent 的提示词；留空则清除"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            onSave(text)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      />
      <div className="dkb-composer-actions">
        <button type="button" className="dkb-btn" onClick={onCancel}>取消</button>
        <button type="button" className="dkb-btn primary" onClick={() => onSave(text)}>保存</button>
      </div>
    </div>
  )
}

function Composer({ onSubmit, onCancel }) {
  const [text, setText] = useState('')
  const [prompt, setPrompt] = useState('')
  const [showPrompt, setShowPrompt] = useState(false)
  const input = useRef(null)

  useEffect(() => { input.current?.focus() }, [])

  const submit = async () => {
    if (text.trim().length === 0) return
    const ok = await onSubmit(text, prompt)
    if (ok) {
      setText('')
      setPrompt('')
      setShowPrompt(false)
    }
  }

  return (
    <div className="dkb-composer">
      <textarea
        ref={input}
        value={text}
        placeholder="第一行是标题，换行后是备注（⌘↩ 添加）"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            submit()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
      />
      {showPrompt
        ? (
          <textarea
            className="dkb-prompt-input"
            value={prompt}
            placeholder="提示词（可选）：点「执行」时把这段原文发进一个新会话"
            onChange={(event) => setPrompt(event.target.value)}
          />
        )
        : (
          <button type="button" className="dkb-linkbtn" onClick={() => setShowPrompt(true)}>
            ＋ 添加提示词
          </button>
        )}
      <div className="dkb-composer-actions">
        <button type="button" className="dkb-btn" onClick={onCancel}>取消</button>
        <button type="button" className="dkb-btn primary" onClick={submit}>添加</button>
      </div>
    </div>
  )
}

function Card({
  card, dragging, editing, editingPrompt, armed, running,
  onDragStart, onDragEnd, onStartEdit, onCommitEdit, onCancelEdit,
  onStartPrompt, onSavePrompt, onCancelPrompt, onArmDelete, onDelete,
  onRun, onOpenSession,
}) {
  const [draft, setDraft] = useState(card.title)

  useEffect(() => { setDraft(card.title) }, [card.title, editing])

  const badge = card.source?.kind === 'todo'
    ? <span className="dkb-badge todo">会话同步</span>
    : card.source?.kind === 'agent'
      ? <span className="dkb-badge agent">agent</span>
      : null

  const classes = ['dkb-card', dragging && 'is-dragging', card.column === 'done' && 'is-done', running && 'is-running']
    .filter(Boolean).join(' ')

  return (
    <article
      data-card-id={card.id}
      className={classes}
      draggable={!editing && !editingPrompt}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDoubleClick={(event) => { if (!editing && !editingPrompt) { event.preventDefault(); onStartEdit() } }}
    >
      {editing
        ? (
          <input
            className="dkb-card-title-input"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => onCommitEdit(draft)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); onCommitEdit(draft) } else if (event.key === 'Escape') { event.preventDefault(); onCancelEdit() }
            }}
          />
        )
        : <div className="dkb-card-title">{card.title}</div>}

      {card.note ? <div className="dkb-note">{card.note}</div> : null}

      {editingPrompt
        ? <PromptEditor value={card.prompt} onSave={onSavePrompt} onCancel={onCancelPrompt} />
        : card.prompt
          ? (
            <button
              type="button"
              className="dkb-prompt"
              title="点击编辑提示词"
              onClick={(event) => { event.stopPropagation(); onStartPrompt() }}
            >
              <span className="dkb-prompt-mark">✨</span>
              <span className="dkb-prompt-text">{card.prompt}</span>
            </button>
          )
          : null}

      <div className="dkb-meta">
        {badge}
        <span>{relativeTime(card.updatedAt)}</span>
        <span className="dkb-spacer" />
        {running ? <span className="dkb-running">启动中…</span> : null}
        {!running && card.prompt
          ? (
            <button
              type="button"
              className="dkb-run"
              title="在新会话里用这条提示词执行"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); onRun() }}
            >
              ▶ 执行
            </button>
          )
          : null}
        {!running && card.lastRun?.sessionId
          ? (
            <button
              type="button"
              className="dkb-linkbtn"
              title="打开上次执行这个任务的会话"
              onClick={(event) => { event.stopPropagation(); onOpenSession(card.lastRun.sessionId) }}
            >
              打开会话
            </button>
          )
          : null}
        {!card.prompt && !editingPrompt
          ? (
            <button
              type="button"
              className="dkb-linkbtn dkb-addprompt"
              title="给这张卡片加一条提示词"
              onClick={(event) => { event.stopPropagation(); onStartPrompt() }}
            >
              ＋提示词
            </button>
          )
          : null}
        <button
          type="button"
          className={'dkb-del' + (armed ? ' is-armed' : '')}
          title="删除卡片"
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            if (armed) onDelete()
            else onArmDelete()
          }}
        >
          {armed ? '确认删除' : '×'}
        </button>
      </div>
    </article>
  )
}

export function KanbanPanel({ api, runner }) {
  const [board, setBoard] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [dropHint, setDropHint] = useState(null)
  const [composerColumn, setComposerColumn] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [promptId, setPromptId] = useState(null)
  const [armedId, setArmedId] = useState(null)
  const [runningId, setRunningId] = useState(null)

  const dragIdRef = useRef(null)
  dragIdRef.current = dragId
  const dropHintRef = useRef(null)
  dropHintRef.current = dropHint

  const load = useCallback(async (signal) => {
    try {
      const value = await api.get(signal)
      setBoard(value.board)
      setError(null)
    } catch (cause) {
      if (!signal?.aborted) setError(cause?.message ?? String(cause))
    }
  }, [api])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal)
    return () => controller.abort()
  }, [load])

  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) load()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  useEffect(() => {
    if (armedId == null) return undefined
    const timer = setTimeout(() => setArmedId(null), DELETE_ARM_MS)
    return () => clearTimeout(timer)
  }, [armedId])

  const run = useCallback(async (operation) => {
    setBusy(true)
    try {
      const value = await operation()
      if (value?.board) setBoard(value.board)
      setError(null)
      return value
    } catch (cause) {
      setError(cause?.message ?? String(cause))
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  const columns = board?.columns ?? []
  const cardsByColumn = useMemo(() => {
    const map = new Map()
    for (const column of columns) map.set(column.id, [])
    for (const card of board?.cards ?? []) {
      if (!map.has(card.column)) map.set(card.column, [])
      map.get(card.column).push(card)
    }
    return map
  }, [board, columns])

  const total = board?.cards?.length ?? 0
  const synced = board?.cards?.filter((card) => card.source?.kind === 'todo').length ?? 0
  const withPrompt = board?.cards?.filter((card) => typeof card.prompt === 'string' && card.prompt.length > 0).length ?? 0

  const moveCard = (id, column, position) =>
    run(() => api.moveCard({ id, column, position }))

  const addCard = async (column, text, prompt) => {
    const [firstLine, ...rest] = text.split('\n')
    const title = firstLine.trim()
    if (title.length === 0) return false
    const note = rest.join('\n').trim()
    const value = await run(() => api.addCard({ title, note, column, prompt }))
    if (value) setComposerColumn(null)
    return Boolean(value)
  }

  const renameCard = async (id, title) => {
    const trimmed = title.trim()
    setEditingId(null)
    if (trimmed.length === 0) return
    await run(() => api.updateCard({ id, title: trimmed }))
  }

  const savePrompt = async (id, prompt) => {
    setPromptId(null)
    await run(() => api.setPrompt({ id, prompt }))
  }

  const deleteCard = async (id) => {
    setArmedId(null)
    await run(() => api.deleteCard({ id }))
  }

  const executeCard = async (card) => {
    if (!card.prompt || runningId) return
    setRunningId(card.id)
    setError(null)
    try {
      const sessionId = await runner.run(card.prompt)
      const value = await api.markRun({ id: card.id, sessionId })
      if (value?.board) setBoard(value.board)
      runner.open(sessionId)
    } catch (cause) {
      setError(`执行失败：${cause?.message ?? String(cause)}`)
    } finally {
      setRunningId(null)
    }
  }

  const computeDropIndex = (event, body) => {
    const nodes = [...body.querySelectorAll('[data-card-id]')]
      .filter((node) => node.dataset.cardId !== dragIdRef.current)
    let index = nodes.length
    for (let i = 0; i < nodes.length; i += 1) {
      const rect = nodes[i].getBoundingClientRect()
      if (event.clientY < rect.top + rect.height / 2) {
        index = i
        break
      }
    }
    return index
  }

  if (!board && !error) {
    return <div className="dkb-root"><div className="dkb-loading">正在加载看板…</div></div>
  }

  return (
    <div className="dkb-root">
      <div className="dkb-header">
        <div className="dkb-heading">
          <div className="dkb-title">任务看板</div>
          <div className="dkb-sub">
            {total === 0
              ? '还没有卡片'
              : `${total} 张卡片${synced > 0 ? ` · ${synced} 张来自会话` : ''}${withPrompt > 0 ? ` · ${withPrompt} 张有提示词` : ''}`}
          </div>
        </div>
        <div className="dkb-spacer" />
        <label className="dkb-switch" title="开启后，会话里的 todo 会自动同步成卡片">
          <input
            type="checkbox"
            checked={board?.settings?.autoSyncTodos !== false}
            disabled={busy || !board}
            onChange={(event) => run(() => api.setSettings({ autoSyncTodos: event.target.checked }))}
          />
          同步会话 todo
        </label>
        <button type="button" className="dkb-iconbtn" title="刷新" disabled={busy} onClick={() => load()}>⟳</button>
      </div>

      {error ? <div className="dkb-banner">{error}</div> : null}

      <div className="dkb-board">
        {columns.map((column) => {
          const cards = cardsByColumn.get(column.id) ?? []
          const hint = dropHint && dropHint.columnId === column.id ? dropHint.index : null
          const children = []

          cards.forEach((card, index) => {
            if (hint === index) children.push(<DropLine key={`line-${card.id}`} />)
            children.push(
              <Card
                key={card.id}
                card={card}
                dragging={dragId === card.id}
                editing={editingId === card.id}
                editingPrompt={promptId === card.id}
                armed={armedId === card.id}
                running={runningId === card.id}
                onDragStart={(event) => {
                  setDragId(card.id)
                  event.dataTransfer.effectAllowed = 'move'
                  try { event.dataTransfer.setData('text/plain', card.id) } catch { /* ignore */ }
                }}
                onDragEnd={() => { setDragId(null); setDropHint(null) }}
                onStartEdit={() => setEditingId(card.id)}
                onCommitEdit={(title) => renameCard(card.id, title)}
                onCancelEdit={() => setEditingId(null)}
                onStartPrompt={() => setPromptId(card.id)}
                onSavePrompt={(prompt) => savePrompt(card.id, prompt)}
                onCancelPrompt={() => setPromptId(null)}
                onArmDelete={() => setArmedId(card.id)}
                onDelete={() => deleteCard(card.id)}
                onRun={() => executeCard(card)}
                onOpenSession={(sessionId) => runner.open(sessionId)}
              />,
            )
          })

          if (hint === cards.length) children.push(<DropLine key="line-end" />)
          if (cards.length === 0 && composerColumn !== column.id) {
            children.push(<div key="empty" className="dkb-empty">空</div>)
          }
          if (composerColumn === column.id) {
            children.push(
              <Composer
                key="composer"
                onSubmit={(text, prompt) => addCard(column.id, text, prompt)}
                onCancel={() => setComposerColumn(null)}
              />,
            )
          } else {
            children.push(
              <button key="add" type="button" className="dkb-add" onClick={() => setComposerColumn(column.id)}>
                ＋ 添加卡片
              </button>,
            )
          }

          return (
            <section key={column.id} className={'dkb-column' + (hint !== null ? ' is-target' : '')}>
              <div className="dkb-column-head">
                <span className="dkb-dot" />
                <span className="dkb-column-title">{column.title}</span>
                <span className="dkb-count">{cards.length}</span>
                <div className="dkb-spacer" />
                {column.id === 'done' && cards.length > 0
                  ? (
                    <button
                      type="button"
                      className="dkb-iconbtn dkb-textbtn"
                      title="删除「已完成」里的全部卡片"
                      disabled={busy}
                      onClick={() => run(() => api.clearColumn(column.id))}
                    >
                      清空
                    </button>
                  )
                  : null}
              </div>
              <div
                className="dkb-column-body"
                onDragOver={(event) => {
                  if (!dragIdRef.current) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'move'
                  setDropHint({ columnId: column.id, index: computeDropIndex(event, event.currentTarget) })
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const id = dragIdRef.current
                  const info = dropHintRef.current
                  setDragId(null)
                  setDropHint(null)
                  if (id && info && info.columnId === column.id) moveCard(id, column.id, info.index)
                }}
              >
                {children}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
