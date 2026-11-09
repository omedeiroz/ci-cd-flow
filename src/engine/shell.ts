// Interpretador de comandos estilo bash (subconjunto didático).
import { FsError, VFS } from './fs'

export const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
}

export type CommandEvent = { line: string; name: string; args: string[]; code: number; cwd: string; host: string }

/** Uma pergunta interativa (senha, yes/no...). `answer` recebe o que o usuário digitou. */
export type Prompt = { text: string; hidden?: boolean; answer: (input: string) => Result }
export type Result = {
  out: string
  code: number
  prompt?: Prompt
  /** Troca de sessão: entrar numa máquina remota (ssh) ou sair dela (exit). */
  session?: { push: Shell } | 'pop'
}
export type Ctx = { sh: Shell; stdin: string; sudo: boolean; background: boolean; nohup: boolean }
/** `pkg`: pacote que precisa estar instalado na máquina para o comando existir. */
export type Cmd = { help: string; pkg?: string; run: (args: string[], ctx: Ctx) => Result }

/** Máquina onde o shell roda: pacotes instalados etc. */
/** `ip`: IP público de saída (usado pelos firewalls/Security Groups). `interactive: false` = sem teclado (runner de CI). */
export type Machine = { id: string; os: 'mac' | 'ubuntu' | 'debian' | 'amazon'; packages: Set<string>; aptUpdated: boolean; ip?: string; interactive?: boolean; userGroups?: Record<string, string[]>; nodeVersion?: string }

/** Encadeia um resultado que pode ter prompts pendentes. `cont` roda quando tudo foi respondido. */
export function afterPrompts(r: Result, cont: (r: Result) => Result): Result {
  if (!r.prompt) return cont(r)
  const p = r.prompt
  return { ...r, prompt: { ...p, answer: (input) => afterPrompts(p.answer(input), cont) } }
}

export function modeString(isDir: boolean, mode: number) {
  const rwx = (n: number) => (n & 4 ? 'r' : '-') + (n & 2 ? 'w' : '-') + (n & 1 ? 'x' : '-')
  return (isDir ? 'd' : '-') + rwx((mode >> 6) & 7) + rwx((mode >> 3) & 7) + rwx(mode & 7)
}

export const ok = (out = ''): Result => ({ out, code: 0 })
export const fail = (out: string, code = 1): Result => ({ out, code })

export function flags(args: string[]) {
  const f = new Set<string>()
  const rest: string[] = []
  for (const a of args) {
    if (a.startsWith('-') && a.length > 1) for (const ch of a.slice(1)) f.add(ch)
    else rest.push(a)
  }
  return { f, rest }
}

