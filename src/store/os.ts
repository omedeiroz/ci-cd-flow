import { create } from 'zustand'
import { createLocalFs } from '../engine/fs'
import { Shell, type CommandEvent, type Machine } from '../engine/shell'
import { missions, type HintCtx, type SimEvent } from '../engine/missions'
import { github } from '../engine/github'
import { net } from '../engine/node'
import { team } from '../engine/team'
import { mail } from '../engine/mail'
import { aws, STAGING_NAME } from '../engine/aws'
import { actions } from '../engine/actions'
import { editor } from '../engine/editor'
import { prepareMission, provisionStaging } from '../engine/bootstrap'
import { docker } from '../engine/docker'
import { openWorld, PROJECTS } from '../engine/openworld'

// ---------- Engine (singletons) ----------
export const localFs = createLocalFs()
export const localMachine: Machine = { id: 'local', os: 'mac', packages: new Set(['git', 'nodejs', 'npm', 'curl', 'docker']), aptUpdated: false }
export const shell = new Shell(localFs, 'dev', 'devops-lab', localMachine)

/** Pilha de sessões do Terminal: [máquina local, servidor via ssh...] */
const sessions: Shell[] = [shell]
export const currentShell = () => sessions[sessions.length - 1]

// ---------- Apps ----------
export type AppId = 'finder' | 'terminal' | 'guide' | 'mail' | 'editor' | 'browser' | 'github' | 'cloud'

/** unlockAt = índice da missão que libera o app. */
export type AppMeta = { id: AppId; name: string; unlockAt?: number; size: { w: number; h: number } }

export const APPS: AppMeta[] = [
  { id: 'finder', name: 'Finder', size: { w: 720, h: 440 } },
  { id: 'terminal', name: 'Terminal', size: { w: 760, h: 460 } },
  { id: 'guide', name: 'Guia', size: { w: 400, h: 640 } },
  { id: 'mail', name: 'Mail', unlockAt: 1, size: { w: 900, h: 560 } },
  { id: 'editor', name: 'Editor', unlockAt: 3, size: { w: 1060, h: 660 } },
  { id: 'browser', name: 'Navegador', unlockAt: 1, size: { w: 1000, h: 660 } },
  { id: 'github', name: 'GitHub', unlockAt: 1, size: { w: 1000, h: 660 } },
  { id: 'cloud', name: 'Console AWS', unlockAt: 2, size: { w: 1000, h: 660 } },
]

export const lockReason = (app: AppMeta, missionIdx: number) =>
  app.unlockAt !== undefined && missionIdx < app.unlockAt ? `Liberado na Missão ${app.unlockAt + 1}` : null

export type Win = {
  open: boolean
  minimized: boolean
  maximized: boolean
  z: number
  x: number
  y: number
  w: number
  h: number
}

type OS = {
  windows: Partial<Record<AppId, Win>>
  focused: AppId | null
  zTop: number
  version: number // muda sempre que fs, GitHub, AWS, mail ou rede mudam
  cwd: string
  depth: number // sessões ssh abertas
  // tutorial
  missionIdx: number
  stepIdx: number
  missionDone: boolean
  openWorld: boolean
  flash: string | null
  typeRequest: { text: string; n: number } | null
  // navegador
  browserNav: { url: string; newTab: boolean; n: number }
  // ações
  openApp: (id: AppId) => void
  closeApp: (id: AppId) => void
  minimize: (id: AppId) => void
  toggleMax: (id: AppId) => void
  focus: (id: AppId) => void
  setRect: (id: AppId, r: Partial<Pick<Win, 'x' | 'y' | 'w' | 'h'>>) => void
  typeInTerminal: (text: string) => void
  openBrowser: (url: string, newTab?: boolean) => void
  pushSession: (sh: Shell) => void
  popSession: () => void
  onEvent: (e: SimEvent) => void
  startMission: (idx: number) => void
  startOpenWorld: () => void
  resetMission: () => void
}

let openCount = 0
/** Estado auxiliar que também vai para o progresso salvo. */
export const flags = { awsMail: false, ciMail: false, dockerMail: false, m6Mail: false, m7Mail: false, m8Mail: false }
export const doneProjects = new Set<string>()
export const seen = new Set<string>()

