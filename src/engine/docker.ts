// Docker simulado: build com camadas e cache, containers, portas, logs, exec e registry (ghcr.sim).
import { dir, VFS, vfsDump, vfsLoad, type VfsJSON } from './fs'
import { C, fail, ok, registerCommand, Shell, type Machine, type Result } from './shell'
import { github, hashOf, type Tree } from './github'
import { appPort, net } from './node'

export type Image = {
  id: string
  repo: string // ex.: todo-api, ghcr.sim/devlab/todo-api, node
  tag: string
  created: number
  sizeMb: number
  files: Tree // caminhos absolutos sem a barra inicial (ex.: app/src/todos.js)
  workdir: string
  cmd: string[]
  deps: boolean // npm ci/install rodou na imagem
  base: string
}
export type Container = {
  id: string
  name: string
  image: Image
  imageRef: string
  status: 'running' | 'exited'
  exitCode: number
  created: number
  ports: { host: number; container: number }[]
  restart: string
  env: Record<string, string>
  fs: VFS
  logs: string[]
}
type State = { images: Image[]; containers: Container[]; logins: Record<string, { login: string; scopes: string[] }>; cache: Set<string> }

const states = new Map<string, State>()
const registry: Record<string, { tags: Record<string, Image>; updated: number; pushedBy: string }> = {}
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
const hex = (n: number) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
const NAMES = ['brave_turing', 'eager_hopper', 'quirky_lovelace', 'focused_curie', 'jolly_babbage', 'serene_noether', 'zen_ritchie']

const BASES: Record<string, { sizeMb: number; node?: string; cmd: string[] }> = {
  'node:20-alpine': { sizeMb: 135, node: 'v20.15.0', cmd: ['node'] },
  'node:20': { sizeMb: 1100, node: 'v20.15.0', cmd: ['node'] },
  'node:20-slim': { sizeMb: 200, node: 'v20.15.0', cmd: ['node'] },
  'node:18-alpine': { sizeMb: 127, node: 'v18.20.4', cmd: ['node'] },
  'node:22-alpine': { sizeMb: 155, node: 'v22.9.0', cmd: ['node'] },
  'alpine:3.20': { sizeMb: 7.8, cmd: ['/bin/sh'] },
  'ubuntu:24.04': { sizeMb: 78, cmd: ['/bin/bash'] },
  'nginx:latest': { sizeMb: 188, cmd: ['nginx', '-g', 'daemon off;'] },
}

export const docker = {
  state(machineId: string): State {
    let s = states.get(machineId)
    if (!s) states.set(machineId, (s = { images: [], containers: [], logins: {}, cache: new Set() }))
    return s
  },
  registry: () => registry,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

// ---------- referências de imagem ----------

function parseRef(ref: string) {
  let [name, tag] = ref.split(/:(?=[^/]*$)/)
  tag = tag ?? 'latest'
  const parts = name.split('/')
  const registry = parts.length > 1 && /[.:]/.test(parts[0]) ? parts[0] : 'docker.io'
  return { registry, name, tag, path: registry === 'docker.io' ? name : parts.slice(1).join('/') }
}
const shortId = (id: string) => id.slice(0, 12)
const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000)
  return s < 60 ? `${s} seconds ago` : s < 3600 ? `${Math.round(s / 60)} minutes ago` : `${Math.round(s / 3600)} hours ago`
}
const fmtSize = (mb: number) => (mb >= 1000 ? `${(mb / 1000).toFixed(2)}GB` : `${mb.toFixed(mb < 10 ? 1 : 0)}MB`)

function findImage(st: State, ref: string) {
  const r = parseRef(ref)
  return st.images.find((i) => (i.repo === r.name && i.tag === r.tag) || i.id.startsWith(ref))
}
function findContainer(st: State, key: string) {
  return st.containers.find((c) => c.name === key || c.id.startsWith(key))
}

// ---------- build ----------

