// Progresso salvo: guarda o estado inteiro do simulador no navegador (localStorage), em 3 slots.
// Sessões ssh e pipelines em andamento não sobrevivem ao recarregar.
import { vfsDump, type VfsJSON } from '../engine/fs'
import { machineAssign, machineDump, type MachineJSON } from '../engine/shell'
import { gitDump, gitLoad, type GitJSON } from '../engine/git'
import { githubDump, githubLoad } from '../engine/github'
import { mailDump, mailLoad } from '../engine/mail'
import { aws, awsDump, awsLoad } from '../engine/aws'
import { netDump, netLoad } from '../engine/node'
import { containerFsRef, containerFsResolve, dockerDump, dockerLoad } from '../engine/docker'
import { actionsDump, actionsLoad } from '../engine/actions'
import { editorDump, editorLoad } from '../engine/editor'
import { openWorld, openWorldDump, openWorldLoad } from '../engine/openworld'
import { github } from '../engine/github'
import { team, teamDump, teamLoad } from '../engine/team'
import { doneProjects, flags, localFs, localMachine, seen, shell, useOS, type AppId, type Win } from './os'
import type { VFS } from '../engine/fs'
import { missions } from '../engine/missions'

const LEGACY_KEY = 'devops-lab:save:v1'
const META_KEY = 'devops-lab:slots'
const ACTIVE_KEY = 'devops-lab:active'
const BOOT_KEY = 'devops-lab:boot'
const slotKey = (id: number) => `devops-lab:slot:${id}`
const VERSION = 1
export const SLOT_IDS = [1, 2, 3]
const FORMAT = 'devops-lab-save'

export type Profile = { name: string; avatar: number }
export type SlotMeta = {
  id: number
  profile: Profile
  missionIdx: number
  stepIdx: number
  missionDone: boolean
  openWorld: boolean
  pct: number
  playedMs: number
  savedAt: number
  created: number
}
/** Ação a executar logo depois de recarregar a página (trocar de save exige um motor limpo). */
export type Boot = { action: 'continue'; slot: number } | { action: 'new'; slot: number; profile: Profile; mission: number }

/** Porcentagem do tutorial concluída. */
export function progressOf(missionIdx: number, stepIdx: number, missionDone: boolean, openWorld: boolean) {
  if (openWorld) return 100
  const total = missions.reduce((n, m) => n + m.steps.length, 0)
  const done = missions.slice(0, missionIdx).reduce((n, m) => n + m.steps.length, 0) + (missionDone ? missions[missionIdx].steps.length : stepIdx)
  return Math.round((done / total) * 100)
}

