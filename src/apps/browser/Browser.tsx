import { useEffect, useRef, useState } from 'react'
import { useOS } from '../../store/os'
import { net, loadTodos, callExport, type Service } from '../../engine/node'
import { actions } from '../../engine/actions'
import { aws } from '../../engine/aws'
import { GitHubPage } from './GitHubPages'
import { AwsConsole } from './AwsConsole'

/** Normaliza o que o usuário digitou na barra de endereço. */
export function normalizeUrl(input: string) {
  const t = input.trim()
  if (!t || t === 'about:start') return 'about:start'
  if (/^https?:\/\//.test(t)) return t.replace(/\/$/, '') || t
  if (/^(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)/.test(t)) return `http://${t}`.replace(/\/$/, '')
  return `https://${t}`.replace(/\/$/, '')
}

function parse(url: string) {
  const m = url.match(/^https?:\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/)
  return { host: m?.[1] ?? '', path: m?.[2] || '/', query: new URLSearchParams(m?.[3] ?? '') }
}

export function pageTitle(url: string) {
  if (url === 'about:start') return 'Nova aba'
  const { host, path } = parse(url)
  if (host === 'github.sim') {
    const parts = path.split('/').filter(Boolean)
    if (!parts.length) return 'GitHub'
    if (parts[0] === 'login') return 'Entrar no GitHub'
    if (parts[0] === 'signup') return 'Cadastre-se no GitHub'
    if (parts[0] === 'settings') return 'Tokens de acesso'
    if (parts[0] === 'verify') return 'E-mail verificado'
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0]
  }
  if (host === 'console.aws.sim') return aws.loggedIn ? 'Console AWS' : 'Login do Console AWS'
  if (host.endsWith('.github.sim')) return path.split('/')[1] || host
  return host
}

// ---------- páginas ----------

function StartPage() {
  const go = (u: string) => useOS.getState().openBrowser(u)
  const tiles = [
    { name: 'GitHub', url: 'https://github.sim', color: '#24292f', letter: 'G' },
    { name: 'Console AWS', url: 'https://console.aws.sim', color: '#232f3e', letter: 'A' },
  ]
  return (
    <div className="start">
      <h2>Favoritos</h2>
      <div className="tiles">
        {tiles.map((t) => (
          <div key={t.url} className="tile" onClick={() => go(t.url)}>
            <span style={{ background: t.color }}>{t.letter}</span>
            {t.name}
          </div>
        ))}
      </div>
    </div>
  )
}

function ErrorPage({ title, detail, code, tip }: { title: string; detail: string; code: string; tip?: string }) {
  return (
    <div className="err-page">
      <div className="err-icon">☹</div>
      <h2>{title}</h2>
      <p>{detail}</p>
      <code>{code}</code>
      {tip && <p className="err-tip">{tip}</p>}
    </div>
  )
}

/** Simula uma conexão que fica "pendurada" até estourar o tempo. */
function Timeout({ host, tip }: { host: string; tip?: string }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setDone(true), 6000)
    return () => clearTimeout(t)
  }, [])
  if (!done)
    return (
      <div className="waiting">
        <div className="spinner" />
        Aguardando {host}…
      </div>
    )
  return <ErrorPage title="Não é possível acessar esse site" detail={`${host} demorou muito para responder.`} code="ERR_CONNECTION_TIMED_OUT" tip={tip} />
}

