// GitHub Actions simulado: a cada push, lê .github/workflows/*.yml do commit e executa os jobs
// num "runner" Linux descartável. Os comandos rodam de verdade no shell do simulador.
import { load } from 'js-yaml'
import { dir, VFS } from './fs'
import { Shell, type Machine } from './shell'
import { github, onGithubPull, onGithubPush, provideChecks, type Commit, type PullRequest, type Tree } from './github'
import { registerRepo } from './git'
import { mail } from './mail'

export const RUNNER_IP = '20.201.28.151'

export type Conclusion = 'success' | 'failure' | 'skipped' | 'cancelled'
export type StepRun = { name: string; status: 'pending' | 'running' | 'done'; conclusion?: Conclusion; log: string[]; started?: number; ended?: number }
export type JobRun = {
  key: string
  defKey: string
  matrix?: Record<string, string>
  name: string
  needs: string[]
  status: 'queued' | 'in_progress' | 'completed'
  conclusion?: Conclusion
  steps: StepRun[]
  started?: number
  ended?: number
}
export type Run = {
  id: number
  number: number
  attempt: number
  repo: string
  workflow: string
  file: string
  commit: Commit
  actor: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion?: Conclusion
  jobs: JobRun[]
  created: number
  ended?: number
  error?: string
  event: 'push' | 'workflow_dispatch' | 'schedule' | 'pull_request'
  artifacts: Record<string, Tree>
  ref?: string // branch do commit (padrão: main)
  pr?: number
}

type StepDef = { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; if?: string }
type Permissions = Record<string, string> | 'read-all' | 'write-all'
type JobDef = {
  name?: string
  'runs-on'?: string
  needs?: string | string[]
  if?: string
  steps?: StepDef[]
  env?: Record<string, unknown>
  permissions?: Permissions
  strategy?: { matrix?: Record<string, unknown> }
}
type WorkflowDef = { name?: string; on?: unknown; jobs?: Record<string, JobDef>; env?: Record<string, unknown>; permissions?: Permissions }

