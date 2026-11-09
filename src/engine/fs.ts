// Sistema de arquivos virtual em memória.
// Cada "máquina" do simulador terá sua própria instância de VFS.

export type FileNode = { type: 'file'; content: string; mtime: number; mode: number }
export type DirNode = { type: 'dir'; children: Record<string, Node>; mtime: number; mode: number }
export type Node = FileNode | DirNode

export class FsError extends Error {}

const now = () => Date.now()
export const dir = (children: Record<string, Node> = {}, mode = 0o755): DirNode => ({ type: 'dir', children, mtime: now(), mode })
export const file = (content = '', mode = 0o644): FileNode => ({ type: 'file', content, mtime: now(), mode })

export class VFS {
  root: DirNode
  home: string
  private listeners = new Set<() => void>()

  constructor(root: DirNode, home: string) {
    this.root = root
    this.home = home
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit() {
    this.listeners.forEach((l) => l())
  }

  /** Resolve um caminho (relativo, absoluto ou com ~) para absoluto normalizado. */
  resolve(cwd: string, path: string): string {
    if (!path || path === '~') return this.home
    if (path.startsWith('~/')) path = this.home + path.slice(1)
    const base = path.startsWith('/') ? [] : cwd.split('/').filter(Boolean)
    for (const part of path.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') base.pop()
      else base.push(part)
    }
    return '/' + base.join('/')
  }

  get(abs: string): Node | null {
    let node: Node = this.root
    for (const part of abs.split('/').filter(Boolean)) {
      if (node.type !== 'dir') return null
      const next: Node | undefined = node.children[part]
      if (!next) return null
      node = next
    }
    return node
  }

  private parent(abs: string): { dir: DirNode; name: string } {
    const parts = abs.split('/').filter(Boolean)
    const name = parts.pop()
    if (!name) throw new FsError('operação inválida na raiz')
    const p = this.get('/' + parts.join('/'))
    if (!p) throw new FsError(`${'/' + parts.join('/')}: diretório não existe`)
    if (p.type !== 'dir') throw new FsError(`${'/' + parts.join('/')}: não é um diretório`)
    return { dir: p, name }
  }

  /** Todos os arquivos sob `abs`, com caminho relativo. `skip` decide o que ignorar. */
  walkFiles(abs: string, skip: (rel: string) => boolean = () => false): Record<string, string> {
    const out: Record<string, string> = {}
    const walk = (node: Node, rel: string) => {
      if (rel && skip(rel)) return
      if (node.type === 'file') out[rel] = node.content
      else for (const [n, child] of Object.entries(node.children)) walk(child, rel ? `${rel}/${n}` : n)
    }
    const n = this.get(abs)
    if (n) walk(n, '')
    return out
  }

  /** Escreve vários arquivos (caminhos relativos a `abs`), criando pastas. */
  writeTree(abs: string, files: Record<string, string>) {
    for (const [rel, content] of Object.entries(files)) {
      const full = `${abs}/${rel}`
      this.mkdir(full.split('/').slice(0, -1).join('/'), true)
      this.write(full, content)
    }
  }

  exists(abs: string) {
    return this.get(abs) !== null
  }
  isDir(abs: string) {
    return this.get(abs)?.type === 'dir'
  }

  list(abs: string): [string, Node][] {
    const n = this.get(abs)
    if (!n) throw new FsError('Arquivo ou diretório inexistente')
    if (n.type === 'file') return [[abs.split('/').pop()!, n]]
    return Object.entries(n.children).sort(([a], [b]) => a.localeCompare(b))
  }

  read(abs: string): string {
    const n = this.get(abs)
    if (!n) throw new FsError('Arquivo ou diretório inexistente')
    if (n.type === 'dir') throw new FsError('É um diretório')
    return n.content
  }

  write(abs: string, content: string, append = false) {
    const { dir: p, name } = this.parent(abs)
    const existing = p.children[name]
    if (existing?.type === 'dir') throw new FsError('É um diretório')
    p.children[name] = file(append && existing ? existing.content + content : content, existing?.mode ?? 0o644)
    p.mtime = now()
    this.emit()
  }

  chmod(abs: string, mode: number) {
    const n = this.get(abs)
    if (!n) throw new FsError('Arquivo ou diretório inexistente')
    n.mode = mode
    this.emit()
  }

  touch(abs: string) {
    const n = this.get(abs)
    if (n) {
      n.mtime = now()
      this.emit()
    } else this.write(abs, '')
  }

  mkdir(abs: string, recursive = false) {
    if (recursive) {
      let cur = ''
      for (const part of abs.split('/').filter(Boolean)) {
        cur += '/' + part
        const n = this.get(cur)
        if (!n) this.parent(cur).dir.children[part] = dir()
        else if (n.type !== 'dir') throw new FsError(`${cur}: não é um diretório`)
      }
    } else {
      if (this.exists(abs)) throw new FsError('Arquivo existe')
      this.parent(abs).dir.children[this.parent(abs).name] = dir()
    }
    this.emit()
  }

  remove(abs: string, recursive = false) {
    const n = this.get(abs)
    if (!n) throw new FsError('Arquivo ou diretório inexistente')
    if (n.type === 'dir' && !recursive) throw new FsError('É um diretório (use -r)')
    const { dir: p, name } = this.parent(abs)
    delete p.children[name]
    this.emit()
  }

  copy(src: string, dst: string) {
    const n = this.get(src)
    if (!n) throw new FsError('Arquivo ou diretório inexistente')
    if (this.isDir(dst)) dst = dst + '/' + src.split('/').pop()
    const { dir: p, name } = this.parent(dst)
    p.children[name] = structuredClone(n)
    this.emit()
  }

  move(src: string, dst: string) {
    this.copy(src, dst)
    const { dir: p, name } = this.parent(src)
    delete p.children[name]
    this.emit()
  }
}

/** Máquina local do aluno (o "Mac"). */
export function createLocalFs(): VFS {
  const root = dir({
    home: dir({
      dev: dir({
        'LEIA-ME.txt': file(
          [
            'Bem-vindo ao DevOps Lab!',
            '',
            'Este é o seu computador de trabalho. Tudo aqui é simulado,',
            'então pode experimentar à vontade: nada vai quebrar.',
            '',
            'Ao longo das missões você vai:',
            '  1. Aprender o básico do terminal Linux',
            '  2. Clonar um repositório do GitHub',
            '  3. Acessar um servidor na AWS via SSH',
            '  4. Montar um pipeline de CI/CD que faz deploy automático',
            '',
            'Siga o app "Guia" para começar.',
            '',
          ].join('\n'),
        ),
        Documentos: dir({
          'checklist-devops.md': file('# Checklist\n\n- [ ] Terminal\n- [ ] Git\n- [ ] SSH\n- [ ] CI/CD\n'),
        }),
        Downloads: dir(),
        '.bashrc': file('# configurações do shell\nexport PATH=/usr/local/bin:/usr/bin:/bin\nalias ll="ls -l"\n'),
      }),
    }),
    etc: dir({
      hostname: file('devops-lab\n'),
      'os-release': file('NAME="DevOps Lab OS"\nVERSION="1.0"\nID=devlab\n'),
    }),
    tmp: dir(),
    usr: dir({ bin: dir(), local: dir({ bin: dir() }) }),
    var: dir({ log: dir({ 'system.log': file('[ok] sistema iniciado\n') }) }),
  })
  return new VFS(root, '/home/dev')
}

// ---------- progresso salvo ----------
export type VfsJSON = { root: DirNode; home: string }
export const vfsDump = (v: VFS): VfsJSON => ({ root: v.root, home: v.home })
export const vfsLoad = (d: VfsJSON) => new VFS(d.root, d.home)