function TodoApp({ svc, label }: { svc: Service; label: string }) {
  const [extra, setExtra] = useState<string[]>([])
  const [text, setText] = useState('')
  const [checked, setChecked] = useState<Record<number, boolean>>({})
  let todos: { id: number; title: string; done: boolean }[] = []
  let error = ''
  try {
    todos = loadTodos(svc.fs, svc.root)
  } catch (e) {
    error = (e as Error).message
  }
  const all = [...todos, ...extra.map((t, i) => ({ id: 1000 + i, title: t, done: false }))]
  return (
    <div className="todo-app">
      <div className="todo-card">
        <h1>✓ Tarefas</h1>
        <p className="todo-sub">{svc.name} · servido por {label}</p>
        {error ? (
          <pre className="todo-err">500 Internal Server Error{'\n'}{error}</pre>
        ) : (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (text.trim()) setExtra((x) => [...x, text.trim()])
                setText('')
              }}
            >
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nova tarefa…" />
              <button>Adicionar</button>
            </form>
            <ul>
              {all.map((t) => {
                const done = checked[t.id] ?? t.done
                return (
                  <li key={t.id} className={done ? 'done' : ''} onClick={() => setChecked((c) => ({ ...c, [t.id]: !done }))}>
                    <span className="box">{done ? '✓' : ''}</span>
                    {t.title}
                  </li>
                )
              })}
            </ul>
            <p className="todo-foot">GET /todos · {all.length} tarefas</p>
          </>
        )}
      </div>
    </div>
  )
}

/** Site publicado no GitHub Pages (owner.github.sim/repo/...). */
function PagesSite({ host, path }: { host: string; path: string }) {
  useOS((s) => s.version)
  const owner = host.replace('.github.sim', '')
  const [, repoName, ...rest] = path.split('/')
  const site = repoName ? actions.pages(`${owner}/${repoName}`) : undefined
  if (!site?.files)
    return (
      <div className="pages-404">
        <h1>404</h1>
        <p><b>There isn't a GitHub Pages site here.</b></p>
        <p>Se você é dono do repositório, ative o Pages em Configurações e publique pelo GitHub Actions.</p>
      </div>
    )
  const file = rest.filter(Boolean).join('/') || 'index.html'
  let html = site.files[file] ?? site.files[`${file}/index.html`]
  if (html === undefined) return <div className="pages-404"><h1>404</h1><p>File not found</p></div>
  // embute CSS e imagens SVG para o documento funcionar isolado
  html = html.replace(/<link[^>]*href="([^"]+\.css)"[^>]*>/g, (m, href: string) => (site.files![href] !== undefined ? `<style>${site.files![href]}</style>` : m))
  html = html.replace(/src="([^"]+\.svg)"/g, (m, src: string) => (site.files![src] !== undefined ? `src="data:image/svg+xml;utf8,${encodeURIComponent(site.files![src])}"` : m))
  return <iframe className="pages-frame" title="site" sandbox="" srcDoc={html} />
}

