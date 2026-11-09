// Node.js/npm simulados. Os testes e o módulo de tarefas são executados de verdade
// (num mini-loader CommonJS), então se o aluno quebrar o código, os testes falham.
import type { VFS } from './fs'
import { C, fail, ok, registerCommand } from './shell'

// ---------- serviços de rede (portas abertas) ----------

/** `via`: quem atende a porta (ex.: 'docker:todo' quando é um container). */
export type Service = { fs: VFS; root: string; name: string; startedAt: number; machineId: string; port: number; sessionId: number; persistent: boolean; via?: string }
/** Como alcançar uma máquina pelo IP público (fornecido pela "AWS"). */
export type PublicHost = { machineId: string; portOpen: (port: number) => boolean }
const services: Record<string, Service> = {}
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())
export const net = {
  get: (machineId: string, port: number) => services[`${machineId}:${port}`] as Service | undefined,
  start(s: Service) {
    services[`${s.machineId}:${s.port}`] = s
    changed()
  },
  stop(machineId: string, port: number) {
    delete services[`${machineId}:${port}`]
    changed()
  },
  /** Ao sair de uma sessão ssh, processos sem nohup recebem SIGHUP e morrem. */
  killSession(sessionId: number) {
    for (const [k, s] of Object.entries(services)) if (s.sessionId === sessionId && !s.persistent) delete services[k]
    changed()
  },
  resolvePublic: (_host: string): PublicHost | null => null,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

// ---------- mini loader CommonJS ----------

type TestCase = { name: string; fn: () => void }

class AssertionError extends Error {}
const fmt = (v: unknown) => JSON.stringify(v)
const assert = {
  ok: (v: unknown, m?: string) => {
    if (!v) throw new AssertionError(m ?? `esperado valor verdadeiro, recebido ${fmt(v)}`)
  },
  strictEqual: (a: unknown, b: unknown, m?: string) => {
    if (a !== b) throw new AssertionError(m ?? `esperado ${fmt(b)}, recebido ${fmt(a)}`)
  },
  equal: (a: unknown, b: unknown, m?: string) => {
    if (a != b) throw new AssertionError(m ?? `esperado ${fmt(b)}, recebido ${fmt(a)}`)
  },
  deepStrictEqual: (a: unknown, b: unknown, m?: string) => {
    if (fmt(a) !== fmt(b)) throw new AssertionError(m ?? `esperado ${fmt(b)}, recebido ${fmt(a)}`)
  },
  throws: (fn: () => void, m?: string) => {
    try {
      fn()
    } catch {
      return
    }
    throw new AssertionError(m ?? 'esperava que a função lançasse um erro')
  },
}

class ExitSignal {
  code: number
  constructor(code: number) {
    this.code = code
  }
}

/** Recursos que só existem a partir do Node 20: somem quando o código roda "em Node 18". */
const NODE20_ONLY: [object, string][] = [
  [Array.prototype, 'toSorted'],
  [Array.prototype, 'toReversed'],
  [Array.prototype, 'findLast'],
  [Object, 'groupBy'],
]
export function withNodeVersion<T>(node: string | undefined, fn: () => T): T {
  if (!node?.startsWith('v18')) return fn()
  const saved = NODE20_ONLY.map(([o, k]) => [o, k, Object.getOwnPropertyDescriptor(o, k)] as const)
  for (const [o, k] of NODE20_ONLY) delete (o as Record<string, unknown>)[k]
  try {
    return fn()
  } finally {
    for (const [o, k, d] of saved) if (d) Object.defineProperty(o, k, d)
  }
}

type LoadOpts = { tests?: TestCase[]; log?: string[]; env?: Record<string, string>; argv?: string[] }

function pathModule(fs: VFS, cwd: string) {
  const norm = (p: string) => fs.resolve('/', p)
  return {
    sep: '/',
    join: (...p: string[]) => p.join('/').replace(/\/+/g, '/').replace(/(?<!^)\/$/, '') || '.',
    resolve: (...p: string[]) => p.reduce((acc, x) => fs.resolve(acc, x), cwd),
    basename: (p: string, ext?: string) => {
      const b = p.split('/').filter(Boolean).pop() ?? ''
      return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b
    },
    dirname: (p: string) => p.split('/').slice(0, -1).join('/') || '/',
    extname: (p: string) => (p.match(/\.[^./]+$/) ?? [''])[0],
    normalize: norm,
  }
}

function fsModule(fs: VFS, cwd: string) {
  const r = (p: string) => fs.resolve(cwd, p)
  const enoent = (p: string) => Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: 'ENOENT' })
  return {
    readFileSync: (p: string) => {
      try {
        return fs.read(r(p))
      } catch {
        throw enoent(p)
      }
    },
    writeFileSync: (p: string, data: string) => fs.write(r(p), String(data)),
    existsSync: (p: string) => fs.exists(r(p)),
    readdirSync: (p: string) => {
      try {
        return fs.list(r(p)).map(([n]) => n)
      } catch {
        throw enoent(p)
      }
    },
    statSync: (p: string) => {
      const n = fs.get(r(p))
      if (!n) throw enoent(p)
      return { isDirectory: () => n.type === 'dir', isFile: () => n.type === 'file', size: n.type === 'file' ? n.content.length : 4096 }
    },
    mkdirSync: (p: string) => fs.mkdir(r(p), true),
  }
}