function fmtDate(ms: number) {
  const d = new Date(ms)
  const m = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][d.getMonth()]
  return `${m} ${String(d.getDate()).padStart(2, ' ')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const commands: Record<string, Cmd> = {
  help: {
    help: 'lista os comandos disponíveis',
    run: (_, { sh }) => {
      const lines = Object.entries(commands)
        .filter(([n]) => sh.hasCommand(n))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([n, c]) => `  ${C.cyan}${n.padEnd(10)}${C.reset} ${c.help}`)
      return ok(`${C.bold}Comandos disponíveis:${C.reset}\n${lines.join('\n')}\n\nDica: use ${C.yellow}Tab${C.reset} para completar e ${C.yellow}↑/↓${C.reset} para o histórico.`)
    },
  },
  pwd: { help: 'mostra o diretório atual', run: (_, { sh }) => ok(sh.cwd) },
  true: { help: 'não faz nada e termina com sucesso', run: () => ok() },
  false: { help: 'não faz nada e termina com erro', run: () => fail('', 1) },
  sleep: { help: 'espera N segundos (no simulador é instantâneo)', run: () => ok() },
  whoami: { help: 'mostra o usuário atual', run: (_, { sh }) => ok(sh.user) },
  hostname: { help: 'mostra o nome da máquina', run: (_, { sh }) => ok(sh.host) },
  uname: {
    help: 'informações do sistema (-a)',
    run: (a, { sh }) => ok(a.includes('-a') ? `Linux ${sh.host} 6.8.0-devlab #1 SMP x86_64 GNU/Linux` : 'Linux'),
  },
  date: { help: 'mostra data e hora', run: () => ok(new Date().toLocaleString('pt-BR')) },
  clear: { help: 'limpa a tela', run: () => ok('\x1b[2J\x1b[3J\x1b[H') },
  echo: { help: 'imprime um texto (use > para salvar em arquivo)', run: (a) => ok(a.join(' ')) },
  history: {
    help: 'mostra comandos anteriores',
    run: (_, { sh }) => ok(sh.history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join('\n')),
  },
  ls: {
    help: 'lista arquivos (-l detalhes, -a ocultos)',
    run: (args, { sh }) => {
      const { f, rest } = flags(args)
      const targets = rest.length ? rest : ['.']
      const blocks: string[] = []
      for (const t of targets) {
        const abs = sh.fs.resolve(sh.cwd, t)
        let entries
        try {
          entries = sh.fs.list(abs)
        } catch {
          return fail(`ls: não foi possível acessar '${t}': Arquivo ou diretório inexistente`, 2)
        }
        if (!f.has('a')) entries = entries.filter(([n]) => !n.startsWith('.'))
        const name = (n: string, isDir: boolean) => (isDir ? `${C.bold}${C.blue}${n}${C.reset}` : n)
        let body: string
        if (f.has('l')) {
          body = entries
            .map(([n, node]) => {
              const isDir = node.type === 'dir'
              const size = isDir ? 4096 : node.content.length
              const exec = !isDir && node.mode & 0o111
              return `${modeString(isDir, node.mode)} 1 ${sh.user} ${sh.user} ${String(size).padStart(5)} ${fmtDate(node.mtime)} ${exec ? C.bold + C.green + n + C.reset : name(n, isDir)}`
            })
            .join('\n')
          body = `total ${entries.length}\n${body}`
        } else body = entries.map(([n, node]) => name(n, node.type === 'dir')).join('  ')
        blocks.push(targets.length > 1 ? `${t}:\n${body}` : body)
      }
      return ok(blocks.join('\n\n'))
    },
  },
  cd: {
    help: 'muda de diretório (cd .. volta um nível)',
    run: (args, { sh }) => {
      const target = args[0] === '-' ? sh.prevCwd : args[0] ?? '~'
      const abs = sh.fs.resolve(sh.cwd, target)
      const node = sh.fs.get(abs)
      if (!node) return fail(`cd: ${target}: Arquivo ou diretório inexistente`)
      if (node.type !== 'dir') return fail(`cd: ${target}: Não é um diretório`)
      sh.prevCwd = sh.cwd
      sh.cwd = abs
      return ok()
    },
  },
  mkdir: {
    help: 'cria diretório (-p cria intermediários)',
    run: (args, { sh }) => {
      const { f, rest } = flags(args)
      if (!rest.length) return fail('mkdir: falta o operando\nUso: mkdir <nome>')
      for (const d of rest) sh.fs.mkdir(sh.fs.resolve(sh.cwd, d), f.has('p'))
      return ok()
    },
  },
  touch: {
    help: 'cria arquivo vazio',
    run: (args, { sh }) => {
      if (!args.length) return fail('touch: falta o operando')
      for (const a of args) sh.fs.touch(sh.fs.resolve(sh.cwd, a))
      return ok()
    },
  },
  cat: {
    help: 'mostra o conteúdo de um arquivo',
    run: (args, { sh, stdin }) => {
      if (!args.length) return ok(stdin)
      return ok(args.map((a) => sh.fs.read(sh.fs.resolve(sh.cwd, a)).replace(/\n$/, '')).join('\n'))
    },
  },
  rm: {
    help: 'remove arquivo (-r para diretórios)',
    run: (args, { sh }) => {
      const { f, rest } = flags(args)
      if (!rest.length) return fail('rm: falta o operando')
      for (const a of rest) {
        const abs = sh.fs.resolve(sh.cwd, a)
        if (abs === '/' || abs === sh.fs.home) return fail(`rm: recusando remover '${a}' (proteção do simulador)`)
        sh.fs.remove(abs, f.has('r') || f.has('R'))
      }
      return ok()
    },
  },
  cp: {
    help: 'copia arquivo: cp <origem> <destino>',
    run: (args, { sh }) => {
      const { rest } = flags(args)
      if (rest.length < 2) return fail('cp: falta o operando de destino')
      sh.fs.copy(sh.fs.resolve(sh.cwd, rest[0]), sh.fs.resolve(sh.cwd, rest[1]))
      return ok()
    },
  },
  mv: {
    help: 'move/renomeia: mv <origem> <destino>',
    run: (args, { sh }) => {
      if (args.length < 2) return fail('mv: falta o operando de destino')
      sh.fs.move(sh.fs.resolve(sh.cwd, args[0]), sh.fs.resolve(sh.cwd, args[1]))
      return ok()
    },
  },
  tree: {
    help: 'mostra a árvore de diretórios',
    run: (args, { sh }) => {
      const start = sh.fs.resolve(sh.cwd, args[0] ?? '.')
      const lines: string[] = [args[0] ?? '.']
      let dirs = 0
      let files = 0
      const walk = (abs: string, prefix: string) => {
        const entries = sh.fs.list(abs).filter(([n]) => !n.startsWith('.'))
        entries.forEach(([n, node], i) => {
          const last = i === entries.length - 1
          const isDir = node.type === 'dir'
          isDir ? dirs++ : files++
          lines.push(`${prefix}${last ? '└── ' : '├── '}${isDir ? C.bold + C.blue + n + C.reset : n}`)
          if (isDir) walk(`${abs === '/' ? '' : abs}/${n}`, prefix + (last ? '    ' : '│   '))
        })
      }
      walk(start, '')
      return ok(`${lines.join('\n')}\n\n${dirs} diretórios, ${files} arquivos`)
    },
  },
  grep: {
    help: 'filtra linhas: grep <texto> [arquivo]',
    run: (args, { sh, stdin }) => {
      const { f, rest } = flags(args)
      const [pat, fileArg] = rest
      if (!pat) return fail('Uso: grep <texto> [arquivo]', 2)
      const src = fileArg ? sh.fs.read(sh.fs.resolve(sh.cwd, fileArg)) : stdin
      const re = new RegExp(pat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), f.has('i') ? 'gi' : 'g')
      const hits = src.split('\n').filter((l) => l.match(re))
      return hits.length ? ok(hits.map((l) => l.replace(re, (m) => C.red + C.bold + m + C.reset)).join('\n')) : fail('', 1)
    },
  },
  head: {
    help: 'primeiras linhas (-n N)',
    run: (args, { sh, stdin }) => {
      const n = args[0] === '-n' ? Number(args[1]) : 10
      const fileArg = args[0] === '-n' ? args[2] : args[0]
      const src = fileArg ? sh.fs.read(sh.fs.resolve(sh.cwd, fileArg)) : stdin
      return ok(src.split('\n').slice(0, n).join('\n'))
    },
  },
  tail: {
    help: 'últimas linhas (-n N)',
    run: (args, { sh, stdin }) => {
      const n = args[0] === '-n' ? Number(args[1]) : 10
      const fileArg = args[0] === '-n' ? args[2] : args[0]
      const src = (fileArg ? sh.fs.read(sh.fs.resolve(sh.cwd, fileArg)) : stdin).replace(/\n$/, '')
      return ok(src.split('\n').slice(-n).join('\n'))
    },
  },
  wc: {
    help: 'conta linhas, palavras e caracteres',
    run: (args, { sh, stdin }) => {
      const src = args[0] ? sh.fs.read(sh.fs.resolve(sh.cwd, args[0])) : stdin
      const l = src ? src.replace(/\n$/, '').split('\n').length : 0
      return ok(`${l} ${src.split(/\s+/).filter(Boolean).length} ${src.length}${args[0] ? ' ' + args[0] : ''}`)
    },
  },
  chmod: {
    help: 'muda permissões: chmod 400 arquivo, chmod +x script',
    run: (args, { sh }) => {
      const [spec, ...files] = args.filter((a) => a !== '-R')
      if (!spec || !files.length) return fail('chmod: falta o operando\nUso: chmod <modo> <arquivo>  (ex: chmod 400 chave.pem)')
      for (const f of files) {
        const abs = sh.fs.resolve(sh.cwd, f)
        const node = sh.fs.get(abs)
        if (!node) return fail(`chmod: não foi possível acessar '${f}': Arquivo ou diretório inexistente`)
        let mode = node.mode
        if (/^[0-7]{3,4}$/.test(spec)) mode = parseInt(spec, 8)
        else {
          const m = spec.match(/^([ugoa]*)([+\-=])([rwx]+)$/)
          if (!m) return fail(`chmod: modo inválido: '${spec}'`)
          const who = m[1] || 'a'
          let bits = 0
          for (const ch of m[3]) bits |= ch === 'r' ? 4 : ch === 'w' ? 2 : 1
          let mask = 0
          if (who.includes('u') || who.includes('a')) mask |= bits << 6
          if (who.includes('g') || who.includes('a')) mask |= bits << 3
          if (who.includes('o') || who.includes('a')) mask |= bits
          mode = m[2] === '+' ? mode | mask : m[2] === '-' ? mode & ~mask : mask
        }
        sh.fs.chmod(abs, mode)
      }
      return ok()
    },
  },
  exit: {
    help: 'encerra a sessão (sai de um servidor via ssh)',
    run: (_, { sh }) =>
      sh.isContainer
        ? { out: '', code: 0, session: 'pop' }
        : sh.remoteLabel
        ? { out: `logout\nConnection to ${sh.remoteLabel} closed.`, code: 0, session: 'pop' }
        : ok(`${C.dim}(este é o terminal da sua máquina; não há sessão remota para encerrar)${C.reset}`),
  },
  groups: { help: 'mostra os grupos do usuário nesta sessão', run: (_, { sh }) => ok(sh.groups.join(' ')) },
  id: {
    help: 'mostra usuário e grupos',
    run: (_, { sh }) => ok(`uid=1000(${sh.user}) gid=1000(${sh.user}) groups=${sh.groups.map((g, i) => `${1000 + i * 3}(${g})`).join(',')}`),
  },
  usermod: {
    help: 'altera um usuário: sudo usermod -aG grupo usuario',
    run: (args, { sh, sudo }) => {
      if (!sudo) return fail('usermod: Permission denied.\nusermod: cannot lock /etc/passwd; try again later.', 1)
      const gi = args.findIndex((a) => a === '-aG' || a === '-a' || a === '-G')
      const group = args[gi + 1]
      const user = args[args.length - 1]
      if (gi < 0 || !group || !user || user === group) return fail('Uso: sudo usermod -aG <grupo> <usuário>', 2)
      const g = (sh.machine.userGroups ??= {})
      g[user] = [...new Set([...(g[user] ?? []), group])]
      return ok()
    },
  },
  man: {
    help: 'explica um comando: man <comando>',
    run: (args) => {
      const c = commands[args[0]]
      return c ? ok(`${C.bold}${args[0]}${C.reset} — ${c.help}`) : fail(`Nenhuma entrada de manual para ${args[0] ?? '(vazio)'}`)
    },
  },
}