/** Normaliza um caminho absoluto (resolve "." e ".."), sem barra final. */
function normPath(p: string) {
  const out: string[] = []
  for (const part of p.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return '/' + out.join('/')
}

function globToRe(p: string) {
  return new RegExp('^' + p.replace(/^\.\//, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\//g, '(.*/)?').replace(/\*/g, '[^/]*').replace(/\?/g, '.') + '(/.*)?$')
}

function build(sh: Shell, args: string[]): Result {
  const tags: string[] = []
  let file = 'Dockerfile'
  let ctxArg = ''
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-t' || args[i] === '--tag') tags.push(args[++i] ?? '')
    else if (args[i] === '-f' || args[i] === '--file') file = args[++i] ?? 'Dockerfile'
    else if (!args[i].startsWith('-')) ctxArg = args[i]
  }
  if (!ctxArg) return fail('ERROR: "docker buildx build" requires exactly 1 argument.\nUsage:  docker build [OPTIONS] PATH | URL | -\n\nDica: o ponto final em "docker build -t todo-api ." é o contexto (a pasta atual).', 1)
  const ctx = sh.fs.resolve(sh.cwd, ctxArg)
  if (!sh.fs.isDir(ctx)) return fail(`ERROR: unable to prepare context: path "${ctxArg}" not found`, 1)
  let dockerfile: string
  try {
    dockerfile = sh.fs.read(sh.fs.resolve(ctx, file))
  } catch {
    return fail(`ERROR: failed to solve: failed to read dockerfile: open ${file}: no such file or directory`, 1)
  }
  const st = docker.state(sh.machine.id)
  const t0 = performance.now()
  const out: string[] = []
  const line = (s: string, secs: number | 'CACHED') => out.push(` => ${secs === 'CACHED' ? `CACHED ${s}` : s.padEnd(60) + ` ${secs.toFixed(1)}s`}`)

  // .dockerignore
  let ignore: RegExp[] = []
  let ignoreFile = ''
  try {
    ignoreFile = sh.fs.read(`${ctx}/.dockerignore`)
    ignore = ignoreFile.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map(globToRe)
  } catch {
    /* sem .dockerignore */
  }
  const ctxFiles = sh.fs.walkFiles(ctx, (rel) => ignore.some((re) => re.test(rel)))
  let ctxMb = Object.values(ctxFiles).reduce((a, c) => a + c.length, 0) / 1e6
  if (Object.keys(ctxFiles).some((f) => f.startsWith('node_modules/'))) ctxMb += 45.3
  if (Object.keys(ctxFiles).some((f) => f.startsWith('.git/'))) ctxMb += 1.2

  // instruções
  const instr: { op: string; arg: string; line: number }[] = []
  const raw = dockerfile.split('\n')
  for (let i = 0; i < raw.length; i++) {
    let l = raw[i].trim()
    const n = i + 1
    if (!l || l.startsWith('#')) continue
    while (l.endsWith('\\') && i + 1 < raw.length) l = l.slice(0, -1) + ' ' + raw[++i].trim()
    const m = l.match(/^(\w+)\s+(.*)$/)
    if (!m) return fail(`ERROR: failed to solve: dockerfile parse error on line ${n}: unknown instruction: ${l}`, 1)
    const op = m[1].toUpperCase()
    if (!['FROM', 'WORKDIR', 'COPY', 'ADD', 'RUN', 'ENV', 'EXPOSE', 'CMD', 'ENTRYPOINT', 'USER', 'ARG', 'LABEL'].includes(op))
      return fail(`ERROR: failed to solve: dockerfile parse error on line ${n}: unknown instruction: ${m[1]}`, 1)
    instr.push({ op, arg: m[2], line: n })
  }
  if (instr[0]?.op !== 'FROM') return fail('ERROR: failed to solve: no build stage in current context (a primeira instrução precisa ser FROM)', 1)
  const base = instr[0].arg.split(/\s/)[0]
  const baseInfo = BASES[base.includes(':') ? base : `${base}:latest`]
  if (!baseInfo) return fail(`ERROR: failed to solve: ${base}: failed to resolve source metadata for docker.io/library/${base}: docker.io/library/${base}: not found`, 1)

  out.push('[+] Building', ' => [internal] load build definition from Dockerfile                    0.0s', ` => [internal] load metadata for docker.io/library/${base}                 1.2s`)
  out.push(` => [internal] load .dockerignore                                       0.0s`, ` => => transferring context: ${ignoreFile ? ignoreFile.length : 2}B`)
  const steps = instr.filter((x) => ['FROM', 'WORKDIR', 'COPY', 'ADD', 'RUN'].includes(x.op))
  let files: Tree = {}
  let workdir = '/'
  let cmd = baseInfo.cmd
  let deps = false
  let key = base
  let sizeMb = baseInfo.sizeMb
  let k = 0
  let ctxShown = false
  for (const ins of instr) {
    const label = `[${k + 1}/${steps.length}] ${ins.op} ${ins.arg}`
    if (ins.op === 'FROM') {
      line(`[1/${steps.length}] FROM docker.io/library/${base}`, st.cache.has(key) ? 'CACHED' : 3.4)
      st.cache.add(key)
      k++
      continue
    }
    if (ins.op === 'WORKDIR') {
      workdir = normPath(ins.arg.startsWith('/') ? ins.arg : `${workdir}/${ins.arg}`)
      key = hashOf(key + ins.arg)
      line(label, st.cache.has(key) ? 'CACHED' : 0.1)
      st.cache.add(key)
      k++
      continue
    }
    if (ins.op === 'COPY' || ins.op === 'ADD') {
      if (!ctxShown) {
        out.push(` => [internal] load build context                                       ${(ctxMb / 20 + 0.1).toFixed(1)}s`, ` => => transferring context: ${ctxMb >= 1 ? `${ctxMb.toFixed(2)}MB` : `${(ctxMb * 1000 + 1.3).toFixed(2)}kB`}`)
        ctxShown = true
      }
      const parts = ins.arg.split(/\s+/).filter((p) => !p.startsWith('--'))
      const dest = parts.pop()!
      const destAbs = normPath(dest.startsWith('/') ? dest : `${workdir}/${dest}`)
      const matched: Tree = {}
      for (const src of parts) {
        if (src === '.' || src === './') Object.assign(matched, ctxFiles)
        else {
          const re = globToRe(src)
          const hit = Object.keys(ctxFiles).filter((f) => re.test(f))
          if (!hit.length) return fail(`${out.join('\n')}\n ${C.red}=> ERROR ${label}${C.reset}\nERROR: failed to solve: failed to compute cache key: "/${src}": not found`, 1)
          for (const h of hit) matched[h] = ctxFiles[h]
        }
      }
      for (const [f, c] of Object.entries(matched)) files[`${destAbs}/${f}`.replace(/^\/+/, '')] = c
      if (Object.keys(matched).some((f) => f.startsWith('node_modules/'))) sizeMb += 45
      key = hashOf(key + ins.arg + JSON.stringify(Object.entries(matched).sort()))
      line(label, st.cache.has(key) ? 'CACHED' : 0.2 + Object.keys(matched).length / 100)
      st.cache.add(key)
      k++
      continue
    }
    if (ins.op === 'RUN') {
      key = hashOf(key + ins.arg)
      const cached = st.cache.has(key)
      if (/npm (ci|install|i)\b/.test(ins.arg)) {
        const has = (f: string) => `${workdir}/${f}`.replace(/^\/+/, '') in files
        if (!has('package.json') || (/npm ci/.test(ins.arg) && !has('package-lock.json'))) {
          return fail(
            `${out.join('\n')}\n ${C.red}=> ERROR ${label}${C.reset}\n------\n > ${label}:\nnpm error code EUSAGE\nnpm error The \`npm ci\` command can only install with an existing package-lock.json\n------\nERROR: failed to solve: process "/bin/sh -c ${ins.arg}" did not complete successfully: exit code: 1`,
            1,
          )
        }
        deps = true
        sizeMb += 6
      }
      line(label, cached ? 'CACHED' : /npm/.test(ins.arg) ? 7.8 : 1.1)
      st.cache.add(key)
      k++
      continue
    }
    if (ins.op === 'CMD' || ins.op === 'ENTRYPOINT') {
      try {
        cmd = ins.arg.trim().startsWith('[') ? JSON.parse(ins.arg) : ins.arg.split(/\s+/)
      } catch {
        return fail(`ERROR: failed to solve: dockerfile parse error on line ${ins.line}: CMD inválido (use ["npm", "start"])`, 1)
      }
    }
  }
  sizeMb += Object.values(files).reduce((a, c) => a + c.length, 0) / 1e6

  const img: Image = { id: hashOf(key + Date.now()).slice(0, 32) + hex(32), repo: '', tag: '', created: Date.now(), sizeMb, files, workdir, cmd, deps, base }
  out.push(' => exporting to image                                                   0.3s', ` => => writing image sha256:${img.id}`)
  if (!tags.length) st.images.unshift(img)
  for (const t of tags) {
    const r = parseRef(t)
    for (const old of st.images) if (old.repo === r.name && old.tag === r.tag) ((old.repo = '<none>'), (old.tag = '<none>'))
    st.images.unshift({ ...img, repo: r.name, tag: r.tag })
    out.push(` => => naming to ${r.registry === 'docker.io' ? 'docker.io/library/' : ''}${r.name}:${r.tag}`)
  }
  out[0] = `[+] Building ${((performance.now() - t0) / 1000 + 4.2).toFixed(1)}s (${steps.length + 4}/${steps.length + 4}) FINISHED`
  emit()
  // alinha a coluna de tempos, como o BuildKit
  return ok(out.map((l) => l.replace(/^( => .*?)\s+(\d+\.\ds)$/, (_, txt: string, t: string) => `${txt.padEnd(62)} ${t.padStart(5)}`)).join('\n'))
}

// ---------- containers ----------

function startContainer(machine: Machine, c: Container): string | null {
  for (const p of c.ports) {
    const busy = net.get(machine.id, p.host)
    if (busy && busy.via !== `docker:${c.name}`)
      return `docker: Error response from daemon: driver failed programming external connectivity on endpoint ${c.name} (${hex(64)}): Bind for 0.0.0.0:${p.host} failed: port is already allocated.`
  }
  const app = c.image.workdir.replace(/^\//, '')
  const runsNpm = c.image.cmd.join(' ') === 'npm start'
  c.logs = []
  if (!runsNpm) {
    c.status = 'exited'
    c.exitCode = 0
    return null
  }
  if (!c.fs.exists(`/${app}/package.json`)) {
    c.logs.push('npm error code ENOENT', `npm error path /${app}/package.json`, 'npm error enoent Could not read package.json')
    c.status = 'exited'
    c.exitCode = 254
    return null
  }
  let pkg = { name: 'app', version: '1.0.0', scripts: { start: '' } }
  try {
    pkg = JSON.parse(c.fs.read(`/${app}/package.json`))
  } catch {
    /* sem package.json */
  }
  c.logs.push('', `> ${pkg.name}@${pkg.version} start`, `> ${pkg.scripts?.start ?? ''}`, '')
  if (!c.image.deps) {
    c.logs.push("node:internal/modules/cjs/loader:1228", "  throw err;", "  ^", "", "Error: Cannot find module 'express'", "Require stack:", `- /${app}/src/server.js`)
    c.status = 'exited'
    c.exitCode = 1
    return null
  }
  const port = appPort(c.fs, `/${app}`, c.env)
  c.logs.push(`Servidor rodando em http://localhost:${port}`)
  c.status = 'running'
  c.exitCode = 0
  for (const p of c.ports)
    if (p.container === port)
      net.start({ fs: c.fs, root: `/${app}`, name: pkg.name, startedAt: Date.now(), machineId: machine.id, port: p.host, sessionId: -1, persistent: true, via: `docker:${c.name}` })
  return null
}

function stopContainer(machine: Machine, c: Container) {
  for (const p of c.ports) if (net.get(machine.id, p.host)?.via === `docker:${c.name}`) net.stop(machine.id, p.host)
  if (c.status === 'running') c.logs.push('npm error signal SIGTERM')
  c.status = 'exited'
  c.exitCode = 143
}

function containerFs(img: Image) {
  const v = new VFS(dir({ app: dir(), tmp: dir(), root: dir(), bin: dir(), etc: dir() }), '/root')
  for (const [p, content] of Object.entries(img.files)) {
    v.mkdir('/' + p.split('/').slice(0, -1).join('/'), true)
    v.write('/' + p, content)
  }
  if (img.deps) {
    const app = img.workdir.replace(/\/$/, '')
    for (const d of ['express', 'body-parser', 'accepts']) {
      v.mkdir(`${app}/node_modules/${d}`, true)
      v.write(`${app}/node_modules/${d}/package.json`, `{ "name": "${d}" }\n`)
    }
  }
  return v
}

/** Baixa uma imagem do registry (ou uma imagem base pública). */
function pull(st: State, ref: string, out: string[]): Image | string {
  const r = parseRef(ref)
  if (r.registry === 'ghcr.sim') {
    const pkg = registry[r.path]
    const img = pkg?.tags[r.tag]
    if (!img) return `Error response from daemon: manifest unknown${pkg ? `: tag "${r.tag}" não existe` : ''} (ghcr.sim/${r.path}:${r.tag})`
    out.push(`${r.tag}: Pulling from ${r.path}`, ...['43c4264eed91', 'a1d2e0b5f8c3', '7f3c1b2a9d44', '0e5a6b7c8d9f'].map((l) => `${l}: Pull complete`), `Digest: sha256:${hashOf(img.id)}`, `Status: Downloaded newer image for ${r.name}:${r.tag}`)
    const copy = { ...img, repo: r.name, tag: r.tag, created: img.created }
    st.images = st.images.filter((i) => !(i.repo === r.name && i.tag === r.tag))
    st.images.unshift(copy)
    return copy
  }
  const baseKey = r.name.includes(':') ? r.name : `${r.name}:${r.tag}`
  const info = BASES[baseKey]
  if (!info) return `Error response from daemon: pull access denied for ${r.name}, repository does not exist or may require 'docker login'`
  out.push(`${r.tag}: Pulling from library/${r.name}`, '43c4264eed91: Pull complete', `Status: Downloaded newer image for ${r.name}:${r.tag}`)
  const img: Image = { id: hashOf(baseKey) + hex(24), repo: r.name, tag: r.tag, created: Date.now() - 86400000 * 9, sizeMb: info.sizeMb, files: {}, workdir: '/', cmd: info.cmd, deps: false, base: baseKey }
  st.images.unshift(img)
  return img
}

function table(rows: string[][]) {
  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)) + 3)
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i]))).join('')).join('\n')
}

