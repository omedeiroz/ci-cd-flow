// Git simulado: clone, status, add, commit, push, pull, fetch, merge, branch, switch, log, diff, config, remote.
import type { VFS } from './fs'
import { C, fail, ok, registerCommand, type Result, type Shell } from './shell'
import { github, makeCommit, type Commit, type Tree } from './github'
import { mergeBase, mergeTrees, unionHistory } from './merge'

export type LocalRepo = {
  root: string
  remoteKey: string
  branch: string
  commits: Commit[] // histórico do branch atual (do mais antigo para o mais novo)
  staged: Record<string, string | null> // null = remoção preparada
  branches?: Record<string, Commit[]> // os outros branches locais
  upstreams?: Record<string, string> // branch local -> branch remoto rastreado
  remotes?: Record<string, Commit[]> // origin/* (atualizado em clone, fetch, pull e push)
  prev?: string // branch anterior (git switch -)
  merging?: { theirs: Commit[]; label: string; message: string; conflicts: string[] }
}

const reposByFs = new WeakMap<VFS, Map<string, LocalRepo>>()
/** "Chaveiro" do sistema: guarda as credenciais do git depois do primeiro push bem-sucedido. */
const keychain = new WeakMap<VFS, { login: string; secret: string }>()
export const saveCredentials = (fs: VFS, login: string, secret: string) => keychain.set(fs, { login, secret })

/** Registra um repositório já presente em disco (usado pelo checkout do runner e pelo atalho de missões). */
export function registerRepo(fs: VFS, root: string, remoteKey: string, commits: Commit[], branch = 'main') {
  const repo: LocalRepo = { root, remoteKey, branch, commits: [...commits], staged: {}, upstreams: { [branch]: branch }, remotes: { [branch]: [...commits] } }
  reposOf(fs).set(root, repo)
  writeGitDir(fs, repo)
  return repo
}
const reposOf = (fs: VFS) => {
  let m = reposByFs.get(fs)
  if (!m) reposByFs.set(fs, (m = new Map()))
  return m
}

/** Encontra o repositório que contém `cwd` (subindo até achar um .git). */
export function findRepo(fs: VFS, cwd: string): LocalRepo | null {
  const repos = reposOf(fs)
  let p = cwd
  while (true) {
    const r = repos.get(p)
    if (r && fs.isDir(`${p === '/' ? '' : p}/.git`)) return r
    if (p === '/') return null
    p = p.split('/').slice(0, -1).join('/') || '/'
  }
}

export function allRepos(fs: VFS): LocalRepo[] {
  return [...reposOf(fs).values()].filter((r) => fs.isDir(`${r.root}/.git`))
}

// ---------- config (~/.gitconfig) ----------

export function readConfig(fs: VFS): Record<string, string> {
  const out: Record<string, string> = {}
  let section = ''
  try {
    for (const raw of fs.read(`${fs.home}/.gitconfig`).split('\n')) {
      const line = raw.trim()
      const s = line.match(/^\[(\w+)\]$/)
      if (s) section = s[1]
      const kv = line.match(/^(\w+)\s*=\s*(.*)$/)
      if (kv && section) out[`${section}.${kv[1]}`] = kv[2]
    }
  } catch {
    /* sem arquivo */
  }
  return out
}

function writeConfig(fs: VFS, cfg: Record<string, string>) {
  const sections: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(cfg)) {
    const [s, key] = k.split('.')
    ;(sections[s] ??= []).push(`\t${key} = ${v}`)
  }
  fs.write(`${fs.home}/.gitconfig`, Object.entries(sections).map(([s, l]) => `[${s}]\n${l.join('\n')}`).join('\n') + '\n')
}

// ---------- árvore de trabalho ----------

function ignoreRules(fs: VFS, root: string) {
  let rules: string[] = []
  try {
    rules = fs.read(`${root}/.gitignore`).split('\n').map((l) => l.trim().replace(/\/$/, '')).filter((l) => l && !l.startsWith('#'))
  } catch {
    /* sem .gitignore */
  }
  return (rel: string) => rel === '.git' || rules.some((r) => rel === r || rel.startsWith(r + '/'))
}

const workTree = (fs: VFS, repo: LocalRepo) => fs.walkFiles(repo.root, ignoreRules(fs, repo.root))
const headTree = (repo: LocalRepo): Tree => repo.commits[repo.commits.length - 1]?.tree ?? {}
function indexTree(repo: LocalRepo): Tree {
  const t = { ...headTree(repo) }
  for (const [p, c] of Object.entries(repo.staged)) {
    if (c === null) delete t[p]
    else t[p] = c
  }
  return t
}

type Change = { path: string; kind: 'novo' | 'modificado' | 'removido' }
function diffTrees(a: Tree, b: Tree): Change[] {
  const out: Change[] = []
  for (const p of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (!(p in a)) out.push({ path: p, kind: 'novo' })
    else if (!(p in b)) out.push({ path: p, kind: 'removido' })
    else if (a[p] !== b[p]) out.push({ path: p, kind: 'modificado' })
  }
  return out.sort((x, y) => x.path.localeCompare(y.path))
}

export function repoStatus(fs: VFS, repo: LocalRepo) {
  const head = headTree(repo)
  const index = indexTree(repo)
  const work = workTree(fs, repo)
  const staged = diffTrees(head, index)
  const all = diffTrees(index, work)
  const unmerged = repo.merging?.conflicts ?? []
  return {
    staged: staged.filter((c) => !unmerged.includes(c.path)),
    unstaged: all.filter((c) => c.kind !== 'novo' && !unmerged.includes(c.path)),
    untracked: all.filter((c) => c.kind === 'novo' && !unmerged.includes(c.path)).map((c) => c.path),
    unmerged,
  }
}

// ---------- branches ----------

const tip = (l: Commit[] | undefined) => l?.[l.length - 1]
const has = (l: Commit[] | undefined, h: string | undefined) => !!h && !!l?.some((c) => c.hash === h)
/** Branch remoto rastreado pelo branch atual (repositórios antigos: main -> main). */
export const upstreamOf = (repo: LocalRepo, b = repo.branch): string | undefined => (repo.upstreams ? repo.upstreams[b] : b === 'main' ? 'main' : undefined)
export const localBranches = (repo: LocalRepo) => [repo.branch, ...Object.keys(repo.branches ?? {})].sort()
const branchList = (repo: LocalRepo, b: string) => (b === repo.branch ? repo.commits : repo.branches?.[b])
/** origin/<b> como o repositório local conhece (sem fetch, não muda). */
const trackingList = (repo: LocalRepo, b: string) => (repo.remotes ? repo.remotes[b] : github.branchCommits(repo.remoteKey, b))
const snapshot = (repo: LocalRepo, b: string) => {
  const l = github.branchCommits(repo.remoteKey, b)
  repo.remotes ??= {}
  if (l) repo.remotes[b] = [...l]
  else delete repo.remotes[b]
}

