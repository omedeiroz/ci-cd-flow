// Git simulado: clone, status, add, commit, push, pull, log, diff, config, remote, branch.
import type { VFS } from './fs'
import { C, fail, ok, registerCommand, type Result, type Shell } from './shell'
import { github, makeCommit, type Commit, type Tree } from './github'

export type LocalRepo = {
  root: string
  remoteKey: string
  branch: string
  commits: Commit[]
  staged: Record<string, string | null> // null = remoção preparada
}

const reposByFs = new WeakMap<VFS, Map<string, LocalRepo>>()
/** "Chaveiro" do sistema: guarda as credenciais do git depois do primeiro push bem-sucedido. */
const keychain = new WeakMap<VFS, { login: string; secret: string }>()
export const saveCredentials = (fs: VFS, login: string, secret: string) => keychain.set(fs, { login, secret })

/** Registra um repositório já presente em disco (usado pelo checkout do runner e pelo atalho de missões). */
export function registerRepo(fs: VFS, root: string, remoteKey: string, commits: Commit[]) {
  const repo: LocalRepo = { root, remoteKey, branch: 'main', commits: [...commits], staged: {} }
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
  return {
    staged,
    unstaged: all.filter((c) => c.kind !== 'novo'),
    untracked: all.filter((c) => c.kind === 'novo').map((c) => c.path),
  }
}

/** Quantos commits locais ainda não foram enviados. */
export function aheadBy(repo: LocalRepo) {
  const remote = github.get(repo.remoteKey)
  if (!remote) return 0
  const remoteHead = remote.commits[remote.commits.length - 1]?.hash
  const idx = repo.commits.findIndex((c) => c.hash === remoteHead)
  return idx < 0 ? repo.commits.length : repo.commits.length - 1 - idx
}

// ---------- diff de linhas (LCS) ----------

function lineDiff(a: string, b: string): string[] {
  const A = a.replace(/\n$/, '').split('\n')
  const B = b.replace(/\n$/, '').split('\n')
  const dp = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0))
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: string[] = []
  let i = 0
  let j = 0
  while (i < A.length || j < B.length) {
    if (i < A.length && j < B.length && A[i] === B[j]) (out.push(`${C.dim} ${A[i]}${C.reset}`), i++, j++)
    else if (j < B.length && (i >= A.length || dp[i][j + 1] >= dp[i + 1][j])) out.push(`${C.green}+${B[j++]}${C.reset}`)
    else out.push(`${C.red}-${A[i++]}${C.reset}`)
  }
  // mantém só as linhas próximas das mudanças
  const keep = new Set<number>()
  out.forEach((l, k) => {
    if (!l.startsWith(C.dim)) for (let d = -2; d <= 2; d++) keep.add(k + d)
  })
  return out.filter((_, k) => keep.has(k))
}

// ---------- comandos ----------

const short = (h: string) => h.slice(0, 7)
const fmtDate = (ms: number) => new Date(ms).toLocaleString('pt-BR', { dateStyle: 'medium', timeStyle: 'short' })
const NOT_REPO = fail(`${C.red}fatal: não é um repositório git (nem nenhum dos diretórios pais): .git${C.reset}`, 128)

function writeGitDir(fs: VFS, repo: LocalRepo) {
  fs.writeTree(`${repo.root}/.git`, {
    HEAD: `ref: refs/heads/${repo.branch}\n`,
    config: `[remote "origin"]\n\turl = ${github.cloneUrl(repo.remoteKey)}\n[branch "${repo.branch}"]\n\tremote = origin\n`,
    'refs/heads/main': (repo.commits[repo.commits.length - 1]?.hash ?? '') + '\n',
  })
}

