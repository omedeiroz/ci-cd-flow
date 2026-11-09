// Páginas do GitHub simulado (github.sim): cadastro, login, convites, tokens e repositórios.
import { useEffect, useState } from 'react'
import { github, type Commit, type RemoteRepo, type Token } from '../../engine/github'
import { useOS } from '../../store/os'
import { FileIcon, FolderIcon } from '../../components/Icons'
import { AnimeAvatar, AVATAR_COUNT, GhostAvatar } from '../../components/AnimeAvatar'
import { Markdown } from './markdown'
import { ActionsList, RunView, SecretsPage, StatusIcon, lastRunStatus } from './ActionsPages'
import { docker } from '../../engine/docker'
import { Compare, DeploymentsBox, PullsList, PullView, PushedBanner } from './PullPages'

const go = (u: string) => useOS.getState().openBrowser(u.startsWith('http') ? u : `https://github.sim${u}`)

const rel = (ms: number) => {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return 'agora mesmo'
  if (s < 3600) return `há ${Math.round(s / 60)} min`
  if (s < 86400) return `há ${Math.round(s / 3600)} h`
  const d = Math.round(s / 86400)
  return `há ${d} dia${d > 1 ? 's' : ''}`
}

/** Avatar de um autor de commit: se o e-mail bate com uma conta, usa o avatar da conta. */
function AuthorAvatar({ email, size = 20 }: { email: string; size?: number }) {
  const u = github.userByEmail(email)
  return u ? <AnimeAvatar seed={u.avatar} size={size} /> : <GhostAvatar size={size} />
}
function AuthorName({ c }: { c: Commit }) {
  const u = github.userByEmail(c.email)
  return u ? (
    <b className="gh-link" onClick={() => go(`/${u.login}`)}>{u.login}</b>
  ) : (
    <b title={`${c.email} não está associado a nenhuma conta do GitHub`}>{c.author}</b>
  )
}

/** Último commit que alterou `path` (arquivo ou pasta). */
function lastTouch(list: Commit[], path: string): Commit {
  const inPath = (t: Record<string, string>) => JSON.stringify(Object.entries(t).filter(([p]) => p === path || p.startsWith(path + '/')).sort())
  for (let i = list.length - 1; i > 0; i--) if (inPath(list[i].tree) !== inPath(list[i - 1].tree)) return list[i]
  return list[0]
}

// ---------- moldura ----------

