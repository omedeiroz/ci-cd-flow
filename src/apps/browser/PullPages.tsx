// Pull requests no GitHub simulado: lista, comparação de branches, conversa, checks, revisão,
// conflitos, merge e as regras de proteção de branch.
import { useEffect, useState } from 'react'
import { github, type Commit, type PullRequest, type RemoteRepo, type Tree } from '../../engine/github'
import { lineOps } from '../../engine/git'
import { mergeBase, mergeTrees } from '../../engine/merge'
import { useOS } from '../../store/os'
import { AnimeAvatar, GhostAvatar } from '../../components/AnimeAvatar'
import { Markdown } from './markdown'
import { StatusIcon } from './ActionsPages'
import { actions } from '../../engine/actions'

const go = (u: string) => useOS.getState().openBrowser(u.startsWith('http') ? u : `https://github.sim${u}`)
const keyOf = (r: RemoteRepo) => `${r.owner}/${r.name}`
const ago = (ms: number) => {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return 'agora mesmo'
  if (s < 3600) return `há ${Math.round(s / 60)} min`
  if (s < 86400) return `há ${Math.round(s / 3600)} h`
  return `há ${Math.round(s / 86400)} d`
}

function Who({ login, size = 20 }: { login: string; size?: number }) {
  const u = github.user(login)
  return u ? <AnimeAvatar seed={u.avatar} size={size} /> : <GhostAvatar size={size} />
}
function UserLink({ login }: { login: string }) {
  return <b className="gh-link" onClick={() => go(`/${login}`)}>{login}</b>
}
function CommitAvatar({ c, size = 18 }: { c: Commit; size?: number }) {
  const u = github.userByEmail(c.email)
  return u ? <AnimeAvatar seed={u.avatar} size={size} /> : <GhostAvatar size={size} />
}

function PrState({ pr }: { pr: PullRequest }) {
  const label = pr.state === 'open' ? '⇄ Aberto' : pr.state === 'merged' ? '⇄ Mesclado' : '⊘ Fechado'
  return <span className={`gh-pr-state ${pr.state}`}>{label}</span>
}

// ---------- aviso "teve pushes recentes" ----------

/** Branches com commits que a main não tem e sem PR aberto. */
function pushedBranches(repo: RemoteRepo) {
  const key = keyOf(repo)
  const main = new Set(repo.commits.map((c) => c.hash))
  return github
    .branchNames(key)
    .filter((b) => b !== repo.branch && !github.openPullFor(key, b) && !github.pulls(key).some((p) => p.head === b && p.state === 'merged'))
    .map((b) => ({ b, tip: github.branchHead(key, b)! }))
    .filter(({ tip }) => tip && !main.has(tip.hash) && Date.now() - tip.date < 3600_000 * 6)
}

export function PushedBanner({ repo }: { repo: RemoteRepo }) {
  const me = github.current()
  if (!me || !github.isCollaborator(me.login, keyOf(repo))) return null
  const list = pushedBranches(repo)
  if (!list.length) return null
  return (
    <>
      {list.map(({ b, tip }) => (
        <div key={b} className="gh-flash warn gh-pushed">
          <span>
            <b className="gh-branch-name">{b}</b> teve pushes recentes {ago(tip.date)}
          </span>
          <button className="gh-btn green" onClick={() => go(`/${keyOf(repo)}/compare/${repo.branch}...${b}`)}>
            Comparar e abrir pull request
          </button>
        </div>
      ))}
    </>
  )
}

// ---------- lista ----------