const sub: Record<string, (args: string[], sh: Shell) => Result> = {
  help: () =>
    ok(
      [
        `${C.bold}Comandos git disponíveis no simulador:${C.reset}`,
        '  clone <url> [pasta]   copia um repositório remoto',
        '  status                mostra o que mudou',
        '  add <arquivo|.>       prepara mudanças para o commit',
        '  commit -m "mensagem"  registra as mudanças preparadas',
        '  push                  envia commits para o GitHub',
        '  pull                  baixa commits novos do GitHub',
        '  log [--oneline]       histórico de commits',
        '  diff [--staged]       mostra as mudanças linha a linha',
        '  config                configura nome e e-mail',
        '  remote -v             mostra o repositório remoto',
        '  branch                lista os branches',
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
    const head = remote.commits[remote.commits.length - 1]
    sh.fs.mkdir(root, true)
    sh.fs.writeTree(root, head.tree)
    const repo: LocalRepo = { root, remoteKey: key, branch: remote.branch, commits: [...remote.commits], staged: {} }
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
    const { staged, unstaged, untracked } = repoStatus(sh.fs, repo)
    const ahead = aheadBy(repo)
    const lines = [`No branch ${repo.branch}`]
    lines.push(
      ahead
        ? `Seu branch está à frente de 'origin/${repo.branch}' por ${ahead} commit${ahead > 1 ? 's' : ''}.\n  (use "git push" para publicar seus commits locais)`
        : `Seu branch está atualizado com 'origin/${repo.branch}'.`,
    )
    if (staged.length)
      lines.push('', 'Mudanças a serem commitadas:', '  (use "git restore --staged <arquivo>..." para despreparar)', ...staged.map((c) => `\t${C.green}${(c.kind + ':').padEnd(12)}${c.path}${C.reset}`))
    if (unstaged.length)
      lines.push('', 'Mudanças não preparadas para commit:', '  (use "git add <arquivo>..." para preparar)', ...unstaged.map((c) => `\t${C.red}${(c.kind + ':').padEnd(12)}${c.path}${C.reset}`))
    if (untracked.length) lines.push('', 'Arquivos não rastreados:', '  (use "git add <arquivo>..." para incluir no commit)', ...untracked.map((p) => `\t${C.red}${p}${C.reset}`))
    if (!staged.length && !unstaged.length && !untracked.length) lines.push('', 'nada para commitar, árvore de trabalho limpa')
    else if (!staged.length) lines.push('', 'nenhuma mudança adicionada ao commit (use "git add")')
    return ok(lines.join('\n'))
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
    for (const prefix of prefixes) {
      const match = (f: string) => !prefix || f === prefix || f.startsWith(prefix + '/')
      for (const f of new Set([...Object.keys(work), ...Object.keys(index)])) {
        if (!match(f)) continue
        matched = true
        if (f in work) repo.staged[f] = work[f]
        else repo.staged[f] = null
      }
    }
    if (!matched) return fail(`${C.red}fatal: o caminho '${paths[0]}' não corresponde a nenhum arquivo${C.reset}`, 128)
    return ok()
  },

  restore: (args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    if (!args.includes('--staged')) return fail('No simulador, use: git restore --staged <arquivo>')
    for (const p of args.filter((a) => !a.startsWith('-'))) {
      const rel = sh.fs.resolve(sh.cwd, p).slice(repo.root.length + 1)
      for (const k of Object.keys(repo.staged)) if (!rel || k === rel || k.startsWith(rel + '/')) delete repo.staged[k]
    }
    return ok()
  },

  commit: (args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    const mi = args.findIndex((a) => a === '-m' || a === '-am')
    if (args.includes('-am') || args.includes('-a')) {
      // -a só inclui arquivos já rastreados (modificados ou removidos), nunca arquivos novos
      const work = workTree(sh.fs, repo)
      for (const f of Object.keys(indexTree(repo))) repo.staged[f] = f in work ? work[f] : null
    }
    const message = mi >= 0 ? args[mi + 1] : undefined
    if (!message) return fail(`${C.red}error: falta a mensagem. Use: git commit -m "sua mensagem"${C.reset}`)
    const cfg = readConfig(sh.fs)
    if (!cfg['user.name'] || !cfg['user.email'])
      return fail(
        `${C.red}*** Por favor, diga quem você é.${C.reset}\n\nExecute\n\n  git config --global user.email "voce@exemplo.com"\n  git config --global user.name "Seu Nome"\n\npara definir a identidade padrão da sua conta.`,
        128,
      )
    const staged = diffTrees(headTree(repo), indexTree(repo))
    if (!staged.length) {
      const { unstaged, untracked } = repoStatus(sh.fs, repo)
      return fail(
        unstaged.length || untracked.length
          ? `No branch ${repo.branch}\nnenhuma mudança adicionada ao commit (use "git add" antes)`
          : `No branch ${repo.branch}\nnada para commitar, árvore de trabalho limpa`,
      )
    }
    const c = makeCommit(repo.commits[repo.commits.length - 1] ?? null, indexTree(repo), message, cfg['user.name'], cfg['user.email'])
    repo.commits.push(c)
    repo.staged = {}
    writeGitDir(sh.fs, repo)
    const counts = { novo: 0, modificado: 0, removido: 0 }
    staged.forEach((s) => counts[s.kind]++)
    return ok(
      `[${repo.branch} ${short(c.hash)}] ${message}\n ${staged.length} arquivo${staged.length > 1 ? 's' : ''} alterado${staged.length > 1 ? 's' : ''}` +
        staged.filter((s) => s.kind === 'novo').map((s) => `\n create mode 100644 ${s.path}`).join(''),
    )
  },

  push: (_args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    const remote = github.get(repo.remoteKey)!
    const url = github.cloneUrl(repo.remoteKey)
    const remoteHead = remote.commits[remote.commits.length - 1]
    if (!repo.commits.some((c) => c.hash === remoteHead.hash))
      return fail(`To ${url}\n ${C.red}! [rejected]        ${repo.branch} -> ${repo.branch} (fetch first)${C.reset}\nerror: o remoto tem commits que você não tem. Rode "git pull" primeiro.`)
    const ahead = aheadBy(repo)
    if (!ahead) return ok('Everything up-to-date')

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
      const before = short(remoteHead.hash)
      github.setCommits(repo.remoteKey, repo.commits, auth.user.login)
      return ok(
        [
          `Enumerando objetos: ${ahead * 5}, concluído.`,
          `Contando objetos: 100% (${ahead * 5}/${ahead * 5}), concluído.`,
          `Comprimindo objetos: 100% (${ahead * 2}/${ahead * 2}), concluído.`,
          `Escrevendo objetos: 100% (${ahead * 3}/${ahead * 3}), 412 bytes | 412.00 KiB/s, concluído.`,
          `Total ${ahead * 3} (delta ${ahead}), reused 0 (delta 0), pack-reused 0`,
          `To ${url}`,
          `   ${before}..${short(repo.commits[repo.commits.length - 1].hash)}  ${repo.branch} -> ${repo.branch}`,
        ].join('\n'),
      )
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
  },

  pull: (_args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    const remote = github.get(repo.remoteKey)!
    const localHead = repo.commits[repo.commits.length - 1]
    if (remote.commits[remote.commits.length - 1].hash === localHead.hash) return ok('Já está atualizado.')
    if (!remote.commits.some((c) => c.hash === localHead.hash)) return fail('fatal: os históricos divergiram (merge não suportado no simulador ainda).')
    const { staged, unstaged } = repoStatus(sh.fs, repo)
    if (staged.length || unstaged.length) return fail('error: suas mudanças locais seriam sobrescritas. Faça commit antes do pull.')
    const newHead = remote.commits[remote.commits.length - 1]
    for (const p of Object.keys(localHead.tree)) if (!(p in newHead.tree)) sh.fs.remove(`${repo.root}/${p}`)
    sh.fs.writeTree(repo.root, newHead.tree)
    const n = remote.commits.length - repo.commits.length
    repo.commits = [...remote.commits]
    writeGitDir(sh.fs, repo)
    return ok(`Atualizando ${short(localHead.hash)}..${short(newHead.hash)}\nFast-forward (${n} commit${n > 1 ? 's' : ''})`)
  },

  log: (args, sh) => {
    const repo = findRepo(sh.fs, sh.cwd)
    if (!repo) return NOT_REPO
    const remoteHead = github.head(repo.remoteKey)?.hash
    const list = [...repo.commits].reverse()
    const refs = (c: Commit, i: number) => {
      const r: string[] = []
      if (i === 0) r.push(`${C.cyan}${C.bold}HEAD -> ${C.green}${repo.branch}${C.reset}`)
      if (c.hash === remoteHead) r.push(`${C.red}${C.bold}origin/${repo.branch}${C.reset}`)
      return r.length ? ` ${C.yellow}(${C.reset}${r.join(`${C.yellow}, ${C.reset}`)}${C.yellow})${C.reset}` : ''
    }
    if (args.includes('--oneline')) return ok(list.map((c, i) => `${C.yellow}${short(c.hash)}${C.reset}${refs(c, i)} ${c.message}`).join('\n'))
    return ok(
      list
        .map((c, i) => `${C.yellow}commit ${c.hash}${C.reset}${refs(c, i)}\nAutor: ${c.author} <${c.email}>\nData:  ${fmtDate(c.date)}\n\n    ${c.message}\n`)
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
    return ok(`* ${C.green}${repo.branch}${C.reset}${args.includes('-a') ? `\n  ${C.red}remotes/origin/${repo.branch}${C.reset}` : ''}`)
  },
}

registerCommand('git', {
  pkg: 'git',
  help: 'controle de versão (git help para detalhes)',
  run: (args, { sh }) => {
    const [name, ...rest] = args
    if (!name || name === '--help') return sub.help([], sh)
    if (name === '--version') return ok('git version 2.47.0')
    const fn = sub[name]
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