/** Quantos commits locais ainda não foram enviados (comparando com o GitHub). */
export function aheadBy(repo: LocalRepo) {
  const u = upstreamOf(repo)
  if (!u) return 0
  const remote = github.branchCommits(repo.remoteKey, u)
  if (!remote) return repo.commits.length
  const set = new Set(remote.map((c) => c.hash))
  return repo.commits.filter((c) => !set.has(c.hash)).length
}
function behindBy(repo: LocalRepo) {
  const u = upstreamOf(repo)
  const remote = u ? trackingList(repo, u) : undefined
  if (!remote) return 0
  const set = new Set(repo.commits.map((c) => c.hash))
  return remote.filter((c) => !set.has(c.hash)).length
}

/** Troca os arquivos da árvore de trabalho de `from` para `to` (só os caminhos que mudam). */
function moveWorkTree(fs: VFS, root: string, from: Tree, to: Tree) {
  for (const p of Object.keys(from)) if (!(p in to)) fs.remove(`${root}/${p}`)
  const changed: Tree = {}
  for (const [p, c] of Object.entries(to)) if (from[p] !== c) changed[p] = c
  fs.writeTree(root, changed)
}

// ---------- diff de linhas (LCS) ----------

export function lineOps(a: string, b: string): { t: ' ' | '+' | '-'; l: string }[] {
  const A = a === '' ? [] : a.replace(/\n$/, '').split('\n')
  const B = b === '' ? [] : b.replace(/\n$/, '').split('\n')
  const dp = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0))
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: { t: ' ' | '+' | '-'; l: string }[] = []
  let i = 0
  let j = 0
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) (out.push({ t: ' ', l: A[i] }), i++, j++)
    else if (j < B.length && (i >= A.length || dp[i][j + 1] >= dp[i + 1][j])) out.push({ t: '+', l: B[j++] })
    else out.push({ t: '-', l: A[i++] })
  }
  return out
}

function lineDiff(a: string, b: string): string[] {
  const ops = lineOps(a, b)
  const keep = new Set<number>()
  ops.forEach((o, k) => {
    if (o.t !== ' ') for (let d = -2; d <= 2; d++) keep.add(k + d)
  })
  return ops
    .map((o) => (o.t === ' ' ? `${C.dim} ${o.l}${C.reset}` : o.t === '+' ? `${C.green}+${o.l}${C.reset}` : `${C.red}-${o.l}${C.reset}`))
    .filter((_, k) => keep.has(k))
}

/** " README.md | 3 ++-" para cada arquivo que mudou entre duas árvores. */
function diffStat(a: Tree, b: Tree): string {
  const ch = diffTrees(a, b)
  if (!ch.length) return ''
  const w = Math.max(...ch.map((c) => c.path.length))
  let ins = 0
  let del = 0
  const lines = ch.map((c) => {
    const ops = lineOps(a[c.path] ?? '', b[c.path] ?? '')
    const plus = c.kind === 'removido' ? 0 : ops.filter((o) => o.t === '+').length
    const minus = c.kind === 'novo' ? 0 : ops.filter((o) => o.t === '-').length
    ins += plus
    del += minus
    return ` ${c.path.padEnd(w)} | ${String(plus + minus).padStart(2)} ${C.green}${'+'.repeat(Math.min(plus, 30))}${C.red}${'-'.repeat(Math.min(minus, 30))}${C.reset}`
  })
  const created = ch.filter((c) => c.kind === 'novo').map((c) => ` create mode 100644 ${c.path}`)
  const n = ch.length
  return [...lines, ` ${n} arquivo${n > 1 ? 's' : ''} alterado${n > 1 ? 's' : ''}, ${ins} inserç${ins === 1 ? 'ão' : 'ões'}(+), ${del} remoç${del === 1 ? 'ão' : 'ões'}(-)`, ...created].join('\n')
}

// ---------- comandos ----------

const short = (h: string) => h.slice(0, 7)
const fmtDate = (ms: number) => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })
const NOT_REPO = fail(`${C.red}fatal: não é um repositório git (nem nenhum dos diretórios pais): .git${C.reset}`, 128)
const WHO = fail(
  `${C.red}*** Por favor, diga quem você é.${C.reset}\n\nExecute\n\n  git config --global user.email "voce@exemplo.com"\n  git config --global user.name "Seu Nome"\n\npara definir a identidade padrão da sua conta.`,
  128,
)

function writeGitDir(fs: VFS, repo: LocalRepo) {
  const g = `${repo.root}/.git`
  if (fs.exists(`${g}/refs`)) fs.remove(`${g}/refs`, true)
  if (fs.exists(`${g}/MERGE_HEAD`)) fs.remove(`${g}/MERGE_HEAD`)
  const files: Record<string, string> = { HEAD: `ref: refs/heads/${repo.branch}\n` }
  const cfg = [`[core]\n\trepositoryformatversion = 0\n\tbare = false`, `[remote "origin"]\n\turl = ${github.cloneUrl(repo.remoteKey)}\n\tfetch = +refs/heads/*:refs/remotes/origin/*`]
  for (const b of localBranches(repo)) {
    files[`refs/heads/${b}`] = (tip(branchList(repo, b))?.hash ?? '') + '\n'
    const u = upstreamOf(repo, b)
    if (u) cfg.push(`[branch "${b}"]\n\tremote = origin\n\tmerge = refs/heads/${u}`)
  }
  for (const [b, l] of Object.entries(repo.remotes ?? {})) files[`refs/remotes/origin/${b}`] = (tip(l)?.hash ?? '') + '\n'
  files.config = cfg.join('\n') + '\n'
  if (repo.merging) {
    files.MERGE_HEAD = (tip(repo.merging.theirs)?.hash ?? '') + '\n'
    files.MERGE_MSG = repo.merging.message + '\n'
  }
  fs.writeTree(g, files)
}

/** Credenciais (chaveiro ou prompt) + permissão de escrita; depois chama `then`. */
function withPushAuth(sh: Shell, repo: LocalRepo, then: (login: string) => Result): Result {
  const url = github.cloneUrl(repo.remoteKey)
  const denied = (login: string, why: string) =>
    fail(`${C.red}remote: Permission to ${repo.remoteKey}.git denied to ${login}.\nfatal: unable to access '${url}/': The requested URL returned error: 403${C.reset}\n${C.dim}${why}${C.reset}`, 128)
  const authFailed = (msg: string) => fail(`${C.red}${msg}\nfatal: Authentication failed for '${url}/'${C.reset}`, 128)
  const attempt = (login: string, secret: string, fromKeychain: boolean): Result => {
    const auth = github.authenticate(login, secret)
    if ('error' in auth) {
      keychain.delete(sh.fs)
      if (fromKeychain) return askCredentials()
      return auth.error === 'password'
        ? authFailed(
            `remote: Support for password authentication was removed on August 13, 2021.\nremote: Please see https://docs.github.sim/authentication for information on currently recommended modes of authentication.\n${C.reset}${C.dim}Dica: no lugar da senha, use um personal access token (GitHub > Configurações > Tokens).${C.red}`,
          )
        : authFailed('remote: Invalid username or token. Password authentication is not supported for Git operations.')
    }
    if (!auth.scopes.includes('repo')) return denied(auth.user.login, 'Dica: o token precisa do escopo "repo" para enviar commits.')
    if (!github.isCollaborator(auth.user.login, repo.remoteKey))
      return denied(auth.user.login, `Dica: você ainda não é colaborador(a) de ${repo.remoteKey}. Aceitou o convite?`)
    keychain.set(sh.fs, { login: auth.user.login, secret })
    return then(auth.user.login)
  }
  const askCredentials = (): Result => ({
    out: '',
    code: 0,
    prompt: {
      text: "Username for 'https://github.sim': ",
      answer: (login) => ({
        out: '',
        code: 0,
        prompt: { text: `Password for 'https://${login.trim()}@github.sim': `, hidden: true, answer: (secret) => attempt(login.trim(), secret.trim(), false) },
      }),
    },
  })
  const saved = keychain.get(sh.fs)
  return saved ? attempt(saved.login, saved.secret, true) : askCredentials()
}

