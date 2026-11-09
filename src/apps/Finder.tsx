import { useState } from 'react'
import { localFs, useOS } from '../store/os'
import { FileIcon, FolderIcon } from '../components/Icons'

const HOME = localFs.home
const SIDEBAR = [
  { label: 'dev', path: HOME },
  { label: 'Documentos', path: `${HOME}/Documentos` },
  { label: 'Downloads', path: `${HOME}/Downloads` },
  { label: 'Disco (/)', path: '/' },
]

export function FinderApp() {
  useOS((s) => s.version) // re-render quando o filesystem muda
  const [path, setPath] = useState(HOME)
  const [back, setBack] = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ name: string; content: string } | null>(null)

  const cur = localFs.isDir(path) ? path : HOME
  const entries = localFs.list(cur).filter(([n]) => !n.startsWith('.'))
  const go = (p: string) => {
    setBack((b) => [...b, cur])
    setPath(p)
    setSelected(null)
    setPreview(null)
  }
  const join = (n: string) => (cur === '/' ? '' : cur) + '/' + n
  const crumbs = cur.split('/').filter(Boolean)

  return (
    <div className="finder">
      <aside>
        <div className="side-title">Favoritos</div>
        {SIDEBAR.filter((s) => localFs.isDir(s.path)).map((s) => (
          <div key={s.path} className={`side-item ${cur === s.path ? 'active' : ''}`} onClick={() => go(s.path)}>
            <FolderIcon size={16} /> {s.label}
          </div>
        ))}
      </aside>
      <main>
        <div className="finder-bar">
          <button disabled={!back.length} onClick={() => (setPath(back[back.length - 1]), setBack((b) => b.slice(0, -1)), setPreview(null))} aria-label="Voltar">‹</button>
          <button disabled={cur === '/'} onClick={() => go(cur.split('/').slice(0, -1).join('/') || '/')} aria-label="Pasta acima">↑</button>
          <div className="crumbs">
            <span onClick={() => go('/')}>/</span>
            {crumbs.map((c, i) => (
              <span key={i} onClick={() => go('/' + crumbs.slice(0, i + 1).join('/'))}>{c}</span>
            ))}
          </div>
          <span className="count">{entries.length} itens</span>
        </div>
        <div className="finder-body">
          <div className="grid" onClick={() => setSelected(null)}>
            {entries.length === 0 && <div className="empty">Pasta vazia</div>}
            {entries.map(([n, node]) => (
              <div
                key={n}
                className={`item ${selected === n ? 'sel' : ''}`}
                onClick={(e) => (e.stopPropagation(), setSelected(n))}
                onDoubleClick={() => (node.type === 'dir' ? go(join(n)) : setPreview({ name: n, content: node.content }))}
              >
                {node.type === 'dir' ? <FolderIcon /> : <FileIcon ext={n.includes('.') ? n.split('.').pop() : ''} />}
                <span>{n}</span>
              </div>
            ))}
          </div>
          {preview && (
            <div className="preview">
              <div className="preview-head">
                <strong>{preview.name}</strong>
                <button onClick={() => setPreview(null)} aria-label="Fechar visualização">×</button>
              </div>
              <pre>{preview.content || '(arquivo vazio)'}</pre>
            </div>
          )}
        </div>
        <div className="finder-status">Dica: dê dois cliques para abrir. Tudo que você cria no Terminal aparece aqui.</div>
      </main>
    </div>
  )
}