const show = (v: unknown) => (typeof v === 'string' ? v : v instanceof Error ? `${v.name}: ${v.message}` : JSON.stringify(v, null, 2))

function makeRequire(fs: VFS, root: string, testsOrOpts: TestCase[] | LoadOpts = {}) {
  const opts: LoadOpts = Array.isArray(testsOrOpts) ? { tests: testsOrOpts } : testsOrOpts
  const tests = opts.tests ?? []
  const log = opts.log ?? []
  const cache: Record<string, unknown> = {}
  const consoleObj = {
    log: (...a: unknown[]) => log.push(a.map(show).join(' ')),
    info: (...a: unknown[]) => log.push(a.map(show).join(' ')),
    warn: (...a: unknown[]) => log.push(a.map(show).join(' ')),
    error: (...a: unknown[]) => log.push(a.map(show).join(' ')),
    table: (x: unknown) => log.push(show(x)),
  }
  const processObj = {
    env: { ...(opts.env ?? {}) },
    argv: opts.argv ?? ['node'],
    cwd: () => root,
    exitCode: 0 as number | undefined,
    exit: (c = 0) => {
      throw new ExitSignal(c)
    },
    version: 'v20.15.0',
    platform: 'linux',
  }
  const load = (abs: string): unknown => {
    if (abs in cache) return cache[abs]
    const candidates = [abs, abs + '.js', abs + '.json', abs + '/index.js']
    const file = candidates.find((c) => fs.get(c)?.type === 'file')
    if (!file) throw new Error(`Cannot find module '${abs.replace(root + '/', './')}'`)
    if (file.endsWith('.json')) return (cache[abs] = JSON.parse(fs.read(file)))
    const module = { exports: {} as unknown }
    cache[abs] = module.exports
    const dir = file.split('/').slice(0, -1).join('/')
    const req = (raw: string) => {
      const id = raw.replace(/^node:/, '')
      if (id === 'test') return Object.assign((name: string, fn: () => void) => tests.push({ name, fn }), { test: (name: string, fn: () => void) => tests.push({ name, fn }), describe: (_: string, fn: () => void) => fn() })
      if (id === 'assert' || id === 'assert/strict') return Object.assign(assert.ok, assert)
      if (id === 'fs') return fsModule(fs, root)
      if (id === 'path') return pathModule(fs, root)
      if (raw.startsWith('.') || raw.startsWith('/')) return load(fs.resolve(dir, raw))
      if (fs.isDir(`${root}/node_modules/${id}`)) return {}
      throw new Error(`Cannot find module '${raw}'`)
    }
    new Function('require', 'module', 'exports', 'console', 'process', '__dirname', '__filename', fs.read(file))(req, module, module.exports, consoleObj, processObj, dir, file)
    cache[abs] = module.exports
    return module.exports
  }
  return Object.assign(load, { process: processObj })
}