// ---------- comando docker ----------

const DENIED =
  'permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: Get "http://%2Fvar%2Frun%2Fdocker.sock/v1.24/containers/json": dial unix /var/run/docker.sock: connect: permission denied'

registerCommand('docker', {
  pkg: 'docker',
  help: 'containers: build, run, ps, logs, exec, stop, rm, images, tag, push, pull, login',
  run: (args, { sh, sudo, stdin }) => {
    const [cmd, ...rest] = args
    const m = sh.machine
    if (cmd === '--version' || cmd === '-v') return ok('Docker version 27.3.1, build ce12230')
    if (!cmd || cmd === '--help' || cmd === 'help')
      return ok(
        'Uso: docker COMMAND\n\nComandos comuns:\n  build    Cria uma imagem a partir de um Dockerfile\n  run      Cria e inicia um container\n  ps       Lista containers\n  logs     Mostra os logs de um container\n  exec     Executa um comando num container\n  stop     Para um container\n  rm       Remove um container\n  images   Lista imagens\n  tag      Cria um novo nome para uma imagem\n  login    Entra num registry\n  push     Envia uma imagem para o registry\n  pull     Baixa uma imagem do registry',
      )
    const allowed = m.os === 'mac' || sudo || sh.user === 'root' || sh.groups.includes('docker')
    if (!allowed)
      return fail(`${DENIED}\n${C.dim}Dica: seu usuário não está no grupo "docker". Use sudo, ou adicione com sudo usermod -aG docker $USER e entre de novo (exit + ssh).${C.reset}`, 1)
    const st = docker.state(m.id)
    const flagVal = (names: string[]) => {
      const i = rest.findIndex((a) => names.includes(a))
      return i >= 0 ? rest[i + 1] : undefined
    }

    switch (cmd) {
      case 'build':
        return build(sh, rest)

      case 'images': {
        const rows = [['REPOSITORY', 'TAG', 'IMAGE ID', 'CREATED', 'SIZE']]
        for (const i of st.images) rows.push([i.repo || '<none>', i.tag || '<none>', shortId(i.id), ago(i.created), fmtSize(i.sizeMb)])
        return ok(table(rows))
      }

      case 'run': {
        let detach = false
        let name = ''
        let restart = 'no'
        const env: Record<string, string> = {}
        const ports: { host: number; container: number }[] = []
        let ref = ''
        for (let i = 0; i < rest.length; i++) {
          const a = rest[i]
          if (a === '-d' || a === '--detach') detach = true
          else if (a === '-it' || a === '-i' || a === '-t' || a === '--rm') continue
          else if (a === '--name') name = rest[++i]
          else if (a === '--restart') restart = rest[++i]
          else if (a.startsWith('--restart=')) restart = a.split('=')[1]
          else if (a === '-p' || a === '--publish') {
            const [h, c] = (rest[++i] ?? '').split(':').map(Number)
            if (!h || !c) return fail(`docker: invalid publish spec "${rest[i]}" (use -p PORTA_DO_HOST:PORTA_DO_CONTAINER, ex: -p 3000:3000)`, 125)
            ports.push({ host: h, container: c })
          } else if (a === '-e' || a === '--env') {
            const [k, ...v] = (rest[++i] ?? '').split('=')
            if (k) env[k] = v.join('=')
          }
          else if (!a.startsWith('-')) {
            ref = a
            break
          }
        }
        if (!ref) return fail('"docker run" requires at least 1 argument.\nUsage:  docker run [OPTIONS] IMAGE [COMMAND] [ARG...]', 125)
        if (name && st.containers.some((c) => c.name === name)) {
          const other = st.containers.find((c) => c.name === name)!
          return fail(`docker: Error response from daemon: Conflict. The container name "/${name}" is already in use by container "${other.id}". You have to remove (or rename) that container to be able to reuse that name.`, 125)
        }
        const pre: string[] = []
        let img = findImage(st, ref)
        if (!img) {
          pre.push(`Unable to find image '${ref.includes(':') ? ref : ref + ':latest'}' locally`)
          const r = pull(st, ref, pre)
          if (typeof r === 'string') return fail(`${pre.join('\n')}\ndocker: ${r}.`, 125)
          img = r
        }
        const c: Container = {
          id: hex(64),
          name: name || NAMES[st.containers.length % NAMES.length],
          image: img,
          imageRef: ref,
          status: 'exited',
          exitCode: 0,
          created: Date.now(),
          ports,
          restart,
          env,
          fs: containerFs(img),
          logs: [],
        }
        const err = startContainer(m, c)
        if (err) return fail(`${pre.join('\n')}${pre.length ? '\n' : ''}${c.id}\n${err}`, 125)
        st.containers.unshift(c)
        emit()
        const head = pre.length ? pre.join('\n') + '\n' : ''
        if (detach) return ok(head + c.id)
        return ok(`${head}${c.logs.join('\n')}${c.status === 'running' ? `\n${C.dim}(no simulador o terminal fica livre; o container segue rodando. Use docker stop ${c.name})${C.reset}` : ''}`)
      }

      case 'ps': {
        const all = rest.includes('-a') || rest.includes('--all')
        const rows = [['CONTAINER ID', 'IMAGE', 'COMMAND', 'CREATED', 'STATUS', 'PORTS', 'NAMES']]
        for (const c of st.containers.filter((x) => all || x.status === 'running'))
          rows.push([
            shortId(c.id),
            c.imageRef,
            `"${c.image.cmd.join(' ').slice(0, 18)}"`,
            ago(c.created),
            c.status === 'running' ? `Up ${ago(c.created).replace(' ago', '')}` : `Exited (${c.exitCode}) ${ago(c.created)}`,
            c.status === 'running' ? c.ports.map((p) => `0.0.0.0:${p.host}->${p.container}/tcp`).join(', ') : '',
            c.name,
          ])
        return ok(table(rows))
      }

      case 'logs': {
        const c = findContainer(st, rest.filter((a) => !a.startsWith('-'))[0] ?? '')
        if (!c) return fail(`Error response from daemon: No such container: ${rest[0] ?? ''}`, 1)
        return ok(c.logs.join('\n'))
      }

      case 'stop':
      case 'start':
      case 'restart': {
        const outs: string[] = []
        for (const key of rest.filter((a) => !a.startsWith('-'))) {
          const c = findContainer(st, key)
          if (!c) return fail(`Error response from daemon: No such container: ${key}`, 1)
          if (cmd !== 'start') stopContainer(m, c)
          if (cmd !== 'stop') {
            const err = startContainer(m, c)
            if (err) return fail(err, 1)
          }
          outs.push(key)
        }
        emit()
        return ok(outs.join('\n'))
      }

      case 'rm': {
        const force = rest.includes('-f') || rest.includes('--force')
        const outs: string[] = []
        for (const key of rest.filter((a) => !a.startsWith('-'))) {
          const c = findContainer(st, key)
          if (!c) return fail(`Error response from daemon: No such container: ${key}`, 1)
          if (c.status === 'running' && !force)
            return fail(`Error response from daemon: cannot remove container "/${c.name}": container is running: stop the container before removing or force remove`, 1)
          stopContainer(m, c)
          st.containers = st.containers.filter((x) => x !== c)
          outs.push(key)
        }
        emit()
        return ok(outs.join('\n'))
      }

      case 'rmi': {
        const img = findImage(st, rest[0] ?? '')
        if (!img) return fail(`Error response from daemon: No such image: ${rest[0] ?? ''}`, 1)
        const user = st.containers.find((c) => c.image === img)
        if (user) return fail(`Error response from daemon: conflict: unable to remove repository reference "${rest[0]}" (must force) - container ${shortId(user.id)} is using its referenced image ${shortId(img.id)}`, 1)
        st.images = st.images.filter((i) => i !== img)
        emit()
        return ok(`Untagged: ${img.repo}:${img.tag}\nDeleted: sha256:${img.id}`)
      }

      case 'exec': {
        const it = rest.some((a) => /^-[it]+$/.test(a))
        const words = rest.filter((a) => !/^-[it]+$/.test(a))
        const [key, ...command] = words
        const c = findContainer(st, key ?? '')
        if (!c) return fail(`Error response from daemon: No such container: ${key ?? ''}`, 1)
        if (c.status !== 'running') return fail(`Error response from daemon: container ${c.id} is not running`, 1)
        if (!command.length) return fail('"docker exec" requires at least 2 arguments.', 1)
        const alpine = c.image.base.includes('alpine')
        if (command[0] === 'bash' && alpine) return fail('OCI runtime exec failed: exec failed: unable to start container process: exec: "bash": executable file not found in $PATH: unknown', 126)
        const machine: Machine = { id: `ctr-${c.id.slice(0, 8)}`, os: 'ubuntu', packages: new Set(['nodejs', 'npm']), aptUpdated: false, nodeVersion: BASES[c.image.base]?.node }
        const inner = new Shell(c.fs, 'root', shortId(c.id), machine)
        inner.isContainer = true
        inner.remoteLabel = c.name
        inner.cwd = c.image.workdir
        if (command[0] === 'sh' || command[0] === 'bash' || command[0] === '/bin/sh') {
          if (!it) return ok()
          return { out: '', code: 0, session: { push: inner } }
        }
        return inner.execute(command.join(' '))
      }

      case 'tag': {
        const [src, dst] = rest
        const img = src ? findImage(st, src) : undefined
        if (!img || !dst) return fail(`Error response from daemon: No such image: ${src ?? ''}`, 1)
        const r = parseRef(dst)
        st.images = st.images.filter((i) => !(i.repo === r.name && i.tag === r.tag))
        st.images.unshift({ ...img, repo: r.name, tag: r.tag })
        emit()
        return ok()
      }

      case 'login': {
        const reg = rest.find((a, i) => !a.startsWith('-') && !['-u', '--username', '-p', '--password'].includes(rest[i - 1])) ?? 'docker.io'
        if (reg !== 'ghcr.sim') return fail(`Error response from daemon: Get "https://${reg}/v2/": no simulador, use o registry do GitHub: docker login ghcr.sim`, 1)
        const attempt = (login: string, secret: string, warn: boolean): Result => {
          const a = github.authenticate(login.trim(), secret.trim())
          const pre = warn ? 'WARNING! Using --password via the CLI is insecure. Use --password-stdin.\n' : ''
          if ('error' in a) return fail(`${pre}Error response from daemon: Get "https://ghcr.sim/v2/": denied: denied${a.error === 'password' ? `\n${C.dim}Dica: use um personal access token (com escopo write:packages), não a senha da conta.${C.reset}` : ''}`, 1)
          st.logins[reg] = { login: a.user.login, scopes: a.scopes }
          emit()
          return ok(`${pre}Login Succeeded`)
        }
        const u = flagVal(['-u', '--username'])
        if (rest.includes('--password-stdin')) {
          if (!u) return fail('Error: Cannot perform an interactive login from a non TTY device (use -u)', 1)
          return attempt(u, stdin, false)
        }
        const p = flagVal(['-p', '--password'])
        if (u && p) return attempt(u, p, true)
        const askPass = (login: string): Result => ({ out: '', code: 0, prompt: { text: 'Password: ', hidden: true, answer: (pw) => attempt(login, pw, false) } })
        if (u) return askPass(u)
        return { out: '', code: 0, prompt: { text: 'Username: ', answer: (login) => askPass(login) } }
      }

      case 'logout': {
        delete st.logins[rest[0] ?? 'ghcr.sim']
        return ok(`Removing login credentials for ${rest[0] ?? 'ghcr.sim'}`)
      }

      case 'push': {
        const ref = rest.find((a) => !a.startsWith('-'))
        if (!ref) return fail('"docker push" requires exactly 1 argument.', 1)
        const img = findImage(st, ref)
        const r = parseRef(ref)
        if (!img) return fail(`An image does not exist locally with the tag: ${r.name}`, 1)
        if (r.registry !== 'ghcr.sim')
          return fail(`The push refers to repository [docker.io/library/${r.name}]\ndenied: requested access to the resource is denied\n${C.dim}Dica: para publicar no GitHub, a imagem precisa se chamar ghcr.sim/<dono>/<nome>. Use docker tag primeiro.${C.reset}`, 1)
        const owner = r.path.split('/')[0]
        const repoKey = r.path.split('/').slice(0, 2).join('/')
        const login = st.logins['ghcr.sim']
        const head = `The push refers to repository [${r.name}]`
        if (!login) return fail(`${head}\nunauthorized: unauthenticated: User cannot be authenticated with the token provided.\n${C.dim}Dica: faça docker login ghcr.sim antes.${C.reset}`, 1)
        if (!login.scopes.includes('write:packages'))
          return fail(`${head}\ndenied: permission_denied: The token provided does not match expected scopes.\n${C.dim}Dica: o token precisa do escopo write:packages. No GitHub Actions, isso é o bloco "permissions: packages: write" no job.${C.reset}`, 1)
        if (owner !== login.login && !github.isCollaborator(login.login, repoKey))
          return fail(`${head}\ndenied: permission_denied: write_package`, 1)
        const layers = ['5f70bf18a086', 'c3a1e9d2b4f7', '8d4e2f1a6b3c', 'e7b9c5d1a2f4', '1a2b3c4d5e6f']
        const known = registry[r.path]?.tags
        const existing = new Set(Object.values(known ?? {}).map((i) => i.id))
        registry[r.path] = { tags: { ...(known ?? {}), [r.tag]: img }, updated: Date.now(), pushedBy: login.login }
        emit()
        return ok(
          [head, ...layers.map((l, i) => `${l}: ${existing.has(img.id) || i < 2 ? (i < 2 ? 'Mounted from library/node' : 'Layer already exists') : 'Pushed'}`), `${r.tag}: digest: sha256:${hashOf(img.id + r.tag)}${hex(24)} size: 1789`].join('\n'),
        )
      }

      case 'pull': {
        const ref = rest.find((a) => !a.startsWith('-'))
        if (!ref) return fail('"docker pull" requires exactly 1 argument.', 1)
        const out: string[] = []
        const r = pull(st, ref, out)
        if (typeof r === 'string') return fail(r, 1)
        emit()
        return ok([...out, ref.includes(':') ? ref : `${ref}:latest`].join('\n'))
      }

      case 'info':
        return ok(`Client:\n Version:    27.3.1\n Context:    default\n\nServer:\n Containers: ${st.containers.length}\n  Running: ${st.containers.filter((c) => c.status === 'running').length}\n Images: ${st.images.length}\n Server Version: 27.3.1\n Operating System: ${m.os === 'mac' ? 'Docker Desktop' : 'Ubuntu 24.04.1 LTS'}`)
    }
    return fail(`docker: '${cmd}' is not a docker command (ou ainda não existe no simulador).\nSee 'docker --help'`, 1)
  },
})

