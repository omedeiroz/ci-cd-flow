// Progresso salvo: guarda o estado inteiro do simulador no navegador (localStorage)
// e restaura ao abrir. Sessões ssh e pipelines em andamento não sobrevivem ao recarregar.
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

const KEY = 'devops-lab:save:v1'
const VERSION = 1

type Save = {
  version: number
  savedAt: number
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
export const persist = {
  /** Data do último salvamento (para a interface). */
  lastSaved: 0 as number,
  error: '' as string,
  /** Chamado uma vez antes de renderizar. Devolve true se havia progresso salvo. */
  restore(): boolean {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return false
      const d = JSON.parse(raw) as Save
      if (d.version !== VERSION) return false
      apply(d)
      persist.lastSaved = d.savedAt
      return true
    } catch (e) {
      console.warn('Progresso salvo ignorado:', e)
      return false
    }
  },
  save() {
    if (disabled) return
    try {
      localStorage.setItem(KEY, JSON.stringify(snapshot()))
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
  /** Apaga tudo e recarrega a página. */
  reset() {
    disabled = true
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* sem acesso ao armazenamento */
    }
    location.reload()
  },
  start() {
    useOS.subscribe((s, prev) => {
      if (s.version !== prev.version || s.stepIdx !== prev.stepIdx || s.missionIdx !== prev.missionIdx || s.windows !== prev.windows || s.openWorld !== prev.openWorld) persist.schedule()
    })
    window.addEventListener('beforeunload', () => persist.save())
    window.addEventListener('pagehide', () => persist.save())
  },
}
