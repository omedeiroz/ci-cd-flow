// "GitHub" simulado: repositórios remotos que o git do terminal e o Navegador enxergam.
import { mergeBase, mergeTrees, unionHistory } from './merge'

export type Tree = Record<string, string>
export type Commit = {
  hash: string
  parent: string | null
  message: string
  author: string
  email: string
  date: number
  tree: Tree
  parent2?: string | null // segundo pai (commits de merge)
}
export type Review = { by: string; state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED'; body: string; date: number; commit: string }
export type PullComment = { by: string; body: string; date: number }
export type PullRequest = {
  number: number
  title: string
  body: string
  head: string
  base: string
  author: string
  state: 'open' | 'merged' | 'closed'
  created: number
  reviews: Review[]
  comments: PullComment[]
  requested: string[] // revisores solicitados
  mergedAt?: number
  mergedBy?: string
  mergeCommit?: string
  headDeleted?: boolean
  merged?: { commits: Commit[]; from: Tree; to: Tree } // retrato do que foi mesclado (o branch pode ser apagado depois)
}
export type Protection = { requirePr: boolean; approvals: number; requireChecks: boolean }
export type Environment = { secrets: Record<string, { value: string; updated: number }>; reviewers: string[]; created: number }
export type RemoteRepo = {
  owner: string
  name: string
  description: string
  stars: number
  branch: string
  commits: Commit[] // do mais antigo para o mais novo
  collaborators: string[]
  admins: string[]
  secrets: Record<string, { value: string; updated: number }>
  branches?: Record<string, Commit[]> // branches além do padrão (o padrão fica em `commits`)
  pulls?: PullRequest[]
  protection?: Record<string, Protection>
  environments?: Record<string, Environment>
}

export type Token = { id: string; note: string; value: string; scopes: string[]; created: number; expires: string }
export type User = {
  login: string
  name: string
  email: string
  password: string
  verified: boolean
  avatar: number // semente do avatar anime
  tokens: Token[]
  bot?: boolean
}
export type Invitation = { id: string; repo: string; invitee: string; inviter: string; status: 'pending' | 'accepted' | 'declined'; date: number }

export function hashOf(input: string) {
  let h1 = 0x811c9dc5
  let h2 = 0x1234567
  for (let i = 0; i < input.length; i++) {
    h1 = Math.imul(h1 ^ input.charCodeAt(i), 16777619)
    h2 = Math.imul(h2 ^ input.charCodeAt(i), 2654435761)
  }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')).repeat(3).slice(0, 40)
}

export function makeCommit(parent: Commit | null, tree: Tree, message: string, author: string, email: string, date = Date.now()): Commit {
  return {
    hash: hashOf(`${parent?.hash}|${message}|${author}|${date}|${JSON.stringify(tree)}`),
    parent: parent?.hash ?? null,
    message,
    author,
    email,
    date,
    tree,
  }
}

// ---------- Conteúdo do repositório do curso ----------

const README = `# todo-api

API de tarefas (to-do) usada no curso **DevOps Lab**.

É uma aplicação Node.js simples, mas com tudo que um projeto real precisa
para entrar num pipeline de CI/CD: testes automatizados, Dockerfile e scripts npm.

## Como rodar

\`\`\`bash
npm install
npm test
npm start
\`\`\`

Depois acesse http://localhost:3000 (a página fica em \`public/\`).

## Endpoints

- GET /todos — lista as tarefas
- POST /todos — cria uma tarefa
- PATCH /todos/:id — marca/desmarca uma tarefa
- GET /health — usado pelo monitoramento
`

const PACKAGE = `{
  "name": "todo-api",
  "version": "1.0.0",
  "description": "API de tarefas do DevOps Lab",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test tests/"
  },
  "dependencies": {
    "express": "^4.19.2"
  }
}
`

const SERVER = `const express = require('express')
const { listTodos, addTodo, toggleTodo } = require('./todos')

const app = express()
app.use(express.json())
app.use(express.static('public')) // a página (public/index.html) chama a API abaixo

app.get('/health', (req, res) => res.json({ status: 'ok' }))
app.get('/todos', (req, res) => res.json(listTodos()))
app.post('/todos', (req, res) => res.status(201).json(addTodo(req.body.title)))
app.patch('/todos/:id', (req, res) => res.json(toggleTodo(Number(req.params.id))))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(\`Servidor rodando em http://localhost:\${PORT}\`))
`

const TODOS = `// As tarefas ficam só na memória do processo: reiniciar o servidor (ou fazer deploy) volta à lista inicial.
const todos = [
  { id: 1, title: 'Aprender o terminal', done: true },
  { id: 2, title: 'Clonar o repositório', done: false },
  { id: 3, title: 'Configurar o pipeline de CI/CD', done: false },
]

function listTodos() {
  return todos
}

function addTodo(title) {
  if (!title) throw new Error('title é obrigatório')
  const todo = { id: todos.length + 1, title, done: false }
  todos.push(todo)
  return todo
}

function toggleTodo(id) {
  const todo = todos.find((t) => t.id === id)
  if (!todo) throw new Error('tarefa não encontrada')
  todo.done = !todo.done
  return todo
}

module.exports = { listTodos, addTodo, toggleTodo }
`

const PUBLIC_INDEX = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Tarefas</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <main class="card">
    <h1>✓ Tarefas</h1>
    <p class="sub">todo-api</p>

    <form id="nova">
      <input id="titulo" placeholder="Nova tarefa…" autocomplete="off">
      <button>Adicionar</button>
    </form>
    <p id="erro" class="erro"></p>

    <ul id="lista"></ul>
    <p class="rodape" id="total"></p>
  </main>

  <script src="app.js"></script>
</body>
</html>
`

const PUBLIC_JS = `// Front-end da todo-api: só chama a API (GET, POST e PATCH em /todos).
const lista = document.getElementById('lista')
const erro = document.getElementById('erro')

async function carregar() {
  const res = await fetch('/todos')
  const todos = await res.json()
  lista.innerHTML = ''
  for (const t of todos) {
    const li = document.createElement('li')
    li.className = t.done ? 'feita' : ''
    li.innerHTML = '<span class="caixa">' + (t.done ? '✓' : '') + '</span>'
    li.append(t.title)
    li.onclick = async () => {
      await fetch('/todos/' + t.id, { method: 'PATCH' })
      carregar()
    }
    lista.append(li)
  }
  document.getElementById('total').textContent = 'GET /todos · ' + todos.length + ' tarefas'
}

document.getElementById('nova').onsubmit = async (e) => {
  e.preventDefault()
  const campo = document.getElementById('titulo')
  const res = await fetch('/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: campo.value.trim() }),
  })
  erro.textContent = res.ok ? '' : 'Erro ' + res.status + ': ' + (await res.text())
  campo.value = ''
  carregar()
}