// ---------- Tokenização ----------

type Token = { t: 'word'; v: string } | { t: 'op'; v: '|' | '>' | '>>' | '&&' | '||' | ';' | '&' }

function tokenize(line: string, env: Record<string, string>): Token[] {
  const out: Token[] = []
  let cur = ''
  let has = false
  let q: '"' | "'" | null = null
  const push = () => {
    if (has) out.push({ t: 'word', v: cur })
    cur = ''
    has = false
  }
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === q) q = null
      else if (ch === '$' && q === '"') {
        const m = line.slice(i + 1).match(/^\w+/)
        if (m) {
          cur += env[m[0]] ?? ''
          i += m[0].length
        } else cur += ch
      } else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      q = ch
      has = true
    } else if (ch === ' ' || ch === '\t') push()
    else if (ch === '|' && line[i + 1] === '|') (push(), out.push({ t: 'op', v: '||' }), i++)
    else if (ch === '|') (push(), out.push({ t: 'op', v: '|' }))
    else if (ch === ';') (push(), out.push({ t: 'op', v: ';' }))
    else if (ch === '&' && line[i + 1] === '&') (push(), out.push({ t: 'op', v: '&&' }), i++)
    else if (ch === '&') (push(), out.push({ t: 'op', v: '&' }))
    else if (ch === '>') {
      push()
      if (line[i + 1] === '>') (out.push({ t: 'op', v: '>>' }), i++)
      else out.push({ t: 'op', v: '>' })
    } else if (ch === '$') {
      const m = line.slice(i + 1).match(/^\w+/)
      if (m) {
        cur += env[m[0]] ?? ''
        has = true
        i += m[0].length
      } else ((cur += ch), (has = true))
    } else ((cur += ch), (has = true))
  }
  if (q) throw new Error('aspas não fechadas')
  push()
  return out
}