// ---------- progresso salvo ----------
type ContainerJSON = Omit<Container, 'fs'> & { fs: VfsJSON }
export function dockerDump() {
  return {
    states: [...states.entries()].map(([id, st]) => ({
      id,
      images: st.images,
      containers: st.containers.map((c): ContainerJSON => ({ ...c, fs: vfsDump(c.fs) })),
      logins: st.logins,
      cache: [...st.cache],
    })),
    registry,
  }
}
export function dockerLoad(d: ReturnType<typeof dockerDump>) {
  states.clear()
  for (const s of d.states)
    states.set(s.id, { images: s.images, containers: s.containers.map((c) => ({ ...c, fs: vfsLoad(c.fs) })), logins: s.logins, cache: new Set(s.cache) })
  for (const k of Object.keys(registry)) delete registry[k]
  Object.assign(registry, d.registry)
}
/** Para o progresso salvo: o sistema de arquivos de um container. */
export function containerFsRef(fs: VFS): string | null {
  for (const [mid, st] of states) for (const c of st.containers) if (c.fs === fs) return `ctr:${mid}:${c.id}`
  return null
}
export function containerFsResolve(ref: string): VFS | null {
  const [, mid, cid] = ref.split(':')
  return states.get(mid)?.containers.find((c) => c.id === cid)?.fs ?? null
}
