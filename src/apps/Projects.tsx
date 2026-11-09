// Quadro do mundo aberto: os projetos que os times pediram, com status e critérios.
import { useEffect, useState } from 'react'
import { github } from '../engine/github'
import { openWorld, PROJECTS } from '../engine/openworld'
import { useOS } from '../store/os'
import { AnimeAvatar } from '../components/AnimeAvatar'

const LABEL = { aguardando: 'Aguardando convite', convite: 'Convite pendente', andamento: 'Em andamento', concluido: 'Concluído' } as const

export function ProjectsBoard() {
  useOS((s) => s.version)
  const flash = useOS((s) => s.flash)
  const [openId, setOpenId] = useState<string | null>(null)
  const [tips, setTips] = useState<Record<string, boolean>>({})
  const u = github.student()
  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => useOS.setState({ flash: null }), 7000)
    return () => clearTimeout(t)
  }, [flash])
  if (!u) return null
  const list = PROJECTS.map((p) => ({ p, st: openWorld.status(p, u.login) }))
  const done = list.filter((x) => x.st === 'concluido').length
  return (
    <div className="guide">
      <header>
        <div className="eyebrow">🌍 Mundo aberto</div>
        <h2>Projetos dos times</h2>
        <p>Outros times da DevLab precisam de CI/CD. Aceite os convites no GitHub e entregue cada projeto. Aqui não tem passo a passo: os critérios são verificados automaticamente.</p>
        <div className="progress">
          <div style={{ width: `${(done / PROJECTS.length) * 100}%` }} />
        </div>
        <div className="progress-label">{done} de {PROJECTS.length} projetos concluídos</div>
      </header>
      {flash && <div className="flash">✓ {flash}</div>}
      <div className="pj-list">
        {list.map(({ p, st }) => {
          const who = github.user(p.from)
          const isOpen = openId === p.id
          return (
            <div key={p.id} className={`pj ${st}`}>
              <div className="pj-head" onClick={() => setOpenId(isOpen ? null : p.id)}>
                {who ? <AnimeAvatar seed={who.avatar} size={32} /> : <span className="pj-ph" />}
                <div className="pj-title">
                  <b>{p.title}</b>
                  <span>devlab/{p.repo} · {p.stack}</span>
                </div>
                <span className={`pj-pill ${st}`}>{st === 'concluido' ? '✓ ' : ''}{LABEL[st]}</span>
              </div>
              {isOpen && (
                <div className="pj-body">
                  {who && <p className="pj-from">Pedido de <b>{who.name}</b>:</p>}
                  <p>{p.brief}</p>
                  <h4>Critérios de aceite</h4>
                  <ul>
                    {p.criteria.map((c) => (
                      <li key={c}>{st === 'concluido' ? '✅' : '◻️'} {c}</li>
                    ))}
                  </ul>
                  <div className="pj-actions">
                    {st === 'convite' && <button onClick={() => useOS.getState().openBrowser(`https://github.sim/devlab/${p.repo}/invitations`, true)}>Ver convite</button>}
                    {st !== 'aguardando' && <button className="ghost" onClick={() => useOS.getState().openBrowser(`https://github.sim/devlab/${p.repo}`, true)}>Abrir repositório</button>}
                    <button className="ghost" onClick={() => setTips((t) => ({ ...t, [p.id]: !t[p.id] }))}>{tips[p.id] ? 'Esconder dicas' : '💡 Dicas'}</button>
                  </div>
                  {tips[p.id] && (
                    <ul className="pj-tips">
                      {p.tips.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {done === PROJECTS.length && (
        <div className="done-card">
          <div className="big">🏆</div>
          <strong>Todos os projetos entregues!</strong>
          <p>Você montou CI/CD para seis serviços diferentes: Pages, lint, depuração, matrix, agendamento e infraestrutura do zero.</p>
        </div>
      )}
    </div>
  )
}