export const hintCtx = (): HintCtx => {
  const u = github.student()
  const prod = aws.instances().filter((i) => i.name !== STAGING_NAME)
  const inst = prod.find((i) => i.state === 'running') ?? prod[0]
  const staging = aws.instances().find((i) => i.name === STAGING_NAME && i.state !== 'terminated')
  const shaTags = Object.keys(docker.registry()['devlab/todo-api']?.tags ?? {}).filter((t) => /^[0-9a-f]{40}$/.test(t))
  return {
    login: u?.login ?? '',
    email: u?.email ?? '',
    ip: inst?.publicIp ?? '',
    key: inst?.keyName ?? aws.keyPairs()[0]?.name ?? 'todo-key',
    prevTag: shaTags[shaTags.length - 2] ?? '',
    stagingIp: staging?.publicIp ?? '',
  }
}

export const useOS = create<OS>((set, get) => ({
  windows: {},
  focused: null,
  zTop: 10,
  version: 0,
  cwd: shell.cwd,
  depth: 1,
  missionIdx: 0,
  stepIdx: 0,
  missionDone: false,
  openWorld: false,
  flash: null,
  typeRequest: null,
  browserNav: { url: 'about:start', newTab: false, n: 0 },

  openApp: (id) => {
    if (id === 'github') return get().openBrowser('https://github.sim', true)
    if (id === 'cloud') return get().openBrowser('https://console.aws.sim', true)
    const meta = APPS.find((a) => a.id === id)!
    if (lockReason(meta, get().missionIdx)) return
    const { windows, zTop } = get()
    const cur = windows[id]
    const z = zTop + 1
    if (cur?.open) {
      set({ windows: { ...windows, [id]: { ...cur, minimized: false, z } }, focused: id, zTop: z })
      return
    }
    const vw = window.innerWidth
    const vh = window.innerHeight
    // janelas comuns ficam à esquerda do Guia (que fica fixo à direita), quando há espaço
    const guideW = APPS.find((a) => a.id === 'guide')!.size.w
    const area = vw >= 1100 && id !== 'guide' ? vw - guideW - 60 : vw - 40
    const w = Math.min(meta.size.w, area)
    const h = Math.min(meta.size.h, vh - 140)
    const offset = (openCount++ % 5) * 28
    const x = id === 'guide' ? vw - w - 24 : Math.max(20, Math.min(area + 20 - w, (area - w) / 2 + offset))
    const y = id === 'guide' ? 44 : Math.max(40, (vh - h) / 2 - 40 + offset)
    set({
      windows: { ...windows, [id]: { open: true, minimized: false, maximized: false, z, x, y, w, h } },
      focused: id,
      zTop: z,
    })
  },
  closeApp: (id) => {
    const { windows } = get()
    const cur = windows[id]
    if (!cur) return
    set({ windows: { ...windows, [id]: { ...cur, open: false } }, focused: null })
  },
  minimize: (id) => {
    const { windows } = get()
    const cur = windows[id]
    if (!cur) return
    set({ windows: { ...windows, [id]: { ...cur, minimized: true } }, focused: null })
  },
  toggleMax: (id) => {
    const { windows } = get()
    const cur = windows[id]
    if (!cur) return
    set({ windows: { ...windows, [id]: { ...cur, maximized: !cur.maximized } } })
  },
  focus: (id) => {
    const { windows, zTop, focused } = get()
    const cur = windows[id]
    if (!cur || focused === id) return
    set({ windows: { ...windows, [id]: { ...cur, z: zTop + 1 } }, focused: id, zTop: zTop + 1 })
  },
  setRect: (id, r) => {
    const { windows } = get()
    const cur = windows[id]
    if (!cur) return
    set({ windows: { ...windows, [id]: { ...cur, ...r } } })
  },

  typeInTerminal: (text) => {
    get().openApp('terminal')
    set({ typeRequest: { text, n: Date.now() } })
  },
  openBrowser: (url, newTab = false) => {
    const meta = APPS.find((a) => a.id === 'browser')!
    if (lockReason(meta, get().missionIdx)) return
    get().openApp('browser')
    set({ browserNav: { url, newTab, n: Date.now() + Math.random() } })
  },

  pushSession: (sh) => {
    sh.onCommand = onCommand
    sessions.push(sh)
    set({ depth: sessions.length, cwd: sh.cwd })
  },
  popSession: () => {
    if (sessions.length <= 1) return
    const sh = sessions.pop()!
    net.killSession(sh.sessionId)
    set({ depth: sessions.length, cwd: currentShell().cwd })
  },

  onEvent: (event) => {
    const cur = currentShell()
    if (get().cwd !== cur.cwd) set({ cwd: cur.cwd })
    if (event.kind === 'ui') seen.add(event.name)
    if (get().openWorld) {
      const u = github.student()
      if (u) {
        openWorld.syncAdmins(u.login)
        for (const p of PROJECTS)
          if (!doneProjects.has(p.id) && openWorld.status(p, u.login) === 'concluido') {
            doneProjects.add(p.id)
            set({ flash: `Projeto "${p.title}" concluído! (${doneProjects.size}/${PROJECTS.length})` })
          }
      }
    }
    const { missionIdx, missionDone } = get()
    if (missionDone) return
    const mission = missions[missionIdx]
    let { stepIdx } = get()
    let flash: string | null = null
    let done = false
    // avança enquanto os passos seguintes já estiverem satisfeitos
    while (stepIdx < mission.steps.length && mission.steps[stepIdx].check({ fs: localFs, cwd: cur.cwd, event, seen })) {
      flash = mission.steps[stepIdx].success
      if (stepIdx === mission.steps.length - 1) {
        done = true
        break
      }
      stepIdx++
      event = { kind: 'tick' } // o mesmo evento não conta duas vezes
    }
    if (flash) set({ flash, stepIdx, missionDone: done })
  },
  startMission: (idx) => {
    // garante os pré-requisitos das missões anteriores (útil ao pular missões)
    if (idx >= 1) prepareMission(idx, localFs, shell)
    if (idx >= 2 && !flags.awsMail) {
      flags.awsMail = true
      aws.sendCredentials()
    }
    if (idx >= 3 && !flags.ciMail) {
      flags.ciMail = true
      sendCiMail()
    }
    if (idx >= 4 && !flags.dockerMail) {
      flags.dockerMail = true
      sendDockerMail()
    }
    if (idx >= 5 && !flags.m6Mail) {
      flags.m6Mail = true
      mail.send({
        from: 'Senku Ishigami',
        fromAddr: 'senku@devlab.sim',
        avatar: 1,
        to: github.student()?.email ?? 'você',
        subject: 'O pipeline não sabe que agora é container',
        preview: 'Produção em container ficou ótimo, mas o job de deploy ainda faz git pull + npm start…',
        body: [
          { kind: 'p', text: 'Produção em container ficou ótimo! Só que o job de deploy ainda faz git pull + npm start no servidor. A porta 3000 agora é do container, então o próximo deploy vai falhar.' },
          { kind: 'p', text: 'Novo plano para o pipeline:\n1. test: igual a antes.\n2. build: constrói a imagem e publica no ghcr.sim, com a tag do hash do commit.\n3. deploy: docker pull da versão exata e recria o container.' },
          { kind: 'p', text: 'Bônus: com cada versão guardada no registry, rollback vira um comando.' },
          { kind: 'p', text: 'Confirma o erro no Actions antes de mexer. Primeiro a gente entende, depois conserta.' },
        ],
      })
    }
    if (idx >= 6 && !flags.m7Mail) {
      flags.m7Mail = true
      team.start()
      mail.send({
        from: 'Senku Ishigami',
        fromAddr: 'senku@devlab.sim',
        avatar: 1,
        to: github.student()?.email ?? 'você',
        subject: 'Nova regra no time: tudo entra por pull request',
        preview: 'O pipeline está redondo. Agora falta proteger a main de nós mesmos…',
        body: [
          { kind: 'p', text: 'O pipeline está redondo: cada push na main vai para produção em minutos. Justamente por isso, a main não pode receber código que ninguém revisou.' },
          { kind: 'p', text: 'Combinado do time a partir de hoje:\n1. Ninguém faz push direto na main (o GitHub vai bloquear).\n2. Cada mudança nasce num branch e vira um pull request.\n3. O CI roda no PR, e pelo menos uma pessoa aprova antes do merge.' },
          { kind: 'p', text: 'Primeira tarefa nesse fluxo: um endpoint que diga quantas tarefas estão pendentes. O Shikamaru revisa. A Bulma também está mexendo na API, então fica de olho.' },
          { kind: 'button', label: 'Configurações do repositório', url: 'https://github.sim/devlab/todo-api/settings/branches' },
        ],
      })
    }
    if (idx >= 7 && !flags.m8Mail) {
      flags.m8Mail = true
      const st = provisionStaging()
      mail.send({
        from: 'Senku Ishigami',
        fromAddr: 'senku@devlab.sim',
        avatar: 1,
        to: github.student()?.email ?? 'você',
        subject: 'Antes da produção, staging',
        preview: 'Revisão de código ajuda, mas não pega tudo. Subi um servidor de staging…',
        body: [
          { kind: 'p', text: 'Revisão de código ajuda, mas não pega tudo: às vezes o código está certo e o problema só aparece rodando de verdade. Hoje, todo merge vai direto para os usuários.' },
          { kind: 'p', text: `Subi um servidor de staging (${STAGING_NAME}${st ? `, IP ${st.publicIp}` : ''}), igual à produção, com a mesma chave SSH e o Docker instalado.` },
          { kind: 'p', text: 'O plano:\n1. Todo merge na main vai automaticamente para staging, com um teste rápido.\n2. Produção só recebe a versão depois que alguém olhar o staging e aprovar.\n\nO GitHub chama isso de environments.' },
          { kind: 'button', label: 'Configurações › Environments', url: 'https://github.sim/devlab/todo-api/settings/environments' },
        ],
      })
    }
    set({ missionIdx: idx, stepIdx: 0, missionDone: false, flash: null })
  },
  startOpenWorld: () => {
    if (!github.student() || !aws.instances().length) prepareMission(5, localFs, shell)
    const u = github.student()!
    set({ missionIdx: missions.length - 1, stepIdx: missions[missions.length - 1].steps.length - 1, missionDone: true, openWorld: true, flash: null })
    openWorld.start(u)
    get().openApp('guide')
  },
  resetMission: () => set({ stepIdx: 0, missionDone: false, flash: null }),
}))