function Logo() {
  return (
    <span className="gh-logo" onClick={() => go('/')}>
      <svg viewBox="0 0 24 24" width="28" height="28">
        <circle cx="12" cy="12" r="11" fill="#24292f" />
        <circle cx="9" cy="7" r="2" fill="none" stroke="#fff" strokeWidth="1.8" />
        <circle cx="9" cy="17" r="2" fill="none" stroke="#fff" strokeWidth="1.8" />
        <circle cx="16" cy="10" r="2" fill="none" stroke="#fff" strokeWidth="1.8" />
        <path d="M9 9v6M16 12q0 3-6 4" stroke="#fff" strokeWidth="1.8" fill="none" />
      </svg>
      <b>GitHub</b> <em>simulado</em>
    </span>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  const me = github.current()
  const [menu, setMenu] = useState(false)
  const pending = me ? github.invitationsFor(me.login).filter((i) => i.status === 'pending').length : 0
  return (
    <div className="gh">
      <div className="gh-top">
        <Logo />
        <div className="gh-search">Buscar ou ir para…</div>
        {me ? (
          <>
            <span className="gh-bell" title="Notificações" onClick={() => go('/notifications')}>
              🔔{pending > 0 && <i />}
            </span>
            <span className="gh-me" onClick={() => setMenu((m) => !m)}>
              <AnimeAvatar seed={me.avatar} size={30} />
            </span>
            {menu && (
              <div className="gh-menu" onMouseLeave={() => setMenu(false)}>
                <div className="gh-menu-head">
                  <AnimeAvatar seed={me.avatar} size={32} />
                  <div>
                    <b>{me.login}</b>
                    <small>{me.name || me.email}</small>
                  </div>
                </div>
                <div onClick={() => go(`/${me.login}`)}>👤 Seu perfil</div>
                <div onClick={() => go('/settings/tokens')}>⚙️ Configurações · Tokens de acesso</div>
                <hr />
                <div onClick={() => (github.logout(), go('/'))}>↪ Sair</div>
              </div>
            )}
          </>
        ) : (
          <>
            <button className="gh-btn ghost" onClick={() => go('/login')}>Entrar</button>
            <button className="gh-btn outline" onClick={() => go('/signup')}>Cadastre-se</button>
          </>
        )}
      </div>
      {me && !me.verified && (
        <div className="gh-flash warn">
          📧 Confirme seu endereço de e-mail. Enviamos um link para <b>{me.email}</b>: abra o app Mail.
        </div>
      )}
      {children}
    </div>
  )
}

// ---------- páginas de conta ----------

function Landing() {
  return (
    <Frame>
      <div className="gh-hero">
        <h1>Construa e entregue software, juntos.</h1>
        <p>Milhões de times guardam código, revisam mudanças e automatizam deploys aqui.</p>
        <div className="gh-hero-cta">
          <button className="gh-btn green big" onClick={() => go('/signup')}>Cadastre-se no GitHub</button>
          <button className="gh-btn ghost big" onClick={() => go('/login')}>Já tenho conta</button>
        </div>
        <p className="gh-hero-small">
          Explorar repositório público: <span className="gh-link" onClick={() => go('/devlab/todo-api')}>devlab/todo-api</span>
        </p>
      </div>
    </Frame>
  )
}

function Field({ label, error, children, help }: { label: string; error?: string; help?: string; children: React.ReactNode }) {
  return (
    <label className={`gh-field ${error ? 'err' : ''}`}>
      <span>{label}</span>
      {children}
      {error ? <small className="e">{error}</small> : help ? <small>{help}</small> : null}
    </label>
  )
}

function Signup() {
  const [login, setLogin] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [base, setBase] = useState(() => Math.floor(Math.random() * AVATAR_COUNT))
  const [avatar, setAvatar] = useState(base)
  if (github.current()) return <SignedIn />
  const options = Array.from({ length: 6 }, (_, i) => (base + i * 7) % AVATAR_COUNT)
  return (
    <div className="gh-auth dark">
      <Logo />
      <h2>Bem-vindo ao GitHub!<br /><small>Vamos começar a aventura.</small></h2>
      <form
        className="gh-auth-card"
        onSubmit={(e) => {
          e.preventDefault()
          const errs = github.validateSignup(login.trim(), email.trim(), password)
          setErrors(errs)
          if (Object.keys(errs).length) return
          github.signup(login.trim(), email.trim(), password, avatar)
          go('/signup/verify')
        }}
      >
        <Field label="E-mail*" error={errors.email}>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="voce@exemplo.com" autoComplete="off" />
        </Field>
        <Field label="Senha*" error={errors.password} help="Pelo menos 8 caracteres, incluindo um número e uma letra.">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <Field label="Nome de usuário*" error={errors.login} help="Letras, números e hífens. Ele aparece nos seus commits.">
          <input value={login} onChange={(e) => setLogin(e.target.value)} placeholder="seu-usuario" autoComplete="off" />
        </Field>
        <div className="gh-field">
          <span>Avatar</span>
          <div className="gh-avatars">
            {options.map((s) => (
              <button type="button" key={s} className={s === avatar ? 'on' : ''} onClick={() => setAvatar(s)} aria-label={`Avatar ${s}`}>
                <AnimeAvatar seed={s} size={44} />
              </button>
            ))}
            <button type="button" className="shuffle" onClick={() => (setBase(Math.floor(Math.random() * AVATAR_COUNT)), setAvatar((base + 13) % AVATAR_COUNT))}>
              🎲
            </button>
          </div>
        </div>
        <button className="gh-btn green wide">Criar conta</button>
        <small className="gh-fine">Ao criar uma conta você concorda com os Termos de Serviço (simulados).</small>
      </form>
      <p className="gh-auth-alt">
        Já tem conta? <span className="gh-link" onClick={() => go('/login')}>Entrar →</span>
      </p>
    </div>
  )
}

function SignedIn() {
  const me = github.current()!
  return (
    <Frame>
      <div className="gh-center">
        <AnimeAvatar seed={me.avatar} size={72} />
        <h2>Você já está conectado como @{me.login}</h2>
        <button className="gh-btn" onClick={() => go('/')}>Ir para o início</button>
      </div>
    </Frame>
  )
}

function VerifyPending() {
  const me = github.current()
  return (
    <Frame>
      <div className="gh-center">
        <div style={{ fontSize: 48 }}>📬</div>
        <h2>Verifique seu e-mail</h2>
        <p>
          Enviamos um link de confirmação para <b>{me?.email}</b>.<br />Abra o app <b>Mail</b> e clique em “Verificar endereço de e-mail”.
        </p>
      </div>
    </Frame>
  )
}

function Verify({ token }: { token: string }) {
  const [state, setState] = useState<'wait' | 'ok' | 'bad'>('wait')
  useEffect(() => {
    if (github.student()?.verified && !token) return setState('ok')
    setState(github.verify(token) ? 'ok' : github.student()?.verified ? 'ok' : 'bad')
  }, [token])
  return (
    <Frame>
      <div className="gh-center">
        {state === 'ok' ? (
          <>
            <div className="gh-check">✓</div>
            <h2>E-mail verificado!</h2>
            <p>Sua conta está pronta. Fique de olho no Mail: convites de times chegam por lá.</p>
            <button className="gh-btn green" onClick={() => go('/')}>Continuar</button>
          </>
        ) : state === 'bad' ? (
          <>
            <h2>Link inválido ou expirado</h2>
            <p>Peça um novo e-mail de verificação.</p>
          </>
        ) : (
          <p>Verificando…</p>
        )}
      </div>
    </Frame>
  )
}

function Login() {
  const [id, setId] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  if (github.current()) return <SignedIn />
  return (
    <div className="gh-auth">
      <Logo />
      <h2>Entrar no GitHub</h2>
      {err && <div className="gh-flash error small">{err}</div>}
      <form
        className="gh-auth-card light"
        onSubmit={(e) => {
          e.preventDefault()
          const r = github.login(id.trim(), pw)
          if (r) setErr(r)
          else go('/')
        }}
      >
        <Field label="Usuário ou e-mail">
          <input value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Senha">
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <button className="gh-btn green wide">Entrar</button>
      </form>
      <p className="gh-auth-alt">
        Novo no GitHub? <span className="gh-link" onClick={() => go('/signup')}>Crie uma conta</span>
      </p>
    </div>
  )
}

function RequireLogin({ children }: { children: React.ReactNode }) {
  if (!github.current()) return <Login />
  return <>{children}</>
}

function Dashboard() {
  const me = github.current()!
  const mine = github.all().filter((r) => r.collaborators.includes(me.login))
  return (
    <Frame>
      <div className="gh-dash">
        <aside>
          <div className="gh-dash-me">
            <AnimeAvatar seed={me.avatar} size={28} /> <b>{me.login}</b>
          </div>
          <h4>Repositórios</h4>
          {mine.length ? (
            mine.map((r) => (
              <div key={r.name} className="gh-dash-repo" onClick={() => go(`/${r.owner}/${r.name}`)}>
                <AnimeAvatar seed={3} size={16} /> {r.owner}/{r.name}
              </div>
            ))
          ) : (
            <p className="gh-muted">Você ainda não colabora em nenhum repositório.</p>
          )}
        </aside>
        <main>
          <h3>Início</h3>
          {github.invitationsFor(me.login).filter((i) => i.status === 'pending').map((i) => (
            <div key={i.id} className="gh-card invite" onClick={() => go(`/${i.repo}/invitations`)}>
              <AnimeAvatar seed={github.user(i.inviter)!.avatar} size={32} />
              <div>
                <b>{i.inviter}</b> convidou você para colaborar em <b>{i.repo}</b>
                <div className="gh-muted">{rel(i.date)} · clique para ver o convite</div>
              </div>
            </div>
          ))}
          {github.all().map((r) => {
            const c = r.commits[r.commits.length - 1]
            return (
              <div key={r.name} className="gh-card" onClick={() => go(`/${r.owner}/${r.name}`)}>
                <div className="gh-feed-head">
                  <AuthorAvatar email={c.email} size={22} /> <AuthorName c={c} /> fez push em <span className="gh-link">{r.owner}/{r.name}</span>
                  <span className="gh-muted"> · {rel(c.date)}</span>
                </div>
                <p>{c.message}</p>
                <span className="gh-meta"><i className="lang-dot" /> JavaScript · ☆ {r.stars}</span>
              </div>
            )
          })}
        </main>
      </div>
    </Frame>
  )
}

function Notifications() {
  const me = github.current()!
  const inv = github.invitationsFor(me.login)
  return (
    <Frame>
      <div className="gh-body">
        <h3 className="gh-h">Notificações</h3>
        <div className="gh-box">
          {inv.length === 0 && <div className="gh-empty">Tudo em dia! 🎉</div>}
          {inv.map((i) => (
            <div key={i.id} className="gh-row notif" onClick={() => go(`/${i.repo}/invitations`)}>
              <span className="gh-name">
                <AnimeAvatar seed={github.user(i.inviter)!.avatar} size={20} /> <b>{i.repo}</b>
              </span>
              <span>Convite para colaborar · {i.status === 'pending' ? 'pendente' : i.status === 'accepted' ? 'aceito' : 'recusado'}</span>
              <span className="gh-muted">{rel(i.date)}</span>
            </div>
          ))}
        </div>
      </div>
    </Frame>
  )
}

function Invitation({ repo }: { repo: RemoteRepo }) {
  const me = github.current()!
  const key = `${repo.owner}/${repo.name}`
  const inv = github.invitationsFor(me.login).find((i) => i.repo === key)
  if (!inv)
    return (
      <Frame>
        <div className="gh-center"><h2>Nenhum convite pendente para {key}</h2></div>
      </Frame>
    )
  const inviter = github.user(inv.inviter)!
  return (
    <Frame>
      <div className="gh-center gh-invite">
        <div className="gh-invite-avatars">
          <AnimeAvatar seed={inviter.avatar} size={64} />
          <span>＋</span>
          <AnimeAvatar seed={me.avatar} size={64} />
        </div>
        {inv.status === 'pending' ? (
          <>
            <h2>
              <b>{inviter.login}</b> convidou você para colaborar em <b>{key}</b>
            </h2>
            <p className="gh-muted">Você terá acesso de escrita: poderá enviar commits com git push.</p>
            <div className="gh-hero-cta">
              <button className="gh-btn green" onClick={() => (github.respondInvite(inv.id, true), go(`/${key}`))}>Aceitar convite</button>
              <button className="gh-btn" onClick={() => github.respondInvite(inv.id, false)}>Recusar</button>
            </div>
          </>
        ) : (
          <h2>Convite {inv.status === 'accepted' ? 'aceito ✓' : 'recusado'}</h2>
        )}
      </div>
    </Frame>
  )
}

let freshToken: Token | null = null

function Tokens() {
  const me = github.current()!
  const [copied, setCopied] = useState(false)
  const shown = freshToken
  useEffect(() => () => void (freshToken = null), [])
  return (
    <Frame>
      <div className="gh-settings">
        <aside>
          <div className="gh-dash-me">
            <AnimeAvatar seed={me.avatar} size={32} />
            <div>
              <b>{me.login}</b>
              <small>Configurações pessoais</small>
            </div>
          </div>
          <div className="side">Perfil público</div>
          <div className="side">E-mails</div>
          <div className="side on">Developer settings · Tokens</div>
        </aside>
        <main>
          <div className="gh-set-head">
            <h2>Personal access tokens (clássicos)</h2>
            <button className="gh-btn" onClick={() => go('/settings/tokens/new')}>Gerar novo token</button>
          </div>
          <p className="gh-muted">Tokens funcionam como senhas para usar o Git pela linha de comando (HTTPS). Trate-os como segredos.</p>
          {shown && (
            <div className="gh-flash ok">
              <b>Copie seu token de acesso agora. Você não conseguirá vê-lo de novo!</b>
              <div className="gh-url">
                <input readOnly value={shown.value} onFocus={(e) => e.target.select()} aria-label="Token gerado" />
                <button
                  onClick={async (e) => {
                    const input = (e.currentTarget.previousElementSibling as HTMLInputElement)
                    input.select()
                    try {
                      await navigator.clipboard.writeText(shown.value)
                      setCopied(true)
                    } catch {
                      document.execCommand?.('copy')
                      setCopied(true)
                    }
                  }}
                >
                  {copied ? '✓ Copiado' : '📋 Copiar'}
                </button>
              </div>
            </div>
          )}
          <div className="gh-box">
            {me.tokens.length === 0 && <div className="gh-empty">Nenhum token ainda.</div>}
            {me.tokens.map((t) => (
              <div key={t.id} className="gh-token">
                <div>
                  <b className="gh-link">{t.note}</b> — <i>{t.scopes.join(', ') || 'sem escopos'}</i>
                  <div className="gh-muted">{t.expires === 'never' ? 'Sem expiração' : `Expira em ${t.expires} dias`}</div>
                </div>
                <button className="gh-btn danger small" onClick={() => github.deleteToken(t.id)}>Excluir</button>
              </div>
            ))}
          </div>
        </main>
      </div>
    </Frame>
  )
}

const SCOPES = [
  ['repo', 'Controle total de repositórios privados e públicos (necessário para git push)'],
  ['workflow', 'Atualizar arquivos de workflow do GitHub Actions'],
  ['read:org', 'Ler membros e times da organização'],
  ['write:packages', 'Publicar imagens e pacotes no registry (docker push)'],
  ['read:packages', 'Baixar pacotes privados do registry'],
  ['gist', 'Criar gists'],
  ['delete_repo', 'Excluir repositórios'],
] as const

function NewToken() {
  const [note, setNote] = useState('')
  const [exp, setExp] = useState('30')
  const [scopes, setScopes] = useState<string[]>([])
  const [err, setErr] = useState('')
  return (
    <Frame>
      <div className="gh-body narrow">
        <h2>Novo personal access token (clássico)</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!note.trim()) return setErr('A nota é obrigatória: descreva para que serve o token.')
            freshToken = github.createToken(note.trim(), scopes, exp)
            go('/settings/tokens')
          }}
        >
          <Field label="Nota" error={err} help="Para que serve este token? Ex.: terminal do notebook">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="terminal do DevOps Lab" />
          </Field>
          <Field label="Expiração">
            <select value={exp} onChange={(e) => setExp(e.target.value)}>
              <option value="7">7 dias</option>
              <option value="30">30 dias</option>
              <option value="90">90 dias</option>
              <option value="never">Sem expiração (não recomendado)</option>
            </select>
          </Field>
          <div className="gh-field">
            <span>Selecione os escopos</span>
            <small>Escopos definem o que o token pode fazer. Dê só o necessário.</small>
            <div className="gh-scopes">
              {SCOPES.map(([s, d]) => (
                <label key={s}>
                  <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes((x) => (e.target.checked ? [...x, s] : x.filter((y) => y !== s)))} />
                  <code>{s}</code> <span>{d}</span>
                </label>
              ))}
            </div>
          </div>
          <button className="gh-btn green">Gerar token</button>
        </form>
      </div>
    </Frame>
  )
}