const runs: Run[] = []
const pages: Record<string, { enabled: boolean; files: Tree | null; updated: number }> = {}
const defs = new Map<number, WorkflowDef>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
let seq = 1000
const numbers: Record<string, number> = {}
const rand = (n: number) => Array.from({ length: n }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const actions = {
  /** Workflows presentes no último commit do repositório. */
  workflows(repo: string) {
    const head = github.head(repo)
    if (!head) return []
    return workflowFiles(head).map(([path, content]) => {
      let def: WorkflowDef = {}
      try {
        def = (load(content) ?? {}) as WorkflowDef
      } catch {
        /* inválido */
      }
      return { path, name: def.name ?? path.split('/').pop()!, dispatch: hasTrigger(def.on, 'workflow_dispatch'), cron: cronOf(def.on) }
    })
  },
  /** Botão "Run workflow" (gatilho workflow_dispatch). */
  dispatch(repo: string, path: string, actor: string): string | null {
    const head = github.head(repo)
    const content = head?.tree[path]
    if (!head || !content) return 'Workflow não encontrado.'
    return startWorkflow(repo, path, content, head, actor, 'workflow_dispatch')
  },
  pages: (repo: string) => pages[repo],
  setPagesEnabled(repo: string, on: boolean) {
    pages[repo] = { ...(pages[repo] ?? { files: null, updated: 0 }), enabled: on }
    emit()
  },
  pagesUrl: (repo: string) => `https://${repo.split('/')[0]}.github.sim/${repo.split('/')[1]}/`,
  runs: (repo: string) => runs.filter((r) => r.repo === repo).sort((a, b) => b.id - a.id),
  get: (id: number) => runs.find((r) => r.id === id),
  /** Status do último run de um commit (para o ícone ✓/✗ na lista de commits). */
  statusFor(repo: string, sha: string): Run | undefined {
    return runs.filter((r) => r.repo === repo && r.commit.hash === sha).sort((a, b) => b.id - a.id)[0]
  },
  rerun(id: number) {
    const r = runs.find((x) => x.id === id)
    const def = defs.get(id)
    if (!r || !def || r.status !== 'completed') return
    r.attempt++
    r.status = 'queued'
    r.conclusion = undefined
    r.ended = undefined
    r.jobs = buildJobs(def)
    emit()
    void execute(r, def)
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

// ---------- gatilhos ----------

const globMatch = (pat: string, b: string) => pat === b || pat === '*' && !b.includes('/') || pat === '**' || (pat.endsWith('/**') && b.startsWith(pat.slice(0, -2))) || (pat.endsWith('/*') && b.startsWith(pat.slice(0, -1)) && !b.slice(pat.length - 1).includes('/'))
function triggersOn(on: unknown, event: 'push' | 'pull_request', branch: string): boolean {
  if (on === event) return true
  if (Array.isArray(on)) return on.includes(event)
  if (on && typeof on === 'object' && event in on) {
    const push = (on as Record<string, unknown>)[event] as { branches?: string[] } | null
    if (!push?.branches) return true
    return push.branches.some((b) => globMatch(String(b), branch))
  }
  return false
}

function combos(matrix: Record<string, unknown>): Record<string, string>[] {
  let out: Record<string, string>[] = [{}]
  for (const [k, v] of Object.entries(matrix)) {
    if (k === 'include' || k === 'exclude' || !Array.isArray(v)) continue
    out = out.flatMap((c) => v.map((x) => ({ ...c, [k]: String(x) })))
  }
  return out
}

function buildJobs(def: WorkflowDef): JobRun[] {
  return Object.entries(def.jobs ?? {}).flatMap(([key, j]) => {
    const needs = j.needs ? (Array.isArray(j.needs) ? j.needs : [j.needs]) : []
    const mx = j.strategy?.matrix
    const list = mx && typeof mx === 'object' ? combos(mx) : [undefined]
    return list.map((m) => {
      let name = j.name ?? key
      if (m) {
        name = name.replace(/\$\{\{\s*matrix\.(\w[\w-]*)\s*\}\}/g, (_, k: string) => m[k] ?? '')
        if (name === (j.name ?? key)) name = `${name} (${Object.values(m).join(', ')})`
      }
      return { key: m ? `${key}-${Object.values(m).join('-')}` : key, defKey: key, matrix: m, name, needs, status: 'queued' as const, steps: [] }
    })
  })
}

const CRON = /^(\S+\s+){4}\S+$/

function startWorkflow(repo: string, path: string, content: string, commit: Commit, actor: string, event: Run['event'], ref = 'main', pr?: PullRequest): string | null {
  const base = {
    ref,
    pr: pr?.number,
    id: seq++,
    number: (numbers[repo] = (numbers[repo] ?? 0) + 1),
    attempt: 1,
    repo,
    file: path,
    commit,
    actor,
    created: Date.now(),
    event,
    artifacts: {},
  }
  let def: WorkflowDef
  try {
    def = (load(content) ?? {}) as WorkflowDef
    if (typeof def !== 'object') throw new Error('o arquivo precisa ser um mapa YAML (chave: valor)')
  } catch (e) {
    if (event !== 'push') return 'Workflow inválido'
    const msg = (e as Error).message.split('\n')[0]
    const run: Run = { ...base, workflow: path, status: 'completed', conclusion: 'failure', jobs: [], ended: Date.now(), error: `Invalid workflow file: ${path}\n${msg}` }
    runs.push(run)
    notifyFailure(run)
    emit()
    return null
  }
  const ok =
    event === 'push' ? triggersOn(def.on, 'push', ref) : event === 'pull_request' ? triggersOn(def.on, 'pull_request', pr!.base) : event === 'workflow_dispatch' ? hasTrigger(def.on, 'workflow_dispatch') : hasTrigger(def.on, 'schedule')
  if (!ok) {
    numbers[repo]--
    seq--
    return event === 'workflow_dispatch' ? 'Este workflow não tem o gatilho workflow_dispatch.' : null
  }
  const name = def.name ?? path.split('/').pop()!
  if (!def.jobs || !Object.keys(def.jobs).length) {
    const run: Run = { ...base, workflow: name, status: 'completed', conclusion: 'failure', jobs: [], ended: Date.now(), error: `Invalid workflow file: ${path}\nNo jobs were defined (a chave "jobs" é obrigatória).` }
    runs.push(run)
    notifyFailure(run)
    emit()
    return null
  }
  const run: Run = { ...base, workflow: name, status: 'queued', jobs: buildJobs(def) }
  runs.push(run)
  defs.set(run.id, def)
  emit()
  void execute(run, def)
  return null
}

function hasTrigger(on: unknown, t: string) {
  if (on === t) return true
  if (Array.isArray(on)) return on.includes(t)
  return !!on && typeof on === 'object' && t in on
}

export function cronOf(on: unknown): string | null {
  if (!on || typeof on !== 'object' || !('schedule' in on)) return null
  const sch = (on as { schedule?: { cron?: string }[] }).schedule
  const c = Array.isArray(sch) ? sch[0]?.cron : undefined
  return c && CRON.test(c.trim()) ? c.trim() : null
}

const workflowFiles = (commit: Commit) => Object.entries(commit.tree).filter(([p]) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p))

onGithubPush((repo, _before, after, pusher, branch) => {
  for (const [path, content] of workflowFiles(after)) startWorkflow(repo, path, content, after, pusher, 'push', branch)
})
onGithubPull((repo, pr, action) => {
  if (action !== 'opened' && action !== 'synchronize') return
  const head = github.branchHead(repo, pr.head)
  if (!head) return
  for (const [path, content] of workflowFiles(head)) startWorkflow(repo, path, content, head, pr.author, 'pull_request', pr.head, pr)
})
// checks de um commit (usados na página do pull request e pela proteção de branch)
provideChecks((repo, sha) =>
  runs
    .filter((r) => r.repo === repo && r.commit.hash === sha)
    .sort((a, b) => b.id - a.id)
    .filter((r, i, all) => all.findIndex((x) => x.file === r.file && x.event === r.event) === i)
    .flatMap((r) =>
      r.jobs.length
        ? r.jobs.map((j) => ({
            name: `${r.workflow} / ${j.name} (${r.event})`,
            state: j.status !== 'completed' ? ('pending' as const) : j.conclusion === 'success' ? ('success' as const) : j.conclusion === 'skipped' ? ('skipped' as const) : ('failure' as const),
            runId: r.id,
          }))
        : [{ name: r.workflow, state: r.status !== 'completed' ? ('pending' as const) : r.conclusion === 'success' ? ('success' as const) : ('failure' as const), runId: r.id }],
    ),
)

// agendamentos (cron): no simulador, cada workflow agendado roda a cada 2 minutos
setInterval(() => {
  for (const r of github.all()) {
    if (!r.collaborators.some((c) => !github.user(c)?.bot)) continue
    const head = r.commits[r.commits.length - 1]
    for (const [path, content] of workflowFiles(head)) {
      try {
        if (cronOf((load(content) as WorkflowDef)?.on)) startWorkflow(`${r.owner}/${r.name}`, path, content, head, 'github-actions[bot]', 'schedule')
      } catch {
        /* YAML inválido: ignora */
      }
    }
  }
}, 120_000)

function notifyFailure(run: Run) {
  if (run.event === 'pull_request' && github.user(run.actor)?.bot) return
  const sha = run.commit.hash.slice(0, 7)
  mail.send({
    from: 'GitHub',
    fromAddr: 'notifications@github.sim',
    logo: 'github',
    to: run.actor || 'você',
    subject: `[${run.repo}] Run failed: ${run.workflow} - ${run.event === 'pull_request' ? `PR #${run.pr}` : (run.ref ?? 'main')} (${sha})`,
    preview: `${run.workflow}: Some jobs were not successful`,
    body: [
      { kind: 'p', text: `❌ ${run.workflow}: Some jobs were not successful` },
      { kind: 'kv', rows: [['Repositório', run.repo], ['Commit', `${sha} ${run.commit.message}`], ['Disparado por', run.actor ? `@${run.actor} (push)` : 'push']] },
      ...(run.error ? [{ kind: 'code' as const, text: run.error }] : run.jobs.filter((j) => j.conclusion === 'failure').map((j) => ({ kind: 'p' as const, text: `• Job "${j.name}" falhou` }))),
      { kind: 'button', label: 'Ver execução', url: `https://github.sim/${run.repo}/actions/runs/${run.id}` },
    ],
  })
}

// ---------- execução ----------

async function execute(run: Run, def: WorkflowDef) {
  await sleep(1200) // "Waiting for a runner to pick up this job..."
  run.status = 'in_progress'
  emit()
  const done = new Set<string>()
  const pending = [...run.jobs]
  while (pending.length) {
    const ready = pending.filter((j) => run.jobs.filter((x) => j.needs.includes(x.defKey)).every((d) => done.has(d.key)))
    if (!ready.length) break
    await Promise.all(
      ready.map(async (job) => {
        pending.splice(pending.indexOf(job), 1)
        const deps = run.jobs.filter((x) => job.needs.includes(x.defKey))
        if (deps.some((d) => d.conclusion !== 'success')) {
          job.status = 'completed'
          job.conclusion = 'skipped'
        } else if (def.jobs![job.defKey].if && !evalIf(def.jobs![job.defKey].if!, run)) {
          job.status = 'completed'
          job.conclusion = 'skipped'
        } else await runJob(run, job, def.jobs![job.defKey], def)
        done.add(job.key)
        emit()
      }),
    )
  }
  run.status = 'completed'
  run.conclusion = run.jobs.some((j) => j.conclusion === 'failure') ? 'failure' : 'success'
  run.ended = Date.now()
  if (run.conclusion === 'failure') notifyFailure(run)
  emit()
}

const refOf = (run: Run) => (run.event === 'pull_request' ? `refs/pull/${run.pr}/merge` : `refs/heads/${run.ref ?? 'main'}`)
const refNameOf = (run: Run) => (run.event === 'pull_request' ? `${run.pr}/merge` : (run.ref ?? 'main'))
function evalIf(expr: string, run: Run): boolean {
  const e = expr.replace(/^\$\{\{\s*|\s*\}\}$/g, '').trim()
  const ctx: Record<string, string> = { 'github.ref': refOf(run), 'github.ref_name': refNameOf(run), 'github.event_name': run.event, 'github.head_ref': run.event === 'pull_request' ? (run.ref ?? '') : '' }
  const parts = e.split(/\s*&&\s*/)
  if (parts.length > 1) return parts.every((p) => evalIf(p, run))
  const m = e.match(/^([\w.]+)\s*(==|!=)\s*'([^']*)'$/)
  if (m) return m[2] === '==' ? ctx[m[1]] === m[3] : ctx[m[1]] !== m[3]
  if (e === 'always()' || e === 'success()') return true
  return true
}

/** Junta linhas de um bloco `run:` respeitando aspas que atravessam linhas e barras invertidas. */
function splitScript(script: string): string[] {
  const out: string[] = []
  let cur = ''
  let quote: string | null = null
  for (const raw of script.split('\n')) {
    const line = cur ? cur + '\n' + raw : raw
    let q: string | null = quote
    for (let i = cur ? cur.length : 0; i < line.length; i++) {
      const ch = line[i]
      if (q) {
        if (ch === q) q = null
      } else if (ch === '"' || ch === "'") q = ch
    }
    if (q || /\\$/.test(raw)) {
      cur = q ? line : line.replace(/\\$/, '')
      quote = q
      continue
    }
    cur = ''
    quote = null
    if (line.trim() && !line.trim().startsWith('#')) out.push(line.trim())
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

/** Escopos do GITHUB_TOKEN conforme o bloco permissions (o padrão só permite ler pacotes). */
function tokenScopes(p: Permissions | undefined): string[] {
  if (p === 'write-all') return ['repo', 'read:packages', 'write:packages']
  if (!p || p === 'read-all') return ['read:packages']
  const scopes = ['read:packages']
  if (p.packages === 'write') scopes.push('write:packages')
  if (p.contents === 'write') scopes.push('repo')
  return scopes
}

async function runJob(run: Run, job: JobRun, def: JobDef, wf: WorkflowDef) {
  job.status = 'in_progress'
  job.started = Date.now()
  const runToken = github.createRunToken(run.actor, tokenScopes(def.permissions ?? wf.permissions))
  const secrets: Record<string, { value: string; updated: number }> = { ...(github.get(run.repo)?.secrets ?? {}), GITHUB_TOKEN: { value: runToken, updated: Date.now() } }
  const secretValues = Object.values(secrets).map((s) => s.value.trim()).filter((v) => v.length >= 4)
  const mask = (s: string) => secretValues.reduce((acc, v) => acc.split(v).join('***'), s)
  const expr = (s: string) =>
    s.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_, e: string) => {
      const sm = e.match(/^secrets\.(\w+)$/)
      if (sm) return secrets[sm[1]]?.value ?? ''
      const ctx: Record<string, string> = {
        'github.sha': run.commit.hash,
        'github.ref': refOf(run),
        'github.ref_name': refNameOf(run),
        'github.head_ref': run.event === 'pull_request' ? (run.ref ?? '') : '',
        'github.base_ref': run.event === 'pull_request' ? 'main' : '',
        'github.repository': run.repo,
        'github.actor': run.actor,
        'github.run_number': String(run.number),
        'github.event_name': run.event,
      }
      const mm = e.match(/^matrix\.([\w-]+)$/)
      if (mm) return job.matrix?.[mm[1]] ?? ''
      return ctx[e] ?? ''
    })

  const steps: { def?: StepDef; name: string }[] = [
    { name: 'Set up job' },
    ...(def.steps ?? []).map((s) => ({ def: s, name: s.name ?? (s.uses ? `Run ${s.uses}` : `Run ${(s.run ?? '').split('\n')[0]}`) })),
    { name: 'Complete job' },
  ]
  job.steps = steps.map((s) => ({ name: s.name, status: 'pending', log: [] }))
  emit()

  const runsOn = def['runs-on'] ?? ''
  const fs = new VFS(dir({ home: dir({ runner: dir({ work: dir() }) }), tmp: dir() }), '/home/runner')
  const machine: Machine = { id: `runner-${rand(6)}`, os: 'ubuntu', packages: new Set(['git', 'nodejs', 'npm', 'curl', 'docker']), aptUpdated: true, ip: RUNNER_IP, interactive: false, userGroups: { runner: ['docker'] }, nodeVersion: 'v20.15.0' }
  const repoName = run.repo.split('/')[1]
  const workspace = `/home/runner/work/${repoName}/${repoName}`
  fs.mkdir(workspace, true)
  const sh = new Shell(fs, 'runner', `fv-az${Math.floor(Math.random() * 900 + 100)}-${rand(3)}`, machine)
  sh.cwd = workspace
  for (const [k, v] of Object.entries({ ...(wf.env ?? {}), ...(def.env ?? {}) })) sh.env[k] = expr(String(v))
  Object.assign(sh.env, { GITHUB_SHA: run.commit.hash, GITHUB_REPOSITORY: run.repo, GITHUB_ACTOR: run.actor, CI: 'true' })

  let failed = false
  for (let i = 0; i < steps.length; i++) {
    const st = job.steps[i]
    const sdef = steps[i].def
    if (failed && i < steps.length - 1) {
      st.status = 'done'
      st.conclusion = 'skipped'
      continue
    }
    st.status = 'running'
    st.started = Date.now()
    emit()
    const log = (l: string) => st.log.push(...mask(strip(l)).split('\n'))
    let ok = true
    if (i === 0) {
      await sleep(700)
      if (!/^ubuntu-/.test(runsOn)) {
        log(`Error: nenhum runner hospedado com o rótulo "${runsOn || '(vazio)'}". Use runs-on: ubuntu-latest`)
        ok = false
      } else {
        log(`Current runner version: '2.320.0'`)
        log(`Runner name: 'GitHub Actions ${Math.floor(Math.random() * 90 + 10)}'`)
        log('Operating System')
        log('  Ubuntu 24.04.1 LTS')
        log(`Runner Image: ${runsOn}`)
        log('Prepare workflow directory')
        log('Prepare all required actions')
        for (const s of def.steps ?? []) if (s.uses) log(`Download action repository '${s.uses}'`)
        log(`Complete job name: ${job.name}`)
      }
    } else if (i === steps.length - 1) {
      await sleep(300)
      log('Cleaning up orphan processes')
    } else if (sdef?.uses) {
      ok = await runAction({ ...sdef, with: Object.fromEntries(Object.entries(sdef.with ?? {}).map(([k, v]) => [k, typeof v === 'string' ? expr(v) : v])) }, { fs, workspace, run, log, machine, perms: def.permissions ?? wf.permissions })
    } else if (sdef?.run) {
      const script = expr(sdef.run)
      log(`\u001b[36mRun ${mask(sdef.run.split('\n')[0])}\u001b[0m`)
      const lines = splitScript(script)
      const slow = /npm (ci|install|i)\b|ssh |git pull|apt/.test(script)
      await sleep(slow ? 2200 : 1000)
      for (const line of lines) {
        const r = sh.execute(line)
        if (r.out) log(r.out)
        if (r.prompt) {
          log('Error: o comando pediu uma entrada interativa, mas o runner não tem teclado (terminal prompts disabled).')
          ok = false
          break
        }
        if (r.code !== 0) {
          log(`Error: Process completed with exit code ${r.code}.`)
          ok = false
          break
        }
      }
    } else {
      log('Error: cada step precisa de "run" ou "uses".')
      ok = false
    }
    st.status = 'done'
    st.conclusion = ok ? 'success' : 'failure'
    st.ended = Date.now()
    if (!ok) failed = true
    emit()
  }
  job.status = 'completed'
  job.conclusion = failed ? 'failure' : 'success'
  job.ended = Date.now()
}

const NODE_VERSIONS: Record<string, string> = { '16': 'v16.20.2', '18': 'v18.20.4', '20': 'v20.15.0', '22': 'v22.9.0' }

async function runAction(
  s: StepDef,
  c: { fs: VFS; workspace: string; run: Run; log: (l: string) => void; machine: Machine; perms: Permissions | undefined },
): Promise<boolean> {
  const [name] = (s.uses ?? '').split('@')
  const { log } = c
  if (name === 'actions/checkout') {
    await sleep(1200)
    const list = github.branchCommits(c.run.repo, c.run.ref ?? 'main') ?? github.get(c.run.repo)!.commits
    const idx = list.findIndex((x) => x.hash === c.run.commit.hash)
    log(`Syncing repository: ${c.run.repo}`)
    log('Getting Git version info')
    log('Initializing the repository')
    log(`Fetching the repository`)
    log(`Determining the checkout info`)
    c.fs.writeTree(c.workspace, c.run.commit.tree)
    registerRepo(c.fs, c.workspace, c.run.repo, idx >= 0 ? list.slice(0, idx + 1) : [c.run.commit], c.run.event === 'pull_request' ? 'main' : (c.run.ref ?? 'main'))
    log(`HEAD is now at ${c.run.commit.hash.slice(0, 7)} ${c.run.commit.message}`)
    return true
  }
  if (name === 'actions/setup-node') {
    await sleep(1400)
    const v = String(s.with?.['node-version'] ?? '20')
    const full = NODE_VERSIONS[v.replace(/\.x$/, '').split('.')[0]]
    if (!full) {
      log(`Error: Unable to find Node version '${v}' for platform linux and architecture x64.`)
      return false
    }
    c.machine.nodeVersion = full
    log(`Attempting to download ${v}...`)
    log(`Acquiring ${full.slice(1)} - x64 from https://github.sim/actions/node-versions/releases`)
    log('Extracting ...')
    log(`Successfully set up Node.js ${v}`)
    if (s.with?.cache) log(`Cache restored for ${s.with.cache}`)
    return true
  }
  const perm = (k: string) => c.perms === 'write-all' || (typeof c.perms === 'object' && c.perms[k] === 'write')
  const repo = c.run.repo
  if (name === 'actions/configure-pages') {
    await sleep(800)
    if (!pages[repo]?.enabled) {
      log('Error: Get Pages site failed. Please verify that the repository has Pages enabled and configured to build using GitHub Actions, or consider exploring the `enablement` parameter for this action.')
      log('Dica: em Configurações > Pages, escolha a origem "GitHub Actions".')
      return false
    }
    log(`Pages configurado. URL do site: ${actions.pagesUrl(repo)}`)
    return true
  }
  if (name === 'actions/upload-pages-artifact') {
    await sleep(900)
    const path = String(s.with?.path ?? '_site').replace(/^\.\//, '').replace(/\/$/, '')
    const abs = path === '.' ? c.workspace : `${c.workspace}/${path}`
    if (!c.fs.isDir(abs)) {
      log(`tar: ${path}: Cannot open: No such file or directory`)
      log('Error: Process completed with exit code 2.')
      return false
    }
    const files = c.fs.walkFiles(abs, (rel) => rel === '.git' || rel.startsWith('node_modules'))
    c.run.artifacts['github-pages'] = files
    log(`Uploaded artifact 'github-pages' (${Object.keys(files).length} arquivos, ${Object.values(files).reduce((a, x) => a + x.length, 0)} bytes)`)
    return true
  }
  if (name === 'actions/deploy-pages') {
    await sleep(1500)
    if (!perm('id-token')) {
      log('Error: Error message: Unable to get ACTIONS_ID_TOKEN_REQUEST_URL env variable')
      log('Dica: o job precisa de "permissions: id-token: write" (e "pages: write").')
      return false
    }
    if (!perm('pages')) {
      log('Error: HttpError: Resource not accessible by integration')
      log('Dica: o job precisa de "permissions: pages: write".')
      return false
    }
    const art = c.run.artifacts['github-pages']
    if (!art) {
      log('Error: No artifacts named "github-pages" were found for this workflow run. Ensure artifacts are uploaded with actions/upload-pages-artifact.')
      return false
    }
    if (!pages[repo]?.enabled) {
      log('Error: Failed to create deployment (status: 404). Ensure GitHub Pages has been enabled.')
      return false
    }
    pages[repo] = { enabled: true, files: art, updated: Date.now() }
    log('Fetching artifact metadata for "github-pages" in this workflow run')
    log('Creating Pages deployment with payload')
    log('Created deployment for ' + c.run.commit.hash)
    log('Getting Pages deployment status...')
    log('Reported success!')
    log(`Site publicado em ${actions.pagesUrl(repo)}`)
    emit()
    return true
  }
  await sleep(500)
  log(`Error: Unable to resolve action \`${s.uses}\`, repository or version not found`)
  return false
}

// ---------- progresso salvo ----------
export function actionsDump() {
  // guarda só as 40 execuções mais recentes por repositório (logs ocupam espaço)
  const byRepo: Record<string, number> = {}
  const kept = [...runs].sort((a, b) => b.id - a.id).filter((r) => (byRepo[r.repo] = (byRepo[r.repo] ?? 0) + 1) <= 40)
  return { runs: kept, defs: [...defs.entries()].filter(([id]) => kept.some((r) => r.id === id)), pages, numbers, seq }
}
export function actionsLoad(d: ReturnType<typeof actionsDump>) {
  // execuções interrompidas pelo recarregamento viram "canceladas"
  for (const r of d.runs)
    if (r.status !== 'completed') {
      r.status = 'completed'
      r.conclusion = 'cancelled'
      r.ended = Date.now()
      for (const j of r.jobs)
        if (j.status !== 'completed') {
          j.status = 'completed'
          j.conclusion = 'cancelled'
          for (const s of j.steps) if (s.status !== 'done') ((s.status = 'done'), (s.conclusion = 'cancelled'))
        }
    }
  runs.splice(0, runs.length, ...d.runs)
  defs.clear()
  for (const [id, w] of d.defs) defs.set(id, w)
  for (const k of Object.keys(pages)) delete pages[k]
  Object.assign(pages, d.pages)
  for (const k of Object.keys(numbers)) delete numbers[k]
  Object.assign(numbers, d.numbers)
  seq = d.seq
}