function sendCiMail() {
  const u = github.student()
  if (u) github.makeAdmin(u.login, 'devlab/todo-api')
  mail.send({
    from: 'Senku Ishigami',
    fromAddr: 'senku@devlab.sim',
    avatar: 1,
    to: u?.email ?? 'você',
    subject: 'Bora automatizar: pipeline de CI/CD',
    preview: 'O deploy manual funcionou, mas não escala. Quero que cada push…',
    body: [
      { kind: 'p', text: 'Mandou bem no deploy da EC2! Mas fazer isso na mão a cada mudança não escala, e uma hora alguém esquece de rodar os testes.' },
      { kind: 'p', text: 'O plano é usar o GitHub Actions:\n1. CI: a cada push na main, rodar npm ci e npm test numa máquina limpa.\n2. CD: se os testes passarem, entrar na EC2 por SSH e atualizar a aplicação sozinho.' },
      { kind: 'p', text: `Te dei permissão de administrador no devlab/todo-api${u ? ` (@${u.login})` : ''}, porque você vai precisar cadastrar os secrets do deploy (IP e chave SSH).` },
      { kind: 'p', text: 'Regra do time: main vermelha, ninguém faz deploy.' },
      { kind: 'button', label: 'Abrir o repositório', url: 'https://github.sim/devlab/todo-api' },
    ],
  })
}

