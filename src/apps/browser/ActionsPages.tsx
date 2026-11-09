// Aba Actions (execuções, jobs, steps, logs) e Configurações > Secrets do GitHub simulado.
import { useEffect, useState } from 'react'
import { actions, type JobRun, type Run, type StepRun } from '../../engine/actions'
import { github, type RemoteRepo } from '../../engine/github'
import { useOS } from '../../store/os'
import { AnimeAvatar, GhostAvatar } from '../../components/AnimeAvatar'
import { BranchesSettings, EnvironmentsSettings } from './PullPages'

const go = (u: string) => useOS.getState().openBrowser(`https://github.sim${u}`)
const ago = (ms: number) => {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000))
  return s < 60 ? `há ${s}s` : s < 3600 ? `há ${Math.round(s / 60)} min` : `há ${Math.round(s / 3600)} h`
}
const dur = (a?: number, b?: number) => {
  if (!a) return ''
  const s = Math.max(0, Math.round(((b ?? Date.now()) - a) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

type Status = { status: string; conclusion?: string }
export function StatusIcon({ s, size = 16 }: { s: Status | undefined; size?: number }) {
  if (!s) return null
  const st = { width: size, height: size, fontSize: size * 0.7 }
  if (s.status === 'waiting') return <span className="ci-ic wait" style={st} title="Esperando aprovação">⏸</span>
  if (s.status !== 'completed' && s.status !== 'done') {
    if (s.status === 'in_progress' || s.status === 'running') return <span className="ci-ic run" style={st} title="Em andamento" />
    return <span className="ci-ic queued" style={st} title="Na fila" />
  }
  if (s.conclusion === 'success') return <span className="ci-ic ok" style={st} title="Sucesso">✓</span>
  if (s.conclusion === 'failure') return <span className="ci-ic fail" style={st} title="Falhou">✕</span>
  return <span className="ci-ic skip" style={st} title="Ignorado">⊘</span>
}

function Actor({ login }: { login: string }) {
  const u = github.user(login)
  return u ? <AnimeAvatar seed={u.avatar} size={16} /> : <GhostAvatar size={16} />
}

function useSeen() {
  useEffect(() => {
    useOS.getState().onEvent({ kind: 'ui', name: 'gh:actions' })
  }, [])
}

const EVENT_LABEL = { push: 'push', workflow_dispatch: 'manual', schedule: '⏰ agendado', pull_request: 'pull request' } as const

export function ActionsList({ repo }: { repo: RemoteRepo }) {
  useSeen()
  const key = `${repo.owner}/${repo.name}`
  const [wf, setWf] = useState<string | null>(null)
  const [dd, setDd] = useState(false)
  const [msg, setMsg] = useState('')
  const workflows = actions.workflows(key)
  const selected = workflows.find((w) => w.path === wf)
  const list = actions.runs(key).filter((r) => !selected || r.file === selected.path)
  const me = github.current()
  return (
    <div className="ci">
      <aside>
        <h3>Actions</h3>
        <div className={`ci-side ${!wf ? 'on' : ''}`} onClick={() => setWf(null)}>Todos os workflows</div>
        {workflows.map((w) => (
          <div key={w.path} className={`ci-side ${wf === w.path ? 'on' : ''}`} onClick={() => setWf(w.path)}>
            {w.name}
          </div>
        ))}
      </aside>
      <main>
        <h2>{selected ? selected.name : 'Todos os workflows'}</h2>
        {selected && <div className="gh-muted small" style={{ marginTop: -8, marginBottom: 10 }}>{selected.path}</div>}
        {selected?.cron && <div className="ci-banner">⏰ Este workflow tem um agendamento: <code>{selected.cron}</code> (no simulador, roda a cada 2 minutos)</div>}
        {selected?.dispatch && (
          <div className="ci-banner dispatch">
            <span>Este workflow tem um gatilho <code>workflow_dispatch</code>.</span>
            <div className="ci-dd">
              <button className="gh-btn" onClick={() => setDd((d) => !d)}>Run workflow ▾</button>
              {dd && (
                <div className="ci-dd-menu">
                  <label>Use workflow from<select><option>Branch: main</option></select></label>
                  <button
                    className="gh-btn green"
                    onClick={() => {
                      const err = actions.dispatch(key, selected.path, me?.login ?? '')
                      setMsg(err ?? 'Execução do workflow enfileirada com sucesso.')
                      setDd(false)
                    }}
                  >
                    Run workflow
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {msg && <div className="gh-flash ok small-flash">{msg}</div>}
        {list.length === 0 ? (
          <div className="ci-empty">
            <h3>Comece com o GitHub Actions</h3>
            <p>
              Automatize testes e deploys. Crie um arquivo <code>.github/workflows/nome.yml</code> no repositório e envie com <code>git push</code>: cada push dispara o
              workflow.
            </p>
            <div className="ci-template">
              <b>Node.js</b> <span className="gh-muted">por GitHub</span>
              <p className="gh-muted">Compila e testa um projeto Node.js com npm.</p>
            </div>
          </div>
        ) : (
          <div className="gh-box">
            <div className="gh-box-head"><b>{list.length} execuções de workflow</b></div>
            {list.map((r) => (
              <div key={r.id} className="ci-run" onClick={() => go(`/${key}/actions/runs/${r.id}`)}>
                <StatusIcon s={r} />
                <div className="ci-run-main">
                  <b className="gh-link">{r.commit.message.split('\n')[0]}</b>
                  <div className="gh-muted">
                    <b>{r.workflow}</b> #{r.number}:{' '}
                    {r.event === 'push' ? (
                      <>Commit <code>{r.commit.hash.slice(0, 7)}</code> enviado por <Actor login={r.actor} /> {r.actor || 'alguém'}</>
                    ) : r.event === 'schedule' ? (
                      <>Agendado (cron)</>
                    ) : (
                      <>Disparado manualmente por <Actor login={r.actor} /> {r.actor}</>
                    )}
                    <span className={`ci-ev ${r.event}`}>{EVENT_LABEL[r.event]}</span>
                  </div>
                </div>
                <span className="gh-branch small">main</span>
                <div className="ci-time gh-muted">
                  <div>📅 {ago(r.created)}</div>
                  <div>⏱ {dur(r.created, r.ended)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function StepView({ st, defaultOpen }: { st: StepRun; defaultOpen: boolean }) {
  const [open, setOpen] = useState<boolean | null>(null)
  const isOpen = open ?? defaultOpen
  return (
    <div className="ci-step">
      <div className="ci-step-head" onClick={() => setOpen(!isOpen)}>
        <span className="ci-chev">{isOpen ? '▾' : '▸'}</span>
        {st.status === 'pending' ? <span className="ci-ic pend" /> : <StatusIcon s={st} size={14} />}
        <span className="ci-step-name">{st.name}</span>
        <span className="ci-step-dur">{st.conclusion === 'skipped' ? '' : dur(st.started, st.ended)}</span>
      </div>
      {isOpen && st.log.length > 0 && (
        <pre className="ci-log">
          {st.log.map((l, i) => (
            <div key={i} className={/^Error:|^remote: Permission|denied|fatal:|✖|Host key verification failed|timed out|bad permissions/i.test(l) ? 'err' : l.startsWith('\u001b[36m') ? 'cmd' : ''}>
              <span className="ln">{i + 1}</span>
              {l.replace(/\u001b\[[0-9;]*m/g, '')}
            </div>
          ))}
        </pre>
      )}
    </div>
  )
}

function JobView({ job }: { job: JobRun }) {
  const focus = job.steps.findIndex((s) => s.status === 'running' || s.conclusion === 'failure')
  return (
    <div className="ci-job">
      <div className="ci-job-head">
        <h3>{job.name}</h3>
        <span className="gh-muted">
          {job.status === 'waiting'
            ? `Esperando aprovação para fazer deploy em ${job.environment}`
            : job.review?.state === 'rejected'
              ? `Deploy rejeitado por ${job.review.by}${job.review.comment ? `: "${job.review.comment}"` : ''}`
              : job.conclusion === 'skipped'
            ? 'Job ignorado (um job do qual ele depende não terminou com sucesso)'
            : job.status === 'queued'
              ? 'Aguardando um runner…'
              : `${job.conclusion === 'success' ? 'concluído com sucesso' : job.conclusion === 'failure' ? 'falhou' : 'em andamento'} · ${dur(job.started, job.ended)}`}
        </span>
      </div>
      {job.environment && (
        <div className="ci-env-note">
          🌐 environment <b>{job.environment}</b>
          {job.review && (
            <span className={job.review.state === 'approved' ? 'gh-add' : 'gh-del'}>
              {' · '}
              {job.review.state === 'approved' ? 'aprovado' : 'rejeitado'} por {job.review.by}
              {job.review.comment ? ` — "${job.review.comment}"` : ''}
            </span>
          )}
        </div>
      )}
      {job.steps.map((s, i) => (
        <StepView key={`${i}-${s.name}`} st={s} defaultOpen={i === focus} />
      ))}
    </div>
  )
}

export function RunView({ repo, id }: { repo: RemoteRepo; id: number }) {
  useSeen()
  const run = actions.get(id)
  const [sel, setSel] = useState<string | null>(null)
  const key = `${repo.owner}/${repo.name}`
  if (!run) return <div className="gh-center"><h2>Execução não encontrada</h2></div>
  const job = run.jobs.find((j) => j.key === sel) ?? run.jobs.find((j) => j.conclusion === 'failure') ?? run.jobs.find((j) => j.status === 'in_progress') ?? run.jobs[0]
  return (
    <div className="ci">
      <aside>
        <div className="gh-link small" onClick={() => go(`/${key}/actions`)}>← {run.workflow}</div>
        <h4>Resumo</h4>
        <h4>Jobs</h4>
        {run.jobs.map((j) => (
          <div key={j.key} className={`ci-side ${j === job ? 'on' : ''}`} onClick={() => setSel(j.key)}>
            <StatusIcon s={j} size={14} /> {j.name}
          </div>
        ))}
      </aside>
      <main>
        <div className="ci-run-title">
          <StatusIcon s={run} size={22} />
          <h2>{run.commit.message.split('\n')[0]} <span className="gh-muted">{run.workflow} #{run.number}{run.attempt > 1 ? ` · tentativa ${run.attempt}` : ''}</span></h2>
          {run.status === 'completed' && !run.error && (
            <button className="gh-btn" onClick={() => actions.rerun(run.id)}>↻ Executar jobs novamente</button>
          )}
        </div>
        {run.jobs.some((j) => j.status === 'waiting') && <ReviewBanner run={run} />}
        <div className="ci-summary">
          <div><span>Disparado via {EVENT_LABEL[run.event]}</span><b><Actor login={run.actor} /> {run.actor} · {ago(run.created)}</b></div>
          <div><span>Status</span><b>{run.status === 'completed' ? (run.conclusion === 'success' ? 'Sucesso' : 'Falha') : run.status === 'queued' ? 'Na fila' : run.status === 'waiting' ? 'Esperando aprovação' : 'Em andamento'}</b></div>
          <div><span>Duração total</span><b>{dur(run.created, run.ended)}</b></div>
          <div><span>Commit</span><b><code>{run.commit.hash.slice(0, 7)}</code></b></div>
        </div>
        {run.error ? (
          <div className="ci-error">
            <b>❌ {run.error.split('\n')[0]}</b>
            <pre>{run.error.split('\n').slice(1).join('\n')}</pre>
          </div>
        ) : (
          <>
            <div className="ci-graph">
              <div className="ci-graph-file">{run.file.split('/').pop()}<div className="gh-muted">on: {run.event}</div></div>
              {run.jobs.map((j, i) => (
                <div key={j.key} className="ci-graph-item">
                  {i > 0 || j.needs.length ? <span className="ci-arrow">→</span> : <span className="ci-arrow">→</span>}
                  <div className={`ci-node ${j === job ? 'on' : ''}`} onClick={() => setSel(j.key)}>
                    <StatusIcon s={j} size={14} /> {j.name}
                    <span className="gh-muted">{dur(j.started, j.ended)}</span>
                  </div>
                </div>
              ))}
            </div>
            {job && <JobView job={job} />}
          </>
        )}
      </main>
    </div>
  )
}

function ReviewBanner({ run }: { run: Run }) {
  const [open, setOpen] = useState(false)
  const [comment, setComment] = useState('')
  const [err, setErr] = useState('')
  const me = github.current()
  const waiting = run.jobs.filter((j) => j.status === 'waiting')
  const envs = [...new Set(waiting.map((j) => j.environment!))]
  const canReview = !!me && envs.every((e) => github.environment(run.repo, e)?.reviewers.includes(me.login))
  const act = (approve: boolean) => {
    const e = actions.reviewDeployment(run.id, approve, me!.login, comment.trim())
    if (e) setErr(e)
    else setOpen(false)
  }
  return (
    <div className="ci-review">
      <div className="ci-review-head">
        <span>
          ⏸ <b>{envs.join(', ')}</b> está esperando revisão{canReview ? '. Você pode aprovar.' : '.'}
        </span>
        {canReview && <button className="gh-btn" onClick={() => setOpen((o) => !o)}>Revisar deployments</button>}
      </div>
      {open && (
        <div className="ci-review-box">
          {envs.map((e) => (
            <label key={e} className="gh-check-opt">
              <input type="checkbox" checked readOnly />
              <div>
                <b>{e}</b>
                <div className="gh-muted">Revisores: {github.environment(run.repo, e)?.reviewers.join(', ')}</div>
              </div>
            </label>
          ))}
          <textarea className="gh-comment" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} placeholder="Deixe um comentário (opcional)" aria-label="Comentário da revisão" />
          {err && <div className="gh-flash error small">{err}</div>}
          <div className="gh-hero-cta left" style={{ marginTop: 0 }}>
            <button className="gh-btn danger" onClick={() => act(false)}>Rejeitar</button>
            <button className="gh-btn green" onClick={() => act(true)}>Aprovar e implantar</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- Configurações > Secrets ----------

type SetTab = 'secrets' | 'pages' | 'branches' | 'environments'
export function SecretsPage({ repo, initial = 'secrets' }: { repo: RemoteRepo; initial?: SetTab }) {
  const [tab, setTab] = useState<SetTab>(initial)
  useEffect(() => setTab(initial), [initial])
  if (tab === 'branches' || tab === 'environments')
    return (
      <div className="gh-settings">
        <SettingsNav tab={tab} setTab={setTab} />
        <main>{tab === 'branches' ? <BranchesSettings repo={repo} /> : <EnvironmentsSettings repo={repo} />}</main>
      </div>
    )
  return tab === 'pages' ? <PagesSettings repo={repo} setTab={setTab} /> : <SecretsInner repo={repo} setTab={setTab} />
}

function SettingsNav({ tab, setTab }: { tab: SetTab; setTab: (t: SetTab) => void }) {
  return (
    <aside>
      <div className="side">Geral</div>
      <div className="side">Colaboradores</div>
      <div className={`side ${tab === 'branches' ? 'on' : ''}`} onClick={() => setTab('branches')}>Branches</div>
      <div className="side-group">Código e automação</div>
      <div className={`side ${tab === 'environments' ? 'on' : ''}`} onClick={() => setTab('environments')}>Environments</div>
      <div className={`side ${tab === 'pages' ? 'on' : ''}`} onClick={() => setTab('pages')}>Pages</div>
      <div className="side-group">Segurança</div>
      <div className={`side ${tab === 'secrets' ? 'on' : ''}`} onClick={() => setTab('secrets')}>Secrets e variáveis › Actions</div>
    </aside>
  )
}

function PagesSettings({ repo, setTab }: { repo: RemoteRepo; setTab: (t: SetTab) => void }) {
  const key = `${repo.owner}/${repo.name}`
  const p = actions.pages(key)
  const url = actions.pagesUrl(key)
  return (
    <div className="gh-settings">
      <SettingsNav tab="pages" setTab={setTab} />
      <main>
        <div className="gh-set-head"><h2>GitHub Pages</h2></div>
        <p className="gh-muted">O GitHub Pages hospeda sites estáticos (HTML, CSS, JS) direto do repositório.</p>
        {p?.files && (
          <div className="gh-flash ok">
            Seu site está no ar em <span className="gh-link" onClick={() => useOS.getState().openBrowser(url, true)}>{url}</span>
            <div className="gh-muted small">Último deploy {ago(p.updated)}</div>
          </div>
        )}
        <h3>Build and deployment</h3>
        <label className="gh-field">
          <span>Source</span>
          <select value={p?.enabled ? 'actions' : 'branch'} onChange={(e) => actions.setPagesEnabled(key, e.target.value === 'actions')} aria-label="Origem do Pages">
            <option value="branch">Deploy from a branch</option>
            <option value="actions">GitHub Actions</option>
          </select>
          <small>{p?.enabled ? 'Use um workflow para publicar o site: actions/upload-pages-artifact + actions/deploy-pages.' : 'Escolha "GitHub Actions" para publicar o site por um workflow.'}</small>
        </label>
      </main>
    </div>
  )
}

function SecretsInner({ repo, setTab }: { repo: RemoteRepo; setTab: (t: SetTab) => void }) {
  const key = `${repo.owner}/${repo.name}`
  const [mode, setMode] = useState<null | { name: string; isNew: boolean }>(null)
  const [name, setName] = useState('')
  const [value, setValue] = useState('')
  const [err, setErr] = useState('')
  const list = Object.entries(repo.secrets)

  const save = () => {
    const n = (mode?.isNew ? name : mode!.name).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) return setErr('O nome pode ter apenas letras, números e _ e não pode começar com número.')
    if (/^GITHUB_/i.test(n)) return setErr('Nomes de secrets não podem começar com GITHUB_.')
    if (!value.trim()) return setErr('O valor do secret não pode ficar vazio.')
    if (mode?.isNew && repo.secrets[n.toUpperCase()]) return setErr('Já existe um secret com esse nome. Use "Atualizar".')
    github.setSecret(key, n.toUpperCase(), value)
    setMode(null)
    setName('')
    setValue('')
    setErr('')
  }

  return (
    <div className="gh-settings">
      <SettingsNav tab="secrets" setTab={setTab} />
      <main>
        {mode ? (
          <>
            <div className="gh-set-head"><h2>Actions secrets / {mode.isNew ? 'Novo secret' : `Atualizar ${mode.name}`}</h2></div>
            <form
              className="ci-secret-form"
              onSubmit={(e) => {
                e.preventDefault()
                save()
              }}
            >
              <label className="gh-field">
                <span>Nome *</span>
                <input value={mode.isNew ? name : mode.name} disabled={!mode.isNew} onChange={(e) => setName(e.target.value.toUpperCase().replace(/\s/g, '_'))} placeholder="EX: EC2_HOST" aria-label="Nome do secret" />
              </label>
              <label className="gh-field">
                <span>Secret *</span>
                <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={8} spellCheck={false} aria-label="Valor do secret" />
              </label>
              {err && <div className="gh-flash error small">{err}</div>}
              <div className="gh-hero-cta left">
                <button className="gh-btn green">{mode.isNew ? 'Adicionar secret' : 'Atualizar secret'}</button>
                <button type="button" className="gh-btn" onClick={() => (setMode(null), setErr(''))}>Cancelar</button>
              </div>
            </form>
          </>
        ) : (
          <>
            <div className="gh-set-head">
              <h2>Actions secrets and variables</h2>
            </div>
            <p className="gh-muted">
              Secrets são criptografados e usados para dados sensíveis (chaves, senhas, tokens). Ninguém consegue ver o valor depois de salvo, nem você. Nos workflows, use{' '}
              <code>{'${{ secrets.NOME }}'}</code>; nos logs eles aparecem como <code>***</code>.
            </p>
            <div className="gh-set-head">
              <h3>Repository secrets</h3>
              <button className="gh-btn green" onClick={() => (setMode({ name: '', isNew: true }), setValue(''))}>Novo repository secret</button>
            </div>
            <div className="gh-box">
              {list.length === 0 && <div className="gh-empty">Este repositório não tem secrets.</div>}
              {list.map(([n, s]) => (
                <div key={n} className="gh-token">
                  <div>
                    🔒 <code><b>{n}</b></code>
                    <div className="gh-muted">Atualizado {ago(s.updated)}</div>
                  </div>
                  <span>
                    <button className="gh-btn small" onClick={() => (setMode({ name: n, isNew: false }), setValue(''))}>✎ Atualizar</button>{' '}
                    <button className="gh-btn danger small" onClick={() => github.deleteSecret(key, n)}>Remover</button>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export function lastRunStatus(repoKey: string, sha: string): Run | undefined {
  return actions.statusFor(repoKey, sha)
}
