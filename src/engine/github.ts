// "GitHub" simulado: repositórios remotos que o git do terminal e o Navegador enxergam.

export type Tree = Record<string, string>
export type Commit = {
  hash: string
  parent: string | null
  message: string
  author: string
  email: string
  date: number
  tree: Tree
}
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

Depois acesse http://localhost:3000

## Endpoints

- GET /todos — lista as tarefas
- POST /todos — cria uma tarefa
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
const { listTodos, addTodo } = require('./todos')

const app = express()
app.use(express.json())
app.use(express.static('public'))

app.get('/health', (req, res) => res.json({ status: 'ok' }))
app.get('/todos', (req, res) => res.json(listTodos()))
app.post('/todos', (req, res) => res.status(201).json(addTodo(req.body.title)))

const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(\`Servidor rodando em http://localhost:\${PORT}\`))
`

const TODOS = `const todos = [
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

module.exports = { listTodos, addTodo }
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

function seedTodoApi(): RemoteRepo {
  const day = 86_400_000
  const t0 = Date.now() - 12 * day
  const c1 = makeCommit(
    null,
    { 'README.md': README, 'package.json': PACKAGE, 'package-lock.json': LOCK, '.gitignore': GITIGNORE, 'src/server.js': SERVER, 'src/todos.js': TODOS_V1 },
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
  setCommits(key: string, commits: Commit[], pusher = '') {
    const before = this.head(key)
    repos[key] = { ...repos[key], commits: [...commits] }
    emit()
    onPushHook?.(key, before, this.head(key)!, pusher)
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

  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

const pendingVerify: Record<string, string> = {}
const runTokens: Record<string, { actor: string; scopes: string[] }> = {}
let onPushHook: ((key: string, before: Commit | undefined, after: Commit, pusher: string) => void) | undefined
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