/** Executa `node arquivo.js` de verdade (com fs, path, console e process simulados). */
export function runFile(fs: VFS, cwd: string, file: string, node?: string, env: Record<string, string> = {}, args: string[] = []): { out: string; code: number } {
  const log: string[] = []
  const abs = fs.resolve(cwd, file)
  if (!fs.get(abs)) return { out: `node:internal/modules/cjs/loader:1228\n  throw err;\n  ^\n\nError: Cannot find module '${abs}'`, code: 1 }
  const load = makeRequire(fs, cwd, { log, env, argv: ['node', abs, ...args] })
  try {
    withNodeVersion(node, () => load(abs))
    return { out: log.join('\n'), code: load.process.exitCode ?? 0 }
  } catch (e) {
    if (e instanceof ExitSignal) return { out: log.join('\n'), code: e.code }
    const err = e as Error
    return { out: [...log, `${abs}:1`, '', `${err.name}: ${err.message}`, `    at Object.<anonymous> (${abs})`, '', `Node.js ${node ?? 'v20.15.0'}`].join('\n'), code: 1 }
  }
}

export function runTests(fs: VFS, root: string, node?: string) {
  const lines: string[] = []
  let passed = 0
  let failed = 0
  const t0 = performance.now()
  const files = Object.keys(fs.walkFiles(`${root}/tests`)).filter((f) => f.endsWith('.test.js'))
  withNodeVersion(node, () => {
    for (const f of files) {
      const tests: TestCase[] = []
      try {
        makeRequire(fs, root, tests)(`${root}/tests/${f}`)
      } catch (e) {
        failed++
        lines.push(`${C.red}✖ tests/${f}: erro ao carregar: ${(e as Error).message}${C.reset}`)
        continue
      }
      for (const t of tests) {
        const s = performance.now()
        try {
          t.fn()
          passed++
          lines.push(`${C.green}✔${C.reset} ${t.name} ${C.dim}(${(performance.now() - s + 0.3).toFixed(2)}ms)${C.reset}`)
        } catch (e) {
          failed++
          const err = e as Error
          lines.push(`${C.red}✖ ${t.name}${C.reset}\n    ${C.red}${err instanceof TypeError ? 'TypeError: ' : ''}${err.message}${C.reset}`)
        }
      }
    }
  })
  const ms = (performance.now() - t0 + 18).toFixed(0)
  lines.push(
    '',
    `${C.cyan}ℹ${C.reset} testes ${passed + failed}`,
    `${C.cyan}ℹ${C.reset} ${C.green}aprovados ${passed}${C.reset}`,
    `${C.cyan}ℹ${C.reset} ${failed ? C.red : ''}falhas ${failed}${C.reset}`,
    `${C.cyan}ℹ${C.reset} duração ${ms}ms`,
  )
  return { passed, failed, total: passed + failed, output: lines.join('\n') }
}

/** Rotas JSON conhecidas dos apps do simulador (lidas do código real do projeto). */
export function apiRoute(svc: Service, path: string): string | undefined {
  try {
    if (path === '/todos' && svc.fs.exists(`${svc.root}/src/todos.js`)) return JSON.stringify(loadTodos(svc.fs, svc.root))
    if (path === '/products' && svc.fs.exists(`${svc.root}/src/catalog.js`)) return JSON.stringify(callExport(svc.fs, svc.root, 'src/catalog.js', 'listProducts'))
  } catch (e) {
    return `{"error":"${(e as Error).message}"}`
  }
  return undefined
}

export function loadModule(fs: VFS, root: string, rel: string): Record<string, unknown> {
  return makeRequire(fs, root, [])(`${root}/${rel}`) as Record<string, unknown>
}