// ---------- Shell ----------

let nextSession = 1
type Chain = { tokens: Token[]; op: ';' | '&&' | '||' | '&' | null }

export class Shell {
  fs: VFS
  cwd: string
  prevCwd: string
  user: string
  host: string
  machine: Machine
  /** Para sessões remotas: o endereço usado no ssh (aparece no "Connection to X closed"). */
  remoteLabel?: string
  /** Sessão dentro de um container (docker exec). */
  isContainer = false
  /** Grupos do usuário, lidos no login: mudanças com usermod só valem na próxima sessão. */
  groups: string[]
  sessionId = nextSession++
  history: string[] = []
  env: Record<string, string>
  aliases: Record<string, string> = { ll: 'ls -l', la: 'ls -a' }
  onCommand?: (e: CommandEvent) => void
  private jobs = 0

  constructor(fs: VFS, user: string, host: string, machine: Machine) {
    this.fs = fs
    this.user = user
    this.host = host
    this.machine = machine
    this.groups = [user, ...(machine.userGroups?.[user] ?? [])]
    this.cwd = fs.home
    this.prevCwd = fs.home
    this.env = { HOME: fs.home, USER: user, SHELL: '/bin/bash', PATH: '/usr/local/bin:/usr/bin:/bin' }
  }

  prompt() {
    const p = this.cwd === this.fs.home ? '~' : this.cwd.startsWith(this.fs.home + '/') ? '~' + this.cwd.slice(this.fs.home.length) : this.cwd
    const color = this.remoteLabel ? C.yellow : C.green
    return `${C.bold}${color}${this.user}@${this.host}${C.reset}:${C.bold}${C.blue}${p}${C.reset}$ `
  }