export function PullsList({ repo }: { repo: RemoteRepo }) {
  const [tab, setTab] = useState<'open' | 'closed'>('open')
  const key = keyOf(repo)
  const all = [...github.pulls(key)].sort((a, b) => b.number - a.number)
  const open = all.filter((p) => p.state === 'open')
  const closed = all.filter((p) => p.state !== 'open')
  const list = tab === 'open' ? open : closed
  return (
    <div className="gh-body">
      <PushedBanner repo={repo} />
      <div className="gh-bar">
        <span style={{ flex: 1 }} />
        <button className="gh-btn green" onClick={() => go(`/${key}/compare`)}>Novo pull request</button>
      </div>
      <div className="gh-box">
        <div className="gh-box-head gh-pr-tabs">
          <span className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>⇄ {open.length} Abertos</span>
          <span className={tab === 'closed' ? 'on' : ''} onClick={() => setTab('closed')}>✓ {closed.length} Fechados</span>
        </div>
        {!list.length && (
          <div className="gh-empty">
            {tab === 'open' ? (
              <>
                <b>Nenhum pull request aberto.</b>
                <p>Pull requests mostram as mudanças de um branch e permitem revisar antes de mesclar na {repo.branch}.</p>
              </>
            ) : (
              'Nenhum pull request fechado.'
            )}
          </div>
        )}
        {list.map((p) => {
          const st = p.state === 'open' ? github.pullStatus(key, p.number) : null
          const checks = st?.checks ?? []
          const ci = checks.some((c) => c.state === 'failure') ? 'failure' : checks.some((c) => c.state === 'pending') ? 'pending' : checks.length ? 'success' : null
          return (
            <div key={p.number} className="gh-pr-row" onClick={() => go(`/${key}/pull/${p.number}`)}>
              <span className={`gh-pr-icon ${p.state}`}>⇄</span>
              <div>
                <div>
                  <b className="gh-link">{p.title}</b>{' '}
                  {ci && <StatusIcon s={{ status: ci === 'pending' ? 'in_progress' : 'completed', conclusion: ci === 'pending' ? undefined : ci }} size={14} />}
                  {st?.changesRequested.length ? <span className="gh-label red">Alterações solicitadas</span> : null}
                  {st && st.approvals > 0 && !st.changesRequested.length ? <span className="gh-label green">Aprovado</span> : null}
                </div>
                <div className="gh-muted">
                  #{p.number} {p.state === 'merged' ? `mesclado ${ago(p.mergedAt!)} por ${p.mergedBy}` : `aberto ${ago(p.created)} por ${p.author}`}
                </div>
              </div>
              <span className="gh-muted">{p.comments.length ? `💬 ${p.comments.length}` : ''}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------- diff de arquivos ----------

function FilesDiff({ from, to }: { from: Tree; to: Tree }) {
  const paths = [...new Set([...Object.keys(from), ...Object.keys(to)])].filter((p) => from[p] !== to[p]).sort()
  if (!paths.length) return <div className="gh-empty">Nenhum arquivo alterado.</div>
  return (
    <>
      {paths.map((p) => {
        const ops = lineOps(from[p] ?? '', to[p] ?? '')
        const plus = ops.filter((o) => o.t === '+').length
        const minus = ops.filter((o) => o.t === '-').length
        // mostra só as linhas perto das mudanças
        const keep = new Set<number>()
        ops.forEach((o, i) => {
          if (o.t !== ' ') for (let d = -3; d <= 3; d++) keep.add(i + d)
        })
        let a = 0
        let b = 0
        const rows: React.ReactNode[] = []
        let gap = false
        ops.forEach((o, i) => {
          if (o.t !== '+') a++
          if (o.t !== '-') b++
          if (!keep.has(i)) {
            if (!gap) rows.push(<div key={`g${i}`} className="gh-diff-gap">⋯</div>)
            gap = true
            return
          }
          gap = false
          rows.push(
            <div key={i} className={`gh-diff-line ${o.t === '+' ? 'add' : o.t === '-' ? 'del' : ''}`}>
              <span className="ln">{o.t === '+' ? '' : a}</span>
              <span className="ln">{o.t === '-' ? '' : b}</span>
              <span className="sign">{o.t}</span>
              <span>{o.l || ' '}</span>
            </div>,
          )
        })
        return (
          <div key={p} className="gh-box">
            <div className="gh-box-head">
              <b>{p}</b>
              {!(p in from) && <span className="gh-label green">novo</span>}
              {!(p in to) && <span className="gh-label red">removido</span>}
              <span className="gh-muted">
                <span className="gh-add">+{plus}</span> <span className="gh-del">−{minus}</span>
              </span>
            </div>
            <pre className="gh-code gh-diff">{rows}</pre>
          </div>
        )
      })}
    </>
  )
}

function CommitList({ commits }: { commits: Commit[] }) {
  return (
    <div className="gh-box">
      {[...commits].reverse().map((c) => (
        <div key={c.hash} className="gh-commit">
          <div>
            <div className="gh-msg">{c.message.split('\n')[0]}</div>
            <div className="gh-muted">
              <CommitAvatar c={c} /> {github.userByEmail(c.email)?.login ?? c.author} fez commit {ago(c.date)}
            </div>
          </div>
          <code>{c.hash.slice(0, 7)}</code>
        </div>
      ))}
    </div>
  )
}

// ---------- comparar e criar ----------

export function Compare({ repo, spec }: { repo: RemoteRepo; spec: string }) {
  const key = keyOf(repo)
  const branches = github.branchNames(key)
  const [b0, h0] = spec.includes('...') ? spec.split('...') : [repo.branch, spec || '']
  const [base, setBase] = useState(branches.includes(b0) ? b0 : repo.branch)
  const [head, setHead] = useState(branches.includes(h0) ? h0 : '')
  const me = github.current()
  const headList = head ? github.branchCommits(key, head) : undefined
  const baseList = github.branchCommits(key, base) ?? []
  const baseSet = new Set(baseList.map((c) => c.hash))
  const commits = (headList ?? []).filter((c) => !baseSet.has(c.hash))
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [err, setErr] = useState('')
  useEffect(() => {
    const name = head.replace(/[-_]/g, ' ')
    const only = commits.length === 1 ? commits[0].message.split('\n')[0] : name.charAt(0).toUpperCase() + name.slice(1)
    setTitle(only)
  }, [head, base]) // eslint-disable-line react-hooks/exhaustive-deps

  const existing = head ? github.openPullFor(key, head) : undefined
  const mb = headList ? mergeBase(headList, baseList) : null
  const headTip = headList?.[headList.length - 1]
  const baseTip = baseList[baseList.length - 1]
  const conflicts = headTip && baseTip ? mergeTrees(mb?.tree ?? {}, headTip.tree, baseTip.tree, { ours: head, theirs: base }).conflicts : []

  const create = () => {
    if (!me) return go('/login')
    const r = github.createPull(key, { title, body, head, base, author: me.login })
    if (typeof r === 'string') return setErr(r)
    go(`/${key}/pull/${r.number}`)
  }

  return (
    <div className="gh-body">
      <h2 className="gh-h2">Comparar mudanças</h2>
      <p className="gh-muted">Escolha dois branches para ver o que mudou e abrir um pull request.</p>
      <div className="gh-compare-bar">
        <label>
          base:{' '}
          <select value={base} onChange={(e) => setBase(e.target.value)} aria-label="Branch base">
            {branches.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        <span>←</span>
        <label>
          comparar:{' '}
          <select value={head} onChange={(e) => setHead(e.target.value)} aria-label="Branch para comparar">
            <option value="">escolha um branch</option>
            {branches.filter((b) => b !== base).map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
        </label>
        {head &&
          (conflicts.length ? (
            <span className="gh-del">✗ Não pode ser mesclado automaticamente. Você ainda pode abrir o PR.</span>
          ) : (
            <span className="gh-add">✓ Pode ser mesclado.</span>
          ))}
      </div>
      {!head ? (
        <div className="gh-box">
          <div className="gh-empty">
            <b>Escolha um branch em "comparar".</b>
            <p>Os branches aparecem aqui depois do primeiro <code>git push -u origin &lt;branch&gt;</code>.</p>
          </div>
        </div>
      ) : existing ? (
        <div className="gh-flash info">
          Já existe um pull request aberto para <b>{head}</b>: <span className="gh-link" onClick={() => go(`/${key}/pull/${existing.number}`)}>#{existing.number} {existing.title}</span>
        </div>
      ) : !commits.length ? (
        <div className="gh-box">
          <div className="gh-empty">
            <b>Não há nada para comparar.</b>
            <p>{base} já tem todos os commits de {head}.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="gh-pr-form">
            <Who login={me?.login ?? ''} size={36} />
            <div className="gh-box">
              <div className="gh-pr-form-in">
                <label className="gh-field">
                  <span>Título</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Título do pull request" />
                </label>
                <label className="gh-field">
                  <span>Descrição</span>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={6}
                    placeholder={'O que mudou?\nComo testar?'}
                    aria-label="Descrição do pull request"
                  />
                </label>
                {err && <div className="gh-flash error small">{err}</div>}
                <div className="gh-hero-cta left">
                  <button className="gh-btn green" disabled={!title.trim()} onClick={create}>Criar pull request</button>
                </div>
              </div>
            </div>
          </div>
          <h3 className="gh-h">◷ {commits.length} commit{commits.length > 1 ? 's' : ''}</h3>
          <CommitList commits={commits} />
          <h3 className="gh-h">Arquivos alterados</h3>
          <FilesDiff from={mb?.tree ?? {}} to={headTip!.tree} />
        </>
      )}
    </div>
  )
}

// ---------- página do PR ----------

type Item = { date: number; node: React.ReactNode }

export function PullView({ repo, n, tab }: { repo: RemoteRepo; n: number; tab: 'conversation' | 'commits' | 'files' }) {
  const key = keyOf(repo)
  useEffect(() => {
    useOS.getState().onEvent({ kind: 'ui', name: 'gh:pull' })
  }, [])
  const pr = github.pull(key, n)
  if (!pr) return <div className="gh-center"><h2>Pull request não encontrado</h2></div>
  const st = pr.state === 'open' ? github.pullStatus(key, n) : null
  const baseSet = new Set((github.branchCommits(key, pr.base) ?? []).map((c) => c.hash))
  const commits = pr.merged?.commits ?? (github.branchCommits(key, pr.head) ?? []).filter((c) => !baseSet.has(c.hash))
  const from = pr.merged?.from ?? (st?.head && st.base ? (mergeBase(st.head, st.base)?.tree ?? {}) : {})
  const to = pr.merged?.to ?? st?.headTip?.tree ?? {}
  const files = [...new Set([...Object.keys(from), ...Object.keys(to)])].filter((p) => from[p] !== to[p])
  const t = (x: typeof tab) => `/${key}/pull/${n}${x === 'conversation' ? '' : `/${x}`}`
  return (
    <div className="gh-body wide">
      <h1 className="gh-pr-title">
        {pr.title} <span className="gh-muted big">#{pr.number}</span>
      </h1>
      <div className="gh-pr-sub">
        <PrState pr={pr} />
        <span>
          <UserLink login={pr.state === 'merged' ? pr.mergedBy! : pr.author} />{' '}
          {pr.state === 'merged' ? 'mesclou' : 'quer mesclar'} {commits.length} commit{commits.length === 1 ? '' : 's'} em <code className="gh-branch-name">{pr.base}</code> a partir de{' '}
          <code className="gh-branch-name">{pr.head}</code>
        </span>
      </div>
      <div className="gh-tabs gh-pr-nav">
        <span className={tab === 'conversation' ? 'on' : ''} onClick={() => go(t('conversation'))}>💬 Conversa <i>{pr.comments.length + pr.reviews.length}</i></span>
        <span className={tab === 'commits' ? 'on' : ''} onClick={() => go(t('commits'))}>◷ Commits <i>{commits.length}</i></span>
        <span className={tab === 'files' ? 'on' : ''} onClick={() => go(t('files'))}>± Arquivos alterados <i>{files.length}</i></span>
      </div>
      {tab === 'commits' ? (
        <CommitList commits={commits} />
      ) : tab === 'files' ? (
        <FilesDiff from={from} to={to} />
      ) : (
        <div className="gh-pr-layout">
          <div>
            <Conversation repo={repo} pr={pr} commits={commits} />
            {st && <MergeBox repo={repo} pr={pr} st={st} />}
            {pr.state === 'merged' && <MergedBox repo={repo} pr={pr} />}
            <CommentBox repo={repo} pr={pr} />
          </div>
          <aside className="gh-pr-side">
            <h4>Revisores</h4>
            {[...new Set([...pr.requested, ...pr.reviews.filter((r) => r.state !== 'COMMENTED').map((r) => r.by)])].map((r) => {
              const last = [...pr.reviews].reverse().find((x) => x.by === r && x.state !== 'COMMENTED')
              return (
                <div key={r} className="gh-pr-rev">
                  <Who login={r} size={18} /> {r}
                  <span className={last?.state === 'APPROVED' ? 'gh-add' : last?.state === 'CHANGES_REQUESTED' ? 'gh-del' : 'gh-muted'}>
                    {last?.state === 'APPROVED' ? '✓' : last?.state === 'CHANGES_REQUESTED' ? '±' : '●'}
                  </span>
                </div>
              )
            })}
            {!pr.requested.length && !pr.reviews.length && <div className="gh-muted">Nenhuma revisão solicitada</div>}
            <h4>Responsável</h4>
            <div className="gh-pr-rev"><Who login={pr.author} size={18} /> {pr.author}</div>
          </aside>
        </div>
      )}
    </div>
  )
}

function Bubble({ login, date, verb, children, tone }: { login: string; date: number; verb: string; children?: React.ReactNode; tone?: 'ok' | 'bad' }) {
  return (
    <div className="gh-tl-item">
      <Who login={login} size={36} />
      <div className={`gh-tl-bubble ${tone ?? ''}`}>
        <div className="gh-tl-head">
          <UserLink login={login} /> <span className="gh-muted">{verb} {ago(date)}</span>
        </div>
        {children && <div className="gh-tl-body">{children}</div>}
      </div>
    </div>
  )
}

function Conversation({ repo, pr, commits }: { repo: RemoteRepo; pr: PullRequest; commits: Commit[] }) {
  const key = keyOf(repo)
  const items: Item[] = [
    {
      date: pr.created,
      node: (
        <Bubble login={pr.author} date={pr.created} verb="abriu este pull request">
          {pr.body.trim() ? <Markdown source={pr.body} /> : <em className="gh-muted">Nenhuma descrição.</em>}
        </Bubble>
      ),
    },
  ]
  // commits enviados (os anteriores à abertura aparecem juntos logo depois dela)
  for (const c of commits) {
    items.push({
      date: Math.max(c.date, pr.created + 1),
      node: (
        <div className="gh-tl-event">
          <span className="gh-tl-dot">◷</span>
          <CommitAvatar c={c} size={16} /> <span className="gh-msg">{c.message.split('\n')[0]}</span>
          <StatusIcon s={actions.statusFor(key, c.hash)} size={13} />
          <code className="gh-muted">{c.hash.slice(0, 7)}</code>
        </div>
      ),
    })
  }
  for (const r of pr.requested)
    items.push({ date: pr.created + 2, node: <div className="gh-tl-event"><span className="gh-tl-dot">👁</span> revisão solicitada a <b>{r}</b></div> })
  for (const r of pr.reviews)
    items.push({
      date: r.date,
      node: (
        <Bubble
          login={r.by}
          date={r.date}
          verb={r.state === 'APPROVED' ? 'aprovou estas alterações' : r.state === 'CHANGES_REQUESTED' ? 'solicitou alterações' : 'revisou'}
          tone={r.state === 'APPROVED' ? 'ok' : r.state === 'CHANGES_REQUESTED' ? 'bad' : undefined}
        >
          {r.body && <Markdown source={r.body} />}
        </Bubble>
      ),
    })
  for (const c of pr.comments) items.push({ date: c.date, node: <Bubble login={c.by} date={c.date} verb="comentou"><Markdown source={c.body} /></Bubble> })
  if (pr.state === 'merged')
    items.push({
      date: pr.mergedAt!,
      node: (
        <div className="gh-tl-event merged">
          <span className="gh-tl-dot">⇄</span> <b>{pr.mergedBy}</b> mesclou o commit <code>{pr.mergeCommit?.slice(0, 7)}</code> em <code>{pr.base}</code> {ago(pr.mergedAt!)}
        </div>
      ),
    })
  if (pr.headDeleted) items.push({ date: (pr.mergedAt ?? pr.created) + 1, node: <div className="gh-tl-event"><span className="gh-tl-dot">⑂</span> o branch <code>{pr.head}</code> foi excluído</div> })
  return (
    <div className="gh-timeline">
      {items
        .sort((a, b) => a.date - b.date)
        .map((i, k) => (
          <div key={k}>{i.node}</div>
        ))}
    </div>
  )
}

function MergeBox({ repo, pr, st }: { repo: RemoteRepo; pr: PullRequest; st: ReturnType<typeof github.pullStatus> }) {
  const key = keyOf(repo)
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState('')
  const me = github.current()
  const rule = st.rule
  const pending = st.checks.filter((c) => c.state === 'pending').length
  const failed = st.checks.filter((c) => c.state === 'failure').length
  const canMerge = !st.blockers.length && !!me && github.isCollaborator(me.login, key)
  return (
    <div className="gh-merge">
      <div className={`gh-merge-icon ${canMerge ? 'ok' : st.conflicts.length || failed ? 'bad' : 'wait'}`}>⇄</div>
      <div className="gh-box gh-merge-box">
        {rule && (
          <div className="gh-merge-row">
            <span className={st.changesRequested.length ? 'gh-del' : st.approvals >= rule.approvals ? 'gh-add' : 'gh-warn'}>
              {st.changesRequested.length ? '±' : st.approvals >= rule.approvals ? '✓' : '●'}
            </span>
            <div>
              <b>{st.changesRequested.length ? 'Alterações solicitadas' : st.approvals >= rule.approvals ? 'Alterações aprovadas' : 'Revisão obrigatória'}</b>
              <div className="gh-muted">
                {st.changesRequested.length
                  ? `${st.changesRequested.join(', ')} pediu alterações. Atenda à revisão e envie novos commits.`
                  : st.approvals >= rule.approvals
                    ? `${st.approvals} aprovação${st.approvals > 1 ? 'ões' : ''} de quem pode revisar.`
                    : `Pelo menos ${rule.approvals} aprovação é necessária antes do merge (quem abriu o PR não pode aprovar).`}
              </div>
            </div>
          </div>
        )}
        <div className="gh-merge-row">
          <span className={failed ? 'gh-del' : pending || !st.checks.length ? 'gh-warn' : 'gh-add'}>{failed ? '✗' : pending || !st.checks.length ? '●' : '✓'}</span>
          <div style={{ flex: 1 }}>
            <b>
              {!st.checks.length
                ? rule?.requireChecks
                  ? 'Aguardando os checks obrigatórios'
                  : 'Nenhum check neste commit'
                : failed
                  ? `${failed} check${failed > 1 ? 's' : ''} falhou`
                  : pending
                    ? 'Alguns checks ainda não terminaram'
                    : 'Todos os checks passaram'}
            </b>
            {st.checks.length > 0 && (
              <div className="gh-checks">
                {st.checks.map((c, i) => (
                  <div key={i} className="gh-check-row" onClick={() => go(`/${key}/actions/runs/${c.runId}`)}>
                    <StatusIcon
                      s={c.state === 'pending' ? { status: 'in_progress' } : { status: 'completed', conclusion: c.state === 'success' ? 'success' : c.state === 'skipped' ? 'skipped' : 'failure' }}
                      size={14}
                    />
                    <span>{c.name}</span>
                    <span className="gh-muted">{c.state === 'skipped' ? 'pulado' : c.state === 'pending' ? 'em andamento…' : c.state === 'success' ? 'passou' : 'falhou'}</span>
                    <span className="gh-link small">Detalhes</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="gh-merge-row">
          <span className={st.conflicts.length ? 'gh-del' : 'gh-add'}>{st.conflicts.length ? '✗' : '✓'}</span>
          <div>
            <b>{st.conflicts.length ? 'Este branch tem conflitos que precisam ser resolvidos' : `Sem conflitos com o branch ${pr.base}`}</b>
            {st.conflicts.length ? (
              <>
                <div className="gh-muted">Arquivos em conflito: {st.conflicts.map((c) => <code key={c}>{c} </code>)}</div>
                <div className="gh-conflict-help">
                  <div className="gh-muted">Resolva na sua máquina, no branch <code>{pr.head}</code>:</div>
                  <pre>{`git fetch origin\ngit merge origin/${pr.base}\n# edite os arquivos, apague os marcadores <<<<<<< ======= >>>>>>>\ngit add <arquivo>\ngit commit\ngit push`}</pre>
                </div>
              </>
            ) : (
              <div className="gh-muted">O merge pode ser feito automaticamente.</div>
            )}
          </div>
        </div>
        <div className="gh-merge-foot">
          {confirm ? (
            <div className="gh-merge-confirm">
              <div className="gh-muted">Commit de merge: <b>Merge pull request #{pr.number} from {pr.author}/{pr.head}</b></div>
              <div className="gh-hero-cta left">
                <button
                  className="gh-btn green"
                  onClick={() => {
                    const e = github.mergePull(key, pr.number, me!.login)
                    if (e) setErr(e)
                    setConfirm(false)
                  }}
                >
                  Confirmar merge
                </button>
                <button className="gh-btn" onClick={() => setConfirm(false)}>Cancelar</button>
              </div>
            </div>
          ) : (
            <>
              <button className="gh-btn green" disabled={!canMerge} onClick={() => setConfirm(true)}>Merge pull request</button>
              {!canMerge && <span className="gh-muted">{st.conflicts.length ? 'Resolva os conflitos primeiro.' : rule ? 'O merge está bloqueado pelas regras de proteção da main.' : ''}</span>}
            </>
          )}
          {err && <div className="gh-flash error small">{err}</div>}
        </div>
      </div>
    </div>
  )
}

function MergedBox({ repo, pr }: { repo: RemoteRepo; pr: PullRequest }) {
  const key = keyOf(repo)
  const exists = !!github.branchCommits(key, pr.head)
  return (
    <div className="gh-merge">
      <div className="gh-merge-icon merged">⇄</div>
      <div className="gh-box gh-merge-box">
        <div className="gh-merge-row">
          <div style={{ flex: 1 }}>
            <b>Pull request mesclado e fechado</b>
            <div className="gh-muted">{exists ? `O branch ${pr.head} pode ser excluído com segurança: o trabalho já está na ${pr.base}.` : `O branch ${pr.head} foi excluído.`}</div>
          </div>
          {exists && (
            <button className="gh-btn" onClick={() => github.deleteBranch(key, pr.head)}>Excluir branch</button>
          )}
        </div>
      </div>
    </div>
  )
}

function CommentBox({ repo, pr }: { repo: RemoteRepo; pr: PullRequest }) {
  const [text, setText] = useState('')
  const me = github.current()
  if (!me) return null
  return (
    <div className="gh-tl-item">
      <Who login={me.login} size={36} />
      <div className="gh-tl-bubble">
        <textarea className="gh-comment" value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Deixe um comentário" aria-label="Comentário" />
        <div className="gh-hero-cta left" style={{ padding: '0 10px 10px' }}>
          {pr.state === 'open' && pr.author === me.login && (
            <button className="gh-btn" onClick={() => github.closePull(keyOf(repo), pr.number)}>Fechar pull request</button>
          )}
          <button
            className="gh-btn green"
            disabled={!text.trim()}
            onClick={() => {
              github.comment(keyOf(repo), pr.number, me.login, text)
              setText('')
            }}
          >
            Comentar
          </button>
        </div>
      </div>
    </div>
  )
}

// ---------- Configurações > Branches ----------

export function BranchesSettings({ repo }: { repo: RemoteRepo }) {
  const key = keyOf(repo)
  const cur = github.protection(key, repo.branch)
  const [edit, setEdit] = useState(false)
  const [requirePr, setRequirePr] = useState(cur?.requirePr ?? true)
  const [approvals, setApprovals] = useState(cur?.approvals ?? 1)
  const [requireChecks, setRequireChecks] = useState(cur?.requireChecks ?? false)
  if (edit)
    return (
      <>
        <div className="gh-set-head"><h2>Regra de proteção de branch</h2></div>
        <label className="gh-field">
          <span>Padrão do nome do branch</span>
          <input value={repo.branch} readOnly aria-label="Padrão do branch" />
        </label>
        <div className="gh-rule">
          <label className="gh-check-opt">
            <input type="checkbox" checked={requirePr} onChange={(e) => setRequirePr(e.target.checked)} />
            <div>
              <b>Exigir pull request antes do merge</b>
              <div className="gh-muted">Todos os commits precisam entrar por um pull request. Push direto no branch é recusado.</div>
            </div>
          </label>
          {requirePr && (
            <label className="gh-field indent">
              <span>Aprovações necessárias</span>
              <select value={approvals} onChange={(e) => setApprovals(Number(e.target.value))} aria-label="Aprovações necessárias">
                {[0, 1, 2].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          )}
          <label className="gh-check-opt">
            <input type="checkbox" checked={requireChecks} onChange={(e) => setRequireChecks(e.target.checked)} />
            <div>
              <b>Exigir que os checks de status passem antes do merge</b>
              <div className="gh-muted">Os workflows do Actions que rodam no pull request precisam terminar com sucesso.</div>
            </div>
          </label>
        </div>
        <div className="gh-hero-cta left">
          <button
            className="gh-btn green"
            onClick={() => {
              github.setProtection(key, repo.branch, { requirePr, approvals: requirePr ? approvals : 0, requireChecks })
              setEdit(false)
            }}
          >
            {cur ? 'Salvar alterações' : 'Criar'}
          </button>
          <button className="gh-btn" onClick={() => setEdit(false)}>Cancelar</button>
        </div>
      </>
    )
  return (
    <>
      <div className="gh-set-head"><h2>Regras de proteção de branch</h2></div>
      <p className="gh-muted">Proteja branches importantes: exija revisão e testes antes que qualquer mudança chegue neles.</p>
      <div className="gh-set-head">
        <h3>Branch padrão</h3>
      </div>
      <div className="gh-box">
        <div className="gh-token">
          <div>
            <code><b>{repo.branch}</b></code>
            <div className="gh-muted">
              {cur
                ? [cur.requirePr && `exige pull request${cur.approvals ? ` com ${cur.approvals} aprovação${cur.approvals > 1 ? 'ões' : ''}` : ''}`, cur.requireChecks && 'exige checks verdes']
                    .filter(Boolean)
                    .join(' · ') || 'regra sem restrições'
                : 'Sem proteção: qualquer colaborador pode mandar push direto.'}
            </div>
          </div>
          <span>
            <button className="gh-btn small" onClick={() => setEdit(true)}>{cur ? '✎ Editar' : 'Adicionar regra'}</button>{' '}
            {cur && <button className="gh-btn danger small" onClick={() => github.setProtection(key, repo.branch, null)}>Remover</button>}
          </span>
        </div>
      </div>
    </>
  )
}
