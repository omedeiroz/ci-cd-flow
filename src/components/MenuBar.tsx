// Barra de menus do "Mac": menu ∞ do sistema e menus do app em foco (Arquivo, Editar, Visualizar, Janela, Ajuda).
import { useEffect, useState } from 'react'
import { APPS, lockReason, useOS, type AppId } from '../store/os'
import { appCommand } from '../store/appCommands'
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

type Item = { label: string; run?: () => void; key?: string; danger?: boolean; checked?: boolean; keepOpen?: boolean } | 'sep' | { header: string }
type Menu = { name: string; bold?: boolean; items: Item[] }

const os = () => useOS.getState()
const cmd = (id: AppId | null, name: string) => appCommand(id, name)

// ---------- ações genéricas de edição (campos de texto do app em foco) ----------

const editable = () => {
  const el = document.activeElement as HTMLElement | null
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) ? el : null
}
const exec = (c: string) => {
  try {
    document.execCommand(c)
  } catch {
    /* não suportado */
  }
}
const pasteText = async () => {
  try {
    const t = await navigator.clipboard.readText()
    if (editable()) document.execCommand('insertText', false, t)
  } catch {
    /* sem permissão para ler a área de transferência */
  }
}

/** Organiza as janelas abertas lado a lado. */
function tile() {
  const { windows } = os()
  const open = (Object.keys(windows) as AppId[]).filter((id) => windows[id]?.open && !windows[id]?.minimized)
  if (!open.length) return
  const vw = window.innerWidth
  const vh = window.innerHeight - 28 - 90
  const cols = open.length <= 2 ? open.length : Math.ceil(open.length / 2)
  const rows = Math.ceil(open.length / cols)
  const w = Math.floor((vw - 16 * (cols + 1)) / cols)
  const h = Math.floor((vh - 12 * (rows + 1)) / rows)
  open.forEach((id, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    os().setRect(id, { x: 16 + c * (w + 16), y: 40 + r * (h + 12), w, h })
    if (windows[id]?.maximized) os().toggleMax(id)
  })
}
function center(id: AppId) {
  const w = os().windows[id]
  if (!w) return
  os().setRect(id, { x: Math.max(0, (window.innerWidth - w.w) / 2), y: Math.max(36, (window.innerHeight - w.h) / 2 - 30) })
}