  hasCommand(name: string) {
    const c = commands[name]
    return !!c && (!c.pkg || this.machine.packages.has(c.pkg))
  }

  commandNames() {
    return [...Object.keys(commands).filter((n) => this.hasCommand(n)), ...Object.keys(this.aliases)]
  }

  /** Completa o último token (comando ou caminho). */
  complete(line: string): { line: string; options: string[] } {
    const parts = line.split(' ')
    const last = parts[parts.length - 1]
    let options: string[]
    let prefix = last
    let base = ''
    if (parts.length === 1) options = this.commandNames().filter((c) => c.startsWith(last))
    else {
      const slash = last.lastIndexOf('/')
      base = slash >= 0 ? last.slice(0, slash + 1) : ''
      prefix = last.slice(slash + 1)
      const dirAbs = this.fs.resolve(this.cwd, base || '.')
      try {
        options = this.fs
          .list(dirAbs)
          .filter(([n]) => n.startsWith(prefix) && (prefix.startsWith('.') || !n.startsWith('.')))
          .map(([n, node]) => n + (node.type === 'dir' ? '/' : ''))
      } catch {
        options = []
      }
    }
    if (options.length === 1) {
      parts[parts.length - 1] = base + options[0] + (options[0].endsWith('/') ? '' : ' ')
      return { line: parts.join(' '), options: [] }
    }
    if (options.length > 1) {
      let common = options[0]
      for (const o of options) while (!o.startsWith(common)) common = common.slice(0, -1)
      if (common.length > prefix.length) parts[parts.length - 1] = base + common
      return { line: parts.join(' '), options }
    }
    return { line, options: [] }
  }

