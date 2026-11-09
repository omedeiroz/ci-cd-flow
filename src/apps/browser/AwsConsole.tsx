// Console da "AWS" simulada (console.aws.sim): login IAM, EC2, pares de chaves e security groups.
import { useState } from 'react'
import { AMIS, aws, INSTANCE_TYPES, RULE_PORTS, type Instance, type Rule, type RuleType } from '../../engine/aws'
import { localFs, useOS } from '../../store/os'

const go = (p: string) => useOS.getState().openBrowser(`https://console.aws.sim${p}`)

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    /* sem permissão: o texto continua selecionável */
  }
}
const Copy = ({ text }: { text: string }) => (
  <button className="aws-copy" title="Copiar" onClick={() => copy(text)}>
    ⧉
  </button>
)

// ---------- login ----------

function SignIn() {
  const [acct, setAcct] = useState('')
  const [user, setUser] = useState('')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [change, setChange] = useState(false)
  const [n1, setN1] = useState('')
  const [n2, setN2] = useState('')
  if (change)
    return (
      <div className="aws-signin">
        <div className="aws-signin-logo">aws<span>.sim</span></div>
        <form
          className="aws-signin-card"
          onSubmit={(e) => {
            e.preventDefault()
            const r = aws.changePassword(pw, n1, n2)
            if (r) setErr(r)
            else go('/')
          }}
        >
          <h2>Alterar senha</h2>
          <p className="aws-muted">
            Você precisa alterar sua senha para continuar.
            <br />
            Conta: {acct} · Usuário: {user}
          </p>
          {err && <div className="aws-alert error">{err}</div>}
          <label>Senha antiga<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          <label>Nova senha<input type="password" value={n1} onChange={(e) => setN1(e.target.value)} /></label>
          <label>Confirme a nova senha<input type="password" value={n2} onChange={(e) => setN2(e.target.value)} /></label>
          <small className="aws-muted">Mínimo de 8 caracteres, com letra maiúscula, minúscula, número e símbolo (ex.: !@#$).</small>
          <button className="aws-btn primary wide">Confirmar alteração de senha</button>
        </form>
      </div>
    )
  return (
    <div className="aws-signin">
      <div className="aws-signin-logo">aws<span>.sim</span></div>
      <form
        className="aws-signin-card"
        onSubmit={(e) => {
          e.preventDefault()
          const r = aws.login(acct, user, pw)
          if (r === 'change') {
            setErr('')
            setChange(true)
          } else if (r !== 'ok') setErr(r)
        }}
      >
        <h2>Fazer login como usuário do IAM</h2>
        {err && <div className="aws-alert error">{err}</div>}
        <label>
          ID da conta (12 dígitos) ou alias
          <input value={acct} onChange={(e) => setAcct(e.target.value)} placeholder="4821-3390-1177" />
        </label>
        <label>
          Nome do usuário do IAM
          <input value={user} onChange={(e) => setUser(e.target.value)} />
        </label>
        <label>
          Senha
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <button className="aws-btn primary wide">Fazer login</button>
        <small className="aws-muted">Login com o e-mail do usuário raiz · Esqueceu a senha?</small>
      </form>
      <p className="aws-muted small">Ambiente simulado para fins educacionais. Nenhum recurso real é criado.</p>
    </div>
  )
}

// ---------- moldura ----------

function Frame({ children, nav }: { children: React.ReactNode; nav?: string }) {
  const [menu, setMenu] = useState(false)
  return (
    <div className="aws">
      <div className="aws-top">
        <span className="aws-logo" onClick={() => go('/')}>aws<span>.sim</span></span>
        <span className="aws-services" onClick={() => go('/')}>☷ Serviços</span>
        <div className="aws-search">🔍 Pesquisar serviços, recursos… <kbd>Alt+S</kbd></div>
        <span className="aws-region">São Paulo ▾</span>
        <span className="aws-acct" onClick={() => setMenu((m) => !m)}>
          {aws.account.user} @ 4821-3390-1177 ▾
        </span>
        {menu && (
          <div className="aws-menu" onMouseLeave={() => setMenu(false)}>
            <div className="aws-muted">ID da conta: 4821-3390-1177</div>
            <div className="aws-muted">Usuário do IAM: {aws.account.user}</div>
            <hr />
            <div onClick={() => aws.logout()}>Sair</div>
          </div>
        )}
      </div>
      {nav ? (
        <div className="aws-ec2">
          <aside>
            <div className="aws-side-title" onClick={() => go('/ec2/instances')}>EC2</div>
            <div className="aws-side-group">Instâncias</div>
            <div className={nav === 'instances' ? 'on' : ''} onClick={() => go('/ec2/instances')}>Instâncias</div>
            <div className="aws-side-group">Rede e segurança</div>
            <div className={nav === 'sg' ? 'on' : ''} onClick={() => go('/ec2/sg')}>Security Groups</div>
            <div className={nav === 'keys' ? 'on' : ''} onClick={() => go('/ec2/keypairs')}>Pares de chaves</div>
          </aside>
          <main>{children}</main>
        </div>
      ) : (
        children
      )}
    </div>
  )
}

function Home() {
  return (
    <Frame>
      <div className="aws-home">
        <h1>Página inicial do console</h1>
        <div className="aws-widgets">
          <div className="aws-panel">
            <h3>Visitados recentemente</h3>
            <div className="aws-svc" onClick={() => go('/ec2/instances')}>
              <span className="aws-svc-ic ec2">▣</span> EC2
            </div>
            <div className="aws-svc dim"><span className="aws-svc-ic iam">⚿</span> IAM</div>
            <div className="aws-svc dim"><span className="aws-svc-ic s3">◫</span> S3</div>
          </div>
          <div className="aws-panel">
            <h3>Bem-vindo à AWS</h3>
            <p>
              <b>EC2</b> (Elastic Compute Cloud) fornece servidores virtuais (instâncias) que você liga em minutos e paga por hora.
            </p>
            <button className="aws-btn primary" onClick={() => go('/ec2/instances')}>Ir para o EC2</button>
          </div>
          <div className="aws-panel">
            <h3>Custo e uso</h3>
            <div className="aws-big">US$ 0,00</div>
            <p className="aws-muted">Custo do mês atual · Nível gratuito</p>
          </div>
        </div>
      </div>
    </Frame>
  )
}

// ---------- instâncias ----------

const STATE: Record<Instance['state'], [string, string]> = {
  pending: ['Pendente', 'pend'],
  running: ['Executando', 'ok'],
  stopping: ['Interrompendo', 'pend'],
  stopped: ['Interrompida', 'off'],
  'shutting-down': ['Encerrando', 'pend'],
  terminated: ['Encerrada', 'off'],
}

function Instances() {
  const list = aws.instances()
  const [sel, setSel] = useState<string | null>(list[0]?.id ?? null)
  const [tab, setTab] = useState<'details' | 'security'>('details')
  const [menu, setMenu] = useState(false)
  const [actions, setActions] = useState(false)
  const inst = list.find((i) => i.id === sel)
  const sg = inst ? aws.group(inst.sgId) : undefined
  return (
    <Frame nav="instances">
      <div className="aws-card">
        <div className="aws-card-head">
          <h2>Instâncias <span className="aws-muted">({list.length})</span></h2>
          <div className="aws-actions">
            <button className="aws-btn" onClick={() => useOS.getState().openBrowser('https://console.aws.sim/ec2/instances')}>↻</button>
            <button className="aws-btn" disabled={!inst || inst.state !== 'running'} onClick={() => inst && go(`/ec2/instances/${inst.id}/connect`)}>Conectar</button>
            <div className="aws-dd">
              <button className="aws-btn" disabled={!inst} onClick={() => setMenu((m) => !m)}>Estado da instância ▾</button>
              {menu && inst && (
                <div className="aws-menu" onMouseLeave={() => setMenu(false)}>
                  <div onClick={() => (aws.setState(inst.id, 'stop'), setMenu(false))}>Interromper instância</div>
                  <div onClick={() => (aws.setState(inst.id, 'start'), setMenu(false))}>Iniciar instância</div>
                  <div className="danger" onClick={() => (aws.setState(inst.id, 'terminate'), setMenu(false))}>Encerrar (excluir) instância</div>
                </div>
              )}
            </div>
            <div className="aws-dd">
              <button className="aws-btn" disabled={!inst} onClick={() => setActions((m) => !m)}>Ações ▾</button>
              {actions && inst && (
                <div className="aws-menu" onMouseLeave={() => setActions(false)}>
                  <div onClick={() => (go(`/ec2/instances/${inst.id}/security`), setActions(false))}>Segurança › Alterar grupo de segurança</div>
                </div>
              )}
            </div>
            <button className="aws-btn primary" onClick={() => go('/ec2/launch')}>Executar instâncias ▾</button>
          </div>
        </div>
        <table className="aws-table">
          <thead>
            <tr>
              <th />
              <th>Name</th>
              <th>ID da instância</th>
              <th>Estado da instância</th>
              <th>Tipo</th>
              <th>Verificação de status</th>
              <th>Zona de disponibilidade</th>
              <th>IPv4 público</th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={8} className="aws-empty">
                  <b>Nenhuma instância</b>
                  <br />
                  Você não tem instâncias nesta região.
                  <br />
                  <button className="aws-btn primary" onClick={() => go('/ec2/launch')}>Executar instâncias</button>
                </td>
              </tr>
            )}
            {list.map((i) => (
              <tr key={i.id} className={i.id === sel ? 'sel' : ''} onClick={() => setSel(i.id)}>
                <td><input type="radio" readOnly checked={i.id === sel} /></td>
                <td>{i.name || '–'}</td>
                <td className="aws-link">{i.id}</td>
                <td><span className={`aws-state ${STATE[i.state][1]}`}>{STATE[i.state][0]}</span></td>
                <td>{i.type}</td>
                <td>{i.state !== 'running' ? '–' : i.checks === 'ok' ? <span className="aws-checks ok">✓ 2/2 verificações aprovadas</span> : <span className="aws-checks">◌ Inicializando</span>}</td>
                <td>{i.az}</td>
                <td>{i.state === 'running' || i.state === 'pending' ? i.publicIp : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {inst && (
        <div className="aws-card">
          <h3>Instância: {inst.id} {inst.name && `(${inst.name})`}</h3>
          <div className="aws-tabs">
            <span className={tab === 'details' ? 'on' : ''} onClick={() => setTab('details')}>Detalhes</span>
            <span className={tab === 'security' ? 'on' : ''} onClick={() => setTab('security')}>Segurança</span>
          </div>
          {tab === 'details' ? (
            <div className="aws-kv">
              <div><span>ID da instância</span>{inst.id}</div>
              <div><span>Endereço IPv4 público</span>{inst.state === 'running' ? <>{inst.publicIp} <Copy text={inst.publicIp} /></> : '–'}</div>
              <div><span>Endereços IPv4 privados</span>{inst.privateIp}</div>
              <div><span>Estado da instância</span><span className={`aws-state ${STATE[inst.state][1]}`}>{STATE[inst.state][0]}</span></div>
              <div><span>DNS IPv4 público</span>{inst.state === 'running' ? <>{aws.publicDns(inst)} <Copy text={aws.publicDns(inst)} /></> : '–'}</div>
              <div><span>Tipo de instância</span>{inst.type}</div>
              <div><span>ID da AMI</span>{inst.ami.id} ({inst.ami.short})</div>
              <div><span>Nome do par de chaves</span>{inst.keyName}</div>
              <div><span>Plataforma</span>{inst.ami.label}</div>
            </div>
          ) : (
            <div>
              <p>
                Security groups: <span className="aws-link" onClick={() => go(`/ec2/sg/${inst.sgId}`)}>{inst.sgId} ({sg?.name})</span>
                {' · '}
                <span className="aws-link" onClick={() => go(`/ec2/instances/${inst.id}/security`)}>Alterar grupo</span>
              </p>
              <p className="aws-muted small">Regras de entrada que valem para esta instância:</p>
              <RulesTable rules={sg?.rules ?? []} />
            </div>
          )}
        </div>
      )}
    </Frame>
  )
}

function RulesTable({ rules }: { rules: Rule[] }) {
  return (
    <table className="aws-table small">
      <thead>
        <tr><th>Tipo</th><th>Protocolo</th><th>Intervalo de portas</th><th>Origem</th><th>Descrição</th></tr>
      </thead>
      <tbody>
        {rules.length === 0 && <tr><td colSpan={5} className="aws-empty">Nenhuma regra de entrada: todo tráfego de entrada é bloqueado.</td></tr>}
        {rules.map((r) => (
          <tr key={r.id}><td>{r.type}</td><td>TCP</td><td>{r.port}</td><td>{r.source}</td><td>{r.description || '–'}</td></tr>
        ))}
      </tbody>
    </table>
  )
}

function Connect({ id }: { id: string }) {
  const inst = aws.instances().find((i) => i.id === id)
  if (!inst) return <Instances />
  const dns = aws.publicDns(inst)
  const cmd = `ssh -i "${inst.keyName}.pem" ${inst.ami.user}@${dns}`
  return (
    <Frame nav="instances">
      <div className="aws-card">
        <h2>Conectar-se à instância</h2>
        <p className="aws-muted">Conecte-se à sua instância {inst.id} ({inst.name}) usando qualquer uma destas opções</p>
        <div className="aws-tabs">
          <span className="off">EC2 Instance Connect</span>
          <span className="off">Gerenciador de sessões</span>
          <span className="on">Cliente SSH</span>
        </div>
        <ol className="aws-steps">
          <li>Abra um cliente SSH (o Terminal).</li>
          <li>Localize seu arquivo de chave privada. A chave usada para executar esta instância é <b>{inst.keyName}.pem</b></li>
          <li>Execute este comando, se necessário, para garantir que sua chave não esteja visível publicamente.<pre>chmod 400 "{inst.keyName}.pem" <Copy text={`chmod 400 "${inst.keyName}.pem"`} /></pre></li>
          <li>Conecte-se à instância usando o DNS público:<pre>{dns} <Copy text={dns} /></pre></li>
        </ol>
        <p><b>Exemplo:</b></p>
        <pre className="aws-pre">{cmd} <Copy text={cmd} /></pre>
        <div className="aws-alert info">
          Observação: o usuário padrão da AMI {inst.ami.short} é <b>{inst.ami.user}</b>. Se a chave estiver em Downloads, use o caminho completo: ~/Downloads/{inst.keyName}.pem
        </div>
      </div>
    </Frame>
  )
}

// ---------- assistente de execução ----------

function KeyPairModal({ onClose }: { onClose: (name?: string) => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<'RSA' | 'ED25519'>('RSA')
  const [err, setErr] = useState('')
  return (
    <div className="aws-modal-bg">
      <div className="aws-modal">
        <h3>Criar par de chaves</h3>
        <label>
          Nome do par de chaves
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="todo-key" autoFocus />
          <small className="aws-muted">O nome pode incluir até 255 caracteres ASCII.</small>
        </label>
        {err && <div className="aws-alert error">{err}</div>}
        <div className="aws-radio">
          <span>Tipo de par de chaves</span>
          <label><input type="radio" checked={type === 'RSA'} onChange={() => setType('RSA')} /> RSA</label>
          <label><input type="radio" checked={type === 'ED25519'} onChange={() => setType('ED25519')} /> ED25519</label>
        </div>
        <div className="aws-radio">
          <span>Formato de arquivo de chave privada</span>
          <label><input type="radio" checked readOnly /> .pem <small className="aws-muted">(para usar com OpenSSH)</small></label>
          <label className="dim"><input type="radio" disabled /> .ppk <small className="aws-muted">(para usar com PuTTY)</small></label>
        </div>
        <div className="aws-alert warn">Quando solicitado, armazene a chave privada em um local seguro e acessível no seu computador. Você precisará dela mais tarde para se conectar à instância.</div>
        <div className="aws-modal-foot">
          <button className="aws-btn" onClick={() => onClose()}>Cancelar</button>
          <button
            className="aws-btn primary"
            onClick={() => {
              const n = name.trim()
              const r = aws.createKeyPair(n, type, localFs)
              if (r) setErr(r)
              else onClose(n)
            }}
          >
            Criar par de chaves
          </button>
        </div>
      </div>
    </div>
  )
}

function Launch() {
  const [name, setName] = useState('')
  const [ami, setAmi] = useState(AMIS[0])
  const [type, setType] = useState('t2.micro')
  const [key, setKey] = useState(aws.keyPairs()[0]?.name ?? '')
  const [modal, setModal] = useState(false)
  const [sgMode, setSgMode] = useState<'new' | 'existing'>('new')
  const [existing, setExisting] = useState(aws.groups()[0].id)
  const [ssh, setSsh] = useState(true)
  const [sshFrom, setSshFrom] = useState('0.0.0.0/0')
  const [https, setHttps] = useState(false)
  const [http, setHttp] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState<Instance | null>(null)
  const [toast, setToast] = useState('')

  if (done)
    return (
      <Frame nav="instances">
        <div className="aws-card">
          <div className="aws-alert success">
            <b>Êxito</b>
            <br />
            Execução da instância iniciada com sucesso (<span className="aws-link" onClick={() => go('/ec2/instances')}>{done.id}</span>)
          </div>
          <button className="aws-btn primary" onClick={() => go('/ec2/instances')}>Visualizar todas as instâncias</button>
        </div>
      </Frame>
    )

  const launch = () => {
    if (!key) return setErr('Selecione um par de chaves. Sem ele, você não conseguirá acessar a instância por SSH.')
    let sgId = existing
    if (sgMode === 'new') {
      const rules: Omit<Rule, 'id'>[] = []
      if (ssh) rules.push({ type: 'SSH', port: 22, source: sshFrom })
      if (https) rules.push({ type: 'HTTPS', port: 443, source: '0.0.0.0/0' })
      if (http) rules.push({ type: 'HTTP', port: 80, source: '0.0.0.0/0' })
      sgId = aws.createGroup('', `launch-wizard created ${new Date().toISOString()}`, rules).id
    }
    setDone(aws.launch({ name: name.trim(), ami, type, keyName: key, sgId }))
  }

  return (
    <Frame nav="instances">
      {modal && (
        <KeyPairModal
          onClose={(n) => {
            setModal(false)
            if (n) {
              setKey(n)
              setToast(`${n}.pem foi baixado para a pasta Downloads.`)
              setTimeout(() => setToast(''), 5000)
            }
          }}
        />
      )}
      {toast && <div className="aws-toast">⬇ {toast}</div>}
      <div className="aws-launch">
        <div className="aws-launch-main">
          <h2>Executar uma instância</h2>
          <p className="aws-muted">O Amazon EC2 permite que você crie máquinas virtuais, ou instâncias, que são executadas na nuvem.</p>

          <section className="aws-card">
            <h3>Nome e tags</h3>
            <label className="aws-field">Nome<input value={name} onChange={(e) => setName(e.target.value)} placeholder="por exemplo, Meu servidor web" /></label>
          </section>

          <section className="aws-card">
            <h3>Imagens de aplicações e sistemas operacionais (Imagem de máquina da Amazon)</h3>
            <p className="aws-muted">Uma AMI é um modelo que contém o sistema operacional e os programas necessários para executar sua instância.</p>
            <div className="aws-amis">
              {AMIS.map((a) => (
                <div key={a.id} className={`aws-ami ${a.id === ami.id ? 'on' : ''}`} onClick={() => setAmi(a)}>
                  <span className={`aws-os ${a.os}`}>{a.os === 'ubuntu' ? '◉' : a.os === 'debian' ? '◎' : '▲'}</span>
                  {a.short}
                </div>
              ))}
            </div>
            <div className="aws-ami-detail">
              <b>{ami.label}</b>
              <div className="aws-muted">{ami.id} · {ami.desc}</div>
            </div>
          </section>

          <section className="aws-card">
            <h3>Tipo de instância</h3>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {INSTANCE_TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.id}{t.free ? '  (nível gratuito)' : ''}
                </option>
              ))}
            </select>
            {(() => {
              const t = INSTANCE_TYPES.find((x) => x.id === type)!
              return (
                <div className="aws-type-detail">
                  <span><b>{t.vcpu}</b> vCPU</span>
                  <span><b>{t.mem}</b> memória</span>
                  <span>Linux: <b>{t.price}</b></span>
                  {t.free && <span className="aws-free">Qualificado para o nível gratuito</span>}
                </div>
              )
            })()}
          </section>

          <section className="aws-card">
            <h3>Par de chaves (login)</h3>
            <p className="aws-muted">Você pode usar um par de chaves para se conectar com segurança à sua instância. Garanta que você tenha acesso ao par de chaves selecionado antes de executar a instância.</p>
            <div className="aws-row">
              <select value={key} onChange={(e) => setKey(e.target.value)}>
                <option value="">Selecionar</option>
                {aws.keyPairs().map((k) => (
                  <option key={k.name} value={k.name}>{k.name}</option>
                ))}
              </select>
              <span className="aws-link" onClick={() => setModal(true)}>Criar novo par de chaves</span>
            </div>
          </section>

          <section className="aws-card">
            <h3>Configurações de rede</h3>
            <p className="aws-muted">VPC: vpc-0d3f (padrão) · Sub-rede: sem preferência · Atribuir IP público automaticamente: Habilitar</p>
            <div className="aws-radio">
              <span>Firewall (grupos de segurança)</span>
              <label><input type="radio" checked={sgMode === 'new'} onChange={() => setSgMode('new')} /> Criar grupo de segurança</label>
              <label><input type="radio" checked={sgMode === 'existing'} onChange={() => setSgMode('existing')} /> Selecionar grupo de segurança existente</label>
            </div>
            {sgMode === 'existing' ? (
              <select value={existing} onChange={(e) => setExisting(e.target.value)}>
                {aws.groups().map((g) => (
                  <option key={g.id} value={g.id}>{g.name} ({g.id})</option>
                ))}
              </select>
            ) : (
              <div className="aws-checks-list">
                <label>
                  <input type="checkbox" checked={ssh} onChange={(e) => setSsh(e.target.checked)} /> Permitir tráfego SSH de
                  <select value={sshFrom} onChange={(e) => setSshFrom(e.target.value)} disabled={!ssh}>
                    <option value="0.0.0.0/0">Qualquer lugar (0.0.0.0/0)</option>
                    <option value={`${aws.myIp}/32`}>Meu IP ({aws.myIp}/32)</option>
                  </select>
                  <small className="aws-muted">Útil para se conectar à sua instância</small>
                </label>
                <label><input type="checkbox" checked={https} onChange={(e) => setHttps(e.target.checked)} /> Permitir tráfego HTTPS da Internet</label>
                <label><input type="checkbox" checked={http} onChange={(e) => setHttp(e.target.checked)} /> Permitir tráfego HTTP da Internet</label>
                {ssh && sshFrom === '0.0.0.0/0' && (
                  <div className="aws-alert warn">Regras com origem 0.0.0.0/0 permitem que todos os endereços IP acessem sua instância. Recomendamos configurar regras para permitir acesso somente a partir de endereços IP conhecidos.</div>
                )}
              </div>
            )}
          </section>

          <section className="aws-card">
            <h3>Configurar armazenamento</h3>
            <p>1x <b>8</b> GiB <b>gp3</b> Volume raiz (não criptografado)</p>
          </section>
        </div>

        <aside className="aws-summary">
          <h3>Resumo</h3>
          <label className="aws-field">Número de instâncias<input value="1" readOnly /></label>
          <div><span>Imagem de software (AMI)</span>{ami.label}</div>
          <div><span>Tipo de servidor virtual (tipo de instância)</span>{type}</div>
          <div><span>Firewall (grupo de segurança)</span>{sgMode === 'new' ? 'Novo grupo de segurança' : aws.group(existing)?.name}</div>
          <div><span>Armazenamento (volumes)</span>1 volume(s) – 8 GiB</div>
          {INSTANCE_TYPES.find((t) => t.id === type)?.free && <div className="aws-alert info small">Nível gratuito: no primeiro ano, 750 horas por mês de uso de t2.micro.</div>}
          {err && <div className="aws-alert error">{err}</div>}
          <div className="aws-summary-foot">
            <button className="aws-btn" onClick={() => go('/ec2/instances')}>Cancelar</button>
            <button className="aws-btn primary" onClick={launch}>Executar instância</button>
          </div>
        </aside>
      </div>
    </Frame>
  )
}

// ---------- pares de chaves e security groups ----------

function KeyPairs() {
  const [modal, setModal] = useState(false)
  return (
    <Frame nav="keys">
      {modal && <KeyPairModal onClose={() => setModal(false)} />}
      <div className="aws-card">
        <div className="aws-card-head">
          <h2>Pares de chaves <span className="aws-muted">({aws.keyPairs().length})</span></h2>
          <button className="aws-btn primary" onClick={() => setModal(true)}>Criar par de chaves</button>
        </div>
        <table className="aws-table">
          <thead><tr><th>Nome</th><th>Tipo</th><th>Hora da criação</th><th>Impressão digital</th></tr></thead>
          <tbody>
            {aws.keyPairs().length === 0 && <tr><td colSpan={4} className="aws-empty">Nenhum par de chaves</td></tr>}
            {aws.keyPairs().map((k) => (
              <tr key={k.name}><td>{k.name}</td><td>{k.type.toLowerCase()}</td><td>{new Date(k.created).toLocaleString('pt-BR')}</td><td className="mono">{k.fingerprint.slice(0, 35)}…</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  )
}

function Groups() {
  return (
    <Frame nav="sg">
      <div className="aws-card">
        <h2>Security Groups <span className="aws-muted">({aws.groups().length})</span></h2>
        <table className="aws-table">
          <thead><tr><th>Nome</th><th>ID do grupo de segurança</th><th>Descrição</th><th>Regras de entrada</th></tr></thead>
          <tbody>
            {aws.groups().map((g) => (
              <tr key={g.id} onClick={() => go(`/ec2/sg/${g.id}`)}>
                <td>{g.name}</td><td className="aws-link">{g.id}</td><td>{g.description}</td><td>{g.rules.length} entradas de permissão</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Frame>
  )
}

function Group({ id }: { id: string }) {
  const g = aws.group(id)
  if (!g) return <Groups />
  const used = aws.instances().filter((i) => i.sgId === id && i.state !== 'terminated')
  return (
    <Frame nav="sg">
      <div className="aws-card">
        <div className="aws-card-head">
          <h2>{g.id} – {g.name}</h2>
          <button className="aws-btn primary" onClick={() => go(`/ec2/sg/${id}/edit`)}>Editar regras de entrada</button>
        </div>
        <p className="aws-muted">{g.description}</p>
        {used.length ? (
          <div className="aws-alert info">Usado por: {used.map((i) => i.name || i.id).join(', ')}. Mudanças nas regras valem na hora para essas instâncias.</div>
        ) : (
          <div className="aws-alert warn">
            Nenhuma instância usa este grupo, então as regras dele não afetam nenhum servidor.
            {aws.instances().some((i) => i.state !== 'terminated') && ' Para liberar uma porta, edite o grupo que aparece na aba Segurança da instância ou troque o grupo da instância (Instâncias › Ações › Segurança).'}
          </div>
        )}
        <h3>Regras de entrada ({g.rules.length})</h3>
        <RulesTable rules={g.rules} />
        <p className="aws-muted small">Regras de saída: todo o tráfego liberado (0.0.0.0/0).</p>
      </div>
    </Frame>
  )
}

type Draft = { type: RuleType; port: string; source: string; description: string }

function EditRules({ id }: { id: string }) {
  const g = aws.group(id)
  const [rows, setRows] = useState<Draft[]>(() => (g?.rules ?? []).map((r) => ({ type: r.type, port: String(r.port), source: r.source, description: r.description ?? '' })))
  const [err, setErr] = useState('')
  if (!g) return <Groups />
  const upd = (i: number, patch: Partial<Draft>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const save = () => {
    for (const r of rows) {
      const p = Number(r.port)
      if (!Number.isInteger(p) || p < 1 || p > 65535) return setErr('Informe uma porta válida (1–65535) em todas as regras.')
      if (!/^\d+\.\d+\.\d+\.\d+\/\d+$/.test(r.source)) return setErr('A origem deve ser um bloco CIDR, como 0.0.0.0/0.')
    }
    aws.setRules(id, rows.map((r) => ({ type: r.type, port: Number(r.port), source: r.source, description: r.description })))
    go(`/ec2/sg/${id}`)
  }
  return (
    <Frame nav="sg">
      <div className="aws-card">
        <h2>Editar regras de entrada</h2>
        <p className="aws-muted">As regras de entrada controlam o tráfego de entrada que pode chegar à instância. · {g.id} – {g.name}</p>
        {!aws.instances().some((i) => i.sgId === id && i.state !== 'terminated') && (
          <div className="aws-alert warn">Atenção: nenhuma instância usa este grupo. As regras salvas aqui não vão liberar nada até o grupo ser ligado a uma instância.</div>
        )}
        <table className="aws-table edit">
          <thead><tr><th>Tipo</th><th>Protocolo</th><th>Intervalo de portas</th><th>Origem</th><th>Descrição - opcional</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td>
                  <select value={r.type} onChange={(e) => {
                    const t = e.target.value as RuleType
                    upd(i, { type: t, port: t === 'TCP personalizado' ? r.port : String(RULE_PORTS[t]) })
                  }}>
                    {(Object.keys(RULE_PORTS) as RuleType[]).map((t) => <option key={t}>{t}</option>)}
                  </select>
                </td>
                <td>TCP</td>
                <td><input value={r.port} disabled={r.type !== 'TCP personalizado'} onChange={(e) => upd(i, { port: e.target.value })} placeholder="3000" /></td>
                <td>
                  <select
                    value={r.source === '0.0.0.0/0' ? 'any' : r.source === `${aws.myIp}/32` ? 'me' : 'custom'}
                    onChange={(e) => upd(i, { source: e.target.value === 'any' ? '0.0.0.0/0' : e.target.value === 'me' ? `${aws.myIp}/32` : '' })}
                  >
                    <option value="custom">Personalizado</option>
                    <option value="any">Qualquer local-IPv4</option>
                    <option value="me">Meu IP</option>
                  </select>
                  <input value={r.source} onChange={(e) => upd(i, { source: e.target.value })} placeholder="0.0.0.0/0" />
                </td>
                <td><input value={r.description} onChange={(e) => upd(i, { description: e.target.value })} /></td>
                <td><button className="aws-btn" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>Excluir</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="aws-btn" onClick={() => setRows((rs) => [...rs, { type: 'TCP personalizado', port: '', source: '', description: '' }])}>Adicionar regra</button>
        {rows.some((r) => r.source === '0.0.0.0/0') && <div className="aws-alert warn">Regras com origem 0.0.0.0/0 permitem que todos os endereços IP acessem sua instância.</div>}
        {err && <div className="aws-alert error">{err}</div>}
        <div className="aws-summary-foot">
          <button className="aws-btn" onClick={() => go(`/ec2/sg/${id}`)}>Cancelar</button>
          <button className="aws-btn primary" onClick={save}>Salvar regras</button>
        </div>
      </div>
    </Frame>
  )
}

function ChangeGroup({ id }: { id: string }) {
  const inst = aws.instances().find((i) => i.id === id)
  const [sg, setSg] = useState(inst?.sgId ?? '')
  if (!inst) return <Instances />
  const g = aws.group(sg)
  return (
    <Frame nav="instances">
      <div className="aws-card">
        <h2>Alterar grupo de segurança</h2>
        <p className="aws-muted">Instância {inst.id} {inst.name && `(${inst.name})`}. O grupo de segurança é o firewall: só as regras dele valem para esta instância.</p>
        <label className="aws-field">
          <span>Grupo de segurança</span>
          <select value={sg} onChange={(e) => setSg(e.target.value)} aria-label="Grupo de segurança">
            {aws.groups().map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} ({x.id}){x.id === inst.sgId ? ' · atual' : ''}
              </option>
            ))}
          </select>
        </label>
        {g && (
          <>
            <h3>Regras de entrada de {g.name}</h3>
            <RulesTable rules={g.rules} />
            {!g.rules.some((r) => r.port === 22) && <div className="aws-alert warn">Este grupo não libera a porta 22: você não vai conseguir entrar por SSH.</div>}
          </>
        )}
        <div className="aws-summary-foot">
          <button className="aws-btn" onClick={() => go('/ec2/instances')}>Cancelar</button>
          <button className="aws-btn primary" disabled={sg === inst.sgId} onClick={() => (aws.setInstanceGroup(inst.id, sg), go('/ec2/instances'))}>Salvar</button>
        </div>
      </div>
    </Frame>
  )
}

export function AwsConsole({ path }: { path: string }) {
  useOS((s) => s.version)
  if (!aws.loggedIn) return <SignIn />
  const p = path.split('/').filter(Boolean)
  if (p[0] !== 'ec2') return <Home />
  if (p[1] === 'launch') return <Launch />
  if (p[1] === 'keypairs') return <KeyPairs />
  if (p[1] === 'sg' && p[2]) return p[3] === 'edit' ? <EditRules id={p[2]} /> : <Group id={p[2]} />
  if (p[1] === 'sg') return <Groups />
  if (p[1] === 'instances' && p[2] && p[3] === 'connect') return <Connect id={p[2]} />
  if (p[1] === 'instances' && p[2] && p[3] === 'security') return <ChangeGroup id={p[2]} />
  return <Instances />
}
