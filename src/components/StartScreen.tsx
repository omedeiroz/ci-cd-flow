// Tela inicial do jogo: continuar, novo jogo, carregar/exportar/importar saves e seleção de missões.
import { useRef, useState } from 'react'
import { useOS } from '../store/os'
import { persist, progressOf, SLOT_IDS, type Profile, type SlotMeta } from '../store/persist'
import { missions } from '../engine/missions'
import { AnimeAvatar, FEMININE_AVATARS, MASCULINE_AVATARS, PLAYER_AVATARS as AVATARS } from './AnimeAvatar'
import { LogoMark } from './Icons'

type View = 'home' | 'load' | 'new' | 'missions'

export const VERSION_LABEL = 'versão 0.12'

const when = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000)
  if (s < 60) return 'agora mesmo'
  if (s < 3600) return `há ${Math.round(s / 60)} min`
  if (s < 86400) return `há ${Math.round(s / 3600)} h`
  return new Date(ms).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}
const played = (ms: number) => {
  const m = Math.round(ms / 60000)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}
const whereIs = (m: SlotMeta) =>
  m.openWorld ? '🌍 Mundo aberto' : `${missions[m.missionIdx]?.title ?? ''}${m.missionDone ? ' · concluída' : ` · passo ${m.stepIdx + 1} de ${missions[m.missionIdx]?.steps.length}`}`

// ---------- ações (trocar de jogo depois de um já carregado exige recarregar a página) ----------