const store = {
  get(k: string) {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set(k: string, v: string) {
    localStorage.setItem(k, v)
  },
  del(k: string) {
    try {
      localStorage.removeItem(k)
    } catch {
      /* sem acesso */
    }
  },
}

type Save = {
  version: number
  savedAt: number
  profile?: Profile
  playedMs?: number
  local: { fs: VfsJSON; machine: MachineJSON; git: GitJSON; shell: { cwd: string; history: string[]; env: Record<string, string> } }
  instancesGit: Record<string, GitJSON>
  github: ReturnType<typeof githubDump>
  mail: ReturnType<typeof mailDump>
  aws: ReturnType<typeof awsDump>
  net: ReturnType<typeof netDump>
  docker: ReturnType<typeof dockerDump>
  actions: ReturnType<typeof actionsDump>
  editor: ReturnType<typeof editorDump>
  openWorld: { started: boolean }
  team?: ReturnType<typeof teamDump>
  ui: {
    missionIdx: number
    stepIdx: number
    missionDone: boolean
    openWorld: boolean
    windows: Partial<Record<AppId, Win>>
    flags: typeof flags
    seen: string[]
    doneProjects: string[]
  }
}

function fsRef(fs: VFS): string | null {
  if (fs === localFs) return 'local'
  const inst = aws.instances().find((i) => i.fs === fs)
  if (inst) return `inst:${inst.id}`
  return containerFsRef(fs)
}
function fsResolve(ref: string): VFS | null {
  if (ref === 'local') return localFs
  if (ref.startsWith('inst:')) return aws.instances().find((i) => i.id === ref.slice(5))?.fs ?? null
  return containerFsResolve(ref)
}

function snapshot(): Save {
  const s = useOS.getState()
  return {
    version: VERSION,
    savedAt: Date.now(),
    profile: persist.profile ?? undefined,
    playedMs: playedNow(),
    local: { fs: vfsDump(localFs), machine: machineDump(localMachine), git: gitDump(localFs), shell: { cwd: shell.cwd, history: shell.history.slice(-200), env: shell.env } },
    instancesGit: Object.fromEntries(aws.instances().map((i) => [i.id, gitDump(i.fs)])),
    github: githubDump(),
    mail: mailDump(),
    aws: awsDump(),
    net: netDump(fsRef),
    docker: dockerDump(),
    actions: actionsDump(),
    editor: editorDump(),
    openWorld: openWorldDump(),
    team: teamDump(),
    ui: {
      missionIdx: s.missionIdx,
      stepIdx: s.stepIdx,
      missionDone: s.missionDone,
      openWorld: s.openWorld,
      windows: s.windows,
      flags: { ...flags },
      seen: [...seen],
      doneProjects: [...doneProjects],
    },
  }
}

function apply(d: Save) {
  localFs.root = d.local.fs.root
  machineAssign(localMachine, d.local.machine)
  gitLoad(localFs, d.local.git)
  shell.cwd = localFs.isDir(d.local.shell.cwd) ? d.local.shell.cwd : localFs.home
  shell.history = d.local.shell.history
  Object.assign(shell.env, d.local.shell.env)
  githubLoad(d.github)
  mailLoad(d.mail)
  awsLoad(d.aws)
  for (const i of aws.instances()) gitLoad(i.fs, d.instancesGit[i.id])
  dockerLoad(d.docker)
  netLoad(d.net, fsResolve)
  actionsLoad(d.actions)
  editorLoad(d.editor, localFs)
  openWorldLoad(d.openWorld)
  teamLoad(d.team)
  team.resume()
  const student = github.student()
  if (student) openWorld.ensureInvites(student)
  Object.assign(flags, d.ui.flags)
  d.ui.seen.forEach((x) => seen.add(x))
  d.ui.doneProjects.forEach((x) => doneProjects.add(x))
  // janelas: restaura posições, mas sem nada minimizado/maximizado fora da tela
  const vw = window.innerWidth
  const vh = window.innerHeight
  const windows = Object.fromEntries(
    Object.entries(d.ui.windows).map(([k, w]) => [k, { ...w!, x: Math.min(Math.max(0, w!.x), vw - 120), y: Math.min(Math.max(28, w!.y), vh - 120), w: Math.min(w!.w, vw), h: Math.min(w!.h, vh - 60) }]),
  )
  useOS.setState({
    missionIdx: d.ui.missionIdx,
    stepIdx: d.ui.stepIdx,
    missionDone: d.ui.missionDone,
    openWorld: d.ui.openWorld,
    windows,
    zTop: Math.max(10, ...Object.values(windows).map((w) => w.z)),
    cwd: shell.cwd,
    version: useOS.getState().version + 1,
  })
}

let disabled = false
let timer: ReturnType<typeof setTimeout> | null = null
let playedBase = 0
let sessionStart = Date.now()
let paused = false
const playedNow = () => playedBase + (paused ? 0 : Date.now() - sessionStart)

function readMeta(): Record<number, SlotMeta> {
  try {
    return JSON.parse(store.get(META_KEY) ?? '{}') as Record<number, SlotMeta>
  } catch {
    return {}
  }
}
function writeMeta(m: Record<number, SlotMeta>) {
  try {
    store.set(META_KEY, JSON.stringify(m))
  } catch {
    /* o save em si já avisa do erro */
  }
}
function metaOf(id: number, d: Save): SlotMeta {
  const ui = d.ui
  const prev = readMeta()[id]
  return {
    id,
    profile: d.profile ?? prev?.profile ?? { name: 'Aluno(a)', avatar: 7 },
    missionIdx: ui.missionIdx,
    stepIdx: ui.stepIdx,
    missionDone: ui.missionDone,
    openWorld: ui.openWorld,
    pct: progressOf(ui.missionIdx, ui.stepIdx, ui.missionDone, ui.openWorld),
    playedMs: d.playedMs ?? 0,
    savedAt: d.savedAt,
    created: prev?.created ?? d.savedAt,
  }
}
/** Lê e valida um save (de um slot ou de um arquivo importado). */
function parseSave(raw: string | null): Save | null {
  if (!raw) return null
  try {
    let d = JSON.parse(raw) as Save & { format?: string; save?: Save }
    if (d.format === FORMAT && d.save) d = d.save as Save & { format?: string }
    if (d.version !== VERSION || !d.local || !d.ui || !d.github) return null
    return d
  } catch {
    return null
  }
}

/** Saves antigos (um só, de antes dos slots) viram o slot 1. */
function migrateLegacy() {
  const raw = store.get(LEGACY_KEY)
  if (!raw) return
  const d = parseSave(raw)
  if (d && !store.get(slotKey(1))) {
    try {
      store.set(slotKey(1), raw)
      writeMeta({ ...readMeta(), 1: metaOf(1, d) })
      if (!store.get(ACTIVE_KEY)) store.set(ACTIVE_KEY, '1')
    } catch {
      return
    }
  }
  store.del(LEGACY_KEY)
}

export const persist = {
  /** Data do último salvamento (para a interface). */
  lastSaved: 0 as number,
  error: '' as string,
  /** Slot em jogo nesta página (null = ainda na tela inicial). */
  active: null as number | null,
  profile: null as Profile | null,
  /** O motor já recebeu um jogo nesta página? Trocar de jogo depois disso exige recarregar. */
  dirty: false,

  slots(): SlotMeta[] {
    migrateLegacy()
    const m = readMeta()
    return SLOT_IDS.map((id) => (store.get(slotKey(id)) ? m[id] : undefined)).filter((x): x is SlotMeta => !!x)
  },
  lastActive(): number | null {
    migrateLegacy()
    const id = Number(store.get(ACTIVE_KEY))
    return SLOT_IDS.includes(id) && store.get(slotKey(id)) ? id : null
  },

  /** Carrega um slot no motor. Devolve true se deu certo. */
  restore(id = persist.lastActive() ?? 1): boolean {
    migrateLegacy()
    const d = parseSave(store.get(slotKey(id)))
    if (!d) return false
    try {
      apply(d)
    } catch (e) {
      console.warn('Progresso salvo ignorado:', e)
      return false
    }
    persist.active = id
    persist.profile = d.profile ?? readMeta()[id]?.profile ?? null
    persist.dirty = true
    persist.lastSaved = d.savedAt
    playedBase = d.playedMs ?? 0
    sessionStart = Date.now()
    try {
      store.set(ACTIVE_KEY, String(id))
    } catch {
      /* sem acesso */
    }
    return true
  },
  /** Começa um jogo novo no slot (o motor precisa estar limpo). */
  newGame(id: number, profile: Profile) {
    persist.active = id
    persist.profile = profile
    persist.dirty = true
    playedBase = 0
    sessionStart = Date.now()
    const m = readMeta()
    delete m[id]
    writeMeta(m)
    try {
      store.set(ACTIVE_KEY, String(id))
    } catch {
      /* sem acesso */
    }
    persist.save()
  },
  save() {
    if (disabled || persist.active === null) return
    try {
      const d = snapshot()
      store.set(slotKey(persist.active), JSON.stringify(d))
      writeMeta({ ...readMeta(), [persist.active]: metaOf(persist.active, d) })
      persist.lastSaved = Date.now()
      persist.error = ''
    } catch (e) {
      persist.error = (e as Error).name === 'QuotaExceededError' ? 'Espaço do navegador cheio: o progresso não pôde ser salvo.' : 'Não foi possível salvar o progresso neste navegador.'
    }
  },
  /** Salva alguns instantes depois da última mudança (agrupa várias mudanças seguidas). */
  schedule() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => persist.save(), 700)
  },
  deleteSlot(id: number) {
    store.del(slotKey(id))
    const m = readMeta()
    delete m[id]
    writeMeta(m)
    if (store.get(ACTIVE_KEY) === String(id)) store.del(ACTIVE_KEY)
    if (persist.active === id) disabled = true // o jogo aberto não pode recriar o save apagado
  },
  /** Conteúdo do arquivo .json de exportação. */
  exportSlot(id: number): string | null {
    if (id === persist.active) persist.save()
    const d = parseSave(store.get(slotKey(id)))
    if (!d) return null
    return JSON.stringify({ format: FORMAT, exportedAt: new Date().toISOString(), meta: readMeta()[id], save: d })
  },
  importSave(text: string, id: number): string | null {
    const d = parseSave(text)
    if (!d) return 'Arquivo inválido: não é um save do DevOps Lab (ou é de uma versão incompatível).'
    try {
      store.set(slotKey(id), JSON.stringify(d))
      writeMeta({ ...readMeta(), [id]: { ...metaOf(id, d), created: Date.now() } })
    } catch {
      return 'Não há espaço no navegador para importar este save.'
    }
    return null
  },
  /** Agenda uma ação para depois de recarregar a página e recarrega. */
  boot(b: Boot) {
    persist.save()
    disabled = true
    try {
      sessionStorage.setItem(BOOT_KEY, JSON.stringify(b))
    } catch {
      /* sem sessionStorage: volta para a tela inicial */
    }
    location.reload()
  },
  takeBoot(): Boot | null {
    try {
      const raw = sessionStorage.getItem(BOOT_KEY)
      sessionStorage.removeItem(BOOT_KEY)
      return raw ? (JSON.parse(raw) as Boot) : null
    } catch {
      return null
    }
  },
  /** Volta para a tela inicial (salvando antes). */
  toMenu() {
    persist.save()
    playedBase = playedNow()
    paused = true
    useOS.setState({ screen: 'start' })
  },
  /** Volta ao jogo que já está carregado nesta página. */
  resume() {
    if (paused) sessionStart = Date.now()
    paused = false
    useOS.setState({ screen: 'desktop' })
  },
  start() {
    useOS.subscribe((s, prev) => {
      if (s.version !== prev.version || s.stepIdx !== prev.stepIdx || s.missionIdx !== prev.missionIdx || s.windows !== prev.windows || s.openWorld !== prev.openWorld) persist.schedule()
    })
    window.addEventListener('beforeunload', () => persist.save())
    window.addEventListener('pagehide', () => persist.save())
    // tempo de jogo: conta também em sessões longas sem mudanças
    setInterval(() => persist.active !== null && useOS.getState().screen === 'desktop' && persist.save(), 60_000)
  },
}