export function MenuBar() {
  const focused = useOS((s) => s.focused)
  const windows = useOS((s) => s.windows)
  const missionIdx = useOS((s) => s.missionIdx)
  useOS((s) => s.version)
  const [now, setNow] = useState(new Date())
  const [open, setOpen] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [modal, setModal] = useState<null | 'about' | 'keys'>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10_000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(null)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  const app = APPS.find((a) => a.id === focused)
  const appName = app?.name ?? 'Finder'
  const win = focused ? windows[focused] : undefined
  const has = (name: string) => !!cmd(focused, name)
  const run = (name: string) => (has(name) ? () => cmd(focused, name)?.() : undefined)
  const openWins = APPS.filter((a) => windows[a.id]?.open)

  // ---------- menus ----------
  const system: Item[] = [
    { label: 'Sobre o DevOps Lab', run: () => setModal('about') },
    'sep',
    { label: 'Abrir o Guia', run: () => os().openApp('guide') },
    { label: 'Reiniciar missão atual', run: () => os().resetMission() },
    'sep',
    { header: 'Pular para a missão' },
    ...missions.flatMap((m, i): Item[] => (i > missionIdx ? [{ label: `${i + 1}. ${m.short}`, run: () => (os().startMission(i), os().openApp('guide')) }] : [])),
    { label: '🌍 Mundo aberto', run: () => os().startOpenWorld() },
    'sep',
    { label: '💾 Salvar agora', run: () => persist.save() },
    { label: '⌂ Menu principal', run: () => persist.toMenu() },
    confirmReset
      ? {
          label: '⚠️ Confirmar: recomeçar este save do zero',
          danger: true,
          run: () => persist.boot({ action: 'new', slot: persist.active ?? 1, profile: persist.profile ?? { name: 'Aluno(a)', avatar: 7 }, mission: 0 }),
        }
      : { label: '↺ Recomeçar este save…', keepOpen: true, run: () => setConfirmReset(true) },
  ]

  const fileItems: Item[] =
    focused === 'browser'
      ? [
          { label: 'Nova aba', run: run('newTab') },
          { label: 'Abrir endereço…', run: run('focusAddress') },
          'sep',
          { label: 'Fechar aba', run: run('closeTab') },
          { label: 'Fechar janela', run: () => os().closeApp('browser') },
        ]
      : focused === 'editor'
        ? [
            { label: 'Novo arquivo', key: 'Ctrl+N', run: run('newFile') },
            { label: 'Abrir pasta…', run: run('openFolder') },
            { label: 'Abrir arquivo…', key: 'Ctrl+P', run: run('openFile') },
            'sep',
            { label: 'Salvar', key: 'Ctrl+S', run: run('save') },
            { label: 'Salvar tudo', run: run('saveAll') },
            'sep',
            { label: 'Fechar arquivo', run: run('closeFile') },
            { label: 'Fechar pasta', run: run('closeFolder') },
            { label: 'Fechar janela', run: () => os().closeApp('editor') },
          ]
        : focused === 'terminal'
          ? [
              { label: 'Nova aba no Navegador', run: () => os().openBrowser('about:start', true) },
              'sep',
              { label: 'Fechar janela', run: () => os().closeApp('terminal') },
            ]
          : [
              { label: 'Abrir Terminal', run: () => os().openApp('terminal') },
              { label: 'Abrir Finder', run: () => os().openApp('finder') },
              ...(focused ? (['sep', { label: 'Fechar janela', run: () => os().closeApp(focused) }] as Item[]) : []),
            ]

  const editItems: Item[] =
    focused === 'terminal'
      ? [
          { label: 'Copiar', run: run('copy') },
          { label: 'Colar', run: run('paste') },
          { label: 'Selecionar tudo', run: run('selectAll') },
          'sep',
          { label: 'Limpar tela', key: 'Ctrl+L', run: run('clear') },
        ]
      : [
          { label: 'Desfazer', run: () => exec('undo') },
          { label: 'Refazer', run: () => exec('redo') },
          'sep',
          { label: 'Recortar', run: () => exec('cut') },
          { label: 'Copiar', run: () => exec('copy') },
          { label: 'Colar', run: () => void pasteText() },
          { label: 'Selecionar tudo', run: () => exec('selectAll') },
        ]

  const viewItems: Item[] = [
    ...(focused === 'terminal'
      ? ([
          { label: 'Aumentar fonte', run: run('fontUp') },
          { label: 'Diminuir fonte', run: run('fontDown') },
          { label: 'Tamanho original', run: run('fontReset') },
          'sep',
        ] as Item[])
      : []),
    ...(focused === 'browser'
      ? ([
          { label: 'Recarregar página', run: run('reload') },
          { label: 'Voltar', run: run('back') },
          { label: 'Avançar', run: run('forward') },
          'sep',
        ] as Item[])
      : []),
    ...(focused === 'editor'
      ? ([
          { label: 'Paleta de comandos…', key: 'Ctrl+Shift+P', run: run('palette') },
          { label: 'Explorer', key: 'Ctrl+Shift+E', run: run('explorer') },
          { label: 'Pesquisar', key: 'Ctrl+Shift+F', run: run('search') },
          { label: 'Controle de código-fonte', key: 'Ctrl+Shift+G', run: run('scm') },
          { label: 'Terminal integrado', key: 'Ctrl+`', run: run('toggleTerminal') },
          'sep',
        ] as Item[])
      : []),
    ...(focused ? [{ label: win?.maximized ? 'Sair da tela cheia' : 'Tela cheia', run: () => os().toggleMax(focused) }] : [{ label: 'Nenhuma janela em foco' }]),
  ]

  const windowItems: Item[] = [
    ...(focused
      ? ([
          { label: 'Minimizar', run: () => os().minimize(focused) },
          { label: 'Zoom', run: () => os().toggleMax(focused) },
          { label: 'Centralizar', run: () => center(focused) },
        ] as Item[])
      : []),
    { label: 'Organizar janelas lado a lado', run: tile },
    'sep',
    ...(openWins.length
      ? openWins.map((a): Item => ({ label: `${a.name}${windows[a.id]?.minimized ? ' (minimizado)' : ''}`, checked: a.id === focused, run: () => os().openApp(a.id) }))
      : [{ header: 'Nenhuma janela aberta' } as Item]),
  ]

  const helpItems: Item[] = [
    { label: 'Abrir o Guia', run: () => os().openApp('guide') },
    { label: 'Comandos do terminal', run: () => os().typeInTerminal('help') },
    { label: 'Atalhos de teclado', run: () => setModal('keys') },
    'sep',
    { label: 'Sobre o DevOps Lab', run: () => setModal('about') },
  ]

  const menus: Menu[] = [
    {
      name: appName,
      bold: true,
      items: [
        { label: `Sobre o ${appName}`, run: () => setModal('about') },
        'sep',
        ...(focused
          ? ([
              { label: `Ocultar ${appName}`, run: () => os().minimize(focused) },
              { label: `Encerrar ${appName}`, run: () => os().closeApp(focused) },
            ] as Item[])
          : [{ header: 'Abra um app pelo Dock' } as Item]),
      ],
    },
    { name: 'Arquivo', items: fileItems },
    { name: 'Editar', items: editItems },
    { name: 'Visualizar', items: viewItems },
    { name: 'Janela', items: windowItems },
    { name: 'Ajuda', items: helpItems },
  ]

  const renderItems = (items: Item[]) =>
    items.map((it, i) => {
      if (it === 'sep') return <div key={i} className="sep" />
      if ('header' in it) return <div key={i} className="item muted">{it.header}</div>
      const disabled = !it.run
      return (
        <div
          key={i}
          className={`item ${it.danger ? 'danger' : ''} ${disabled ? 'disabled' : ''}`}
          onMouseDown={(e) => e.preventDefault()} // não tira o foco do campo de texto (Copiar/Colar)
          onClick={() => {
            if (disabled) return
            it.run!()
            if (!it.keepOpen) setOpen(null)
          }}
        >
          <span className="check">{it.checked ? '✓' : ''}</span>
          <span className="label">{it.label}</span>
          {it.key && <span className="key">{it.key}</span>}
        </div>
      )
    })

  const toggle = (name: string) => (e: React.PointerEvent) => {
    e.stopPropagation()
    setConfirmReset(false)
    setOpen((o) => (o === name ? null : name))
  }
  const hover = (name: string) => () => open && open !== name && setOpen(name)

  return (
    <div className="menubar">
      <div className="left">
        <span className="menu-root">
          <button className={`logo ${open === '∞' ? 'on' : ''}`} onPointerDown={toggle('∞')} onMouseEnter={hover('∞')} aria-label="Menu do sistema">
            <LogoMark />
          </button>
          {open === '∞' && (
            <div className="dropdown" onPointerDown={(e) => e.stopPropagation()}>
              {renderItems(system)}
              <div className="sep" />
              <div className="item muted">DevOps Lab · {VERSION_LABEL}{persist.active ? ` · Save ${persist.active}` : ''}</div>
            </div>
          )}
        </span>
        {menus.map((m) => (
          <span key={m.name} className="menu-root">
            <span className={`m ${m.bold ? 'app' : ''} ${open === m.name ? 'on' : ''}`} onPointerDown={toggle(m.name)} onMouseEnter={hover(m.name)}>
              {m.name}
            </span>
            {open === m.name && (
              <div className="dropdown" onPointerDown={(e) => e.stopPropagation()}>
                {renderItems(m.items)}
              </div>
            )}
          </span>
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
          <span className="who" title={`Save ${persist.active} · voltar ao menu principal`} onClick={() => persist.toMenu()}>
            <AnimeAvatar seed={persist.profile.avatar} size={16} /> {persist.profile.name}
          </span>
        )}
        <span className="clock">{fmt(now)}</span>
      </div>
      {modal && <Modal kind={modal} close={() => setModal(null)} />}
    </div>
  )
}

function Modal({ kind, close }: { kind: 'about' | 'keys'; close: () => void }) {
  const locked = APPS.filter((a) => lockReason(a, useOS.getState().missionIdx))
  return (
    <div className="mb-modal-bg" onPointerDown={close}>
      <div className="mb-modal" onPointerDown={(e) => e.stopPropagation()}>
        {kind === 'about' ? (
          <>
            <div className="mb-modal-logo"><LogoMark /></div>
            <h3>DevOps Lab</h3>
            <p className="muted">{VERSION_LABEL}</p>
            <p>Um computador simulado para aprender DevOps na prática: terminal, Git e GitHub, servidores na nuvem, Docker e pipelines de CI/CD.</p>
            <p className="muted">Tudo roda no seu navegador. Nenhum comando sai daqui, e as contas, servidores e pessoas são fictícios.</p>
            {locked.length > 0 && <p className="muted">Apps ainda bloqueados: {locked.map((a) => `${a.name} (${lockReason(a, useOS.getState().missionIdx)})`).join(', ')}.</p>}
          </>
        ) : (
          <>
            <h3>Atalhos de teclado</h3>
            <table>
              <tbody>
                <tr><th colSpan={2}>Terminal</th></tr>
                <tr><td>Tab</td><td>completa comandos e caminhos</td></tr>
                <tr><td>↑ / ↓</td><td>histórico de comandos</td></tr>
                <tr><td>Ctrl+C</td><td>cancela a linha (ou para um processo)</td></tr>
                <tr><td>Ctrl+L</td><td>limpa a tela</td></tr>
                <tr><td>Ctrl+U</td><td>apaga a linha até o cursor</td></tr>
                <tr><td>Ctrl+D</td><td>sai de uma sessão ssh</td></tr>
                <tr><th colSpan={2}>Editor</th></tr>
                <tr><td>Ctrl+S</td><td>salvar</td></tr>
                <tr><td>Ctrl+P</td><td>abrir arquivo pelo nome</td></tr>
                <tr><td>Ctrl+Shift+P</td><td>paleta de comandos</td></tr>
                <tr><td>Ctrl+`</td><td>terminal integrado</td></tr>
                <tr><td>Ctrl+Shift+E / F / G</td><td>Explorer, Pesquisar, Git</td></tr>
              </tbody>
            </table>
          </>
        )}
        <button onClick={close}>OK</button>
      </div>
    </div>
  )
}