function play(id: number) {
  if (persist.dirty && persist.active === id) return persist.resume()
  if (persist.dirty) return persist.boot({ action: 'continue', slot: id })
  if (persist.restore(id)) useOS.setState({ screen: 'desktop', flash: 'Progresso carregado. Continue de onde parou!' })
}
function startNew(id: number, profile: Profile, mission: number) {
  if (persist.dirty) return persist.boot({ action: 'new', slot: id, profile, mission })
  persist.newGame(id, profile)
  if (mission > 0) useOS.getState().startMission(mission)
  useOS.setState({ screen: 'desktop' })
  persist.save()
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ---------- telas ----------

export function StartScreen() {
  const [view, setView] = useState<View>('home')
  const [missionPick, setMissionPick] = useState(0)
  const [, force] = useState(0)
  const slots = persist.slots()
  const last = persist.active ?? persist.lastActive()
  const current = slots.find((s) => s.id === last)
  const refresh = () => force((n) => n + 1)

  return (
    <div className="title-screen">
      <div className="wallpaper" />
      <div className="start-shade" />
      <div className="start-panel">
        <div className="start-brand">
          <span className="start-logo"><LogoMark /></span>
          <div>
            <h1>DevOps Lab</h1>
            <p>Aprenda DevOps na prática: terminal, Git, nuvem, Docker e CI/CD.</p>
          </div>
        </div>

        {view === 'home' && (
          <Home
            current={current}
            hasSaves={slots.length > 0}
            go={setView}
            onNew={() => (setMissionPick(0), setView('new'))}
          />
        )}
        {view === 'load' && <Load slots={slots} active={last} back={() => setView('home')} refresh={refresh} />}
        {view === 'new' && <NewGame slots={slots} mission={missionPick} setMission={setMissionPick} back={() => setView('home')} />}
        {view === 'missions' && (
          <Missions
            current={current}
            back={() => setView('home')}
            pick={(i) => {
              setMissionPick(i)
              setView('new')
            }}
          />
        )}
        <div className="start-foot">DevOps Lab · {VERSION_LABEL} · o progresso fica salvo neste navegador</div>
      </div>
    </div>
  )
}

function Home({ current, hasSaves, go, onNew }: { current?: SlotMeta; hasSaves: boolean; go: (v: View) => void; onNew: () => void }) {
  return (
    <div className="start-home">
      {current ? (
        <button className="start-continue" onClick={() => play(current.id)} autoFocus>
          <AnimeAvatar seed={current.profile.avatar} size={64} />
          <div className="start-continue-info">
            <span className="start-kicker">Continuar · Save {current.id}</span>
            <b>{current.profile.name}</b>
            <span>{whereIs(current)}</span>
            <div className="start-bar"><i style={{ width: `${current.pct}%` }} /></div>
            <small>
              {current.pct}% concluído · {played(current.playedMs)} jogados · salvo {when(current.savedAt)}
            </small>
          </div>
          <span className="start-play">▶</span>
        </button>
      ) : (
        <div className="start-welcome">
          <b>Bem-vindo(a)!</b>
          <p>Você vai entrar num computador simulado e, com a ajuda do Guia, colocar uma aplicação de verdade em produção com um pipeline de CI/CD.</p>
        </div>
      )}
      <div className="start-menu">
        <button className={current ? '' : 'primary'} onClick={onNew}>
          <span>✦</span> Novo jogo
        </button>
        <button onClick={() => go('load')} title={hasSaves ? '' : 'Nenhum save ainda: importe um arquivo'}>
          <span>⧉</span> Carregar
        </button>
        <button onClick={() => go('missions')}>
          <span>☰</span> Missões
        </button>
      </div>
    </div>
  )
}

function Load({ slots, active, back, refresh }: { slots: SlotMeta[]; active: number | null; back: () => void; refresh: () => void }) {
  const [confirm, setConfirm] = useState<number | null>(null)
  const [msg, setMsg] = useState<{ id: number; text: string; ok?: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const target = useRef<number>(1)
  const pickFile = (id: number) => {
    target.current = id
    fileRef.current?.click()
  }
  return (
    <div className="start-sub">
      <Header title="Carregar jogo" back={back} />
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          const id = target.current
          if (id === persist.active && persist.dirty) return setMsg({ id, text: 'Esse save está aberto agora. Importe em outro slot.' })
          const err = persist.importSave(await f.text(), id)
          setMsg(err ? { id, text: err } : { id, text: 'Save importado.', ok: true })
          refresh()
        }}
      />
      <div className="start-slots">
        {SLOT_IDS.map((id) => {
          const m = slots.find((s) => s.id === id)
          return (
            <div key={id} className={`start-slot ${m ? '' : 'empty'} ${id === active ? 'active' : ''}`}>
              <div className="start-slot-num">{id}</div>
              {m ? (
                <>
                  <AnimeAvatar seed={m.profile.avatar} size={48} />
                  <div className="start-slot-info">
                    <b>
                      {m.profile.name} {id === active && <em>último jogado</em>}
                    </b>
                    <span>{whereIs(m)}</span>
                    <div className="start-bar small"><i style={{ width: `${m.pct}%` }} /></div>
                    <small>
                      {m.pct}% · {played(m.playedMs)} · salvo {when(m.savedAt)}
                    </small>
                  </div>
                  <div className="start-slot-actions">
                    {confirm === id ? (
                      <>
                        <span className="start-warn">Apagar este save?</span>
                        <button
                          className="danger"
                          onClick={() => {
                            persist.deleteSlot(id)
                            setConfirm(null)
                            refresh()
                          }}
                        >
                          Apagar
                        </button>
                        <button onClick={() => setConfirm(null)}>Cancelar</button>
                      </>
                    ) : (
                      <>
                        <button className="primary" onClick={() => play(id)}>Jogar</button>
                        <button
                          title="Baixar um arquivo .json com este save"
                          onClick={() => {
                            const t = persist.exportSlot(id)
                            if (t) download(`devops-lab-save${id}-${m.profile.name.toLowerCase().replace(/\W+/g, '-')}.json`, t)
                          }}
                        >
                          Exportar
                        </button>
                        <button onClick={() => setConfirm(id)} title="Apagar este save">🗑</button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="start-slot-info">
                    <b>Vazio</b>
                    <small>Comece um jogo novo aqui ou importe um save (.json).</small>
                  </div>
                  <div className="start-slot-actions">
                    <button onClick={() => pickFile(id)}>Importar arquivo…</button>
                  </div>
                </>
              )}
              {msg?.id === id && <div className={`start-msg ${msg.ok ? 'ok' : ''}`}>{msg.text}</div>}
            </div>
          )
        })}
      </div>
      <p className="start-hint">Dica: exporte o save para continuar em outro computador ou para mostrar seu progresso a um professor.</p>
    </div>
  )
}

function NewGame({ slots, mission, setMission, back }: { slots: SlotMeta[]; mission: number; setMission: (n: number) => void; back: () => void }) {
  const firstEmpty = SLOT_IDS.find((id) => !slots.some((s) => s.id === id))
  const [slot, setSlot] = useState(firstEmpty ?? SLOT_IDS[0])
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState(() => AVATARS[Math.floor(Math.random() * AVATARS.length)])
  const [kind, setKind] = useState<'all' | 'm' | 'f'>('all')
  const shown = kind === 'm' ? MASCULINE_AVATARS : kind === 'f' ? FEMININE_AVATARS : AVATARS
  const taken = slots.find((s) => s.id === slot)
  const ok = name.trim().length >= 2
  return (
    <div className="start-sub">
      <Header title="Novo jogo" back={back} />
      <form
        className="start-form"
        onSubmit={(e) => {
          e.preventDefault()
          if (ok) startNew(slot, { name: name.trim(), avatar }, mission)
        }}
      >
        <label className="start-field">
          <span>Seu nome</span>
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} placeholder="Como quer ser chamado(a)?" autoFocus aria-label="Seu nome" />
        </label>
        <div className="start-field">
          <span className="start-avatar-label">
            Avatar
            <span className="start-avatar-tools">
              {(
                [
                  ['all', 'Todos'],
                  ['m', 'Masculinos'],
                  ['f', 'Femininos'],
                ] as const
              ).map(([k, label]) => (
                <button type="button" key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
                  {label}
                </button>
              ))}
              <button type="button" onClick={() => setAvatar(shown[Math.floor(Math.random() * shown.length)])}>🎲 Aleatório</button>
            </span>
          </span>
          <div className="start-avatars">
            {shown.map((a) => (
              <button type="button" key={a} className={a === avatar ? 'on' : ''} onClick={() => setAvatar(a)} aria-label={`Avatar ${a}`}>
                <AnimeAvatar seed={a} size={40} />
              </button>
            ))}
          </div>
        </div>
        <div className="start-row">
          <label className="start-field">
            <span>Slot</span>
            <select value={slot} onChange={(e) => setSlot(Number(e.target.value))} aria-label="Slot do save">
              {SLOT_IDS.map((id) => {
                const m = slots.find((s) => s.id === id)
                return (
                  <option key={id} value={id}>
                    Save {id} · {m ? `${m.profile.name} (${m.pct}%)` : 'vazio'}
                  </option>
                )
              })}
            </select>
          </label>
          <label className="start-field">
            <span>Começar em</span>
            <select value={mission} onChange={(e) => setMission(Number(e.target.value))} aria-label="Missão inicial">
              {missions.map((m, i) => (
                <option key={m.id} value={i}>
                  {m.title}
                </option>
              ))}
            </select>
          </label>
        </div>
        {taken && <div className="start-msg">⚠ O Save {slot} ({taken.profile.name}, {taken.pct}%) será substituído.</div>}
        {mission > 0 && <div className="start-msg info">As missões anteriores serão montadas automaticamente: conta no GitHub, servidor na AWS e o que mais elas deixariam pronto.</div>}
        <button className="start-go" disabled={!ok}>Começar ▶</button>
      </form>
    </div>
  )
}

function Missions({ current, back, pick }: { current?: SlotMeta; back: () => void; pick: (i: number) => void }) {
  const [open, setOpen] = useState<number | null>(current && !current.openWorld ? current.missionIdx : 0)
  const state = (i: number) => {
    if (!current) return 'new'
    if (current.openWorld || i < current.missionIdx || (i === current.missionIdx && current.missionDone)) return 'done'
    if (i === current.missionIdx) return 'current'
    return 'locked'
  }
  return (
    <div className="start-sub">
      <Header title="Missões" back={back} />
      {current && <p className="start-hint">Progresso do Save {current.id} ({current.profile.name}): {progressOf(current.missionIdx, current.stepIdx, current.missionDone, current.openWorld)}%</p>}
      <div className="start-missions">
        {missions.map((m, i) => {
          const st = state(i)
          return (
            <div key={m.id} className={`start-mission ${st} ${open === i ? 'open' : ''}`}>
              <button className="start-mission-head" onClick={() => setOpen(open === i ? null : i)}>
                <span className="start-mission-badge">{st === 'done' ? '✓' : st === 'locked' ? '🔒' : i + 1}</span>
                <span>
                  <b>{m.short}</b>
                  <small>{m.steps.length} passos{st === 'current' ? ' · em andamento' : st === 'done' ? ' · concluída' : ''}</small>
                </span>
                <span className="start-chev">{open === i ? '▾' : '▸'}</span>
              </button>
              {open === i && (
                <div className="start-mission-body">
                  <p>{m.summary}</p>
                  <div className="start-mission-actions">
                    {st === 'current' && current && (
                      <button className="primary" onClick={() => play(current.id)}>Continuar ▶</button>
                    )}
                    <button onClick={() => pick(i)}>{st === 'done' ? 'Rejogar num save novo' : 'Começar daqui num save novo'}</button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        <div className={`start-mission ${current?.openWorld ? 'current' : 'locked'}`}>
          <div className="start-mission-head static">
            <span className="start-mission-badge">🌍</span>
            <span>
              <b>Mundo aberto</b>
              <small>Libera ao terminar as {missions.length} missões: convites de outros times para montar o CI/CD de novos projetos.</small>
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Header({ title, back }: { title: string; back: () => void }) {
  return (
    <div className="start-head">
      <button onClick={back} aria-label="Voltar">‹ Voltar</button>
      <h2>{title}</h2>
    </div>
  )
}
