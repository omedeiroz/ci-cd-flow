// Estado do editor de código (estilo VS Code) e o comando `code` do terminal.
import type { VFS } from './fs'
import { C, fail, ok, registerCommand } from './shell'

export type Buffer = { path: string; content: string; saved: string }

let fs: VFS | null = null
let root: string | null = null
let open: Buffer[] = []
let active: string | null = null
let recent: string[] = []
let reveal: { path: string; line: number; n: number } | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
let onShow: (() => void) | undefined
/** Arquivo › Salvamento automático: salva 1 s depois da última alteração (como o "afterDelay" do VS Code). */
let autoSave = false
export const AUTO_SAVE_DELAY = 1000
const autoTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const editor = {
  get root() {
    return root
  },
  get fs() {
    return fs
  },
  get open() {
    return open
  },
  get active() {
    return active
  },
  get recent() {
    return recent
  },
  /** Pedido para posicionar o cursor numa linha (resultado de busca). */
  get reveal() {
    return reveal
  },
  revealLine(path: string, line: number) {
    reveal = { path, line, n: Date.now() }
    emit()
  },
  closeFolder() {
    root = null
    open = []
    active = null
    emit()
  },
  /** Ajusta abas abertas depois de renomear/excluir no Explorer. */
  renamed(from: string, to: string | null) {
    open = open
      .map((b) => (b.path === from || b.path.startsWith(from + '/') ? (to ? { ...b, path: to + b.path.slice(from.length) } : null) : b))
      .filter((b): b is Buffer => !!b)
    if (active && (active === from || active.startsWith(from + '/'))) active = to ? to + active.slice(from.length) : open[0]?.path ?? null
    emit()
  },
  saveAll() {
    for (const b of open) if (b.content !== b.saved) this.save(b.path)
  },
  /** Chamado pela interface para trazer a janela do editor à frente. */
  setShowHandler(fn: () => void) {
    onShow = fn
  },
  openFolder(vfs: VFS, abs: string) {
    fs = vfs
    root = abs
    recent = [abs, ...recent.filter((r) => r !== abs)].slice(0, 6)
    open = []
    active = null
    emit()
    onShow?.()
  },
  openFile(vfs: VFS, abs: string, contentIfNew = '') {
    fs = vfs
    if (!root) {
      // como o VS Code: se o arquivo está num repositório, abre a pasta do repositório
      let dir = abs.split('/').slice(0, -1).join('/') || '/'
      let p = dir
      while (p && p !== '/' && !vfs.isDir(`${p}/.git`)) p = p.split('/').slice(0, -1).join('/')
      if (p && p !== '/') dir = p
      root = dir
    }
    let b = open.find((x) => x.path === abs)
    if (!b) {
      const n = vfs.get(abs)
      const content = n?.type === 'file' ? n.content : contentIfNew
      b = { path: abs, content, saved: n?.type === 'file' ? n.content : '\u0000novo' }
      open = [...open, b]
    }
    active = abs
    emit()
    onShow?.()
  },
  get autoSave() {
    return autoSave
  },
  setAutoSave(on: boolean) {
    autoSave = on
    if (on) editor.saveAll() // ao ligar, salva o que estava pendente
    else for (const t of autoTimers.values()) clearTimeout(t)
    if (!on) autoTimers.clear()
    emit()
  },
  setContent(abs: string, content: string) {
    open = open.map((b) => (b.path === abs ? { ...b, content } : b))
    emit()
    if (autoSave) {
      clearTimeout(autoTimers.get(abs))
      autoTimers.set(
        abs,
        setTimeout(() => {
          autoTimers.delete(abs)
          const b = open.find((x) => x.path === abs)
          if (b && editor.dirty(b)) editor.save(abs)
        }, AUTO_SAVE_DELAY),
      )
    }
  },
  save(abs: string) {
    const b = open.find((x) => x.path === abs)
    if (!b || !fs) return
    fs.mkdir(abs.split('/').slice(0, -1).join('/') || '/', true)
    fs.write(abs, b.content)
    open = open.map((x) => (x.path === abs ? { ...x, saved: x.content } : x))
    emit()
  },
  close(abs: string) {
    const i = open.findIndex((b) => b.path === abs)
    open = open.filter((b) => b.path !== abs)
    if (active === abs) active = open[Math.max(0, i - 1)]?.path ?? null
    emit()
  },
  select(abs: string) {
    active = abs
    emit()
  },
  dirty: (b: Buffer) => b.content !== b.saved,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

registerCommand('code', {
  help: 'abre o editor de código: code . (pasta) ou code arquivo',
  run: (args, { sh }) => {
    if (sh.machine.os !== 'mac') return fail(`code: comando não encontrado${C.dim} (o editor roda na sua máquina, não no servidor)${C.reset}`, 127)
    const target = sh.fs.resolve(sh.cwd, args.find((a) => !a.startsWith('-')) ?? '.')
    const node = sh.fs.get(target)
    if (node?.type === 'dir') editor.openFolder(sh.fs, target)
    else editor.openFile(sh.fs, target)
    return ok()
  },
})

// ---------- progresso salvo ----------
export function editorDump() {
  return { root, open, active, recent, autoSave }
}
export function editorLoad(d: ReturnType<typeof editorDump>, vfs: VFS) {
  fs = d.root ? vfs : null
  root = d.root
  open = d.open
  active = d.active
  recent = d.recent
  autoSave = !!d.autoSave
}