function Profile({ login }: { login: string }) {
  const u = github.user(login)
  if (!u) return <NotFound />
  const repos = github.all().filter((r) => r.collaborators.includes(u.login))
  return (
    <Frame>
      <div className="gh-profile">
        <aside>
          <AnimeAvatar seed={u.avatar} size={180} />
          <h2>{u.name || u.login}</h2>
          <div className="gh-muted big">{u.login}</div>
        </aside>
        <main>
          <h3>Repositórios</h3>
          {repos.map((r) => (
            <div key={r.name} className="gh-card" onClick={() => go(`/${r.owner}/${r.name}`)}>
              <div className="gh-link"><b>{r.owner}/{r.name}</b></div>
              <p>{r.description}</p>
            </div>
          ))}
          {!repos.length && <p className="gh-muted">Nenhum repositório.</p>}
        </main>
      </div>
    </Frame>
  )
}

function NotFound() {
  return (
    <Frame>
      <div className="gh-404"><b>404</b><p>Esta não é a página que você está procurando.</p></div>
    </Frame>
  )
}

// ---------- repositório ----------

function CloneButton({ repo }: { repo: RemoteRepo }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const url = github.cloneUrl(`${repo.owner}/${repo.name}`)
  return (
    <div className="gh-clone">
      <button className="gh-green" onClick={() => setOpen((o) => !o)}>‹›&nbsp; Code ▾</button>
      {open && (
        <div className="gh-pop">
          <div className="gh-pop-tab">Clone · HTTPS</div>
          <div className="gh-url">
            <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="URL de clone" />
            <button
              onClick={async (e) => {
                ;(e.currentTarget.previousElementSibling as HTMLInputElement).select()
                try {
                  await navigator.clipboard.writeText(url)
                } catch {
                  document.execCommand?.('copy')
                }
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? '✓' : '📋'}
            </button>
          </div>
          <small>Use esta URL com <code>git clone</code> no terminal.</small>
        </div>
      )}
    </div>
  )
}

function RepoHeader({ repo, tab }: { repo: RemoteRepo; tab: 'code' | 'commits' | 'pulls' | 'actions' | 'settings' }) {
  const base = `/${repo.owner}/${repo.name}`
  const me = github.current()
  const pending = me && github.invitationsFor(me.login).find((i) => i.repo === `${repo.owner}/${repo.name}` && i.status === 'pending')
  return (
    <>
      {pending && (
        <div className="gh-flash info">
          📨 Você foi convidado(a) para colaborar neste repositório. <span className="gh-link" onClick={() => go(`${base}/invitations`)}>Ver convite</span>
        </div>
      )}
      <div className="gh-repo-head">
        <div className="gh-title">
          <AnimeAvatar seed={3} size={24} />
          <span className="gh-link" onClick={() => go(base)}>{repo.owner} / <b>{repo.name}</b></span>
          <span className="gh-badge">Público</span>
          <span className="gh-star">☆ Star {repo.stars}</span>
        </div>
        <div className="gh-tabs">
          <span className={tab === 'code' ? 'on' : ''} onClick={() => go(base)}>‹› Código</span>
          <span className={tab === 'commits' ? 'on' : ''} onClick={() => go(`${base}/commits`)}>◷ Commits <i>{repo.commits.length}</i></span>
          <span className={tab === 'pulls' ? 'on' : ''} onClick={() => go(`${base}/pulls`)}>
            ⇄ Pull requests {github.pulls(`${repo.owner}/${repo.name}`).filter((p) => p.state === 'open').length > 0 && <i>{github.pulls(`${repo.owner}/${repo.name}`).filter((p) => p.state === 'open').length}</i>}
          </span>
          <span className={tab === 'actions' ? 'on' : ''} onClick={() => go(`${base}/actions`)}>▶ Actions</span>
          {me && github.isAdmin(me.login, `${repo.owner}/${repo.name}`) && (
            <span className={tab === 'settings' ? 'on' : ''} onClick={() => go(`${base}/settings/secrets/actions`)}>⚙ Configurações</span>
          )}
        </div>
      </div>
    </>
  )
}

function CodeView({ repo, dir, file, branch }: { repo: RemoteRepo; dir: string; file?: string; branch: string }) {
  const key = `${repo.owner}/${repo.name}`
  const list = github.branchCommits(key, branch) ?? repo.commits
  const head = list[list.length - 1]
  const base = `/${repo.owner}/${repo.name}`
  const branches = github.branchNames(key)
  const prefix = dir ? dir + '/' : ''
  const entries = new Map<string, 'dir' | 'file'>()
  for (const p of Object.keys(head.tree)) {
    if (!p.startsWith(prefix)) continue
    const rest = p.slice(prefix.length).split('/')
    entries.set(rest[0], rest.length > 1 ? 'dir' : 'file')
  }
  const sorted = [...entries].sort(([a, ta], [b, tb]) => (ta === tb ? a.localeCompare(b) : ta === 'dir' ? -1 : 1))
  const crumbs = (file ?? dir).split('/').filter(Boolean)
  const touch = file ? lastTouch(list, file) : head

  return (
    <div className="gh-body">
      {!dir && !file && <PushedBanner repo={repo} />}
      <div className="gh-bar">
        <select className="gh-branch" value={branch} aria-label="Branch" onChange={(e) => go(e.target.value === repo.branch ? base : `${base}/tree/${e.target.value}`)}>
          {branches.map((b) => (
            <option key={b} value={b}>⑂ {b}</option>
          ))}
        </select>
        {branches.length > 1 && <span className="gh-muted">{branches.length} branches</span>}
        {crumbs.length > 0 && (
          <span className="gh-crumbs">
            <span className="gh-link" onClick={() => go(base)}>{repo.name}</span>
            {crumbs.map((c, i) => (
              <span key={i}>
                {' / '}
                {i < crumbs.length - 1 || !file ? (
                  <span className="gh-link" onClick={() => go(`${base}/tree/${branch}/${crumbs.slice(0, i + 1).join('/')}`)}>{c}</span>
                ) : (
                  <b>{c}</b>
                )}
              </span>
            ))}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {!dir && !file && <CloneButton repo={repo} />}
      </div>

      {file ? (
        <div className="gh-box">
          <div className="gh-box-head">
            <AuthorAvatar email={touch.email} /> <AuthorName c={touch} /> {touch.message}
            <span className="gh-muted">{head.tree[file].split('\n').length} linhas</span>
          </div>
          <pre className="gh-code">
            {head.tree[file].replace(/\n$/, '').split('\n').map((l, i) => (
              <div key={i}><span className="ln">{i + 1}</span>{l || ' '}</div>
            ))}
          </pre>
        </div>
      ) : (
        <>
          <div className="gh-box">
            <div className="gh-box-head">
              <AuthorAvatar email={head.email} /> <AuthorName c={head} /> <span className="gh-msg">{head.message.split('\n')[0]}</span>
              <span className="ci-inline" onClick={() => { const r = lastRunStatus(`${repo.owner}/${repo.name}`, head.hash); if (r) go(`${base}/actions/runs/${r.id}`) }}>
                <StatusIcon s={lastRunStatus(`${repo.owner}/${repo.name}`, head.hash)} size={14} />
              </span>
              <span className="gh-muted">
                <code>{head.hash.slice(0, 7)}</code> · {rel(head.date)} · <span className="gh-link" onClick={() => go(`${base}/commits`)}>◷ {list.length} commits</span>
              </span>
            </div>
            {dir && (
              <div className="gh-row" onClick={() => go(dir.includes('/') ? `${base}/tree/${branch}/${dir.split('/').slice(0, -1).join('/')}` : branch === repo.branch ? base : `${base}/tree/${branch}`)}>
                <span className="gh-name">..</span>
              </div>
            )}
            {sorted.map(([name, type]) => {
              const path = prefix + name
              const c = lastTouch(list, path)
              return (
                <div key={name} className="gh-row" onClick={() => go(`${base}/${type === 'dir' ? 'tree' : 'blob'}/${branch}/${path}`)}>
                  <span className="gh-name">
                    {type === 'dir' ? <FolderIcon size={16} /> : <FileIcon size={16} />} <span className="gh-link">{name}</span>
                  </span>
                  <span className="gh-muted gh-cmsg">{c.message}</span>
                  <span className="gh-muted">{rel(c.date)}</span>
                </div>
              )
            })}
          </div>
          {!dir && <PackagesBox repo={repo} />}
          {!dir && <DeploymentsBox repo={repo} />}
          {!dir && head.tree['README.md'] && (
            <div className="gh-box gh-readme">
              <div className="gh-box-head"><b>📖 README</b></div>
              <Markdown source={head.tree['README.md']} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function PackagesBox({ repo }: { repo: RemoteRepo }) {
  const key = `${repo.owner}/${repo.name}`
  const pkg = docker.registry()[key]
  if (!pkg) return null
  return (
    <div className="gh-box gh-pkg" onClick={() => go(`/${key}/pkgs/container/${repo.name}`)}>
      <div className="gh-box-head"><b>📦 Packages</b> <span className="gh-muted">1</span></div>
      <div className="gh-pkg-row">
        <span className="gh-link"><b>{repo.name}</b></span>
        <span className="gh-muted">container · tags: {Object.keys(pkg.tags).map((t) => (/^[0-9a-f]{40}$/.test(t) ? t.slice(0, 7) : t)).join(', ')} · publicado por @{pkg.pushedBy} {rel(pkg.updated)}</span>
      </div>
    </div>
  )
}

function PackagePage({ repo }: { repo: RemoteRepo }) {
  const key = `${repo.owner}/${repo.name}`
  useEffect(() => {
    useOS.getState().onEvent({ kind: 'ui', name: 'gh:package' })
  }, [])
  const pkg = docker.registry()[key]
  if (!pkg) return <div className="gh-center"><h2>Pacote não encontrado</h2></div>
  const tags = Object.entries(pkg.tags)
  const latest = tags[tags.length - 1]
  return (
    <div className="gh-body">
      <h2>📦 {repo.name} <span className="gh-badge">Público</span></h2>
      <p className="gh-muted">Container publicado em ghcr.sim · por @{pkg.pushedBy} · {rel(pkg.updated)}</p>
      <div className="gh-box">
        <div className="gh-box-head"><b>Instalar do terminal</b></div>
        <pre className="gh-code" style={{ padding: 14 }}>docker pull ghcr.sim/{key}:{latest[0]}</pre>
      </div>
      <div className="gh-box">
        <div className="gh-box-head"><b>Versões (tags)</b></div>
        {tags.map(([t, img]) => (
          <div key={t} className="gh-token">
            <div>
              <code><b>{t}</b></code>
              <div className="gh-muted">sha256:{img.id.slice(0, 12)} · {img.sizeMb.toFixed(0)} MB · base {img.base}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function CommitsView({ repo }: { repo: RemoteRepo }) {
  const list = [...repo.commits].reverse()
  const key = `${repo.owner}/${repo.name}`
  return (
    <div className="gh-body">
      <h3 className="gh-h">Commits no branch {repo.branch}</h3>
      <div className="gh-box">
        {list.map((c, i) => (
          <div key={c.hash} className={`gh-commit ${i === 0 ? 'newest' : ''}`}>
            <div>
              <div className="gh-msg">
                {c.message.split('\n')[0]}{' '}
                <span className="ci-inline" onClick={() => { const r = lastRunStatus(key, c.hash); if (r) go(`/${key}/actions/runs/${r.id}`) }}>
                  <StatusIcon s={lastRunStatus(key, c.hash)} size={14} />
                </span>
              </div>
              <div className="gh-muted">
                <AuthorAvatar email={c.email} size={18} /> <AuthorName c={c} /> fez commit {rel(c.date)}
              </div>
            </div>
            <code>{c.hash.slice(0, 7)}</code>
          </div>
        ))}
      </div>
    </div>
  )
}

export function GitHubPage({ path, query }: { path: string; query: URLSearchParams }) {
  useOS((s) => s.version)
  const parts = path.split('/').filter(Boolean)
  const me = github.current()
  if (!parts.length) return me ? <Dashboard /> : <Landing />
  if (parts[0] === 'signup') return parts[1] === 'verify' ? <VerifyPending /> : <Signup />
  if (parts[0] === 'login') return <Login />
  if (parts[0] === 'verify') return <Verify token={query.get('token') ?? ''} />
  if (parts[0] === 'notifications') return <RequireLogin><Notifications /></RequireLogin>
  if (parts[0] === 'settings') return <RequireLogin>{parts[2] === 'new' ? <NewToken /> : <Tokens />}</RequireLogin>
  if (parts.length === 1) return <Profile login={parts[0]} />
  const repo = github.get(`${parts[0]}/${parts[1]}`)
  if (!repo) return <NotFound />
  const [, , kind] = parts
  // /tree/<branch>/<caminho>: o nome do branch pode ter "/", então pega o maior prefixo que é um branch
  let branch = repo.branch
  let rest = parts.slice(4)
  if (kind === 'tree' || kind === 'blob') {
    const after = parts.slice(3)
    const names = github.branchNames(`${repo.owner}/${repo.name}`)
    for (let i = after.length; i > 0; i--) {
      const cand = after.slice(0, i).join('/')
      if (names.includes(cand)) {
        branch = cand
        rest = after.slice(i)
        break
      }
    }
  }
  if (kind === 'pkgs')
    return (
      <Frame>
        <RepoHeader repo={repo} tab="code" />
        <PackagePage repo={repo} />
      </Frame>
    )
  if (kind === 'invitations') return <RequireLogin><Invitation repo={repo} /></RequireLogin>
  if (kind === 'pulls' || kind === 'pull' || kind === 'compare') {
    const tail = parts.slice(3).join('/')
    return (
      <Frame>
        <RepoHeader repo={repo} tab="pulls" />
        {kind === 'pulls' ? (
          <PullsList repo={repo} />
        ) : kind === 'compare' ? (
          <Compare repo={repo} spec={tail} />
        ) : parts[3] === 'new' ? (
          <Compare repo={repo} spec={`${repo.branch}...${parts.slice(4).join('/')}`} />
        ) : (
          <PullView repo={repo} n={Number(parts[3])} tab={parts[4] === 'commits' ? 'commits' : parts[4] === 'files' ? 'files' : 'conversation'} />
        )}
      </Frame>
    )
  }
  if (kind === 'actions')
    return (
      <Frame>
        <RepoHeader repo={repo} tab="actions" />
        {parts[3] === 'runs' && parts[4] ? <RunView repo={repo} id={Number(parts[4])} /> : <ActionsList repo={repo} />}
      </Frame>
    )
  if (kind === 'settings') {
    const ok = me && github.isAdmin(me.login, `${repo.owner}/${repo.name}`)
    return (
      <RequireLogin>
        <Frame>
          <RepoHeader repo={repo} tab="settings" />
          {ok ? <SecretsPage repo={repo} initial={parts[3] === 'branches' ? 'branches' : parts[3] === 'environments' ? 'environments' : parts[3] === 'pages' ? 'pages' : 'secrets'} /> : <div className="gh-center"><h2>404 · Somente administradores do repositório podem ver as configurações.</h2></div>}
        </Frame>
      </RequireLogin>
    )
  }
  const sub = rest.join('/')
  return (
    <Frame>
      <RepoHeader repo={repo} tab={kind === 'commits' ? 'commits' : 'code'} />
      {kind === 'commits' ? (
        <CommitsView repo={repo} />
      ) : kind === 'blob' && github.branchHead(`${repo.owner}/${repo.name}`, branch)?.tree[sub] !== undefined ? (
        <CodeView repo={repo} dir="" file={sub} branch={branch} />
      ) : (
        <CodeView repo={repo} dir={kind === 'tree' ? sub : ''} branch={branch} />
      )}
    </Frame>
  )
}
