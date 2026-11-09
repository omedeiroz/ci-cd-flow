import { useEffect, useState } from 'react'
import { missions } from '../engine/missions'
import { hintCtx, localFs, useOS } from '../store/os'
import { editor } from '../engine/editor'
import { allRepos } from '../engine/git'
import { ProjectsBoard } from './Projects'

/** Converte `trechos` em <code>. */
const Rich = ({ text }: { text: string }) => (
  <>
    {text.split(/(`[^`]+`)/).map((p, i) => (p.startsWith('`') ? <code key={i}>{p.slice(1, -1)}</code> : <span key={i}>{p}</span>))}
  </>
)

function Snippet({ file, code, mode }: { file: string; code: string; mode: 'replace' | 'append' }) {
  const [msg, setMsg] = useState('')
  const insert = () => {
    // o caminho do trecho é sempre relativo à raiz do repositório
    const root = allRepos(localFs).find((r) => r.remoteKey === 'devlab/todo-api')?.root ?? editor.root
    if (!root) return setMsg('Abra o projeto no editor primeiro (code .).')
    const abs = `${root}/${file}`
    editor.openFile(editor.fs ?? localFs, abs)
    const b = editor.open.find((x) => x.path === abs)!
    const content = mode === 'replace' ? code : b.content.replace(/\s*$/, '\n') + code
    editor.setContent(abs, content)
    setMsg('Inserido no editor. Agora salve com ⌘S / Ctrl+S.')
  }
  return (
    <div className="snippet">
      <div className="snippet-head">
        <span>📄 {file}{mode === 'append' ? ' (adicionar ao final)' : ''}</span>
        <span>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code)
                setMsg('Copiado!')
              } catch {
                setMsg('Não deu para copiar: selecione o texto e use Ctrl+C.')
              }
            }}
          >
            Copiar
          </button>
          <button onClick={insert}>Inserir no editor</button>
        </span>
      </div>
      <pre>{code.replace(/^\n/, '')}</pre>
      {msg && <div className="snippet-msg">{msg}</div>}
    </div>
  )
}

export function GuideApp() {
  const ow = useOS((s) => s.openWorld)
  return ow ? <ProjectsBoard /> : <MissionGuide />
}

function MissionGuide() {
  const { missionIdx, stepIdx, missionDone, flash, typeInTerminal, resetMission, startMission } = useOS()
  useOS((s) => s.version)
  const h = hintCtx()
  const val = (v: string | ((x: typeof h) => string) | undefined) => (typeof v === 'function' ? v(h) : v)
  const next = missions[missionIdx + 1]
  const mission = missions[missionIdx]
  const done = missionDone ? mission.steps.length : stepIdx
  const pct = Math.round((done / mission.steps.length) * 100)

  useEffect(() => {
    document.querySelector('.steps li.current')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [stepIdx])

  useEffect(() => {
    if (!flash) return
    const t = setTimeout(() => useOS.setState({ flash: null }), 6000)
    return () => clearTimeout(t)
  }, [flash])

  return (
    <div className="guide">
      <header>
        <div className="eyebrow">Trilha DevOps · CI/CD</div>
        <h2>{mission.title}</h2>
        <p>{mission.summary}</p>
        <div className="progress">
          <div style={{ width: `${pct}%` }} />
        </div>
        <div className="progress-label">
          {done} de {mission.steps.length} passos
        </div>
      </header>

      {flash && <div className="flash">✓ <Rich text={flash} /></div>}

      <ol className="steps">
        {mission.steps.map((s, i) => {
          const state = missionDone || i < stepIdx ? 'done' : i === stepIdx ? 'current' : 'todo'
          return (
            <li key={s.id} className={state}>
              <div className="step-head">
                <span className="bullet">{state === 'done' ? '✓' : i + 1}</span>
                <span>{s.title}</span>
              </div>
              {state === 'current' && (
                <div className="step-body">
                  {s.body.map((b, j) => (
                    <p key={j}><Rich text={b} /></p>
                  ))}
                  {s.browse && (
                    <div className="hint web">
                      <span className="hint-label">Digite na barra de endereço:</span>
                      <code>{val(s.browse)}</code>
                    </div>
                  )}
                  {s.snippet && <Snippet file={s.snippet.file} code={s.snippet.code} mode={s.snippet.mode} />}
                  {s.hint && (
                    <>
                      <div className="hint">
                        <code>$ {val(s.hint)}</code>
                        <button onClick={() => typeInTerminal(val(s.hint)!)}>Digitar no terminal</button>
                      </div>
                      <p className="tip">Você também pode digitar o comando à mão. Depois aperte Enter.</p>
                    </>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ol>

      {missionDone && (
        <div className="done-card">
          <div className="big">🎉</div>
          <strong>Missão concluída!</strong>
          {next ? (
            <>
              <p>Próxima: <b>{next.title}</b></p>
              <button className="primary" onClick={() => startMission(missionIdx + 1)}>Começar Missão {missionIdx + 2}</button>
            </>
          ) : (
            <>
              <p>Você completou a trilha DevOps: terminal, Git, nuvem, CI/CD e containers. 🚀</p>
              <p>Agora outros times querem sua ajuda.</p>
              <button className="primary" onClick={() => useOS.getState().startOpenWorld()}>🌍 Entrar no mundo aberto</button>
            </>
          )}
          <button className="ghost" onClick={resetMission}>Refazer esta missão</button>
        </div>
      )}
    </div>
  )
}