function CatalogApp({ svc, label }: { svc: Service; label: string }) {
  let items: { id: number; name: string; price: number; emoji?: string }[] = []
  let error = ''
  try {
    items = callExport(svc.fs, svc.root, 'src/catalog.js', 'listProducts')
  } catch (e) {
    error = (e as Error).message
  }
  return (
    <div className="cat-app">
      <h1>🛍️ Catálogo</h1>
      <p className="todo-sub">{svc.name} · servido por {label}</p>
      {error ? (
        <pre className="todo-err">500 Internal Server Error{'\n'}{error}</pre>
      ) : (
        <div className="cat-grid">
          {items.map((p) => (
            <div key={p.id} className="cat-card">
              <div className="cat-emoji">{p.emoji ?? '📦'}</div>
              <b>{p.name}</b>
              <span>R$ {p.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</span>
            </div>
          ))}
        </div>
      )}
      <p className="todo-foot">GET /products · {items.length} produtos</p>
    </div>
  )
}

function HttpPage({ host, path }: { host: string; path: string }) {
  useOS((s) => s.version)
  const [hostname, portStr] = host.split(':')
  const port = Number(portStr || 80)
  const local = hostname === 'localhost' || hostname === '127.0.0.1'
  let machineId = 'local'
  if (!local) {
    const inst = aws.findByHost(hostname)
    if (!inst || inst.state !== 'running') return <Timeout host={hostname} />
    if (!aws.allows(inst, port, aws.myIp))
      return <Timeout key={`${host}-closed`} host={hostname} tip={`Dica: o servidor pode estar rodando, mas o Security Group da instância não libera a porta ${port} para a internet.`} />
    machineId = inst.id
  }
  const svc = net.get(machineId, port)
  if (!svc)
    return (
      <ErrorPage
        title="Não é possível acessar esse site"
        detail={`${hostname} recusou a conexão.`}
        code="ERR_CONNECTION_REFUSED"
        tip={local ? 'Dica: o servidor não está rodando. No Terminal, dentro da pasta do projeto, rode npm start.' : 'Dica: a porta está liberada, mas nenhum processo está escutando nela. A aplicação está rodando no servidor?'}
      />
    )
  if (path === '/health') return <pre className="raw">{'{"status":"ok"}'}</pre>
  if (path === '/todos') return <pre className="raw">{JSON.stringify(loadTodos(svc.fs, svc.root))}</pre>
  if (path === '/products') return <pre className="raw">{JSON.stringify(callExport(svc.fs, svc.root, 'src/catalog.js', 'listProducts'))}</pre>
  const where = local ? `localhost:${port} (sua máquina)` : `${hostname}:${port} (EC2)`
  const label = svc.via ? `container Docker "${svc.via.replace('docker:', '')}" em ${where}` : where
  if (svc.fs.exists(`${svc.root}/src/catalog.js`)) return <CatalogApp svc={svc} label={label} />
  if (!svc.fs.exists(`${svc.root}/src/todos.js`)) return <pre className="raw">{`{"service":"${svc.name}","status":"ok"}`}</pre>
  return <TodoApp svc={svc} label={label} />
}

// ---------- abas ----------

type Tab = { id: number; history: string[]; idx: number; userTab: boolean; reload: number }
let tabSeq = 1

export function BrowserApp() {
  const nav = useOS((s) => s.browserNav)
  useOS((s) => s.version)
  const [tabs, setTabs] = useState<Tab[]>([{ id: tabSeq++, history: ['about:start'], idx: 0, userTab: false, reload: 0 }])
  const [active, setActive] = useState(tabs[0].id)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const urlRef = useRef<HTMLInputElement>(null)
  const tab = tabs.find((t) => t.id === active) ?? tabs[0]
  const url = tab.history[tab.idx]

  const flashLoad = () => {
    setLoading(true)
    setTimeout(() => setLoading(false), 350)
  }
  const emit = (u: string, userTab: boolean) => {
    if (u !== 'about:start') useOS.getState().onEvent({ kind: 'browse', url: u, userTab })
  }
  const visit = (raw: string, tabId = active) => {
    const u = normalizeUrl(raw)
    setTabs((ts) => ts.map((t) => (t.id === tabId ? { ...t, history: [...t.history.slice(0, t.idx + 1), u], idx: t.idx + 1 } : t)))
    setInput(u === 'about:start' ? '' : u)
    flashLoad()
    emit(u, tabs.find((t) => t.id === tabId)?.userTab ?? false)
  }
  const newTab = (u = 'about:start', userTab = true) => {
    const t: Tab = { id: tabSeq++, history: [normalizeUrl(u)], idx: 0, userTab, reload: 0 }
    setTabs((ts) => [...ts, t])
    setActive(t.id)
    setInput(u === 'about:start' ? '' : normalizeUrl(u))
    if (u === 'about:start') setTimeout(() => urlRef.current?.focus(), 30)
    else {
      flashLoad()
      emit(normalizeUrl(u), userTab)
    }
  }
  const closeTab = (id: number) => {
    if (tabs.length === 1) return useOS.getState().closeApp('browser')
    const i = tabs.findIndex((t) => t.id === id)
    const rest = tabs.filter((t) => t.id !== id)
    setTabs(rest)
    if (id === active) {
      const next = rest[Math.max(0, i - 1)]
      setActive(next.id)
      setInput(next.history[next.idx] === 'about:start' ? '' : next.history[next.idx])
    }
  }
  const select = (id: number) => {
    const t = tabs.find((x) => x.id === id)!
    setActive(id)
    setInput(t.history[t.idx] === 'about:start' ? '' : t.history[t.idx])
  }
  const move = (d: number) => {
    const ni = tab.idx + d
    if (ni < 0 || ni >= tab.history.length) return
    setTabs((ts) => ts.map((t) => (t.id === active ? { ...t, idx: ni } : t)))
    setInput(tab.history[ni] === 'about:start' ? '' : tab.history[ni])
    flashLoad()
    emit(tab.history[ni], tab.userTab)
  }
  const reload = () => {
    setTabs((ts) => ts.map((t) => (t.id === active ? { ...t, reload: t.reload + 1 } : t)))
    flashLoad()
    emit(url, tab.userTab)
  }

  useEffect(() => {
    if (!nav.n) return
    if (nav.newTab) newTab(nav.url, false)
    else visit(nav.url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.n])

  const { host, path, query } = parse(url)
  let page: React.ReactNode
  if (url === 'about:start') page = <StartPage />
  else if (host === 'github.sim') page = <GitHubPage path={path} query={query} />
  else if (host === 'console.aws.sim') page = <AwsConsole path={path} />
  else if (host.endsWith('.github.sim')) page = <PagesSite host={host} path={path} />
  else if (/^(localhost|127\.0\.0\.1|\d+\.\d+\.\d+\.\d+)(:\d+)?$/.test(host)) page = <HttpPage host={host} path={path} />
  else
    page = (
      <ErrorPage
        title="Não foi possível encontrar o servidor"
        detail={`O endereço de DNS de ${host} não foi encontrado.`}
        code="DNS_PROBE_FINISHED_NXDOMAIN"
        tip="No simulador, a internet tem github.sim, console.aws.sim e o que você colocar no ar."
      />
    )

  const favicon = (u: string) => {
    const h = parse(u).host
    return h === 'github.sim' ? '⑂' : h === 'console.aws.sim' ? '☁' : u === 'about:start' ? '◌' : '◍'
  }

  return (
    <div className="browser">
      <div className="tabs">
        {tabs.map((t) => (
          <div key={t.id} className={`tab ${t.id === active ? 'on' : ''}`} onPointerDown={() => select(t.id)}>
            <span className="fav">{favicon(t.history[t.idx])}</span>
            <span className="tab-title">{pageTitle(t.history[t.idx])}</span>
            <button
              className="tab-x"
              aria-label="Fechar aba"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => (e.stopPropagation(), closeTab(t.id))}
            >
              ×
            </button>
          </div>
        ))}
        <button className="tab-new" aria-label="Nova aba" title="Nova aba" onClick={() => newTab()}>
          +
        </button>
      </div>
      <div className="browser-bar">
        <button onClick={() => move(-1)} disabled={tab.idx === 0} aria-label="Voltar">‹</button>
        <button onClick={() => move(1)} disabled={tab.idx >= tab.history.length - 1} aria-label="Avançar">›</button>
        <button onClick={reload} aria-label="Recarregar">↻</button>
        <form
          className="url"
          onSubmit={(e) => {
            e.preventDefault()
            visit(input)
            urlRef.current?.blur()
          }}
        >
          <span className="lock-ic">{url.startsWith('https') ? '🔒' : 'ⓘ'}</span>
          <input
            ref={urlRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder="Pesquise ou digite um endereço"
            spellCheck={false}
            aria-label="Barra de endereço"
          />
        </form>
      </div>
      {loading && <div className="loadbar" />}
      <div className="browser-page" key={`${active}-${tab.idx}-${tab.reload}`}>
        {page}
      </div>
    </div>
  )
}