/** Paths sujos (preparados ou modificados) do repositório. */
const dirtyPaths = (fs: VFS, repo: LocalRepo) => {
  const st = repoStatus(fs, repo)
  return new Set([...st.staged, ...st.unstaged].map((c) => c.path))
}

/** Faz merge de `theirs` no branch atual (fast-forward, merge automático ou conflito). */
function doMerge(sh: Shell, repo: LocalRepo, theirs: Commit[], label: string, message: string, ffOnly = false): Result {
  const ours = tip(repo.commits)
  const their = tip(theirs)
  if (!their || has(repo.commits, their.hash)) return ok('Já está atualizado.')
  const changed = diffTrees(ours?.tree ?? {}, their.tree).map((c) => c.path)
  const dirty = dirtyPaths(sh.fs, repo)
  const clash = changed.filter((p) => dirty.has(p))
  if (clash.length)
    return fail(
      `${C.red}error: Suas mudanças locais nos seguintes arquivos seriam sobrescritas pelo merge:${C.reset}\n${clash.map((p) => `\t${p}`).join('\n')}\nFaça commit das suas mudanças (ou descarte-as) antes do merge.\nAbortando`,
      1,
    )
  const from = ours?.tree ?? {}
  if (!ours || has(theirs, ours.hash)) {
    moveWorkTree(sh.fs, repo.root, from, their.tree)
    repo.commits = [...theirs]
    writeGitDir(sh.fs, repo)
    return ok(`Atualizando ${short(ours?.hash ?? '0000000')}..${short(their.hash)}\nFast-forward\n${diffStat(from, their.tree)}`)
  }
  if (ffOnly) return fail(`${C.red}fatal: Não é possível fazer fast-forward, abortando.${C.reset}`, 128)
  const cfg = readConfig(sh.fs)
  if (!cfg['user.name'] || !cfg['user.email']) return WHO
  const base = mergeBase(repo.commits, theirs)
  const m = mergeTrees(base?.tree ?? {}, ours.tree, their.tree, { ours: 'HEAD', theirs: label })
  moveWorkTree(sh.fs, repo.root, from, m.tree)
  const both = diffTrees(base?.tree ?? {}, ours.tree)
    .map((c) => c.path)
    .filter((p) => (base?.tree ?? {})[p] !== their.tree[p])
  const lines = both.map((p) => `Mesclando automaticamente ${p}`)
  if (m.conflicts.length) {
    repo.staged = {}
    for (const c of diffTrees(ours.tree, m.tree)) if (!m.conflicts.includes(c.path)) repo.staged[c.path] = m.tree[c.path] ?? null
    repo.merging = { theirs: [...theirs], label, message, conflicts: [...m.conflicts] }
    writeGitDir(sh.fs, repo)
    lines.push(...m.conflicts.map((p) => `${C.red}CONFLITO (conteúdo): Conflito de merge em ${p}${C.reset}`))
    lines.push('Merge automático falhou; corrija os conflitos e então faça commit do resultado.')
    return { out: lines.join('\n'), code: 1 }
  }
  const mc: Commit = { ...makeCommit(ours, m.tree, message, cfg['user.name'], cfg['user.email']), parent2: their.hash }
  repo.commits = [...unionHistory(repo.commits, theirs), mc]
  repo.staged = {}
  writeGitDir(sh.fs, repo)
  lines.push("Merge made by the 'ort' strategy.", diffStat(from, m.tree))
  return ok(lines.join('\n'))
}

/** git switch / git checkout <branch>. */
function switchTo(sh: Shell, repo: LocalRepo, name: string, create: boolean): Result {
  if (repo.merging) return fail(`${C.red}error: você precisa resolver seu índice atual primeiro${C.reset}\n${repo.merging.conflicts.map((p) => `${p}: needs merge`).join('\n')}`, 1)
  if (name === '-') {
    if (!repo.prev) return fail(`${C.red}fatal: nenhum branch anterior${C.reset}`, 128)
    name = repo.prev
  }
  const exists = name === repo.branch || !!repo.branches?.[name]
  if (create && exists) return fail(`${C.red}fatal: já existe um branch chamado '${name}'${C.reset}`, 128)
  if (!create && name === repo.branch) return ok(`Já está em '${name}'`)
  if (create && !/^[\w./-]+$/.test(name)) return fail(`${C.red}fatal: '${name}' não é um nome de branch válido${C.reset}`, 128)
  let target: Commit[]
  let tracking = false
  if (create) target = [...repo.commits]
  else if (exists) target = repo.branches![name]
  else {
    const remote = trackingList(repo, name)
    if (!remote) {
      return fail(
        `${C.red}fatal: referência inválida: ${name}${C.reset}\n${C.dim}Dica: para criar um branch novo use "git switch -c ${name}". Se ele existe no GitHub, rode "git fetch" antes.${C.reset}`,
        128,
      )
    }
    target = [...remote]
    tracking = true
  }
  const from = tip(repo.commits)?.tree ?? {}
  const to = tip(target)?.tree ?? {}
  const differ = new Set([...Object.keys(from), ...Object.keys(to)].filter((p) => from[p] !== to[p]))
  const dirty = [...dirtyPaths(sh.fs, repo)].filter((p) => differ.has(p))
  const untracked = repoStatus(sh.fs, repo).untracked.filter((p) => p in to && differ.has(p))
  if (dirty.length)
    return fail(
      `${C.red}error: Suas mudanças locais nos seguintes arquivos seriam sobrescritas pelo checkout:${C.reset}\n${dirty.map((p) => `\t${p}`).join('\n')}\nFaça commit das suas mudanças antes de trocar de branch.\nAbortando`,
      1,
    )
  if (untracked.length)
    return fail(`${C.red}error: Os seguintes arquivos não rastreados seriam sobrescritos pelo checkout:${C.reset}\n${untracked.map((p) => `\t${p}`).join('\n')}\nMova-os ou remova-os antes de trocar de branch.\nAbortando`, 1)
  const work = workTree(sh.fs, repo)
  for (const p of differ) {
    if (!(p in to)) sh.fs.remove(`${repo.root}/${p}`)
    else if (work[p] !== to[p]) sh.fs.write(`${repo.root}/${p}`, to[p])
  }
  repo.branches ??= {}
  repo.branches[repo.branch] = repo.commits
  delete repo.branches[name]
  repo.prev = repo.branch
  repo.branch = name
  repo.commits = target
  repo.upstreams ??= { main: 'main' }
  if (tracking) repo.upstreams[name] = name
  writeGitDir(sh.fs, repo)
  const lines: string[] = []
  if (tracking) lines.push(`branch '${name}' configurado para rastrear 'origin/${name}'.`)
  lines.push(create || tracking ? `Alternado para um novo branch '${name}'` : `Alternado para o branch '${name}'`)
  const u = upstreamOf(repo)
  if (u && !create) {
    const a = aheadBy(repo)
    const b = behindBy(repo)
    lines.push(
      a && b
        ? `Seu branch e 'origin/${u}' divergiram.`
        : a
          ? `Seu branch está à frente de 'origin/${u}' por ${a} commit${a > 1 ? 's' : ''}.`
          : b
            ? `Seu branch está atrás de 'origin/${u}' por ${b} commit${b > 1 ? 's' : ''}, e pode ser atualizado com fast-forward.\n  (use "git pull" para atualizar seu branch local)`
            : `Seu branch está atualizado com 'origin/${u}'.`,
    )
  }
  return ok(lines.join('\n'))
}