  /** Executa uma linha. O resultado pode trazer um prompt pendente ou uma troca de sessão. */
  execute(line: string): Result {
    const trimmed = line.trim()
    if (!trimmed) return ok()
    this.history.push(trimmed)

    let tokens: Token[]
    try {
      tokens = tokenize(trimmed, this.env)
    } catch (e) {
      return fail(`${C.red}bash: erro de sintaxe: ${(e as Error).message}${C.reset}`, 2)
    }

    const chains: Chain[] = []
    let cur: Token[] = []
    for (const tk of tokens) {
      if (tk.t === 'op' && (tk.v === ';' || tk.v === '&&' || tk.v === '||' || tk.v === '&')) {
        chains.push({ tokens: cur, op: tk.v })
        cur = []
      } else cur.push(tk)
    }
    if (cur.length) chains.push({ tokens: cur, op: null })

    const join = (...xs: string[]) => xs.filter(Boolean).join('\n')
    /** Pula o comando i (curto-circuito de && / ||) e segue no próximo separador que permita continuar. */
    const skip = (i: number, outs: string[], code: number, why: '&&' | '||'): Result => {
      let j = i
      while (j < chains.length && chains[j].op === why) j++
      return run(j + 1, outs, code)
    }
    const run = (i: number, outs: string[], lastCode: number): Result => {
      if (i >= chains.length) return { out: join(...outs), code: lastCode }
      if (i > 0 && chains[i - 1].op === '&&' && lastCode !== 0) return skip(i, outs, lastCode, '&&')
      if (i > 0 && chains[i - 1].op === '||' && lastCode === 0) return skip(i, outs, lastCode, '||')
      const r = this.runPipeline(chains[i].tokens, trimmed, chains[i].op === '&')
      if (r.session) return { ...r, out: join(...outs, r.out) }
      if (r.prompt) {
        const wrap = (p: Prompt): Prompt => ({
          ...p,
          answer: (input) => {
            const a = p.answer(input)
            if (a.prompt) return { ...a, prompt: wrap(a.prompt) }
            if (a.session) return a
            const rest = run(i + 1, [], a.code)
            return { ...rest, out: join(a.out, rest.out) }
          },
        })
        return { ...r, out: join(...outs, r.out), prompt: wrap(r.prompt) }
      }
      return run(i + 1, [...outs, r.out], r.code)
    }
    return run(0, [], 0)
  }

