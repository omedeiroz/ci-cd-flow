// Editor de código no estilo VS Code: barra de atividades, Explorer com status do git,
// pesquisa, controle de código-fonte, abrir pasta, abertura rápida (Ctrl+P), paleta de comandos
// e terminal integrado.
import { useEffect, useMemo, useRef, useState } from 'react'
import { load } from 'js-yaml'
import { editor } from '../engine/editor'
import { aheadBy, findRepo, repoStatus } from '../engine/git'
import { Shell } from '../engine/shell'
import { localFs, localMachine, onCommand, useOS } from '../store/os'
import { TerminalApp } from './Terminal'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function highlight(code: string, lang: string): string {
  const lines = code.split('\n')
  if (lang === 'yaml')
    return lines
      .map((l) => {
        if (/^\s*#/.test(l)) return `<i class="c">${esc(l)}</i>`
        const m = l.match(/^(\s*)(- )?([\w.-]+:)?(.*)$/)!
        const [, ind, dash = '', key = '', rest] = m
        let r = esc(rest)
        r = r.replace(/(#.*)$/, '<i class="c">$1</i>')
        r = r.replace(/(\$\{\{.*?\}\})/g, '<b class="x">$1</b>')
        r = r.replace(/("[^"]*"|'[^']*')/g, '<span class="s">$1</span>')
        return `${ind}${dash ? '<span class="p">- </span>' : ''}${key ? `<span class="k">${esc(key)}</span>` : ''}${r}`
      })
      .join('\n')
  if (lang === 'javascript' || lang === 'json')
    return lines
      .map((l) => {
        if (/^\s*\/\//.test(l)) return `<i class="c">${esc(l)}</i>`
        return esc(l)
          .replace(/('[^']*'|"[^"]*"|`[^`]*`)/g, '<span class="s">$1</span>')
          .replace(/\b(const|let|var|function|return|require|module|exports|if|else|throw|new|true|false|null|async|await|for|of|in)\b(?![^<]*<\/span>)/g, '<span class="kw">$1</span>')
          .replace(/\b(\d+)\b(?![^<]*<\/span>)/g, '<span class="n">$1</span>')
      })
      .join('\n')
  if (lang === 'html')
    // uma passada só, para não realçar de novo o HTML que acabamos de inserir
    return esc(code).replace(/(&lt;\/?)([\w-]+)|([\w-]+)=(?=")|("[^"]*")/g, (_m, lt, tag, attr, str) =>
      lt ? `${lt}<span class="kw">${tag}</span>` : attr ? `<span class="k">${attr}</span>=` : `<span class="s">${str}</span>`,
    )
  if (lang === 'markdown' || lang === 'dockerfile')
    return lines.map((l) => (/^#/.test(l) ? `<span class="k">${esc(l)}</span>` : lang === 'dockerfile' ? esc(l).replace(/^(\w+)/, '<span class="kw">$1</span>') : esc(l))).join('\n')
  return esc(code)
}

const langOf = (p: string) =>
  /\.ya?ml$/.test(p) ? 'yaml' : /\.(js|mjs|cjs|ts)$/.test(p) ? 'javascript' : /\.json$/.test(p) ? 'json' : /\.md$/.test(p) ? 'markdown' : /Dockerfile$/.test(p) ? 'dockerfile' : /\.html?$/.test(p) ? 'html' : /\.css$/.test(p) ? 'css' : 'plaintext'
const LANG_LABEL: Record<string, string> = { yaml: 'YAML', javascript: 'JavaScript', json: 'JSON', markdown: 'Markdown', dockerfile: 'Dockerfile', html: 'HTML', css: 'CSS', plaintext: 'Texto sem formatação' }

function FileIc({ name }: { name: string }) {
  const l = langOf(name)
  const map: Record<string, [string, string]> = { yaml: ['#cb4b7a', 'Y'], javascript: ['#e8c547', 'JS'], json: ['#e8c547', '{}'], markdown: ['#4fa3e0', 'M↓'], dockerfile: ['#2496ed', '🐳'], html: ['#e44d26', '<>'], css: ['#2965f1', '#'] }
  const [c, t] = name.endsWith('.pem') ? ['#e0a84f', '🔑'] : name.startsWith('.git') ? ['#f05033', '◆'] : map[l] ?? ['#9aa5b1', '≡']
  return <span className="ed-ic" style={{ color: c }}>{t}</span>
}

type GitMark = Record<string, 'M' | 'U' | 'D' | 'A'>

/** Marcas do git por caminho relativo (e propagadas para as pastas). */
function gitMarksFor(root: string | null): { marks: GitMark; repo: ReturnType<typeof findRepo> } {
  const fs = editor.fs
  if (!fs || !root) return { marks: {}, repo: null }
  const repo = findRepo(fs, root)
  if (!repo) return { marks: {}, repo: null }
  const st = repoStatus(fs, repo)
  const marks: GitMark = {}
  const base = repo.root
  const put = (rel: string, m: GitMark[string]) => {
    const abs = `${base}/${rel}`
    marks[abs] = marks[abs] ?? m
    let d = abs.split('/').slice(0, -1).join('/')
    while (d.length >= base.length && d.startsWith(base)) {
      marks[d] = marks[d] ?? 'M'
      d = d.split('/').slice(0, -1).join('/')
    }
  }
  st.staged.forEach((c) => put(c.path, c.kind === 'novo' ? 'A' : c.kind === 'removido' ? 'D' : 'M'))
  st.unstaged.forEach((c) => put(c.path, c.kind === 'removido' ? 'D' : 'M'))
  st.untracked.forEach((p) => put(p, 'U'))
  return { marks, repo }
}

type Menu = { x: number; y: number; path: string; isDir: boolean } | null

function Tree({ path, depth, marks, onMenu, renaming, setRenaming }: { path: string; depth: number; marks: GitMark; onMenu: (m: Menu) => void; renaming: string | null; setRenaming: (p: string | null) => void }) {
  const fs = editor.fs!
  const [open, setOpen] = useState<Record<string, boolean>>({})
  let entries: [string, { type: string }][] = []
  try {
    entries = fs.list(path)
  } catch {
    return null
  }
  entries = entries.filter(([n]) => n !== '.git').sort(([a, x], [b, y]) => (x.type === y.type ? a.localeCompare(b) : x.type === 'dir' ? -1 : 1))
  return (
    <>
      {entries.map(([n, node]) => {
        const abs = `${path === '/' ? '' : path}/${n}`
        const isDir = node.type === 'dir'
        const mark = marks[abs]
        return (
          <div key={n}>
            <div
              className={`ed-row ${editor.active === abs ? 'on' : ''} ${n === 'node_modules' ? 'dim' : ''} ${mark ? `git-${mark}` : ''}`}
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={() => (isDir ? setOpen((o) => ({ ...o, [n]: !o[n] })) : editor.openFile(fs, abs))}
              onContextMenu={(e) => {
                e.preventDefault()
                onMenu({ x: e.clientX, y: e.clientY, path: abs, isDir })
              }}
            >
              {isDir ? <span className="ed-chev">{open[n] ? '▾' : '▸'}</span> : <FileIc name={n} />}
              {renaming === abs ? (
                <input
                  className="ed-rename"
                  autoFocus
                  defaultValue={n}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setRenaming(null)
                    if (e.key === 'Enter') {
                      const v = e.currentTarget.value.trim()
                      if (v && v !== n) {
                        const to = `${path === '/' ? '' : path}/${v}`
                        fs.move(abs, to)
                        editor.renamed(abs, to)
                      }
                      setRenaming(null)
                    }
                  }}
                  onBlur={() => setRenaming(null)}
                />
              ) : (
                <span className="ed-name">{n}</span>
              )}
              {mark && !isDir && <span className="ed-mark">{mark}</span>}
              {mark && isDir && <span className="ed-dot">●</span>}
            </div>
            {isDir && open[n] && <Tree path={abs} depth={depth + 1} marks={marks} onMenu={onMenu} renaming={renaming} setRenaming={setRenaming} />}
          </div>
        )
      })}
    </>
  )
}

function FolderPicker({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState(localFs.home)
  const [sel, setSel] = useState<string | null>(null)
  const dirs = (() => {
    try {
      return localFs.list(cur).filter(([n, x]) => x.type === 'dir' && !n.startsWith('.'))
    } catch {
      return []
    }
  })()
  const crumbs = cur.split('/').filter(Boolean)
  const target = sel ?? cur
  return (
    <div className="ed-modal-bg" onClick={onClose}>
      <div className="ed-picker" onClick={(e) => e.stopPropagation()}>
        <div className="ed-picker-head">Abrir pasta</div>
        <div className="ed-picker-crumbs">
          <span onClick={() => (setCur('/'), setSel(null))}>💻</span>
          {crumbs.map((c, i) => (
            <span key={i} onClick={() => (setCur('/' + crumbs.slice(0, i + 1).join('/')), setSel(null))}>
              › {c}
            </span>
          ))}
        </div>
        <div className="ed-picker-list">
          {cur !== '/' && (
            <div onDoubleClick={() => (setCur(cur.split('/').slice(0, -1).join('/') || '/'), setSel(null))} className="up">
              📁 ..
            </div>
          )}
          {dirs.map(([n]) => {
            const abs = `${cur === '/' ? '' : cur}/${n}`
            return (
              <div key={n} className={sel === abs ? 'on' : ''} onClick={() => setSel(abs)} onDoubleClick={() => (setCur(abs), setSel(null))}>
                📁 {n}
                {localFs.isDir(`${abs}/.git`) && <span className="ed-badge">repositório git</span>}
              </div>
            )
          })}
          {!dirs.length && <div className="dim">Sem subpastas</div>}
        </div>
        <div className="ed-picker-foot">
          <span className="dim">{target}</span>
          <button onClick={onClose}>Cancelar</button>
          <button
            className="primary"
            onClick={() => {
              editor.openFolder(localFs, target)
              onClose()
            }}
          >
            Abrir
          </button>
        </div>
      </div>
    </div>
  )
}

type Cmd = { label: string; key?: string; run: () => void }

function QuickPick({ mode, onClose, commands }: { mode: 'files' | 'commands'; onClose: () => void; commands: Cmd[] }) {
  const [q, setQ] = useState(mode === 'commands' ? '> ' : '')
  const [idx, setIdx] = useState(0)
  const root = editor.root
  const isCmd = q.startsWith('>')
  const items = useMemo(() => {
    if (isCmd) {
      const t = q.slice(1).trim().toLowerCase()
      return commands.filter((c) => c.label.toLowerCase().includes(t)).map((c) => ({ label: c.label, detail: c.key ?? '', run: c.run }))
    }
    if (!root || !editor.fs) return []
    const files = Object.keys(editor.fs.walkFiles(root, (rel) => rel === '.git' || rel === 'node_modules'))
    const t = q.toLowerCase()
    const score = (f: string) => {
      let i = 0
      for (const ch of f.toLowerCase()) if (ch === t[i]) i++
      return i === t.length
    }
    return files
      .filter((f) => !t || score(f))
      .slice(0, 40)
      .map((f) => ({ label: f.split('/').pop()!, detail: f, run: () => editor.openFile(editor.fs!, `${root}/${f}`) }))
  }, [q, isCmd, root, commands])
  return (
    <div className="ed-modal-bg top" onClick={onClose}>
      <div className="ed-quick" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          onChange={(e) => (setQ(e.target.value), setIdx(0))}
          placeholder="Pesquisar arquivos pelo nome (digite > para comandos)"
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
            if (e.key === 'ArrowDown') setIdx((i) => Math.min(i + 1, items.length - 1))
            if (e.key === 'ArrowUp') setIdx((i) => Math.max(i - 1, 0))
            if (e.key === 'Enter' && items[idx]) {
              items[idx].run()
              onClose()
            }
          }}
        />
        <div className="ed-quick-list">
          {items.map((it, i) => (
            <div key={it.detail + it.label} className={i === idx ? 'on' : ''} onMouseEnter={() => setIdx(i)} onClick={() => (it.run(), onClose())}>
              {!isCmd && <FileIc name={it.label} />} <b>{it.label}</b> <span className="dim">{it.detail}</span>
            </div>
          ))}
          {!items.length && <div className="dim">Nenhum resultado</div>}
        </div>
      </div>
    </div>
  )
}

function SearchPanel() {
  const [q, setQ] = useState('')
  const root = editor.root!
  const results = useMemo(() => {
    if (q.length < 2 || !editor.fs) return []
    const files = editor.fs.walkFiles(root, (rel) => rel === '.git' || rel === 'node_modules')
    const out: { file: string; hits: { line: number; text: string }[] }[] = []
    for (const [f, c] of Object.entries(files)) {
      const hits = c
        .split('\n')
        .map((text, i) => ({ line: i + 1, text }))
        .filter((x) => x.text.toLowerCase().includes(q.toLowerCase()))
      if (hits.length) out.push({ file: f, hits: hits.slice(0, 20) })
    }
    return out
  }, [q, root])
  const total = results.reduce((a, r) => a + r.hits.length, 0)
  return (
    <div className="ed-panel">
      <div className="ed-side-head"><span>PESQUISAR</span></div>
      <div className="ed-search">
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pesquisar" aria-label="Pesquisar nos arquivos" />
        {q.length >= 2 && <div className="dim small">{total} resultados em {results.length} arquivos</div>}
      </div>
      <div className="ed-tree">
        {results.map((r) => (
          <div key={r.file}>
            <div className="ed-row"><FileIc name={r.file} /> <b>{r.file.split('/').pop()}</b> <span className="dim small">{r.file}</span></div>
            {r.hits.map((h) => (
              <div
                key={h.line}
                className="ed-row hit"
                onClick={() => {
                  editor.openFile(editor.fs!, `${root}/${r.file}`)
                  editor.revealLine(`${root}/${r.file}`, h.line)
                }}
              >
                <span className="dim small">{h.line}</span> {h.text.trim().slice(0, 60)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function ScmPanel({ repoRoot }: { repoRoot: string | null }) {
  const [msg, setMsg] = useState('')
  const [note, setNote] = useState('')
  const fs = editor.fs!
  const repo = repoRoot ? findRepo(fs, repoRoot) : null
  if (!repo)
    return (
      <div className="ed-panel">
        <div className="ed-side-head"><span>CONTROLE DE CÓDIGO-FONTE</span></div>
        <p className="ed-note">A pasta aberta não é um repositório git. Clone um repositório (git clone) e abra a pasta dele.</p>
      </div>
    )
  const st = repoStatus(fs, repo)
  const changes = [...st.unstaged.map((c) => ({ path: c.path, m: c.kind === 'removido' ? 'D' : 'M' })), ...st.untracked.map((p) => ({ path: p, m: 'U' }))]
  const staged = st.staged.map((c) => ({ path: c.path, m: c.kind === 'novo' ? 'A' : c.kind === 'removido' ? 'D' : 'M' }))
  const ahead = aheadBy(repo)
  const git = (line: string) => {
    const sh = new Shell(fs, 'dev', 'devops-lab', localMachine)
    sh.cwd = repo.root
    sh.onCommand = onCommand
    return sh.execute(line)
  }
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '')
  const commit = () => {
    if (!msg.trim()) return setNote('Escreva uma mensagem de commit.')
    if (!staged.length) git('git add -A')
    const r = git(`git commit -m "${msg.replace(/"/g, "'")}"`)
    setNote(strip(r.out).split('\n')[0])
    if (r.code === 0) setMsg('')
  }
  const sync = () => {
    const r = git('git push')
    if (r.prompt) setNote('O git pediu usuário e token. Faça o primeiro git push pelo terminal para salvar as credenciais.')
    else setNote(r.code === 0 ? `Sincronizado: ${strip(r.out).split('\n').pop()}` : strip(r.out).split('\n').filter(Boolean).slice(0, 2).join(' '))
  }
  const Row = ({ f, stagedRow }: { f: { path: string; m: string }; stagedRow: boolean }) => (
    <div className={`ed-row scm git-${f.m}`} onClick={() => fs.exists(`${repo.root}/${f.path}`) && editor.openFile(fs, `${repo.root}/${f.path}`)}>
      <FileIc name={f.path} />
      <span className="ed-name">{f.path.split('/').pop()}</span>
      <span className="dim small ed-path">{f.path.split('/').slice(0, -1).join('/')}</span>
      <button
        title={stagedRow ? 'Remover do stage' : 'Adicionar ao stage'}
        onClick={(e) => {
          e.stopPropagation()
          git(stagedRow ? `git restore --staged ${f.path}` : `git add ${f.path}`)
        }}
      >
        {stagedRow ? '−' : '+'}
      </button>
      <span className="ed-mark">{f.m}</span>
    </div>
  )
  return (
    <div className="ed-panel">
      <div className="ed-side-head"><span>CONTROLE DE CÓDIGO-FONTE</span></div>
      <div className="ed-scm-box">
        <textarea
          value={msg}
          onChange={(e) => setMsg(e.target.value)}
          placeholder={`Mensagem (Ctrl+Enter para commit em "${repo.branch}")`}
          aria-label="Mensagem de commit"
          onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && commit()}
        />
        {staged.length || changes.length ? (
          <button className="primary" onClick={commit}>✓ Commit{!staged.length ? ' (tudo)' : ''}</button>
        ) : ahead > 0 ? (
          <button className="primary" onClick={sync}>⟳ Sincronizar alterações {ahead}↑</button>
        ) : (
          <button disabled>Nada para commitar</button>
        )}
        {note && <div className="ed-note">{note}</div>}
      </div>
      <div className="ed-tree">
        {staged.length > 0 && <div className="ed-group">ALTERAÇÕES PREPARADAS <span>{staged.length}</span></div>}
        {staged.map((f) => <Row key={'s' + f.path} f={f} stagedRow />)}
        {changes.length > 0 && <div className="ed-group">ALTERAÇÕES <span>{changes.length}</span></div>}
        {changes.map((f) => <Row key={'c' + f.path} f={f} stagedRow={false} />)}
      </div>
    </div>
  )
}

export function EditorApp() {
  useOS((s) => s.version)
  const [view, setView] = useState<'explorer' | 'search' | 'scm'>('explorer')
  const [creating, setCreating] = useState<null | { kind: 'file' | 'folder'; dir: string }>(null)
  const [newName, setNewName] = useState('')
  const [pos, setPos] = useState({ ln: 1, col: 1 })
  const [menu, setMenu] = useState<Menu>(null)
  const [topMenu, setTopMenu] = useState<string | null>(null)
  const [picker, setPicker] = useState(false)
  const [quick, setQuick] = useState<null | 'files' | 'commands'>(null)
  const [term, setTerm] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const gutRef = useRef<HTMLDivElement>(null)
  const { root, open, active, fs } = editor
  const buf = open.find((b) => b.path === active)
  const lang = buf ? langOf(buf.path) : 'plaintext'
  const html = useMemo(() => (buf ? highlight(buf.content, lang) + '\n' : ''), [buf, lang])
  const { marks, repo } = gitMarksFor(root)
  const changeCount = Object.entries(marks).filter(([p]) => fs?.get(p)?.type !== 'dir').length

  const yamlErr = useMemo(() => {
    if (!buf || lang !== 'yaml') return null
    try {
      load(buf.content)
      return ''
    } catch (e) {
      const err = e as { reason?: string; mark?: { line: number }; message: string }
      return `${err.reason ?? err.message.split('\n')[0]}${err.mark ? ` (linha ${err.mark.line + 1})` : ''}`
    }
  }, [buf, lang])

  // posiciona o cursor numa linha pedida pela pesquisa
  const reveal = editor.reveal
  useEffect(() => {
    if (!reveal || reveal.path !== active || !taRef.current) return
    const lines = taRef.current.value.split('\n')
    const at = lines.slice(0, reveal.line - 1).reduce((a, l) => a + l.length + 1, 0)
    taRef.current.focus()
    taRef.current.setSelectionRange(at, at + (lines[reveal.line - 1]?.length ?? 0))
    taRef.current.scrollTop = Math.max(0, (reveal.line - 5) * 20)
    setPos({ ln: reveal.line, col: 1 })
  }, [reveal, active])

  const commands: Cmd[] = [
    { label: 'Arquivo: Novo arquivo', key: 'Ctrl+N', run: () => root && setCreating({ kind: 'file', dir: root }) },
    { label: 'Arquivo: Nova pasta', run: () => root && setCreating({ kind: 'folder', dir: root }) },
    { label: 'Arquivo: Abrir pasta...', key: 'Ctrl+K Ctrl+O', run: () => setPicker(true) },
    { label: 'Arquivo: Salvar', key: 'Ctrl+S', run: () => buf && editor.save(buf.path) },
    { label: 'Arquivo: Salvar tudo', run: () => editor.saveAll() },
    { label: 'Arquivo: Fechar pasta', run: () => editor.closeFolder() },
    { label: 'Ver: Explorer', key: 'Ctrl+Shift+E', run: () => setView('explorer') },
    { label: 'Ver: Pesquisar', key: 'Ctrl+Shift+F', run: () => setView('search') },
    { label: 'Ver: Controle de código-fonte', key: 'Ctrl+Shift+G', run: () => setView('scm') },
    { label: 'Terminal: Alternar terminal integrado', key: 'Ctrl+`', run: () => setTerm((t) => !t) },
    { label: 'Ir para arquivo...', key: 'Ctrl+P', run: () => setTimeout(() => setQuick('files'), 0) },
  ]

  const keys = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && e.shiftKey && k === 'p') (e.preventDefault(), setQuick('commands'))
    else if (mod && !e.shiftKey && k === 'p') (e.preventDefault(), root && setQuick('files'))
    else if (mod && e.key === '`') (e.preventDefault(), setTerm((t) => !t))
    else if (mod && e.shiftKey && k === 'e') (e.preventDefault(), setView('explorer'))
    else if (mod && e.shiftKey && k === 'f') (e.preventDefault(), setView('search'))
    else if (mod && e.shiftKey && k === 'g') (e.preventDefault(), setView('scm'))
    else if (mod && k === 's' && !e.shiftKey) (e.preventDefault(), buf && editor.save(buf.path))
  }

  const MENUS: Record<string, Cmd[]> = {
    Arquivo: [
      { label: 'Novo arquivo', key: 'Ctrl+N', run: () => root && setCreating({ kind: 'file', dir: root }) },
      { label: 'Nova pasta', run: () => root && setCreating({ kind: 'folder', dir: root }) },
      { label: 'Abrir pasta...', key: 'Ctrl+K Ctrl+O', run: () => setPicker(true) },
      { label: 'Abrir arquivo...', key: 'Ctrl+P', run: () => root && setQuick('files') },
      { label: 'Salvar', key: 'Ctrl+S', run: () => buf && editor.save(buf.path) },
      { label: 'Salvar tudo', run: () => editor.saveAll() },
      { label: 'Fechar editor', run: () => buf && editor.close(buf.path) },
      { label: 'Fechar pasta', run: () => editor.closeFolder() },
    ],
    Ver: [
      { label: 'Paleta de comandos...', key: 'Ctrl+Shift+P', run: () => setQuick('commands') },
      { label: 'Explorer', key: 'Ctrl+Shift+E', run: () => setView('explorer') },
      { label: 'Pesquisar', key: 'Ctrl+Shift+F', run: () => setView('search') },
      { label: 'Controle de código-fonte', key: 'Ctrl+Shift+G', run: () => setView('scm') },
    ],
    Terminal: [{ label: 'Novo terminal', key: 'Ctrl+`', run: () => setTerm(true) }],
    Ajuda: [{ label: 'Atalhos: Ctrl+P arquivos, Ctrl+Shift+P comandos', run: () => setQuick('commands') }],
  }

  const create = () => {
    const name = newName.trim().replace(/^\/+/, '')
    if (!name || !creating || !fs) return setCreating(null)
    const abs = `${creating.dir}/${name}`
    if (creating.kind === 'folder') fs.mkdir(abs, true)
    else {
      fs.mkdir(abs.split('/').slice(0, -1).join('/'), true)
      if (!fs.exists(abs)) fs.write(abs, '')
      editor.openFile(fs, abs)
    }
    setCreating(null)
    setNewName('')
  }

  const updatePos = () => {
    const ta = taRef.current
    if (!ta) return
    const lines = ta.value.slice(0, ta.selectionStart).split('\n')
    setPos({ ln: lines.length, col: lines[lines.length - 1].length + 1 })
  }
  const rel = (p: string) => (root && p.startsWith(root + '/') ? p.slice(root.length + 1) : p)
  const ahead = repo ? aheadBy(repo) : 0

  return (
    <div className="ed" onKeyDown={keys} onClick={() => (setMenu(null), setTopMenu(null))} tabIndex={-1}>
      <div className="ed-menubar">
        {Object.keys(MENUS).map((m) => (
          <div key={m} className={`ed-mitem ${topMenu === m ? 'on' : ''}`} onClick={(e) => (e.stopPropagation(), setTopMenu(topMenu === m ? null : m))}>
            {m}
            {topMenu === m && (
              <div className="ed-dropdown">
                {MENUS[m].map((c) => (
                  <div key={c.label} onClick={(e) => (e.stopPropagation(), setTopMenu(null), c.run())}>
                    <span>{c.label}</span>
                    <span className="dim">{c.key}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div className="ed-cmdcenter" onClick={(e) => (e.stopPropagation(), setQuick(root ? 'files' : 'commands'))}>
          🔍 {root ? root.split('/').pop() : 'Pesquisar'}
        </div>
      </div>
      <div className="ed-body">
        <nav className="ed-activity">
          <button className={view === 'explorer' ? 'on' : ''} title="Explorer (Ctrl+Shift+E)" onClick={() => setView('explorer')}>
            <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
          </button>
          <button className={view === 'search' ? 'on' : ''} title="Pesquisar (Ctrl+Shift+F)" onClick={() => setView('search')}>
            <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M15 15l6 6" stroke="currentColor" strokeWidth="1.8" /></svg>
          </button>
          <button className={view === 'scm' ? 'on' : ''} title="Controle de código-fonte (Ctrl+Shift+G)" onClick={() => setView('scm')}>
            <svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="6" cy="19" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.6" /><circle cx="18" cy="8" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M6 7.3v9.4M18 10.3c0 4-6 3-11 6.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
            {changeCount > 0 && <span className="ed-abadge">{changeCount}</span>}
          </button>
          <button className="bottom" title="Terminal (Ctrl+`)" onClick={() => setTerm((t) => !t)}>
            <svg viewBox="0 0 24 24"><path d="M4 7l5 5-5 5M12 18h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </nav>

        {root && fs && (
          <aside className="ed-side">
            {view === 'explorer' && (
              <div className="ed-panel">
                <div className="ed-side-head">
                  <span>EXPLORER</span>
                  <span className="ed-tools">
                    <button title="Novo arquivo" onClick={() => setCreating({ kind: 'file', dir: root })}>＋📄</button>
                    <button title="Nova pasta" onClick={() => setCreating({ kind: 'folder', dir: root })}>＋📁</button>
                  </span>
                </div>
                <div className="ed-root">▾ {root.split('/').pop()?.toUpperCase()}</div>
                {creating && (
                  <form
                    className="ed-new"
                    onSubmit={(e) => {
                      e.preventDefault()
                      create()
                    }}
                  >
                    <input
                      autoFocus
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      onBlur={create}
                      onKeyDown={(e) => e.key === 'Escape' && setCreating(null)}
                      placeholder={creating.kind === 'file' ? `${rel(creating.dir) === creating.dir ? '' : rel(creating.dir) + '/'}nome (ex: .github/workflows/ci.yml)` : 'nome da pasta'}
                      aria-label={creating.kind === 'file' ? 'Nome do novo arquivo' : 'Nome da nova pasta'}
                    />
                  </form>
                )}
                <div className="ed-tree">
                  <Tree path={root} depth={0} marks={marks} onMenu={setMenu} renaming={renaming} setRenaming={setRenaming} />
                </div>
              </div>
            )}
            {view === 'search' && <SearchPanel />}
            {view === 'scm' && <ScmPanel repoRoot={repo?.root ?? null} />}
          </aside>
        )}

        <section className="ed-main">
          {!root ? (
            <div className="ed-welcome">
              <div>
                <div className="ed-logo">⟨/⟩</div>
                <h2>Editor</h2>
                <p className="dim">Edição evoluída</p>
                <div className="ed-wcols">
                  <div>
                    <h4>Iniciar</h4>
                    <a onClick={() => setPicker(true)}>📂 Abrir pasta...</a>
                    <a onClick={() => setQuick('commands')}>⌘ Paleta de comandos...</a>
                    <a onClick={() => setTerm(true)}>⌨ Abrir terminal</a>
                  </div>
                  <div>
                    <h4>Recentes</h4>
                    {editor.recent.length ? (
                      editor.recent.map((r) => (
                        <a key={r} onClick={() => editor.openFolder(localFs, r)}>
                          {r.split('/').pop()} <span className="dim">{r.replace(localFs.home, '~')}</span>
                        </a>
                      ))
                    ) : (
                      <span className="dim">Nenhuma pasta recente. No terminal, <code>code .</code> abre a pasta atual.</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="ed-tabs">
                {open.map((b) => (
                  <div key={b.path} className={`ed-tab ${b.path === active ? 'on' : ''} ${marks[b.path] ? `git-${marks[b.path]}` : ''}`} onClick={() => editor.select(b.path)}>
                    <FileIc name={b.path} />
                    <span>{b.path.split('/').pop()}</span>
                    <button className={editor.dirty(b) ? 'dirty' : ''} onClick={(e) => (e.stopPropagation(), editor.close(b.path))} aria-label="Fechar arquivo">
                      {editor.dirty(b) ? '●' : '×'}
                    </button>
                  </div>
                ))}
              </div>
              {buf ? (
                <>
                  <div className="ed-crumbs">{rel(buf.path).split('/').join('  ›  ')}</div>
                  <div className="ed-code">
                    <div className="ed-gutter" ref={gutRef}>
                      {buf.content.split('\n').map((_, i) => (
                        <div key={i} className={i + 1 === pos.ln ? 'cur' : ''}>{i + 1}</div>
                      ))}
                    </div>
                    <div className="ed-area">
                      <pre ref={preRef} className={`ed-hl lang-${lang}`} aria-hidden dangerouslySetInnerHTML={{ __html: html }} />
                      <textarea
                        ref={taRef}
                        className="ed-ta"
                        spellCheck={false}
                        value={buf.content}
                        aria-label={`Conteúdo de ${rel(buf.path)}`}
                        onChange={(e) => (editor.setContent(buf.path, e.target.value), updatePos())}
                        onClick={updatePos}
                        onKeyUp={updatePos}
                        onScroll={(e) => {
                          const t = e.currentTarget
                          if (preRef.current) (preRef.current.scrollTop = t.scrollTop), (preRef.current.scrollLeft = t.scrollLeft)
                          if (gutRef.current) gutRef.current.scrollTop = t.scrollTop
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Tab') {
                            e.preventDefault()
                            const ta = e.currentTarget
                            const { selectionStart: a, selectionEnd: b } = ta
                            editor.setContent(buf.path, ta.value.slice(0, a) + '  ' + ta.value.slice(b))
                            requestAnimationFrame(() => taRef.current?.setSelectionRange(a + 2, a + 2))
                          }
                        }}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="ed-empty">
                  <div className="ed-logo dim">⟨/⟩</div>
                  <p><b>Mostrar todos os comandos</b> <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd></p>
                  <p><b>Ir para arquivo</b> <kbd>Ctrl</kbd>+<kbd>P</kbd></p>
                  <p><b>Alternar terminal</b> <kbd>Ctrl</kbd>+<kbd>`</kbd></p>
                </div>
              )}
            </>
          )}
          {term && (
            <div className="ed-terminal">
              <div className="ed-term-head">
                <span className="on">TERMINAL</span>
                <span>PROBLEMAS {yamlErr ? 1 : 0}</span>
                <button onClick={() => setTerm(false)} aria-label="Fechar terminal">×</button>
              </div>
              <div className="ed-term-body">
                <TerminalApp embedded={{ cwd: root ?? localFs.home }} />
              </div>
            </div>
          )}
        </section>
      </div>
      <div className="ed-status">
        {repo ? (
          <>
            <span>⑂ {repo.branch}{changeCount ? '*' : ''}</span>
            <span title="Commits para enviar" className={ahead ? 'sync' : ''} onClick={() => setView('scm')}>⟳ {ahead}↑ 0↓</span>
          </>
        ) : (
          <span>⟨/⟩ {root ? 'sem repositório' : 'nenhuma pasta aberta'}</span>
        )}
        <span className={yamlErr ? 'err' : ''}>{yamlErr ? `⊗ 1  ${yamlErr}` : '⊗ 0  ⚠ 0'}</span>
        <span className="right">
          {buf && editor.dirty(buf) && <span className="unsaved">● Não salvo (Ctrl+S)</span>}
          {buf && <span>Ln {pos.ln}, Col {pos.col}</span>}
          {buf && <span>Espaços: 2</span>}
          {buf && <span>UTF-8</span>}
          {buf && <span>{LANG_LABEL[lang]}</span>}
          <span>🔔</span>
        </span>
      </div>

      {menu && fs && (
        <div className="ed-ctx" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          <div onClick={() => (setCreating({ kind: 'file', dir: menu.isDir ? menu.path : menu.path.split('/').slice(0, -1).join('/') }), setMenu(null))}>Novo arquivo...</div>
          <div onClick={() => (setCreating({ kind: 'folder', dir: menu.isDir ? menu.path : menu.path.split('/').slice(0, -1).join('/') }), setMenu(null))}>Nova pasta...</div>
          <hr />
          <div onClick={() => (setRenaming(menu.path), setMenu(null))}>Renomear...</div>
          <div onClick={() => (setConfirmDel(menu.path), setMenu(null))}>Excluir</div>
          <hr />
          <div onClick={() => (navigator.clipboard?.writeText(menu.path).catch(() => {}), setMenu(null))}>Copiar caminho</div>
          <div onClick={() => (navigator.clipboard?.writeText(rel(menu.path)).catch(() => {}), setMenu(null))}>Copiar caminho relativo</div>
        </div>
      )}
      {confirmDel && fs && (
        <div className="ed-modal-bg" onClick={() => setConfirmDel(null)}>
          <div className="ed-confirm" onClick={(e) => e.stopPropagation()}>
            <p>Excluir <b>{rel(confirmDel)}</b>{fs.isDir(confirmDel) ? ' e todo o conteúdo' : ''}?</p>
            <p className="dim small">Você pode desfazer com o git, se o arquivo estiver versionado.</p>
            <div>
              <button onClick={() => setConfirmDel(null)}>Cancelar</button>
              <button
                className="danger"
                onClick={() => {
                  fs.remove(confirmDel, true)
                  editor.renamed(confirmDel, null)
                  setConfirmDel(null)
                }}
              >
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
      {picker && <FolderPicker onClose={() => setPicker(false)} />}
      {quick && <QuickPick mode={quick} onClose={() => setQuick(null)} commands={commands} />}
    </div>
  )
}
