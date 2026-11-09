// O "time" da Missão 7: Shikamaru revisa o pull request do aluno e a Bulma mescla
// uma mudança dela na main enquanto isso (o que gera o conflito no README).
import { github, makeCommit, onGithubPull, type PullRequest } from './github'
import { mail } from './mail'

export const TEAM_REPO = 'devlab/todo-api'
const REVIEWER = 'shikamaru-nara'
/** Linha que o revisor espera ver no README (endpoint novo documentado). */
export const documents = (readme: string | undefined) => !!readme && /GET \/todos\/pendentes/.test(readme)

type TeamState = { active: boolean; reviewed: number[]; approved: number[]; bulma: 'idle' | 'scheduled' | 'merged' }
const st: TeamState = { active: false, reviewed: [], approved: [], bulma: 'idle' }
const timers = new Set<ReturnType<typeof setTimeout>>()
const later = (ms: number, fn: () => void) => {
  const t = setTimeout(() => (timers.delete(t), fn()), ms)
  timers.add(t)
}

const student = () => github.student()

function notify(pr: PullRequest, subject: string, text: string) {
  const u = student()
  mail.send({
    from: 'Shikamaru Nara',
    fromAddr: 'notifications@github.sim',
    avatar: 25,
    to: u?.email ?? 'você',
    subject: `Re: [${TEAM_REPO}] ${pr.title} (PR #${pr.number})`,
    preview: subject,
    body: [
      { kind: 'p', text: `@shikamaru-nara ${subject}` },
      { kind: 'p', text },
      { kind: 'button', label: 'Ver o pull request', url: `https://github.sim/${TEAM_REPO}/pull/${pr.number}` },
    ],
  })
}

/** Revisão do Shikamaru: pede o README atualizado; quando está lá, aprova. */
function review(n: number) {
  const pr = github.pull(TEAM_REPO, n)
  if (!pr || pr.state !== 'open') return
  const readme = github.branchHead(TEAM_REPO, pr.head)?.tree['README.md']
  if (documents(readme)) {
    if (st.approved.includes(n)) return
    st.approved.push(n)
    const body = st.reviewed.includes(n) ? 'Agora sim, endpoint documentado. LGTM 👍' : 'Código e teste ok, e já veio documentado. LGTM 👍'
    github.review(TEAM_REPO, n, { by: REVIEWER, state: 'APPROVED', body })
    notify(pr, 'aprovou estas alterações.', body)
  } else if (!st.reviewed.includes(n)) {
    st.reviewed.push(n)
    const body =
      'Código e teste ficaram bons. Só falta uma coisa: documenta o endpoint novo no README, na seção "Endpoints". Quem usa a API lê o README, não o código.'
    github.review(TEAM_REPO, n, { by: REVIEWER, state: 'CHANGES_REQUESTED', body })
    notify(pr, 'solicitou alterações.', body)
  }
  github.touch()
}

/** A Bulma abre e mescla um PR que mexe na mesma parte do README. */
function bulmaPr() {
  if (st.bulma === 'merged') return
  const base = github.branchCommits(TEAM_REPO, 'main')!
  const tip = base[base.length - 1]
  const readme = tip.tree['README.md'] ?? ''
  const line = '- GET /version — versão da API em produção'
  const lines = readme.split('\n')
  const at = lines.findIndex((l) => /GET \/health/.test(l))
  if (at >= 0) lines.splice(at + 1, 0, line)
  else lines.push(line)
  const server = (tip.tree['src/server.js'] ?? '').replace(
    /(app\.get\('\/health'[^\n]*\n)/,
    `$1app.get('/version', (req, res) => res.json({ version: require('../package.json').version }))\n`,
  )
  const c = makeCommit(tip, { ...tip.tree, 'README.md': lines.join('\n'), 'src/server.js': server }, 'feat: endpoint /version', 'Bulma Briefs', 'bulma@devlab.sim')
  github.setCommits(TEAM_REPO, [...base, c], 'bulma-briefs', 'feat/version')
  const pr = github.createPull(TEAM_REPO, { title: 'feat: endpoint /version', body: 'Expõe a versão do package.json para o monitoramento.', head: 'feat/version', base: 'main', author: 'bulma-briefs' })
  if (typeof pr === 'string') return
  github.review(TEAM_REPO, pr.number, { by: REVIEWER, state: 'APPROVED', body: 'Pequeno e direto. Aprovado.' })
  later(1500, () => {
    github.mergePull(TEAM_REPO, pr.number, 'senku-ishigami', true)
    github.deleteBranch(TEAM_REPO, 'feat/version')
    st.bulma = 'merged'
    github.touch()
  })
}

onGithubPull((key, pr, action) => {
  if (!st.active || key !== TEAM_REPO || github.user(pr.author)?.bot) return
  if (action === 'opened') {
    github.requestReview(TEAM_REPO, pr.number, REVIEWER)
    later(6000, () => review(pr.number))
    if (st.bulma === 'idle') {
      st.bulma = 'scheduled'
      later(9000, bulmaPr)
    }
  }
  if (action === 'synchronize' && st.reviewed.includes(pr.number)) later(5000, () => review(pr.number))
})

export const team = {
  start() {
    st.active = true
  },
  state: (): Readonly<TeamState> => st,
  /** Retoma o que estava agendado quando a página foi recarregada. */
  resume() {
    if (!st.active) return
    for (const pr of github.pulls(TEAM_REPO)) if (pr.state === 'open' && !github.user(pr.author)?.bot && !st.approved.includes(pr.number)) later(3000, () => review(pr.number))
    if (st.bulma === 'scheduled') later(4000, bulmaPr)
  },
}

export function teamDump(): TeamState {
  return { ...st, reviewed: [...st.reviewed], approved: [...st.approved] }
}
export function teamLoad(d: TeamState | undefined) {
  for (const t of timers) clearTimeout(t)
  timers.clear()
  Object.assign(st, d ?? { active: false, reviewed: [], approved: [], bulma: 'idle' })
}