function sendDockerMail() {
  const u = github.student()
  mail.send({
    from: 'Senku Ishigami',
    fromAddr: 'senku@devlab.sim',
    avatar: 1,
    to: u?.email ?? 'você',
    subject: 'Node 18 no servidor, Node 20 aqui: hora do Docker',
    preview: 'Achei uma bomba-relógio: o servidor está com Node 18 (veio do apt) e…',
    body: [
      { kind: 'p', text: 'Achei uma bomba-relógio: o servidor roda Node 18 (o que veio do apt) e as nossas máquinas rodam Node 20. Hoje funciona. No dia em que alguém usar um recurso do Node 20, quebra só em produção: o clássico "na minha máquina funciona".' },
      { kind: 'p', text: 'Solução: empacotar a aplicação numa imagem Docker, com o Node certo dentro. O Dockerfile já está no repositório.' },
      { kind: 'p', text: 'Passos:\n1. Construir e testar a imagem na sua máquina (o Docker Desktop já está instalado aí).\n2. Publicar no registry do GitHub (ghcr.sim/devlab/todo-api).\n3. Instalar o Docker no servidor e rodar a imagem de lá.' },
      { kind: 'p', text: 'Dica: crie um .dockerignore. Ninguém merece mandar a node_modules inteira para o build.' },
    ],
  })
}

export const onCommand = (e: CommandEvent) => useOS.getState().onEvent({ kind: 'cmd', ...e })
shell.onCommand = onCommand

let tickQueued = false
const bump = () => {
  useOS.setState((s) => ({ version: s.version + 1 }))
  // reavalia passos que dependem de estado (ex.: instância ficou pronta), fora do ciclo atual
  if (!tickQueued) {
    tickQueued = true
    queueMicrotask(() => {
      tickQueued = false
      useOS.getState().onEvent({ kind: 'tick' })
    })
  }
}
localFs.subscribe(bump)
github.subscribe(bump)
net.subscribe(bump)
mail.subscribe(bump)
aws.subscribe(bump)
actions.subscribe(bump)
docker.subscribe(bump)
editor.subscribe(bump)
editor.setShowHandler(() => useOS.getState().openApp('editor'))
