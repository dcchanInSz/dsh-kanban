/**
 * Panel styles + theme sync.
 *
 * Colours are plain CSS variables in two palettes. The active palette is chosen
 * by `data-dkb-theme` on <html>, which `syncTheme()` derives from the shell's
 * effective `color-scheme` (falling back to the OS preference). We do not use
 * `light-dark()` here: some Chromium builds resolve it to the light branch even
 * when `color-scheme: dark` is in force.
 */

const CSS = String.raw`
.dkb-root {
  --dkb-text: #1c1d21;
  --dkb-dim: #6b7078;
  --dkb-faint: #99a0a9;
  --dkb-panel: #f5f6f8;
  --dkb-surface: #ffffff;
  --dkb-border: #e6e8ec;
  --dkb-border-strong: #d7dae1;
  --dkb-accent: #3b6cf6;
  --dkb-accent-soft: rgba(59, 108, 246, 0.10);
  --dkb-danger: #d93a3a;
  --dkb-shadow: rgba(16, 24, 40, 0.04);
  --dkb-hover: rgba(0, 0, 0, 0.05);
  --dkb-chip: rgba(0, 0, 0, 0.05);
  --dkb-todo-fg: #2f6ad9;
  --dkb-todo-bg: rgba(59, 108, 246, 0.12);
  --dkb-agent-fg: #7b4fe0;
  --dkb-agent-bg: rgba(123, 79, 224, 0.12);

  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--dkb-text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Hiragino Sans GB", sans-serif;
}

:root[data-dkb-theme="dark"] .dkb-root {
  --dkb-text: #e9eaee;
  --dkb-dim: #9aa0a9;
  --dkb-faint: #6f757e;
  --dkb-panel: #1e1f23;
  --dkb-surface: #26272c;
  --dkb-border: #33353b;
  --dkb-border-strong: #42454c;
  --dkb-accent: #6c93ff;
  --dkb-accent-soft: rgba(108, 147, 255, 0.16);
  --dkb-danger: #ff6f6f;
  --dkb-shadow: rgba(0, 0, 0, 0.30);
  --dkb-hover: rgba(255, 255, 255, 0.07);
  --dkb-chip: rgba(255, 255, 255, 0.07);
  --dkb-todo-fg: #9dbcff;
  --dkb-todo-bg: rgba(108, 147, 255, 0.18);
  --dkb-agent-fg: #c1a6ff;
  --dkb-agent-bg: rgba(193, 166, 255, 0.16);
}

.dkb-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 22px 14px;
  flex: 0 0 auto;
}

.dkb-heading { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.dkb-title { font-size: 15px; font-weight: 600; letter-spacing: 0.01em; }
.dkb-sub { font-size: 11.5px; color: var(--dkb-dim); }
.dkb-spacer { flex: 1 1 auto; }

.dkb-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--dkb-dim);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.dkb-switch input { accent-color: var(--dkb-accent); margin: 0; }

.dkb-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 26px;
  height: 26px;
  padding: 0 6px;
  border-radius: 7px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--dkb-dim);
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
}
.dkb-iconbtn:hover { background: var(--dkb-hover); color: var(--dkb-text); }
.dkb-iconbtn:disabled { opacity: 0.45; cursor: default; }
.dkb-textbtn { font-size: 10.5px; height: 20px; padding: 0 7px; }
.dkb-add:focus:not(:focus-visible),
.dkb-btn:focus:not(:focus-visible),
.dkb-iconbtn:focus:not(:focus-visible),
.dkb-del:focus:not(:focus-visible) { outline: none; }

.dkb-banner {
  margin: 0 22px 12px;
  padding: 7px 10px;
  border-radius: 8px;
  font-size: 11.5px;
  background: var(--dkb-todo-bg);
  color: var(--dkb-danger);
  flex: 0 0 auto;
}

.dkb-board {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  gap: 14px;
  padding: 0 18px 18px;
  overflow-x: auto;
  align-items: stretch;
}

.dkb-column {
  flex: 1 1 0;
  min-width: 228px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--dkb-panel);
  border: 1px solid var(--dkb-border);
  border-radius: 12px;
  transition: border-color 0.12s ease, background 0.12s ease;
}
.dkb-column.is-target { border-color: var(--dkb-accent); background: var(--dkb-accent-soft); }

.dkb-column-head { display: flex; align-items: center; gap: 7px; padding: 10px 10px 6px 12px; flex: 0 0 auto; }
.dkb-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--dkb-border-strong); flex: 0 0 auto; }
.dkb-column.is-target .dkb-dot { background: var(--dkb-accent); }
.dkb-column-title { font-size: 12px; font-weight: 600; letter-spacing: 0.02em; }
.dkb-count {
  font-size: 10px;
  color: var(--dkb-dim);
  background: var(--dkb-chip);
  border-radius: 999px;
  padding: 1px 6px;
  font-variant-numeric: tabular-nums;
}

.dkb-column-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 3px 8px 8px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.dkb-card {
  background: var(--dkb-surface);
  border: 1px solid var(--dkb-border);
  border-radius: 9px;
  padding: 9px 10px 8px;
  box-shadow: 0 1px 2px var(--dkb-shadow);
  cursor: grab;
  flex: 0 0 auto;
  position: relative;
}
.dkb-card:hover { border-color: var(--dkb-border-strong); }
.dkb-card.is-dragging { opacity: 0.4; }
.dkb-card.is-done .dkb-card-title { text-decoration: line-through; opacity: 0.6; }

.dkb-card-title { font-size: 12.8px; line-height: 1.45; font-weight: 500; word-break: break-word; }
.dkb-card-title-input {
  width: 100%;
  box-sizing: border-box;
  font: inherit;
  font-size: 12.8px;
  padding: 2px 4px;
  border-radius: 5px;
  border: 1px solid var(--dkb-accent);
  background: var(--dkb-surface);
  color: inherit;
  outline: none;
}

.dkb-note {
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--dkb-dim);
  margin-top: 3px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.dkb-meta { display: flex; align-items: center; gap: 6px; margin-top: 7px; font-size: 10px; color: var(--dkb-faint); }
.dkb-badge {
  border-radius: 999px;
  padding: 1px 6px;
  font-size: 9.5px;
  line-height: 1.5;
  white-space: nowrap;
}
.dkb-badge.todo { color: var(--dkb-todo-fg); background: var(--dkb-todo-bg); }
.dkb-badge.agent { color: var(--dkb-agent-fg); background: var(--dkb-agent-bg); }

.dkb-del {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--dkb-faint);
  cursor: pointer;
  font-size: 11px;
  padding: 0 2px;
  opacity: 0;
  transition: opacity 0.1s ease, color 0.1s ease;
}
.dkb-card:hover .dkb-del { opacity: 1; }
.dkb-del:hover { color: var(--dkb-danger); }
.dkb-del.is-armed { opacity: 1; color: var(--dkb-danger); font-weight: 600; }

.dkb-drop-line { height: 2px; border-radius: 2px; background: var(--dkb-accent); margin: -3px 2px; flex: 0 0 auto; }

.dkb-add {
  border: 1px dashed var(--dkb-border-strong);
  border-radius: 9px;
  padding: 7px 8px;
  font-size: 11.5px;
  color: var(--dkb-dim);
  background: transparent;
  cursor: pointer;
  text-align: left;
  flex: 0 0 auto;
}
.dkb-add:hover { color: var(--dkb-accent); border-color: var(--dkb-accent); background: var(--dkb-accent-soft); }

.dkb-composer { display: flex; flex-direction: column; gap: 6px; flex: 0 0 auto; }
.dkb-composer textarea {
  width: 100%;
  min-height: 56px;
  resize: vertical;
  font: inherit;
  font-size: 12.5px;
  line-height: 1.5;
  padding: 7px 8px;
  border-radius: 8px;
  border: 1px solid var(--dkb-accent);
  background: var(--dkb-surface);
  color: inherit;
  outline: none;
  box-sizing: border-box;
}
.dkb-composer-actions { display: flex; gap: 6px; justify-content: flex-end; }

.dkb-btn {
  font-size: 11.5px;
  padding: 3px 10px;
  border-radius: 7px;
  border: 1px solid var(--dkb-border-strong);
  background: transparent;
  color: var(--dkb-text);
  cursor: pointer;
}
.dkb-btn:hover { border-color: var(--dkb-accent); color: var(--dkb-accent); }
.dkb-btn.primary { background: var(--dkb-accent); border-color: var(--dkb-accent); color: #fff; }
.dkb-btn.primary:hover { filter: brightness(1.05); color: #fff; }

/* 提示词与执行 */
.dkb-prompt {
  display: flex;
  gap: 5px;
  align-items: flex-start;
  width: 100%;
  margin-top: 6px;
  padding: 5px 7px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: var(--dkb-chip);
  color: var(--dkb-dim);
  font: inherit;
  font-size: 11px;
  line-height: 1.5;
  text-align: left;
  cursor: pointer;
}
.dkb-prompt:hover { border-color: var(--dkb-border-strong); color: var(--dkb-text); }
.dkb-prompt-mark { flex: 0 0 auto; font-size: 10px; line-height: 1.6; }
.dkb-prompt-text {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-word;
}

.dkb-prompt-editor { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.dkb-prompt-editor textarea,
.dkb-prompt-input {
  width: 100%;
  min-height: 62px;
  resize: vertical;
  font: inherit;
  font-size: 11.5px;
  line-height: 1.5;
  padding: 6px 7px;
  border-radius: 7px;
  border: 1px solid var(--dkb-accent);
  background: var(--dkb-surface);
  color: inherit;
  outline: none;
  box-sizing: border-box;
}

.dkb-linkbtn {
  border: 0;
  background: transparent;
  padding: 0 2px;
  color: var(--dkb-faint);
  font: inherit;
  font-size: 10px;
  cursor: pointer;
  white-space: nowrap;
}
.dkb-linkbtn:hover { color: var(--dkb-accent); }
.dkb-addprompt { opacity: 0; transition: opacity 0.12s ease; }
.dkb-card:hover .dkb-addprompt { opacity: 1; }

.dkb-run {
  border: 1px solid var(--dkb-accent);
  background: var(--dkb-accent-soft);
  color: var(--dkb-accent);
  border-radius: 999px;
  padding: 1px 8px;
  font: inherit;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.dkb-run:hover { background: var(--dkb-accent); color: #fff; }

.dkb-running { font-size: 10px; color: var(--dkb-accent); }
.dkb-card.is-running { border-color: var(--dkb-accent); }

/* 下拉菜单 */
.dkb-menuwrap { position: relative; display: inline-flex; }
.dkb-menubtn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 180px;
  height: 24px;
  padding: 0 8px;
  border-radius: 7px;
  border: 1px solid var(--dkb-border);
  background: var(--dkb-surface);
  color: var(--dkb-text);
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
}
.dkb-menubtn:hover, .dkb-menubtn.is-open { border-color: var(--dkb-border-strong); background: var(--dkb-hover); }
.dkb-menubtn-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dkb-caret { color: var(--dkb-faint); font-size: 9px; }

.dkb-menu {
  position: absolute;
  top: calc(100% + 4px);
  z-index: 40;
  padding: 4px;
  border-radius: 10px;
  border: 1px solid var(--dkb-border-strong);
  background: var(--dkb-surface);
  box-shadow: 0 10px 28px rgba(16, 24, 40, 0.16), 0 2px 6px rgba(16, 24, 40, 0.08);
  max-height: 60vh;
  overflow-y: auto;
}
.dkb-menuitem {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dkb-text);
  font: inherit;
  font-size: 11.5px;
  text-align: left;
  cursor: pointer;
}
.dkb-menuitem:hover { background: var(--dkb-hover); }
.dkb-menuitem.is-active { color: var(--dkb-accent); }
.dkb-menuitem.is-danger:hover { color: var(--dkb-danger); }
.dkb-menuitem-check { width: 10px; flex: 0 0 auto; color: var(--dkb-accent); font-size: 10px; }
.dkb-menuitem-label { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dkb-menusession { display: block; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dkb-menucount {
  font-size: 10px;
  color: var(--dkb-faint);
  background: var(--dkb-chip);
  border-radius: 999px;
  padding: 0 6px;
  font-variant-numeric: tabular-nums;
}
.dkb-menusep { height: 1px; margin: 4px 2px; background: var(--dkb-border); }
.dkb-menuform { display: flex; gap: 6px; padding: 4px 4px 2px; }
.dkb-menuform input {
  flex: 1 1 auto;
  min-width: 0;
  font: inherit;
  font-size: 11.5px;
  padding: 4px 7px;
  border-radius: 6px;
  border: 1px solid var(--dkb-accent);
  background: var(--dkb-surface);
  color: inherit;
  outline: none;
}
.dkb-menucheck {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 7px;
  border-radius: 6px;
  font-size: 11.5px;
  color: var(--dkb-dim);
  cursor: pointer;
}
.dkb-menucheck:hover { background: var(--dkb-hover); }
.dkb-menucheck input { accent-color: var(--dkb-accent); margin: 0; }

.dkb-empty { font-size: 11px; color: var(--dkb-faint); text-align: center; padding: 10px 6px; }
.dkb-loading { font-size: 12px; color: var(--dkb-faint); padding: 40px 22px; }
`

function detectTheme() {
  try {
    const scheme = getComputedStyle(document.documentElement).colorScheme
    if (scheme === 'dark') return 'dark'
    if (scheme === 'light') return 'light'
    if (scheme === 'light dark' || scheme === 'dark light') {
      return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
  } catch { /* ignore */ }
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function syncTheme() {
  const root = document.documentElement
  const apply = () => { root.dataset.dkbTheme = detectTheme() }
  apply()

  const observer = new MutationObserver(apply)
  observer.observe(root, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] })

  const media = matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', apply)

  return () => {
    observer.disconnect()
    media.removeEventListener('change', apply)
    delete root.dataset.dkbTheme
  }
}

export function installStyles() {
  const existing = document.querySelector('style[data-dsh-kanban]')
  const style = existing ?? document.createElement('style')
  if (!existing) {
    style.setAttribute('data-dsh-kanban', '')
    style.textContent = CSS
    document.head.appendChild(style)
  }
  const stopTheme = syncTheme()
  return () => {
    stopTheme()
    if (!existing) style.remove()
  }
}
