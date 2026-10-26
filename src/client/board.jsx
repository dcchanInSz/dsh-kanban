/**
 * The board itself: three columns, draggable cards, inline editing.
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

function Composer({ onSubmit, onCancel }) {
  const [text, setText] = useState('')
  const input = useRef(null)

  useEffect(() => { input.current?.focus() }, [])

  const submit = async () => {
    if (text.trim().length === 0) return
    const ok = await onSubmit(text)
    if (ok) setText('')
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
      <div className="dkb-composer-actions">
        <button type="button" className="dkb-btn" onClick={onCancel}>取消</button>
        <button type="button" className="dkb-btn primary" onClick={submit}>添加</button>
      </div>
    </div>
  )
}

function Card({ card, dragging, editing, armed, onDragStart, onDragEnd, onStartEdit, onCommitEdit, onCancelEdit, onArmDelete, onDelete }) {
  const [draft, setDraft] = useState(card.title)

  useEffect(() => { setDraft(card.title) }, [card.title, editing])

  const badge = card.source?.kind === 'todo'
    ? <span className="dkb-badge todo">会话同步</span>
    : card.source?.kind === 'agent'
      ? <span className="dkb-badge agent">agent</span>
      : null

  const classes = ['dkb-card', dragging && 'is-dragging', card.column === 'done' && 'is-done']
    .filter(Boolean).join(' ')

  return (
    <article
      data-card-id={card.id}
      className={classes}
      draggable={!editing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDoubleClick={(event) => { if (!editing) { event.preventDefault(); onStartEdit() } }}
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

      <div className="dkb-meta">
        {badge}
        <span>{relativeTime(card.updatedAt)}</span>
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

export function KanbanPanel({ api }) {
  const [board, setBoard] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [dragId, setDragId] = useState(null)
  const [dropHint, setDropHint] = useState(null)
  const [composerColumn, setComposerColumn] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [armedId, setArmedId] = useState(null)

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

  const moveCard = (id, column, position) =>
    run(() => api.moveCard({ id, column, position }))

  const addCard = async (column, text) => {
    const [firstLine, ...rest] = text.split('\n')
    const title = firstLine.trim()
    if (title.length === 0) return false
    const note = rest.join('\n').trim()
    const value = await run(() => api.addCard({ title, note, column }))
    if (value) setComposerColumn(null)
    return Boolean(value)
  }

  const renameCard = async (id, title) => {
    const trimmed = title.trim()
    setEditingId(null)
    if (trimmed.length === 0) return
    await run(() => api.updateCard({ id, title: trimmed }))
  }

  const deleteCard = async (id) => {
    setArmedId(null)
    await run(() => api.deleteCard({ id }))
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
              : `${total} 张卡片${synced > 0 ? ` · ${synced} 张来自会话` : ''}`}
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
                armed={armedId === card.id}
                onDragStart={(event) => {
                  setDragId(card.id)
                  event.dataTransfer.effectAllowed = 'move'
                  try { event.dataTransfer.setData('text/plain', card.id) } catch { /* ignore */ }
                }}
                onDragEnd={() => { setDragId(null); setDropHint(null) }}
                onStartEdit={() => setEditingId(card.id)}
                onCommitEdit={(title) => renameCard(card.id, title)}
                onCancelEdit={() => setEditingId(null)}
                onArmDelete={() => setArmedId(card.id)}
                onDelete={() => deleteCard(card.id)}
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
                onSubmit={(text) => addCard(column.id, text)}
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