carregar()
`

const PUBLIC_CSS = `body {
  margin: 0;
  min-height: 100vh;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
  background: linear-gradient(135deg, #e3f6e8, #e1ecfb);
  color: #1d1d1f;
}
.card { max-width: 380px; margin: 40px auto; padding: 24px; background: #fff; border-radius: 16px; box-shadow: 0 12px 30px rgba(0, 0, 0, .08); }
h1 { margin: 0; font-size: 26px; }
.sub { margin: 4px 0 16px; color: #6e6e73; font-size: 13px; }
form { display: flex; gap: 8px; }
input { flex: 1; padding: 8px 10px; border: 1px solid #d2d2d7; border-radius: 8px; font: inherit; }
button { padding: 8px 14px; border: 0; border-radius: 8px; background: #1f883d; color: #fff; font-weight: 600; cursor: pointer; }
ul { list-style: none; padding: 0; margin: 12px 0 0; }
li { display: flex; align-items: center; gap: 10px; padding: 10px 2px; border-bottom: 1px solid #eee; cursor: pointer; }
.caixa { width: 18px; height: 18px; border: 1.5px solid #c7c7cc; border-radius: 5px; display: grid; place-items: center; font-size: 12px; color: #fff; }
li.feita { color: #8e8e93; text-decoration: line-through; }
li.feita .caixa { background: #1f883d; border-color: #1f883d; }
.erro { color: #c9302c; font-size: 12px; margin: 6px 0 0; }
.rodape { margin: 14px 0 0; color: #8e8e93; font: 12px ui-monospace, monospace; }
`

const TEST = `const test = require('node:test')
const assert = require('node:assert')
const { listTodos, addTodo } = require('../src/todos')

test('lista as tarefas iniciais', () => {
  assert.strictEqual(listTodos().length, 3)
})

test('adiciona uma tarefa', () => {
  const t = addTodo('Escrever testes')
  assert.strictEqual(t.title, 'Escrever testes')
})

test('recusa tarefa sem título', () => {
  assert.throws(() => addTodo(''))
})
`

const DOCKERFILE = `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
`

const LOCK = `{
  "name": "todo-api",
  "version": "1.0.0",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": { "name": "todo-api", "version": "1.0.0", "dependencies": { "express": "^4.19.2" } },
    "node_modules/express": { "version": "4.19.2", "resolved": "https://registry.npmjs.sim/express/-/express-4.19.2.tgz" }
  }
}
`

const GITIGNORE = `node_modules/
.env
`

const TODOS_V1 = TODOS.replace("  if (!title) throw new Error('title é obrigatório')\n", '')
const PUBLIC = { 'public/index.html': PUBLIC_INDEX, 'public/app.js': PUBLIC_JS, 'public/style.css': PUBLIC_CSS }

function seedTodoApi(): RemoteRepo {
  const day = 86_400_000
  const t0 = Date.now() - 12 * day
  const c1 = makeCommit(
    null,
    { 'README.md': README, 'package.json': PACKAGE, 'package-lock.json': LOCK, '.gitignore': GITIGNORE, 'src/server.js': SERVER, 'src/todos.js': TODOS_V1, ...PUBLIC },
    'feat: estrutura inicial da API',
    'Senku Ishigami',
    'senku@devlab.sim',
    t0,
  )
  const c2 = makeCommit(c1, { ...c1.tree, 'tests/todos.test.js': TEST }, 'test: adiciona testes do módulo de tarefas', 'Shikamaru Nara', 'shikamaru@devlab.sim', t0 + 3 * day)
  const c2b = makeCommit(c2, { ...c2.tree, 'src/todos.js': TODOS }, 'fix: valida título vazio ao criar tarefa', 'Bulma Briefs', 'bulma@devlab.sim', t0 + 5 * day)
  const c3 = makeCommit(c2b, { ...c2b.tree, Dockerfile: DOCKERFILE }, 'build: adiciona Dockerfile', 'Senku Ishigami', 'senku@devlab.sim', t0 + 7 * day)
  return {
    owner: 'devlab',
    name: 'todo-api',
    description: 'API de tarefas usada no curso DevOps Lab',
    stars: 42,
    branch: 'main',
    commits: [c1, c2, c2b, c3],
    collaborators: ['senku-ishigami', 'shikamaru-nara', 'bulma-briefs'],
    admins: ['senku-ishigami'],
    secrets: {},
  }
}

// ---------- Estado ----------

const repos: Record<string, RemoteRepo> = { 'devlab/todo-api': seedTodoApi() }
const users: Record<string, User> = {
  'senku-ishigami': { login: 'senku-ishigami', name: 'Senku Ishigami', email: 'senku@devlab.sim', password: '-', verified: true, avatar: 1, tokens: [], bot: true },
  'shikamaru-nara': { login: 'shikamaru-nara', name: 'Shikamaru Nara', email: 'shikamaru@devlab.sim', password: '-', verified: true, avatar: 25, tokens: [], bot: true },
  'bulma-briefs': { login: 'bulma-briefs', name: 'Bulma Briefs', email: 'bulma@devlab.sim', password: '-', verified: true, avatar: 5, tokens: [], bot: true },
}
const invitations: Invitation[] = []
let session: string | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

const rand = (n: number, chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') =>
  Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('')

const RESERVED = ['login', 'signup', 'settings', 'verify', 'notifications', 'devlab', 'new', 'admin']

export const github = {
  host: 'github.sim',

  // ---------- repositórios ----------
  get(key: string): RemoteRepo | undefined {
    return repos[key]
  },
  all(): RemoteRepo[] {
    return Object.values(repos)
  },
  /** Aceita https://github.sim/dono/repo(.git) e git@github.sim:dono/repo.git */
  parseUrl(url: string): string | null {
    const m = url.match(/^(?:https?:\/\/)?github\.sim[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/) ?? url.match(/^git@github\.sim:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/)
    return m ? `${m[1]}/${m[2]}` : null
  },
  cloneUrl(key: string) {
    return `https://github.sim/${key}.git`
  },
  head(key: string): Commit | undefined {
    const r = repos[key]
    return r?.commits[r.commits.length - 1]
  },
  setCommits(key: string, commits: Commit[], pusher = '', branch?: string) {
    const r = repos[key]
    const b = branch ?? r.branch
    const before = this.branchHead(key, b)
    if (b === r.branch) repos[key] = { ...r, commits: [...commits] }
    else repos[key] = { ...r, branches: { ...(r.branches ?? {}), [b]: [...commits] } }
    emit()
    onPushHook?.(key, before, commits[commits.length - 1], pusher, b)
    const pr = this.openPullFor(key, b)
    if (pr) onPullHook?.(key, pr, 'synchronize')
  },

  // ---------- branches ----------
  branchNames(key: string): string[] {
    const r = repos[key]
    return r ? [r.branch, ...Object.keys(r.branches ?? {})] : []
  },
  branchCommits(key: string, branch: string): Commit[] | undefined {
    const r = repos[key]
    if (!r) return undefined
    return branch === r.branch ? r.commits : r.branches?.[branch]
  },
  branchHead(key: string, branch: string): Commit | undefined {
    const l = this.branchCommits(key, branch)
    return l?.[l.length - 1]
  },
  deleteBranch(key: string, branch: string) {
    const r = repos[key]
    if (!r?.branches?.[branch]) return
    const rest = { ...r.branches }
    delete rest[branch]
    repos[key] = { ...r, branches: rest }
    for (const pr of r.pulls ?? []) if (pr.head === branch && pr.state !== 'open') pr.headDeleted = true
    emit()
  },
  protection(key: string, branch: string): Protection | undefined {
    return repos[key]?.protection?.[branch]
  },
  setProtection(key: string, branch: string, p: Protection | null) {
    const r = repos[key]
    if (!r) return
    const all = { ...(r.protection ?? {}) }
    if (p) all[branch] = p
    else delete all[branch]
    repos[key] = { ...r, protection: all }
    emit()
  },

  // ---------- pull requests ----------
  pulls(key: string): PullRequest[] {
    return repos[key]?.pulls ?? []
  },
  pull(key: string, n: number): PullRequest | undefined {
    return repos[key]?.pulls?.find((p) => p.number === n)
  },
  openPullFor(key: string, head: string): PullRequest | undefined {
    return repos[key]?.pulls?.find((p) => p.head === head && p.state === 'open')
  },
  createPull(key: string, d: { title: string; body: string; head: string; base: string; author: string }): PullRequest | string {
    const r = repos[key]
    if (!r) return 'Repositório não encontrado.'
    if (!d.title.trim()) return 'O título é obrigatório.'
    if (d.head === d.base) return 'Escolha branches diferentes.'
    const head = this.branchCommits(key, d.head)
    const base = this.branchCommits(key, d.base)
    if (!head || !base) return 'Branch não encontrado.'
    if (this.openPullFor(key, d.head)) return `Já existe um pull request aberto para ${d.head}.`
    if (!head.some((c) => !base.some((b) => b.hash === c.hash))) return `Não há nada para comparar: ${d.base} já contém todos os commits de ${d.head}.`
    const pulls = r.pulls ?? (r.pulls = [])
    const pr: PullRequest = {
      number: (r.pulls.length ? Math.max(...r.pulls.map((p) => p.number)) : 0) + 1,
      title: d.title.trim(),
      body: d.body,
      head: d.head,
      base: d.base,
      author: d.author,
      state: 'open',
      created: Date.now(),
      reviews: [],
      comments: [],
      requested: [],
    }
    pulls.push(pr)
    emit()
    onPullHook?.(key, pr, 'opened')
    return pr
  },
  review(key: string, n: number, review: Omit<Review, 'date' | 'commit'>) {
    const pr = this.pull(key, n)
    if (!pr) return
    pr.reviews.push({ ...review, date: Date.now(), commit: this.branchHead(key, pr.head)?.hash ?? '' })
    pr.requested = pr.requested.filter((x) => x !== review.by)
    emit()
  },
  comment(key: string, n: number, by: string, body: string) {
    const pr = this.pull(key, n)
    if (!pr || !body.trim()) return
    pr.comments.push({ by, body: body.trim(), date: Date.now() })
    emit()
    onPullHook?.(key, pr, 'commented')
  },
  requestReview(key: string, n: number, login: string) {
    const pr = this.pull(key, n)
    if (!pr || pr.requested.includes(login)) return
    pr.requested.push(login)
    emit()
  },
  closePull(key: string, n: number) {
    const pr = this.pull(key, n)
    if (pr && pr.state === 'open') ((pr.state = 'closed'), emit())
  },
  /** Situação do PR: conflitos, aprovações e o que impede o merge. */
  pullStatus(key: string, n: number) {
    const pr = this.pull(key, n)!
    const head = this.branchCommits(key, pr.head) ?? []
    const base = this.branchCommits(key, pr.base) ?? []
    const headTip = head[head.length - 1]
    const baseTip = base[base.length - 1]
    const upToDate = !!baseTip && head.some((c) => c.hash === baseTip.hash)
    let conflicts: string[] = []
    if (!upToDate && headTip && baseTip) {
      const mb = mergeBase(head, base)
      conflicts = mergeTrees(mb?.tree ?? {}, headTip.tree, baseTip.tree, { ours: pr.head, theirs: pr.base }).conflicts
    }
    // a revisão mais recente de cada pessoa é a que vale
    const latest = new Map<string, Review>()
    for (const rv of pr.reviews) if (rv.state !== 'COMMENTED') latest.set(rv.by, rv)
    const approvals = [...latest.values()].filter((r) => r.state === 'APPROVED').length
    const changesRequested = [...latest.values()].filter((r) => r.state === 'CHANGES_REQUESTED').map((r) => r.by)
    const checks = checksProvider?.(key, headTip?.hash ?? '') ?? []
    const rule = this.protection(key, pr.base)
    const blockers: string[] = []
    if (conflicts.length) blockers.push('conflicts')
    if (rule) {
      if (changesRequested.length) blockers.push('changes')
      if (approvals < rule.approvals) blockers.push('approvals')
      if (rule.requireChecks && (!checks.length || checks.some((c) => c.state === 'pending' || c.state === 'failure'))) blockers.push('checks')
    }
    return { pr, head, base, headTip, baseTip, upToDate, conflicts, approvals, changesRequested, checks, rule, blockers }
  },
  /** Botão "Merge pull request": cria o commit de merge no branch base. */
  mergePull(key: string, n: number, login: string, bypass = false): string | null {
    const st = this.pullStatus(key, n)
    const { pr, head, base, headTip, baseTip } = st
    if (pr.state !== 'open') return 'Este pull request não está aberto.'
    if (!this.isCollaborator(login, key)) return 'Você não tem permissão de escrita neste repositório.'
    if (st.conflicts.length || (!bypass && st.blockers.length)) return 'O merge está bloqueado.'
    const mb = mergeBase(head, base)
    const tree = st.upToDate ? headTip!.tree : mergeTrees(mb?.tree ?? {}, headTip!.tree, baseTip!.tree, { ours: pr.head, theirs: pr.base }).tree
    const u = users[login]
    const mc: Commit = {
      ...makeCommit(baseTip ?? null, tree, `Merge pull request #${pr.number} from ${pr.author}/${pr.head}

${pr.title}`, u?.name ?? login, u?.email ?? `${login}@users.noreply.github.sim`),
      parent2: headTip!.hash,
    }
    const baseSet = new Set(base.map((c) => c.hash))
    pr.merged = { commits: head.filter((c) => !baseSet.has(c.hash)), from: mb?.tree ?? {}, to: headTip!.tree }
    pr.state = 'merged'
    pr.mergedAt = Date.now()
    pr.mergedBy = login
    pr.mergeCommit = mc.hash
    this.setCommits(key, [...unionHistory(base, head), mc], login, pr.base)
    onPullHook?.(key, pr, 'merged')
    return null
  },

  // ---------- administração / secrets ----------
  isAdmin(login: string, key: string) {
    return !!repos[key]?.admins.includes(login)
  },
  makeAdmin(login: string, key: string) {
    const r = repos[key]
    if (r && !r.admins.includes(login)) r.admins.push(login)
    if (r && !r.collaborators.includes(login)) r.collaborators.push(login)
    emit()
  },
  setSecret(key: string, name: string, value: string) {
    repos[key].secrets[name] = { value, updated: Date.now() }
    emit()
  },
  deleteSecret(key: string, name: string) {
    delete repos[key].secrets[name]
    emit()
  },

  // ---------- environments (ambientes de deploy) ----------
  environments(key: string): Record<string, Environment> {
    return repos[key]?.environments ?? {}
  },
  environment(key: string, name: string): Environment | undefined {
    return repos[key]?.environments?.[name]
  },
  createEnvironment(key: string, name: string): string | null {
    const r = repos[key]
    if (!r) return 'Repositório não encontrado.'
    const n = name.trim()
    if (!/^[\w.-]+$/.test(n)) return 'Use apenas letras, números, ponto, hífen e _.'
    if (r.environments?.[n]) return 'Já existe um environment com esse nome.'
    r.environments = { ...(r.environments ?? {}), [n]: { secrets: {}, reviewers: [], created: Date.now() } }
    emit()
    return null
  },
  deleteEnvironment(key: string, name: string) {
    const r = repos[key]
    if (!r?.environments?.[name]) return
    const rest = { ...r.environments }
    delete rest[name]
    r.environments = rest
    emit()
  },
  setEnvSecret(key: string, env: string, name: string, value: string | null) {
    const e = repos[key]?.environments?.[env]
    if (!e) return
    if (value === null) delete e.secrets[name]
    else e.secrets[name] = { value, updated: Date.now() }
    emit()
  },
  setEnvReviewers(key: string, env: string, reviewers: string[]) {
    const e = repos[key]?.environments?.[env]
    if (!e) return
    e.reviewers = [...new Set(reviewers)]
    emit()
  },

  /** Usado pelo mundo aberto para criar repositórios e pessoas novas. */
  addRepo(r: RemoteRepo) {
    repos[`${r.owner}/${r.name}`] = r
    emit()
  },
  addUser(u: User) {
    users[u.login] = u
    emit()
  },
  /** Convida alguém para um repositório (o e-mail fica por conta de quem chamou). */
  invite(repo: string, invitee: string, inviter: string) {
    const inv: Invitation = { id: rand(8, '0123456789'), repo, invitee, inviter, status: 'pending', date: Date.now() }
    invitations.push(inv)
    emit()
    return inv
  },

  // ---------- contas ----------
  user(login: string): User | undefined {
    return users[login]
  },
  userByEmail(email: string): User | undefined {
    return Object.values(users).find((u) => u.email.toLowerCase() === email.toLowerCase())
  },
  current(): User | null {
    return session ? users[session] : null
  },
  /** A conta criada pelo aluno (mesmo deslogado). */
  student(): User | undefined {
    return Object.values(users).find((u) => !u.bot)
  },
  validateSignup(login: string, email: string, password: string): Record<string, string> {
    const e: Record<string, string> = {}
    if (!/^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/i.test(login)) e.login = 'Use apenas letras, números e hífens (sem hífen no início ou fim).'
    else if (users[login.toLowerCase()] || RESERVED.includes(login.toLowerCase())) e.login = `O nome de usuário ${login} não está disponível.`
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) e.email = 'E-mail inválido.'
    else if (this.userByEmail(email)) e.email = 'Este e-mail já está em uso.'
    if (password.length < 8) e.password = 'A senha precisa ter pelo menos 8 caracteres.'
    else if (!/\d/.test(password) || !/[a-z]/i.test(password)) e.password = 'Inclua pelo menos um número e uma letra.'
    return e
  },
  signup(login: string, email: string, password: string, avatar: number) {
    const key = login.toLowerCase()
    users[key] = { login: key, name: '', email, password, verified: false, avatar, tokens: [] }
    session = key
    const code = rand(24)
    pendingVerify[code] = key
    onSignup?.(users[key], `https://github.sim/verify?token=${code}`)
    emit()
  },
  verify(token: string): boolean {
    const login = pendingVerify[token]
    if (!login) return false
    delete pendingVerify[token]
    users[login].verified = true
    emit()
    // a líder técnica convida o aluno pouco depois
    setTimeout(() => {
      const inv: Invitation = { id: rand(8, '0123456789'), repo: 'devlab/todo-api', invitee: login, inviter: 'senku-ishigami', status: 'pending', date: Date.now() }
      invitations.push(inv)
      onInvite?.(users[login], inv)
      emit()
    }, 2500)
    return true
  },
  login(id: string, password: string): string | null {
    const u = users[id.toLowerCase()] ?? this.userByEmail(id)
    if (!u || u.bot || u.password !== password) return 'Usuário ou senha incorretos.'
    session = u.login
    emit()
    return null
  },
  logout() {
    session = null
    emit()
  },
  setName(name: string) {
    const u = this.current()
    if (u) (u.name = name), emit()
  },
  setAvatar(seed: number) {
    const u = this.current()
    if (u) (u.avatar = seed), emit()
  },

  /** Atalho de missões: garante uma conta de aluno verificada e colaboradora, com token. */
  bootstrapStudent(): { user: User; token: string } {
    let u = this.student()
    if (!u) {
      users['aluno-devlab'] = { login: 'aluno-devlab', name: 'Aluno DevLab', email: 'aluno@devlab.sim', password: 'senha1234', verified: true, avatar: 9, tokens: [] }
      u = users['aluno-devlab']
    }
    u.verified = true
    session = u.login
    if (!repos['devlab/todo-api'].collaborators.includes(u.login)) repos['devlab/todo-api'].collaborators.push(u.login)
    let t = u.tokens.find((x) => x.scopes.includes('repo'))
    if (!t) {
      t = { id: rand(6, '0123456789'), note: 'terminal (atalho)', value: 'ghp_' + rand(36), scopes: ['repo'], created: Date.now(), expires: '30' }
      u.tokens.push(t)
    }
    emit()
    return { user: u, token: t.value }
  },

  // ---------- convites ----------
  invitationsFor(login: string) {
    return invitations.filter((i) => i.invitee === login)
  },
  respondInvite(id: string, accept: boolean) {
    const inv = invitations.find((i) => i.id === id)
    if (!inv || inv.status !== 'pending') return
    inv.status = accept ? 'accepted' : 'declined'
    if (accept) repos[inv.repo].collaborators.push(inv.invitee)
    emit()
  },
  isCollaborator(login: string, key: string) {
    return !!repos[key]?.collaborators.includes(login)
  },

  // ---------- tokens ----------
  createToken(note: string, scopes: string[], expires: string): Token {
    const u = this.current()!
    const t: Token = { id: rand(6, '0123456789'), note, value: 'ghp_' + rand(36), scopes, created: Date.now(), expires }
    u.tokens.push(t)
    emit()
    return t
  },
  deleteToken(id: string) {
    const u = this.current()
    if (u) (u.tokens = u.tokens.filter((t) => t.id !== id)), emit()
  },
  /** GITHUB_TOKEN: token temporário criado para cada job do Actions. */
  createRunToken(actor: string, scopes: string[]): string {
    const value = 'ghs_' + rand(36)
    runTokens[value] = { actor, scopes }
    return value
  },
  /** Autenticação HTTPS do git (usuário + token). */
  authenticate(login: string, secret: string): { user: User; scopes: string[] } | { error: 'password' | 'invalid' } {
    const rt = runTokens[secret]
    if (rt && users[rt.actor]) return { user: users[rt.actor], scopes: rt.scopes }
    const u = users[login.toLowerCase()]
    if (!u || u.bot) return { error: 'invalid' }
    if (secret === u.password) return { error: 'password' }
    const t = u.tokens.find((x) => x.value === secret)
    return t ? { user: u, scopes: t.scopes } : { error: 'invalid' }
  },

  /** Força a atualização das telas. */
  touch() {
    emit()
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

const pendingVerify: Record<string, string> = {}
const runTokens: Record<string, { actor: string; scopes: string[] }> = {}
let onPushHook: ((key: string, before: Commit | undefined, after: Commit, pusher: string, branch: string) => void) | undefined
let onPullHook: ((key: string, pr: PullRequest, action: 'opened' | 'synchronize' | 'commented' | 'merged') => void) | undefined
export type CheckState = { name: string; state: 'success' | 'failure' | 'pending' | 'skipped'; runId: number }
let checksProvider: ((key: string, sha: string) => CheckState[]) | undefined
/** Eventos de pull request (Actions e o revisor automático escutam). */
export function onGithubPull(fn: typeof onPullHook) {
  const prev = onPullHook
  onPullHook = (...a) => (prev?.(...a), fn?.(...a))
}
export const firePull = (key: string, pr: PullRequest, action: 'synchronize') => onPullHook?.(key, pr, action)
/** O Actions informa o estado dos checks de um commit. */
export function provideChecks(fn: typeof checksProvider) {
  checksProvider = fn
}
/** Usado pelo GitHub Actions para disparar workflows a cada push. */
export function onGithubPush(fn: typeof onPushHook) {
  onPushHook = fn
}
let onSignup: ((u: User, verifyUrl: string) => void) | undefined
let onInvite: ((u: User, inv: Invitation) => void) | undefined
/** Ganchos usados pelo Mail para "enviar" e-mails. */
export function onGithubMail(signup: typeof onSignup, invite: typeof onInvite) {
  onSignup = signup
  onInvite = invite
}

// ---------- progresso salvo ----------
export function githubDump() {
  return { repos, users, invitations, session, pendingVerify, runTokens }
}
export function githubLoad(d: ReturnType<typeof githubDump>) {
  for (const k of Object.keys(repos)) delete repos[k]
  Object.assign(repos, d.repos)
  for (const k of Object.keys(users)) delete users[k]
  Object.assign(users, d.users)
  invitations.splice(0, invitations.length, ...d.invitations)
  session = d.session
  Object.assign(pendingVerify, d.pendingVerify)
  Object.assign(runTokens, d.runTokens)
}
