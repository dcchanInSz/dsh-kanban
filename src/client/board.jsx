/**
 * The board itself: columns, draggable cards, prompts, runs,
 * multiple boards and a session filter.
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

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

function Menu({ label, title, children, width = 230, align = 'end' }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      if (!wrap.current?.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="dkb-menuwrap" ref={wrap}>
      <button
        type="button"
        className={'dkb-menubtn' + (open ? ' is-open' : '')}
        title={title}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="dkb-menubtn-label">{label}</span>
        <span className="dkb-caret">▾</span>
      </button>
      {open ? (
        <div
          className="dkb-menu"
          style={{ width, [align === 'end' ? 'right' : 'left']: 0 }}
        >
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      ) : null}
    </div>
  )
}

function MenuItem({ onClick, active, danger, children }) {
  return (
    <button
      type="button"
      className={'dkb-menuitem' + (active ? ' is-active' : '') + (danger ? ' is-danger' : '')}
      onClick={(event) => { event.stopPropagation(); onClick?.() }}
    >
      <span className="dkb-menuitem-check">{active ? '✓' : ''}</span>
      <span className="dkb-menuitem-label">{children}</span>
    </button>
  )
}

function InlineInput({ initial = '', placeholder, onSubmit, onCancel }) {
  const [value, setValue] = useState(initial)
  const input = useRef(null)

  useEffect(() => { input.current?.focus(); input.current?.select() }, [])

  const submit = () => {
    const text = value.trim()
    if (text.length > 0) onSubmit(text)
    else onCancel()
  }

  return (
    <div className="dkb-menuform" onClick={(event) => event.stopPropagation()}>
      <input
        ref={input}
        value={value}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') { event.preventDefault(); submit() } else if (event.key === 'Escape') { event.preventDefault(); onCancel() }
        }}
      />
      <button type="button" className="dkb-btn primary" onClick={submit}>确定</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

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
              {card.lastRun.finishedAt ? '已完成 · 打开会话' : '打开会话'}
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

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export function KanbanPanel({ api, runner, sessionTitle = (id) => id.slice(0, 8) }) {
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
  const [sessionFilter, setSessionFilter] = useState('all')
  const [boardForm, setBoardForm] = useState(null) // 'create' | 'rename'
  const [deleteArmed, setDeleteArmed] = useState(false)

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
  const boards = board?.boards ?? []

  const sessionOptions = useMemo(() => {
    const counts = new Map()
    for (const card of board?.cards ?? []) {
      for (const id of [card.source?.sessionId, card.lastRun?.sessionId]) {
        if (typeof id === 'string' && id.length > 0) counts.set(id, (counts.get(id) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1])
  }, [board])

  const matchesFilter = useCallback((card) => {
    if (sessionFilter === 'all') return true
    return card.source?.sessionId === sessionFilter || card.lastRun?.sessionId === sessionFilter
  }, [sessionFilter])

  const cardsByColumn = useMemo(() => {
    const map = new Map()
    for (const column of columns) map.set(column.id, [])
    for (const card of board?.cards ?? []) {
      if (!matchesFilter(card)) continue
      if (!map.has(card.column)) map.set(card.column, [])
      map.get(card.column).push(card)
    }
    return map
  }, [board, columns, matchesFilter])

  const total = (board?.cards ?? []).filter(matchesFilter).length
  const allCards = board?.cards?.length ?? 0
  const withPrompt = (board?.cards ?? []).filter((card) => typeof card.prompt === 'string' && card.prompt.length > 0).length

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

  const switchBoard = async (id) => {
    setSessionFilter('all')
    setComposerColumn(null)
    await run(() => api.selectBoard(id))
  }

  const createBoard = async (name) => {
    setBoardForm(null)
    setSessionFilter('all')
    await run(() => api.createBoard(name))
  }

  const renameBoard = async (name) => {
    setBoardForm(null)
    await run(() => api.renameBoard({ id: board.activeBoardId, name }))
  }

  const deleteBoard = async () => {
    setDeleteArmed(false)
    setSessionFilter('all')
    await run(() => api.deleteBoard(board.activeBoardId))
  }

  /** Board deletion is not recoverable, so it takes a second click. */
  const armDeleteBoard = () => {
    setDeleteArmed(true)
    setTimeout(() => setDeleteArmed(false), DELETE_ARM_MS)
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

  const filterLabel = sessionFilter === 'all' ? '全部会话' : sessionTitle(sessionFilter)

  return (
    <div className="dkb-root">
      <div className="dkb-header">
        <div className="dkb-heading">
          <div className="dkb-title">任务看板</div>
          <div className="dkb-sub">
            {allCards === 0
              ? '还没有卡片'
              : `${sessionFilter === 'all' ? `${allCards} 张卡片` : `${total}/${allCards} 张卡片`}`
                + `${boards.length > 1 ? ` · ${boards.length} 块看板` : ''}`
                + `${withPrompt > 0 ? ` · ${withPrompt} 张有提示词` : ''}`}
          </div>
        </div>
        <div className="dkb-spacer" />

        <Menu
          label={board.activeBoardName}
          title="切换 / 管理看板"
          width={240}
        >
          {(close) => (
            <>
              {boards.map((entry) => (
                <MenuItem
                  key={entry.id}
                  active={entry.active}
                  onClick={() => { close(); switchBoard(entry.id) }}
                >
                  {entry.name}
                  <span className="dkb-menucount">{entry.cardCount}</span>
                </MenuItem>
              ))}
              <div className="dkb-menusep" />
              {boardForm === 'create'
                ? (
                  <InlineInput
                    placeholder="看板名称，比如「项目 A」"
                    onSubmit={(name) => { close(); createBoard(name) }}
                    onCancel={() => setBoardForm(null)}
                  />
                )
                : <MenuItem onClick={() => setBoardForm('create')}>＋ 新建看板</MenuItem>}
              {boardForm === 'rename'
                ? (
                  <InlineInput
                    initial={board.activeBoardName}
                    onSubmit={(name) => { close(); renameBoard(name) }}
                    onCancel={() => setBoardForm(null)}
                  />
                )
                : <MenuItem onClick={() => setBoardForm('rename')}>✎ 重命名这块看板</MenuItem>}
              {deleteArmed
                ? (
                  <MenuItem danger onClick={() => { close(); deleteBoard() }}>
                    确认删除「{board.activeBoardName}」（{allCards} 张卡片）
                  </MenuItem>
                )
                : (
                  <MenuItem danger onClick={armDeleteBoard}>
                    🗑 删除这块看板
                  </MenuItem>
                )}
            </>
          )}
        </Menu>

        <Menu label={filterLabel} title="按会话过滤卡片" width={260}>
          {(close) => (
            <>
              <MenuItem active={sessionFilter === 'all'} onClick={() => { setSessionFilter('all'); close() }}>
                全部会话
                <span className="dkb-menucount">{allCards}</span>
              </MenuItem>
              {sessionOptions.length > 0 ? <div className="dkb-menusep" /> : null}
              {sessionOptions.map(([id, count]) => (
                <MenuItem
                  key={id}
                  active={sessionFilter === id}
                  onClick={() => { setSessionFilter(id); close() }}
                >
                  <span className="dkb-menusession">{sessionTitle(id)}</span>
                  <span className="dkb-menucount">{count}</span>
                </MenuItem>
              ))}
            </>
          )}
        </Menu>

        <Menu label="⚙" title="设置" width={220}>
          {() => (
            <>
              <label className="dkb-menucheck" onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={board?.settings?.autoSyncTodos !== false}
                  disabled={busy}
                  onChange={(event) => run(() => api.setSettings({ autoSyncTodos: event.target.checked }))}
                />
                同步会话 todo
              </label>
              <label className="dkb-menucheck" onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={board?.settings?.autoCompleteOnRun !== false}
                  disabled={busy}
                  onChange={(event) => run(() => api.setSettings({ autoCompleteOnRun: event.target.checked }))}
                />
                跑完自动进「已完成」
              </label>
            </>
          )}
        </Menu>

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
            children.push(
              <div key="empty" className="dkb-empty">
                {sessionFilter === 'all' ? '空' : '这个会话没有卡片'}
              </div>,
            )
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