  private runPipeline(tokens: Token[], fullLine: string, background: boolean): Result {
    let redirect: { mode: '>' | '>>'; target: string } | null = null
    const ri = tokens.findIndex((t) => t.t === 'op' && (t.v === '>' || t.v === '>>'))
    if (ri >= 0) {
      const target = tokens[ri + 1]
      if (!target || target.t !== 'word') return fail(`${C.red}bash: erro de sintaxe perto de '${(tokens[ri] as Token).v}'${C.reset}`, 2)
      redirect = { mode: (tokens[ri] as { v: '>' | '>>' }).v, target: target.v }
      tokens = tokens.slice(0, ri)
    }

    const stages: string[][] = [[]]
    for (const tk of tokens) {
      if (tk.t === 'op' && tk.v === '|') stages.push([])
      else if (tk.t === 'word') stages[stages.length - 1].push(tk.v)
    }

    let stdin = ''
    let result: Result = ok()
    const events: CommandEvent[] = []
    for (let s = 0; s < stages.length; s++) {
      let words = stages[s]
      if (!words.length) return fail(`${C.red}bash: erro de sintaxe${C.reset}`, 2)
      const alias = this.aliases[words[0]]
      if (alias) words = [...alias.split(' '), ...words.slice(1)]
      let sudo = false
      let nohup = false
      while (words[0] === 'sudo' || words[0] === 'nohup') {
        if (words[0] === 'sudo') sudo = true
        else nohup = true
        words = words.slice(1)
      }
      const [name, ...args] = words
      if (!name) {
        result = fail(sudo ? 'uso: sudo <comando>' : 'uso: nohup <comando> &')
        continue
      }
      if (/^\w+=/.test(name) && !args.length) {
        const [k, ...v] = name.split('=')
        this.env[k] = v.join('=')
        result = ok()
        continue
      }
      if (name === 'export') {
        for (const a of args) {
          const [k, ...v] = a.split('=')
          if (v.length) this.env[k] = v.join('=')
        }
        result = ok()
        continue
      }
      const cmd = commands[name]
      if (!cmd || !this.hasCommand(name)) {
        const pkg = cmd?.pkg
        result =
          this.machine.os !== 'mac' && pkg
            ? fail(`Command '${name}' not found, but can be installed with:\n\nsudo apt install ${pkg === 'docker' ? 'docker.io' : pkg}`, 127)
            : fail(`${C.red}${name}: comando não encontrado${C.reset}${C.dim}  (digite 'help' para ver a lista)${C.reset}`, 127)
      } else {
        try {
          result = cmd.run(args, { sh: this, stdin, sudo, background, nohup })
        } catch (e) {
          if (e instanceof FsError) result = fail(`${C.red}${name}: ${args.filter((a) => !a.startsWith('-')).join(' ')}: ${e.message}${C.reset}`)
          else throw e
        }
      }
      if (result.prompt || result.session) {
        // comandos interativos: o evento sai quando o usuário terminar de responder
        return afterPrompts(result, (final) => {
          this.onCommand?.({ line: fullLine, name, args, code: final.code, cwd: this.cwd, host: this.host })
          return final
        })
      }
      events.push({ line: fullLine, name, args, code: result.code, cwd: this.cwd, host: this.host })
      stdin = result.out
    }

    if (redirect && result.code === 0) {
      try {
        this.fs.write(this.fs.resolve(this.cwd, redirect.target), result.out + '\n', redirect.mode === '>>')
        result = ok()
      } catch (e) {
        result = fail(`${C.red}bash: ${redirect.target}: ${(e as Error).message}${C.reset}`)
      }
    }
    if (background && result.code === 0 && !result.out.startsWith('[')) {
      this.jobs++
      result = { ...result, out: `[${this.jobs}] ${2000 + Math.floor(Math.random() * 7000)}${result.out ? '\n' + result.out : ''}` }
    }
    events.forEach((e) => this.onCommand?.(e))
    return result
  }
}

export function registerCommand(name: string, cmd: Cmd) {
  commands[name] = cmd
}

// ---------- progresso salvo ----------
export type MachineJSON = Omit<Machine, 'packages'> & { packages: string[] }
export const machineDump = (m: Machine): MachineJSON => ({ ...m, packages: [...m.packages] })
export const machineLoad = (d: MachineJSON): Machine => ({ ...d, packages: new Set(d.packages) })
/** Aplica os dados salvos sobre um objeto Machine existente (mantém a mesma referência). */
export function machineAssign(m: Machine, d: MachineJSON) {
  Object.assign(m, machineLoad(d))
}