const sub: Record<string, (args: string[], sh: Shell) => Result> = {
  help: () =>
    ok(
      [
        `${C.bold}Comandos git disponíveis no simulador:${C.reset}`,
        '  clone <url> [pasta]        copia um repositório remoto',
        '  status                     mostra o que mudou',
        '  add <arquivo|.>            prepara mudanças para o commit',
        '  commit -m "mensagem"       registra as mudanças preparadas',
        '  push [-u origin <branch>]  envia commits para o GitHub',
        '  pull [origin <branch>]     baixa e mescla commits do GitHub',
        '  fetch [--prune]            atualiza origin/* sem mexer nos seus arquivos',
        '  merge <branch>             junta outro branch no atual (--abort desiste)',
        '  branch [-d nome]           lista, cria ou apaga branches',
        '  switch [-c] <branch>       troca de branch (-c cria um novo)',
        '  log [--oneline]            histórico de commits',
        '  diff [--staged]            mostra as mudanças linha a linha',
        '  restore [--staged] <arq>   desfaz mudanças de um arquivo',
        '  config                     configura nome e e-mail',
        '  remote -v                  mostra o repositório remoto',
      ].join('\n'),
    ),

  config: (args, sh) => {
    const a = args.filter((x) => x !== '--global')
    const cfg = readConfig(sh.fs)
    if (a[0] === '--list' || a[0] === '-l') return ok(Object.entries(cfg).map(([k, v]) => `${k}=${v}`).join('\n'))
    const [key, ...rest] = a
    if (!key) return fail('uso: git config [--global] <chave> <valor>')
    if (!/^\w+\.\w+$/.test(key)) return fail(`${C.red}error: chave inválida: ${key}${C.reset}`)
    if (!rest.length) return cfg[key] ? ok(cfg[key]) : fail('', 1)
    cfg[key] = rest.join(' ')
    writeConfig(sh.fs, cfg)
    return ok()
  },

  clone: (args, sh) => {
    const [url, dirArg] = args.filter((x) => !x.startsWith('-'))
    if (!url) return fail('fatal: você precisa especificar um repositório para clonar.\n\nuso: git clone <url> [<pasta>]', 128)
    const key = github.parseUrl(url)
    const remote = key ? github.get(key) : undefined
    if (!key || !remote) {
      return fail(
        `Clonando em '${dirArg ?? url.split('/').pop()?.replace(/\.git$/, '')}'...\n${C.red}remote: Repository not found.\nfatal: repositório '${url}' não encontrado${C.reset}\n${C.dim}Confira a URL no GitHub (botão "Code").${C.reset}`,
        128,
      )
    }
    const name = dirArg ?? remote.name
    const root = sh.fs.resolve(sh.cwd, name)
    if (sh.fs.exists(root) && sh.fs.list(root).length) return fail(`${C.red}fatal: o caminho de destino '${name}' já existe e não é um diretório vazio.${C.reset}`, 128)
    const head = tip(remote.commits)!
    sh.fs.mkdir(root, true)
    sh.fs.writeTree(root, head.tree)
    const remotes: Record<string, Commit[]> = {}
    for (const b of github.branchNames(key)) remotes[b] = [...github.branchCommits(key, b)!]
    const repo: LocalRepo = { root, remoteKey: key, branch: remote.branch, commits: [...remote.commits], staged: {}, upstreams: { [remote.branch]: remote.branch }, remotes }
    reposOf(sh.fs).set(root, repo)
    writeGitDir(sh.fs, repo)
    const n = Object.keys(head.tree).length
    return ok(
      [
        `Clonando em '${name}'...`,
        `remote: Enumerating objects: ${n * 3 + 4}, done.`,
        `remote: Counting objects: 100% (${n * 3 + 4}/${n * 3 + 4}), done.`,
        `remote: Compressing objects: 100% (${n * 2}/${n * 2}), done.`,
        `Recebendo objetos: 100% (${n * 3 + 4}/${n * 3 + 4}), 6.12 KiB | 3.06 MiB/s, concluído.`,
        `Resolvendo deltas: 100% (${remote.commits.length}/${remote.commits.length}), concluído.`,
      ].join('\n'),
    )
  },

  status: (_args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    const { staged, unstaged, untracked, unmerged } = repoStatus(sh.fs, repo)
    const lines = [`No branch ${repo.branch}`]
    const u = upstreamOf(repo)
    if (u) {
      const a = aheadBy(repo)
      const b = behindBy(repo)
      if (!github.branchCommits(repo.remoteKey, u) && !trackingList(repo, u)) lines.push(`Seu branch está baseado em 'origin/${u}', mas ele não existe mais.\n  (use "git branch --unset-upstream" para corrigir)`)
      else if (a && b) lines.push(`Seu branch e 'origin/${u}' divergiram,\ne têm ${a} e ${b} commits diferentes cada, respectivamente.\n  (use "git pull" para mesclar o branch remoto no seu)`)
      else if (a) lines.push(`Seu branch está à frente de 'origin/${u}' por ${a} commit${a > 1 ? 's' : ''}.\n  (use "git push" para publicar seus commits locais)`)
      else if (b) lines.push(`Seu branch está atrás de 'origin/${u}' por ${b} commit${b > 1 ? 's' : ''}, e pode ser atualizado com fast-forward.\n  (use "git pull" para atualizar seu branch local)`)
      else lines.push(`Seu branch está atualizado com 'origin/${u}'.`)
    }
    if (repo.merging) {
      if (unmerged.length) lines.push('Você tem caminhos não mesclados.', '  (corrija os conflitos e execute "git commit")', '  (use "git merge --abort" para abortar o merge)')
      else lines.push('Todos os conflitos foram corrigidos, mas você ainda está no meio de um merge.', '  (use "git commit" para concluir o merge)')
    }
    if (staged.length)
      lines.push('', 'Mudanças a serem commitadas:', '  (use "git restore --staged <arquivo>..." para despreparar)', ...staged.map((c) => `\t${C.green}${(c.kind + ':').padEnd(12)}${c.path}${C.reset}`))
    if (unmerged.length)
      lines.push('', 'Caminhos não mesclados:', '  (use "git add <arquivo>..." para marcar a resolução)', ...unmerged.map((p) => `\t${C.red}${'ambos modificados:'.padEnd(20)}${p}${C.reset}`))
    if (unstaged.length)
      lines.push('', 'Mudanças não preparadas para commit:', '  (use "git add <arquivo>..." para preparar)', '  (use "git restore <arquivo>..." para descartar mudanças)', ...unstaged.map((c) => `\t${C.red}${(c.kind + ':').padEnd(12)}${c.path}${C.reset}`))
    if (untracked.length) lines.push('', 'Arquivos não rastreados:', '  (use "git add <arquivo>..." para incluir no commit)', ...untracked.map((p) => `\t${C.red}${p}${C.reset}`))
    if (!staged.length && !unstaged.length && !untracked.length && !unmerged.length) lines.push('', repo.merging ? '' : 'nada para commitar, árvore de trabalho limpa')
    else if (!staged.length && !unmerged.length) lines.push('', 'nenhuma mudança adicionada ao commit (use "git add")')
    return ok(lines.join('\n').replace(/\n+$/, ''))
  },

  add: (args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    const paths = args.filter((a) => !a.startsWith('-'))
    const all = args.includes('-A') || args.includes('--all')
    if (!paths.length && !all) return fail('Nada especificado, nada adicionado.\nTalvez você quisesse dizer "git add ."?')
    const work = workTree(sh.fs, repo)
    const index = indexTree(repo)
    const prefixes = all ? [''] : paths.map((p) => {
      const abs = sh.fs.resolve(sh.cwd, p)
      return abs === repo.root ? '' : abs.slice(repo.root.length + 1)
    })
    let matched = false
    const markers: string[] = []
    for (const prefix of prefixes) {
      const match = (f: string) => !prefix || f === prefix || f.startsWith(prefix + '/')
      for (const f of new Set([...Object.keys(work), ...Object.keys(index), ...(repo.merging?.conflicts ?? [])])) {
        if (!match(f)) continue
        matched = true
        if (f in work) repo.staged[f] = work[f]
        else repo.staged[f] = null
        if (repo.merging?.conflicts.includes(f)) {
          repo.merging.conflicts = repo.merging.conflicts.filter((x) => x !== f)
          if (/^(<{7}|={7}|>{7})( |$)/m.test(work[f] ?? '')) markers.push(f)
        }
      }
    }
    if (!matched) return fail(`${C.red}fatal: o caminho '${paths[0]}' não corresponde a nenhum arquivo${C.reset}`, 128)
    if (repo.merging) writeGitDir(sh.fs, repo)
    return ok(markers.map((f) => `${C.yellow}Atenção (simulador): ${f} ainda tem marcadores de conflito (<<<<<<< ======= >>>>>>>). Apague-os antes do commit.${C.reset}`).join('\n'))
  },

  restore: (args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    const paths = args.filter((a) => !a.startsWith('-'))
    if (!paths.length) return fail(`${C.red}fatal: você precisa especificar o(s) caminho(s) a restaurar${C.reset}`, 128)
    const rels = paths.map((p) => {
      const abs = sh.fs.resolve(sh.cwd, p)
      return abs === repo.root ? '' : abs.slice(repo.root.length + 1)
    })
    const match = (k: string) => rels.some((rel) => !rel || k === rel || k.startsWith(rel + '/'))
    if (args.includes('--staged') || args.includes('-S')) {
      for (const k of Object.keys(repo.staged)) if (match(k)) delete repo.staged[k]
      return ok()
    }
    // descarta mudanças da árvore de trabalho (volta ao conteúdo do índice)
    const index = indexTree(repo)
    const work = workTree(sh.fs, repo)
    let hit = false
    for (const p of new Set([...Object.keys(index), ...Object.keys(work)])) {
      if (!match(p) || !(p in index)) continue
      hit = true
      if (work[p] !== index[p]) sh.fs.write(`${repo.root}/${p}`, index[p])
    }
    if (!hit) return fail(`${C.red}error: o caminho '${paths[0]}' não corresponde a nenhum arquivo conhecido pelo git${C.reset}`, 1)
    return ok()
  },

  commit: (args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    const mi = args.findIndex((a) => a === '-m' || a === '-am')
    if (args.includes('-am') || args.includes('-a')) {
      // -a só inclui arquivos já rastreados (modificados ou removidos), nunca arquivos novos
      const work = workTree(sh.fs, repo)
      for (const f of new Set([...Object.keys(indexTree(repo)), ...(repo.merging?.conflicts ?? [])])) repo.staged[f] = f in work ? work[f] : null
      if (repo.merging) repo.merging.conflicts = []
    }
    const message = mi >= 0 ? args[mi + 1] : repo.merging?.message
    if (!message) return fail(`${C.red}error: falta a mensagem. Use: git commit -m "sua mensagem"${C.reset}`)
    const cfg = readConfig(sh.fs)
    if (!cfg['user.name'] || !cfg['user.email']) return WHO
    if (repo.merging?.conflicts.length)
      return fail(
        `${C.red}error: Não é possível fazer commit porque você tem arquivos não mesclados.${C.reset}\nhint: Corrija-os na árvore de trabalho e então use 'git add <arquivo>'\nhint: para marcar a resolução e fazer o commit.\nfatal: Saindo por causa de um conflito não resolvido.`,
        128,
      )
    const staged = diffTrees(headTree(repo), indexTree(repo))
    if (!staged.length && !repo.merging) {
      const { unstaged, untracked } = repoStatus(sh.fs, repo)
      return fail(
        unstaged.length || untracked.length
          ? `No branch ${repo.branch}\nnenhuma mudança adicionada ao commit (use "git add" antes)`
          : `No branch ${repo.branch}\nnada para commitar, árvore de trabalho limpa`,
      )
    }
    const parent = tip(repo.commits) ?? null
    const c: Commit = makeCommit(parent, indexTree(repo), message, cfg['user.name'], cfg['user.email'])
    if (repo.merging) {
      c.parent2 = tip(repo.merging.theirs)?.hash ?? null
      repo.commits = unionHistory(repo.commits, repo.merging.theirs)
      repo.merging = undefined
    }
    repo.commits.push(c)
    repo.staged = {}
    writeGitDir(sh.fs, repo)
    const stat = diffStat(parent?.tree ?? {}, c.tree).split('\n').filter((l) => !l.includes(' | '))
    return ok(`[${repo.branch} ${short(c.hash)}] ${message.split('\n')[0]}\n${stat.join('\n')}`)
  },

  push: (args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    const setUp = args.includes('-u') || args.includes('--set-upstream')
    const del = args.includes('--delete') || args.includes('-d')
    const pos = args.filter((a) => !a.startsWith('-'))
    if (pos[0] && pos[0] !== 'origin')
      return fail(`${C.red}fatal: '${pos[0]}' não parece ser um repositório git\nfatal: Não foi possível ler do repositório remoto.${C.reset}\n${C.dim}Dica: o remoto deste repositório se chama "origin".${C.reset}`, 128)
    const url = github.cloneUrl(repo.remoteKey)

    if (del) {
      const b = pos[1]
      if (!b) return fail('uso: git push origin --delete <branch>', 128)
      if (!github.branchCommits(repo.remoteKey, b)) return fail(`${C.red}error: não foi possível apagar '${b}': a referência remota não existe${C.reset}\nerror: failed to push some refs to '${url}'`, 1)
      if (b === github.get(repo.remoteKey)!.branch)
        return fail(`To ${url}\n ${C.red}! [remote rejected] ${b} (refusing to delete the current branch: refs/heads/${b})${C.reset}\nerror: failed to push some refs to '${url}'`, 1)
      return withPushAuth(sh, repo, () => {
        github.deleteBranch(repo.remoteKey, b)
        snapshot(repo, b)
        writeGitDir(sh.fs, repo)
        return ok(`To ${url}\n - [deleted]         ${b}`)
      })
    }

    const [localName, remoteName] = (pos[1] ?? '').split(':')
    const local = localName || repo.branch
    const list = branchList(repo, local)
    if (!list) return fail(`${C.red}error: src refspec ${local} não corresponde a nenhuma referência\nerror: failed to push some refs to '${url}'${C.reset}`, 1)
    const target = remoteName || (pos[1] ? local : upstreamOf(repo, local))
    if (!target) {
      return fail(
        `${C.red}fatal: O branch atual ${local} não tem um branch upstream.${C.reset}\nPara enviar o branch atual e definir o remoto como upstream, use\n\n    git push --set-upstream origin ${local}\n\n${C.dim}(ou a forma curta: git push -u origin ${local})${C.reset}`,
        128,
      )
    }
    const remote = github.branchCommits(repo.remoteKey, target)
    const remoteTip = tip(remote)
    const setUpstream = () => {
      if (!setUp) return ''
      repo.upstreams ??= { main: 'main' }
      repo.upstreams[local] = target
      return `\nbranch '${local}' configurado para rastrear 'origin/${target}'.`
    }
    if (remoteTip && !has(list, remoteTip.hash))
      return fail(
        `To ${url}\n ${C.red}! [rejected]        ${local} -> ${target} (fetch first)${C.reset}\n${C.red}error: failed to push some refs to '${url}'${C.reset}\nhint: As atualizações foram rejeitadas porque o remoto contém commits que você\nhint: não tem localmente. Integre-os primeiro (por exemplo, "git pull") antes\nhint: de enviar de novo.`,
        1,
      )
    const remoteSet = new Set((remote ?? []).map((c) => c.hash))
    const ahead = list.filter((c) => !remoteSet.has(c.hash)).length
    if (remote && !ahead) {
      const msg = setUpstream()
      writeGitDir(sh.fs, repo)
      return ok(`Everything up-to-date${msg}`)
    }
    return withPushAuth(sh, repo, (login) => {
      const rule = github.protection(repo.remoteKey, target)
      if (rule?.requirePr)
        return fail(
          [
            `Enumerando objetos: ${ahead * 5}, concluído.`,
            `Total ${ahead * 3} (delta ${ahead}), reused 0 (delta 0), pack-reused 0`,
            `${C.red}remote: error: GH006: Protected branch update failed for refs/heads/${target}.`,
            `remote: - Changes must be made through a pull request.${rule.approvals ? `\nremote: - ${rule.approvals} of ${rule.approvals} required approving review${rule.approvals > 1 ? 's are' : ' is'} missing.` : ''}${C.reset}`,
            `To ${url}`,
            ` ${C.red}! [remote rejected] ${local} -> ${target} (protected branch hook declined)${C.reset}`,
            `${C.red}error: failed to push some refs to '${url}'${C.reset}`,
          ].join('\n'),
          1,
        )
      github.setCommits(repo.remoteKey, list, login, target)
      snapshot(repo, target)
      const up = setUpstream()
      writeGitDir(sh.fs, repo)
      const lines = [
        `Enumerando objetos: ${ahead * 5}, concluído.`,
        `Contando objetos: 100% (${ahead * 5}/${ahead * 5}), concluído.`,
        `Comprimindo objetos: 100% (${ahead * 2}/${ahead * 2}), concluído.`,
        `Escrevendo objetos: 100% (${ahead * 3}/${ahead * 3}), 412 bytes | 412.00 KiB/s, concluído.`,
        `Total ${ahead * 3} (delta ${ahead}), reused 0 (delta 0), pack-reused 0`,
      ]
      if (!remote) {
        const pr = github.openPullFor(repo.remoteKey, target)
        if (!pr) lines.push('remote:', `remote: Create a pull request for '${target}' on GitHub by visiting:`, `remote:      https://github.sim/${repo.remoteKey}/pull/new/${target}`, 'remote:')
        lines.push(`To ${url}`, ` * [new branch]      ${local} -> ${target}`)
      } else lines.push(`To ${url}`, `   ${short(remoteTip!.hash)}..${short(tip(list)!.hash)}  ${local} -> ${target}`)
      return ok(lines.join('\n') + up)
    })
  },

  fetch: (args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    const prune = args.includes('--prune') || args.includes('-p')
    const lines: string[] = []
    const key = repo.remoteKey
    repo.remotes ??= {}
    for (const b of github.branchNames(key)) {
      const now = github.branchCommits(key, b)!
      const old = repo.remotes[b]
      if (!old) lines.push(` * [new branch]      ${b.padEnd(10)} -> origin/${b}`)
      else if (tip(old)?.hash !== tip(now)?.hash) lines.push(`   ${short(tip(old)!.hash)}..${short(tip(now)!.hash)}  ${b.padEnd(10)} -> origin/${b}`)
      repo.remotes[b] = [...now]
    }
    if (prune)
      for (const b of Object.keys(repo.remotes))
        if (!github.branchCommits(key, b)) {
          delete repo.remotes[b]
          lines.push(` - [deleted]         (nenhum)   -> origin/${b}`)
        }
    writeGitDir(sh.fs, repo)
    return ok(lines.length ? `De ${github.cloneUrl(key).replace(/\.git$/, '')}\n${lines.join('\n')}` : '')
  },

  pull: (args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    if (repo.merging) return fail(`${C.red}error: Não é possível fazer pull porque você tem arquivos não mesclados.${C.reset}\nhint: Corrija-os, use 'git add' e 'git commit', ou 'git merge --abort'.`, 128)
    const pos = args.filter((a) => !a.startsWith('-'))
    if (pos[0] && pos[0] !== 'origin') return fail(`${C.red}fatal: '${pos[0]}' não parece ser um repositório git${C.reset}`, 128)
    const b = pos[1] ?? upstreamOf(repo)
    if (!b)
      return fail(
        `Não há informação de rastreamento para o branch atual.\nPor favor, especifique de qual branch você quer fazer merge.\n\n    git pull origin <branch>\n\nSe quiser definir o rastreamento, faça:\n\n    git branch --set-upstream-to=origin/<branch> ${repo.branch}`,
        1,
      )
    const remote = github.branchCommits(repo.remoteKey, b)
    if (!remote) return fail(`${C.red}fatal: não foi possível encontrar a referência remota ${b}${C.reset}`, 1)
    const old = tip(repo.remotes?.[b])
    snapshot(repo, b)
    const fetched = old && old.hash !== tip(remote)!.hash ? `De ${github.cloneUrl(repo.remoteKey).replace(/\.git$/, '')}\n * branch            ${b.padEnd(10)} -> FETCH_HEAD\n   ${short(old.hash)}..${short(tip(remote)!.hash)}  ${b.padEnd(10)} -> origin/${b}\n` : ''
    const ours = tip(repo.commits)
    const diverged = !!ours && !has(remote, ours.hash) && !has(repo.commits, tip(remote)!.hash)
    const cfg = readConfig(sh.fs)
    const ffOnly = args.includes('--ff-only') || cfg['pull.ff'] === 'only'
    if (args.includes('--rebase') || cfg['pull.rebase'] === 'true')
      return fail(`${C.yellow}O simulador ainda não faz rebase.${C.reset} Use merge: git pull --no-rebase (ou git config --global pull.rebase false).`, 1)
    if (diverged && !ffOnly && !args.includes('--no-rebase') && cfg['pull.rebase'] !== 'false') {
      writeGitDir(sh.fs, repo)
      return fail(
        fetched +
          [
            'hint: Você tem branches divergentes e precisa especificar como reconciliá-los.',
            'hint: Você pode fazer isso executando um dos comandos a seguir antes do',
            'hint: seu próximo pull:',
            'hint:',
            'hint:   git config pull.rebase false  # merge',
            'hint:   git config pull.rebase true   # rebase',
            'hint:   git config pull.ff only       # apenas fast-forward',
            'hint:',
            'hint: Você pode trocar "git config" por "git config --global" para definir uma',
            'hint: preferência padrão para todos os repositórios. Você também pode passar',
            'hint: --rebase, --no-rebase ou --ff-only na linha de comando.',
            `${C.red}fatal: É preciso especificar como reconciliar branches divergentes.${C.reset}`,
          ].join('\n'),
        128,
      )
    }
    const into = repo.branch === 'main' ? '' : ` into ${repo.branch}`
    const r = doMerge(sh, repo, remote, short(tip(remote)!.hash), `Merge branch '${b}' of ${github.cloneUrl(repo.remoteKey).replace(/\.git$/, '')}${into}`, ffOnly)
    writeGitDir(sh.fs, repo)
    return { ...r, out: fetched + r.out }
  },

  merge: (args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    if (args.includes('--abort')) {
      if (!repo.merging) return fail(`${C.red}fatal: Não há nenhum merge para abortar (MERGE_HEAD ausente).${C.reset}`, 128)
      const head = headTree(repo)
      moveWorkTree(sh.fs, repo.root, workTree(sh.fs, repo), head)
      repo.staged = {}
      repo.merging = undefined
      writeGitDir(sh.fs, repo)
      return ok()
    }
    if (args.includes('--continue')) return sub.commit([], sh)
    if (repo.merging) return fail(`${C.red}error: O merge anterior ainda não terminou (MERGE_HEAD existe).${C.reset}\nhint: Faça commit das suas mudanças antes de um novo merge, ou use "git merge --abort".`, 128)
    const name = args.find((a) => !a.startsWith('-'))
    if (!name) return fail('uso: git merge <branch>', 128)
    const remoteRef = name.match(/^(?:remotes\/)?origin\/(.+)$/)
    const theirs = remoteRef ? trackingList(repo, remoteRef[1]) : branchList(repo, name)
    if (!theirs) return fail(`${C.red}merge: ${name} - não é algo que possamos mesclar${C.reset}${remoteRef ? `\n${C.dim}Dica: rode "git fetch" para atualizar origin/*.${C.reset}` : ''}`, 1)
    const into = repo.branch === 'main' ? '' : ` into ${repo.branch}`
    const msg = remoteRef ? `Merge remote-tracking branch '${name}'${into}` : `Merge branch '${name}'${into}`
    return doMerge(sh, repo, theirs, name, msg, args.includes('--ff-only'))
  },

  switch: (args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    const create = args.includes('-c') || args.includes('--create')
    const name = args.find((a) => !a.startsWith('-') || a === '-')
    if (!name) return fail(`${C.red}fatal: faltou o nome do branch${C.reset}\nuso: git switch [-c] <branch>`, 128)
    return switchTo(sh, repo, name, create)
  },

  checkout: (args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    const dd = args.indexOf('--')
    if (dd >= 0) return sub.restore(args.slice(dd + 1), sh)
    const create = args.includes('-b')
    const name = args.find((a) => !a.startsWith('-') || a === '-')
    if (!name) return fail('uso: git checkout [-b] <branch>', 128)
    if (!create && !branchList(repo, name) && !trackingList(repo, name) && name !== '-') {
      const abs = sh.fs.resolve(sh.cwd, name)
      if (sh.fs.exists(abs)) return sub.restore([name], sh)
    }
    return switchTo(sh, repo, name, create)
  },

  log: (args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    const target = args.find((a) => !a.startsWith('-'))
    const remoteRef = target?.match(/^origin\/(.+)$/)
    const base = target ? (remoteRef ? trackingList(repo, remoteRef[1]) : branchList(repo, target)) : repo.commits
    if (!base) return fail(`${C.red}fatal: argumento ambíguo '${target}': revisão desconhecida${C.reset}`, 128)
    const list = [...base].reverse()
    const headHash = tip(repo.commits)?.hash
    const refs = (c: Commit) => {
      const r: string[] = []
      if (c.hash === headHash) r.push(`${C.cyan}${C.bold}HEAD -> ${C.green}${repo.branch}${C.reset}`)
      for (const b of Object.keys(repo.remotes ?? { [repo.branch]: [] }).sort((x, y) => (x === repo.branch ? -1 : y === repo.branch ? 1 : x.localeCompare(y))))
        if (tip(trackingList(repo, b))?.hash === c.hash) r.push(`${C.red}${C.bold}origin/${b}${C.reset}`)
      for (const b of Object.keys(repo.branches ?? {}).sort()) if (tip(repo.branches![b])?.hash === c.hash) r.push(`${C.green}${C.bold}${b}${C.reset}`)
      return r.length ? ` ${C.yellow}(${C.reset}${r.join(`${C.yellow}, ${C.reset}`)}${C.yellow})${C.reset}` : ''
    }
    if (args.includes('--oneline')) return ok(list.map((c) => `${C.yellow}${short(c.hash)}${C.reset}${refs(c)} ${c.message.split('\n')[0]}`).join('\n'))
    return ok(
      list
        .map(
          (c) =>
            `${C.yellow}commit ${c.hash}${C.reset}${refs(c)}\n${c.parent2 ? `Merge: ${short(c.parent ?? '')} ${short(c.parent2)}\n` : ''}Autor: ${c.author} <${c.email}>\nData:  ${fmtDate(c.date)}\n\n${c.message
              .split('\n')
              .map((l) => `    ${l}`)
              .join('\n')}\n`,
        )
        .join('\n'),
    )
  },

  diff: (args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    const stagedMode = args.includes('--staged') || args.includes('--cached')
    const a = stagedMode ? headTree(repo) : indexTree(repo)
    const b = stagedMode ? indexTree(repo) : workTree(sh.fs, repo)
    const changes = diffTrees(a, b).filter((c) => stagedMode || c.kind !== 'novo')
    return ok(
      changes
        .map((c) => [`${C.bold}diff --git a/${c.path} b/${c.path}${C.reset}`, `${C.bold}--- a/${c.path}\n+++ b/${c.path}${C.reset}`, ...lineDiff(a[c.path] ?? '', b[c.path] ?? '')].join('\n'))
        .join('\n'),
    )
  },

  remote: (args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    const url = github.cloneUrl(repo.remoteKey)
    return ok(args.includes('-v') ? `origin\t${url} (fetch)\norigin\t${url} (push)` : 'origin')
  },

  branch: (args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    const pos = args.filter((a) => !a.startsWith('-'))
    const delFlag = args.find((a) => a === '-d' || a === '-D' || a === '--delete')
    if (args.includes('--unset-upstream')) {
      repo.upstreams ??= { main: 'main' }
      delete repo.upstreams[repo.branch]
      writeGitDir(sh.fs, repo)
      return ok()
    }
    const setTo = args.find((a) => a.startsWith('--set-upstream-to='))
    if (setTo) {
      const b = setTo.split('=')[1].replace(/^origin\//, '')
      if (!trackingList(repo, b)) return fail(`${C.red}fatal: o branch 'origin/${b}' não existe${C.reset}`, 128)
      repo.upstreams ??= { main: 'main' }
      repo.upstreams[repo.branch] = b
      writeGitDir(sh.fs, repo)
      return ok(`branch '${repo.branch}' configurado para rastrear 'origin/${b}'.`)
    }
    if (delFlag) {
      if (!pos.length) return fail('fatal: o nome do branch é obrigatório', 128)
      const out: string[] = []
      for (const name of pos) {
        if (name === repo.branch) return fail(`${C.red}error: Não é possível excluir o branch '${name}' que está em uso em '${repo.root}'${C.reset}\n${C.dim}Dica: troque de branch antes (git switch main).${C.reset}`, 1)
        const l = repo.branches?.[name]
        if (!l) return fail(`${C.red}error: branch '${name}' não encontrado.${C.reset}`, 1)
        const t = tip(l)!
        const u = upstreamOf(repo, name)
        const merged = has(repo.commits, t.hash) || (u ? has(trackingList(repo, u), t.hash) : false)
        if (!merged && delFlag !== '-D')
          return fail(`${C.red}error: O branch '${name}' não foi totalmente mesclado.${C.reset}\nSe tem certeza de que quer excluí-lo, execute 'git branch -D ${name}'.`, 1)
        if (!has(repo.commits, t.hash) && delFlag !== '-D' && u)
          out.push(`${C.yellow}warning: excluindo o branch '${name}' que foi mesclado em\n         'refs/remotes/origin/${u}', mas ainda não em HEAD.${C.reset}`)
        delete repo.branches![name]
        if (repo.upstreams) delete repo.upstreams[name]
        if (repo.prev === name) repo.prev = undefined
        out.push(`Branch ${name} excluído (era ${short(t.hash)}).`)
      }
      writeGitDir(sh.fs, repo)
      return ok(out.join('\n'))
    }
    if (pos.length && !args.includes('-a') && !args.includes('-r')) {
      const name = pos[0]
      if (branchList(repo, name)) return fail(`${C.red}fatal: já existe um branch chamado '${name}'${C.reset}`, 128)
      if (!/^[\w./-]+$/.test(name)) return fail(`${C.red}fatal: '${name}' não é um nome de branch válido${C.reset}`, 128)
      repo.branches ??= {}
      repo.branches[name] = [...repo.commits]
      writeGitDir(sh.fs, repo)
      return ok()
    }
    const verbose = args.includes('-v') || args.includes('-vv')
    const line = (b: string) => {
      const l = branchList(repo, b)!
      const t = tip(l)
      const u = upstreamOf(repo, b)
      const extra = verbose ? ` ${C.yellow}${short(t?.hash ?? '')}${C.reset} ${args.includes('-vv') && u ? `[${C.blue}origin/${u}${C.reset}] ` : ''}${t?.message.split('\n')[0] ?? ''}` : ''
      return b === repo.branch ? `* ${C.green}${b}${C.reset}${extra}` : `  ${b}${extra}`
    }
    const out = args.includes('-r') ? [] : localBranches(repo).map(line)
    if (args.includes('-a') || args.includes('-r'))
      for (const b of Object.keys(repo.remotes ?? { [repo.branch]: [] }).sort()) out.push(`  ${C.red}${args.includes('-r') ? '' : 'remotes/'}origin/${b}${C.reset}`)
    return ok(out.join('\n'))
  },
}

registerCommand('git', {
  pkg: 'git',
  help: 'controle de versão (git help para detalhes)',
  run: (args, { sh }) => {
    const [name, ...rest] = args
    if (!name || name === '--help') return sub.help([], sh)
    if (name === '--version') return ok('git version 2.47.0')
    const fn = Object.hasOwn(sub, name) ? sub[name] : undefined
    if (!fn) return fail(`git: '${name}' não é um comando git (ou ainda não existe no simulador). Veja 'git help'.`, 1)
    return fn(rest, sh)
  },
})

// ---------- progresso salvo ----------
export type GitJSON = { repos: LocalRepo[]; keychain: { login: string; secret: string } | null }
export function gitDump(fs: VFS): GitJSON {
  return { repos: [...reposOf(fs).values()], keychain: keychain.get(fs) ?? null }
}
export function gitLoad(fs: VFS, d: GitJSON | undefined) {
  if (!d) return
  const m = reposOf(fs)
  m.clear()
  for (const r of d.repos) m.set(r.root, r)
  if (d.keychain) keychain.set(fs, d.keychain)
}