/** Carrega um módulo do projeto e chama uma função exportada (usado pelo navegador e pelo curl). */
export function callExport<T>(fs: VFS, root: string, rel: string, fn: string): T {
  const mod = makeRequire(fs, root, [])(`${root}/${rel}`) as Record<string, () => T>
  return mod[fn]()
}

/** Executa src/todos.js e devolve a lista (usado pelo curl e pelo navegador). */
export function loadTodos(fs: VFS, root: string): { id: number; title: string; done: boolean }[] {
  return callExport(fs, root, 'src/todos.js', 'listTodos')
}

/** Descobre em que porta o servidor escuta: process.env.PORT || 3000 no arquivo de entrada. */
export function appPort(fs: VFS, root: string, env: Record<string, string> = {}): number {
  let entry = 'src/server.js'
  try {
    const pkg = JSON.parse(fs.read(`${root}/package.json`))
    const m = (pkg.scripts?.start ?? '').match(/node\s+(\S+)/)
    if (m) entry = m[1]
  } catch {
    /* sem package.json */
  }
  let src = ''
  try {
    src = fs.read(`${root}/${entry}`)
  } catch {
    return 3000
  }
  const m = src.match(/process\.env\.PORT\s*(?:\|\||\?\?)\s*(\d+)/)
  if (env.PORT) return Number(env.PORT)
  return m ? Number(m[1]) : Number((src.match(/listen\((\d+)/) ?? [])[1] ?? 3000)
}

// ---------- comandos ----------

function readPkg(fs: VFS, cwd: string) {
  try {
    return JSON.parse(fs.read(`${cwd}/package.json`)) as { name: string; version: string; scripts?: Record<string, string>; dependencies?: Record<string, string> }
  } catch {
    return null
  }
}
const NO_PKG = (cwd: string) =>
  fail(`${C.red}npm error code ENOENT\nnpm error path ${cwd}/package.json\nnpm error enoent Não foi possível ler o package.json${C.reset}\n${C.dim}Dica: entre na pasta do projeto (cd todo-api) antes de rodar o npm.${C.reset}`, 254)

registerCommand('npm', {
  pkg: 'npm',
  help: 'gerenciador de pacotes do Node (install, test, start)',
  run: (args, ctx) => {
    const { sh } = ctx
    const [cmd, ...rest] = args
    if (cmd === '-v' || cmd === '--version') return ok('10.8.2')
    if (!cmd) return ok('Uso: npm <comando>\n\nComandos: install, ci, test, start, run <script>')
    const pkg = readPkg(sh.fs, sh.cwd)
    if (!pkg) return NO_PKG(sh.cwd)
    const header = (s: string) => `\n> ${pkg.name}@${pkg.version} ${s}\n> ${pkg.scripts?.[s] ?? ''}\n`

    if (cmd === 'ci' && !sh.fs.exists(`${sh.cwd}/package-lock.json`))
      return fail(`${C.red}npm error code EUSAGE\nnpm error The \`npm ci\` command can only install with an existing package-lock.json${C.reset}`, 1)
    if (cmd === 'install' || cmd === 'i' || cmd === 'ci') {
      const deps = Object.keys(pkg.dependencies ?? {})
      const nm = `${sh.cwd}/node_modules`
      sh.fs.mkdir(nm, true)
      for (const d of [...deps, 'body-parser', 'accepts', 'cookie', 'debug', 'qs']) {
        sh.fs.mkdir(`${nm}/${d}`, true)
        sh.fs.write(`${nm}/${d}/package.json`, `{ "name": "${d}" }\n`)
      }
      return ok(`\nadded 64 packages, and audited 65 packages in 2s\n\n12 packages are looking for funding\n  run \`npm fund\` for details\n\nfound ${C.green}0${C.reset} vulnerabilities`)
    }

    const nodeV = nodeVersionOf(sh.machine)
    if ((cmd === 'test' || (cmd === 'run' && rest[0] === 'test')) && /^node --test/.test(pkg.scripts?.test ?? 'node --test')) {
      if (!pkg.scripts?.test) return fail('npm error Missing script: "test"')
      const r = runTests(sh.fs, sh.cwd, nodeV)
      return { out: header('test') + '\n' + r.output, code: r.failed ? 1 : 0 }
    }

    if (cmd === 'start' || (cmd === 'run' && rest[0] === 'start')) {
      const { background, nohup } = ctx
      if (!pkg.scripts?.start) return fail('npm error Missing script: "start"')
      for (const d of Object.keys(pkg.dependencies ?? {}))
        if (!sh.fs.isDir(`${sh.cwd}/node_modules/${d}`))
          return fail(`${header('start')}\n${C.red}Error: Cannot find module '${d}'${C.reset}\n${C.dim}Dica: as dependências não estão instaladas. Rode npm install primeiro.${C.reset}`)
      const port = appPort(sh.fs, sh.cwd, sh.env)
      const entry = (pkg.scripts.start.match(/node\s+(\S+)/) ?? [])[1]
      if (entry) {
        // carrega os módulos do projeto (sem o server.js, que dependeria do express) para pegar erros de sintaxe
        try {
          for (const f of Object.keys(sh.fs.walkFiles(`${sh.cwd}/src`)).filter((x) => x.endsWith('.js') && `src/${x}` !== entry))
            withNodeVersion(nodeV, () => loadModule(sh.fs, sh.cwd, `src/${f}`))
        } catch (e) {
          return fail(`${header('start')}\n${C.red}${(e as Error).name}: ${(e as Error).message}${C.reset}`)
        }
      }
      if (net.get(sh.machine.id, port))
        return fail(`${header('start')}\n${C.red}Error: listen EADDRINUSE: address already in use :::${port}${C.reset}\n${C.dim}Já existe um servidor nesta porta. Use "npm stop" para parar o anterior.${C.reset}`)
      const persistent = nohup && background
      net.start({ fs: sh.fs, root: sh.cwd, name: pkg.name, startedAt: Date.now(), machineId: sh.machine.id, port, sessionId: sh.sessionId, persistent })
      const log = `${header('start')}\nServidor rodando em http://localhost:${port}\n`
      if (nohup) {
        sh.fs.write(`${sh.cwd}/nohup.out`, log.replace(/\x1b\[[0-9;]*m/g, ''), true)
        return ok(`nohup: ignorando entrada e anexando saída a 'nohup.out'`)
      }
      if (background) return ok(log.trim() + `\n${C.dim}(rodando em segundo plano, mas preso a esta sessão: se ela fechar, o processo morre)${C.reset}`)
      return ok(
        `${log}${C.dim}(no simulador o terminal fica livre, mas o processo continua preso a esta sessão. Use "npm stop" para parar.)${C.reset}`,
      )
    }

    if (cmd === 'stop') {
      const port = appPort(sh.fs, sh.cwd, sh.env)
      const svc = net.get(sh.machine.id, port)
      if (svc?.via) return ok(`${C.dim}(a porta ${port} é de um container Docker (${svc.via.replace('docker:', '')}); npm stop não mexe nele. Use docker stop.)${C.reset}`)
      net.stop(sh.machine.id, port)
      return ok('Servidor parado.')
    }

    // npm run <script> (ou npm test com um comando diferente de node --test): roda o comando do package.json
    const script = cmd === 'run' || cmd === 'run-script' ? rest[0] : cmd === 'test' ? 'test' : null
    if (cmd === 'run' && !script)
      return ok(`Scripts disponíveis em ${pkg.name}@${pkg.version}:\n${Object.entries(pkg.scripts ?? {}).map(([k, v]) => `  ${k}\n    ${v}`).join('\n')}`)
    if (script) {
      const line = pkg.scripts?.[script]
      if (!line) return fail(`npm error Missing script: "${script}"\nnpm error\nnpm error To see a list of scripts, run:\nnpm error   npm run`, 1)
      const cwd = sh.cwd
      const r = sh.execute(line)
      sh.history.pop()
      sh.cwd = cwd
      return { out: `${header(script)}\n${r.out}`, code: r.code }
    }
    return fail(`npm error Comando desconhecido: "${cmd}"`)
  },
})

export const nodeVersionOf = (m: { nodeVersion?: string; os: string }) => m.nodeVersion ?? (m.os === 'mac' ? 'v20.15.0' : 'v18.19.1')

registerCommand('node', {
  pkg: 'nodejs',
  help: 'executa JavaScript: node arquivo.js (node -v mostra a versão)',
  run: (args, { sh }) => {
    if (args[0] === '-v' || args[0] === '--version') return ok(nodeVersionOf(sh.machine))
    if (!args.length) return fail('No simulador, o modo interativo do node não existe. Use: node arquivo.js')
    if (args[0] === '--test') {
      const r = runTests(sh.fs, sh.cwd, nodeVersionOf(sh.machine))
      return { out: r.output, code: r.failed ? 1 : 0 }
    }
    const pkgDir = (() => {
      let d = sh.cwd
      while (d !== '/' && !sh.fs.exists(`${d}/package.json`)) d = d.split('/').slice(0, -1).join('/') || '/'
      return sh.fs.exists(`${d}/package.json`) ? d : sh.cwd
    })()
    const entry = sh.fs.resolve(sh.cwd, args[0])
    if (/server\.js$/.test(entry)) return fail(`${C.dim}No simulador, suba o servidor com npm start.${C.reset}`)
    const r = runFile(sh.fs, pkgDir, entry, nodeVersionOf(sh.machine), sh.env, args.slice(1))
    return { out: r.out, code: r.code }
  },
})

registerCommand('curl', {
  pkg: 'curl',
  help: 'faz uma requisição HTTP: curl <url>',
  run: (args, { sh }) => {
    const url = args.find((a) => !a.startsWith('-'))
    if (!url) return fail('curl: tente "curl http://localhost:3000/health"')
    const m = url.match(/^(?:https?:\/\/)?([^/]+)(\/.*)?$/)
    const host = m?.[1] ?? ''
    const path = m?.[2] ?? '/'
    const [hostname, portStr] = host.split(':')
    const port = Number(portStr || 80)
    const pub = net.resolvePublic(hostname)
    if (hostname === 'localhost' || hostname === '127.0.0.1' || pub) {
      if (pub && pub.machineId !== sh.machine.id && !pub.portOpen(port))
        return fail(`curl: (28) Failed to connect to ${hostname} port ${port} after 75002 ms: Couldn't connect to server`, 28)
      const svc = net.get(pub?.machineId ?? sh.machine.id, port)
      if (!svc) return fail(`curl: (7) Failed to connect to ${hostname} port ${port}: Connection refused`, 7)
      if (path === '/health') return ok('{"status":"ok"}')
      const route = apiRoute(svc, path)
      if (route !== undefined) return ok(route)
      if (path === '/') return ok(`<!DOCTYPE html><html><head><title>${svc.name}</title></head>...`)
      return ok(`Cannot GET ${path}`)
    }
    if (host === 'github.sim') return ok('<!DOCTYPE html><html><head><title>GitHub</title></head>...')
    return fail(`curl: (6) Could not resolve host: ${host}`, 6)
  },
})

// ---------- progresso salvo ----------
/** `ref` identifica o sistema de arquivos de cada serviço (máquina local, instância, container). */
export function netDump(ref: (fs: VFS) => string | null) {
  return Object.values(services)
    .map((s) => ({ ...s, fs: ref(s.fs) }))
    .filter((s) => s.fs)
}
export function netLoad(list: ReturnType<typeof netDump>, resolve: (ref: string) => VFS | null) {
  for (const k of Object.keys(services)) delete services[k]
  for (const s of list) {
    const fs = resolve(s.fs!)
    if (fs) services[`${s.machineId}:${s.port}`] = { ...s, fs }
  }
}
