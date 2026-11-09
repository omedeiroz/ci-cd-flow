import { useEffect, useState } from 'react'
import { APPS, useOS } from '../store/os'
import { LogoMark } from './Icons'
import { VERSION_LABEL } from './StartScreen'
import { AnimeAvatar } from './AnimeAvatar'
import { missions } from '../engine/missions'
import { persist } from '../store/persist'

const fmt = (d: Date) => {
  const day = d.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '')
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `${day[0].toUpperCase()}${day.slice(1)}  ${time}`
}

export function MenuBar() {
  const focused = useOS((s) => s.focused)
  const [now, setNow] = useState(new Date())
  const [menu, setMenu] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  useOS((s) => s.version)
  const missionIdx = useOS((s) => s.missionIdx)
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  const appName = APPS.find((a) => a.id === focused)?.name ?? 'Finder'

  return (
    <div className="menubar">
      <div className="left">
        <button className="logo" onPointerDown={(e) => (e.stopPropagation(), setConfirmReset(false), setMenu((m) => !m))} aria-label="Menu do sistema">
          <LogoMark />
        </button>
        {menu && (
          <div className="dropdown" onPointerDown={(e) => e.stopPropagation()}>
            <div className="item" onClick={() => (useOS.getState().openApp('guide'), setMenu(false))}>Abrir o Guia</div>
            <div className="item" onClick={() => (useOS.getState().resetMission(), setMenu(false))}>Reiniciar missão atual</div>
            <div className="sep" />
            <div className="item muted">Pular para a missão</div>
            {missions.map((m, i) =>
              i > missionIdx ? (
                <div key={m.id} className="item" onClick={() => (useOS.getState().startMission(i), useOS.getState().openApp('guide'), setMenu(false))}>
                  {i + 1}. {m.short}
                </div>
              ) : null,
            )}
            <div className="item" onClick={() => (useOS.getState().startOpenWorld(), setMenu(false))}>🌍 Mundo aberto</div>
            <div className="sep" />
            <div className="item" onClick={() => (persist.save(), setMenu(false))}>💾 Salvar agora</div>
            <div className="item" onClick={() => (setMenu(false), persist.toMenu())}>⌂ Menu principal</div>
            {confirmReset ? (
              <div
                className="item danger"
                onClick={() => persist.boot({ action: 'new', slot: persist.active ?? 1, profile: persist.profile ?? { name: 'Aluno(a)', avatar: 7 }, mission: 0 })}
              >
                ⚠️ Confirmar: recomeçar este save do zero
              </div>
            ) : (
              <div className="item" onClick={() => setConfirmReset(true)}>↺ Recomeçar este save…</div>
            )}
            <div className="sep" />
            <div className="item muted">DevOps Lab · {VERSION_LABEL}{persist.active ? ` · Save ${persist.active}` : ''}</div>
          </div>
        )}
        <span className="app">{appName}</span>
        {['Arquivo', 'Editar', 'Visualizar', 'Janela', 'Ajuda'].map((m) => (
          <span key={m} className="m">{m}</span>
        ))}
      </div>
      <div className="right">
        <svg viewBox="0 0 24 16" width="18" height="12"><rect x="1" y="2" width="19" height="12" rx="3" fill="none" stroke="currentColor" strokeWidth="1.4" /><rect x="3" y="4" width="13" height="8" rx="1.5" fill="currentColor" /><rect x="21" y="6" width="2" height="4" rx="1" fill="currentColor" /></svg>
        <svg viewBox="0 0 20 16" width="16" height="12"><path d="M10 14l2.6-3a3.6 3.6 0 0 0-5.2 0zM4.8 8.2a7.4 7.4 0 0 1 10.4 0l1.6-1.8a9.9 9.9 0 0 0-13.6 0zM1.6 4.6a12 12 0 0 1 16.8 0L20 2.8a14.6 14.6 0 0 0-20 0z" fill="currentColor" /></svg>
        <svg viewBox="0 0 16 16" width="13" height="13"><circle cx="6.5" cy="6.5" r="4.8" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M10 10l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        <span className={`saved ${persist.error ? 'err' : ''}`} title={persist.error || (persist.lastSaved ? `Progresso salvo neste navegador às ${new Date(persist.lastSaved).toLocaleTimeString('pt-BR')}` : 'O progresso é salvo automaticamente neste navegador')}>
          {persist.error ? '⚠ Não salvo' : '✓ Salvo'}
        </span>
        {persist.profile && (
          <span className="who" title={`Save ${persist.active}`} onClick={() => persist.toMenu()}>
            <AnimeAvatar seed={persist.profile.avatar} size={16} /> {persist.profile.name}
          </span>
        )}
        <span className="clock">{fmt(now)}</span>
      </div>
    </div>
  )
}
