// "AWS" simulada: conta IAM, EC2 (instâncias, pares de chaves, security groups),
// servidores Linux remotos, ssh e gerenciador de pacotes (apt/dnf).
import { dir, file, VFS, vfsDump, vfsLoad, type VfsJSON } from './fs'
import { C, fail, ok, registerCommand, Shell, machineDump, machineLoad, type Machine, type MachineJSON, type Result } from './shell'
import { hashOf } from './github'
import { mail } from './mail'
import { net } from './node'

export type RuleType = 'SSH' | 'HTTP' | 'HTTPS' | 'TCP personalizado'
export type Rule = { id: string; type: RuleType; port: number; source: string; description?: string }
export type SecurityGroup = { id: string; name: string; description: string; rules: Rule[] }
export type KeyPair = { name: string; type: 'RSA' | 'ED25519'; fingerprint: string; material: string; created: number }
export type Ami = { id: string; label: string; short: string; os: Machine['os']; user: string; desc: string }
export type Instance = {
  id: string
  name: string
  ami: Ami
  type: string
  state: 'pending' | 'running' | 'stopping' | 'stopped' | 'shutting-down' | 'terminated'
  checks: 'init' | 'ok'
  publicIp: string
  privateIp: string
  keyName: string
  sgId: string
  az: string
  launched: number
  fs: VFS
  machine: Machine
  hostKey: string
}

export const AMIS: Ami[] = [
  { id: 'ami-0a1b2c3d4e5f60789', label: 'Ubuntu Server 24.04 LTS (HVM), SSD Volume Type', short: 'Ubuntu', os: 'ubuntu', user: 'ubuntu', desc: 'Ubuntu 24.04 LTS · 64 bits (x86) · Qualificado para o nível gratuito' },
  { id: 'ami-0f9e8d7c6b5a40321', label: 'Amazon Linux 2023 AMI', short: 'Amazon Linux', os: 'amazon', user: 'ec2-user', desc: 'Amazon Linux 2023 · kernel 6.1 · Qualificado para o nível gratuito' },
  { id: 'ami-0123abcd4567ef890', label: 'Debian 12 (HVM), SSD Volume Type', short: 'Debian', os: 'debian', user: 'admin', desc: 'Debian 12 · 64 bits (x86) · Qualificado para o nível gratuito' },
]
export const INSTANCE_TYPES = [
  { id: 't2.micro', vcpu: 1, mem: '1 GiB', price: '0,0146 USD/h', free: true },
  { id: 't3.micro', vcpu: 2, mem: '1 GiB', price: '0,0136 USD/h', free: true },
  { id: 't3.small', vcpu: 2, mem: '2 GiB', price: '0,0272 USD/h', free: false },
  { id: 't3.medium', vcpu: 2, mem: '4 GiB', price: '0,0544 USD/h', free: false },
]
export const RULE_PORTS: Record<RuleType, number> = { SSH: 22, HTTP: 80, HTTPS: 443, 'TCP personalizado': 0 }

const hex = (n: number) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')
const b64 = (n: number) => Array.from({ length: n }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'[Math.floor(Math.random() * 64)]).join('')
const octet = () => 10 + Math.floor(Math.random() * 240)

// ---------- estado ----------

const MY_IP = '177.37.142.58'
const account = { id: '482133901177', user: 'aluno-devops', password: `Tmp#${hex(4)}${b64(4).replace(/[+/]/g, 'x')}`, mustChange: true }
let loggedIn = false
const instances: Instance[] = []
const keyPairs: KeyPair[] = []
const groups: SecurityGroup[] = [
  { id: 'sg-0' + hex(16), name: 'default', description: 'default VPC security group', rules: [] },
]
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
let sgCounter = 1

export const aws = {
  myIp: MY_IP,
  region: { code: 'sa-east-1', name: 'América do Sul (São Paulo)' },
  account,
  get loggedIn() {
    return loggedIn
  },
  instances: () => instances.filter((i) => i.state !== 'terminated' || Date.now() - i.launched < 3_600_000),
  keyPairs: () => keyPairs,
  groups: () => groups,
  group: (id: string) => groups.find((g) => g.id === id),

  sendCredentials() {
    mail.send({
      from: 'Senku Ishigami',
      fromAddr: 'senku@devlab.sim',
      avatar: 1,
      to: 'você',
      subject: 'Seu acesso à AWS do projeto',
      preview: 'Criei um usuário IAM para você. Na primeira vez, a AWS vai pedir…',
      body: [
        { kind: 'p', text: 'Oi! Criei um usuário IAM para você na conta da AWS do projeto. Seguem os dados de acesso:' },
        {
          kind: 'kv',
          rows: [
            ['URL de login', 'https://console.aws.sim'],
            ['ID da conta', '4821-3390-1177'],
            ['Usuário do IAM', account.user],
            ['Senha temporária', account.password],
          ],
        },
        { kind: 'p', text: 'No primeiro acesso a AWS vai pedir para você trocar a senha.' },
        { kind: 'p', text: 'Use a região São Paulo (sa-east-1) e o tipo t2.micro, que entra no nível gratuito. E nunca compartilhe a chave .pem com ninguém!' },
        { kind: 'button', label: 'Abrir o console da AWS', url: 'https://console.aws.sim' },
      ],
    })
  },

  login(accountId: string, user: string, password: string): 'ok' | 'change' | string {
    if (accountId.replace(/-/g, '').trim() !== account.id) return 'ID da conta ou alias inválido.'
    if (user.trim() !== account.user || password !== account.password) return 'Sua autenticação falhou. Verifique os dados e tente novamente.'
    if (account.mustChange) return 'change'
    loggedIn = true
    emit()
    return 'ok'
  },
  changePassword(old: string, next: string, confirm: string): string | null {
    if (old !== account.password) return 'A senha antiga está incorreta.'
    if (next !== confirm) return 'As senhas novas não coincidem.'
    if (next === old) return 'A nova senha precisa ser diferente da atual.'
    if (next.length < 8 || !/[A-Z]/.test(next) || !/[a-z]/.test(next) || !/\d/.test(next) || !/[^A-Za-z0-9]/.test(next))
      return 'A senha não atende à política: mínimo de 8 caracteres, com maiúscula, minúscula, número e símbolo.'
    account.password = next
    account.mustChange = false
    loggedIn = true
    emit()
    return null
  },
  /** Atalho de missões: entra no console sem passar pelo login. */
  forceLogin() {
    account.mustChange = false
    loggedIn = true
    emit()
  },
  /** Atalho de missões: deixa a instância pronta na hora. */
  forceReady(i: Instance) {
    i.state = 'running'
    i.checks = 'ok'
    emit()
  },
  logout() {
    loggedIn = false
    emit()
  },

  /** Cria o par de chaves e "baixa" o .pem para ~/Downloads da máquina local. */
  createKeyPair(name: string, type: KeyPair['type'], local: VFS): string | null {
    if (!/^[\w.-]{1,255}$/.test(name)) return 'O nome pode ter letras, números, ponto, hífen e sublinhado.'
    if (keyPairs.some((k) => k.name === name)) return `Já existe um par de chaves chamado ${name}.`
    const material = b64(48)
    keyPairs.push({ name, type, fingerprint: hex(40).match(/../g)!.join(':'), material, created: Date.now() })
    const body = Array.from({ length: 22 }, (_, i) => (i === 3 ? material.slice(0, 64).padEnd(64, 'A') : b64(64))).join('\n')
    const header = type === 'RSA' ? 'RSA PRIVATE KEY' : 'OPENSSH PRIVATE KEY'
    local.mkdir(`${local.home}/Downloads`, true)
    local.write(`${local.home}/Downloads/${name}.pem`, `-----BEGIN ${header}-----\n${body}\n-----END ${header}-----\n`)
    emit()
    return null
  },

  createGroup(name: string, description: string, rules: Omit<Rule, 'id'>[]): SecurityGroup {
    const g: SecurityGroup = { id: 'sg-0' + hex(16), name: name || `launch-wizard-${sgCounter++}`, description, rules: rules.map((r) => ({ ...r, id: 'sgr-0' + hex(16) })) }
    groups.push(g)
    emit()
    return g
  },
  setRules(sgId: string, rules: Omit<Rule, 'id'>[]) {
    const g = groups.find((x) => x.id === sgId)
    if (!g) return
    g.rules = rules.map((r) => ({ ...r, id: 'sgr-0' + hex(16) }))
    emit()
  },

  launch(opts: { name: string; ami: Ami; type: string; keyName: string; sgId: string }): Instance {
    const ip = `18.231.${octet()}.${octet()}`
    const priv = `172.31.${octet()}.${octet()}`
    const id = 'i-0' + hex(16)
    const machine: Machine = { id, os: opts.ami.os, packages: new Set(opts.ami.os === 'amazon' ? ['git', 'curl'] : ['git', 'curl']), aptUpdated: false }
    if (opts.ami.os === 'debian') machine.packages.delete('git')
    const inst: Instance = {
      ...opts,
      id,
      state: 'pending',
      checks: 'init',
      publicIp: ip,
      privateIp: priv,
      az: 'sa-east-1a',
      launched: Date.now(),
      fs: createServerFs(opts.ami),
      machine,
      hostKey: b64(43),
    }
    instances.unshift(inst)
    emit()
    setTimeout(() => ((inst.state = 'running'), emit()), 4000)
    setTimeout(() => ((inst.checks = 'ok'), emit()), 11000)
    return inst
  },
  setState(id: string, action: 'stop' | 'start' | 'terminate') {
    const i = instances.find((x) => x.id === id)
    if (!i) return
    const later = (fn: () => void, ms: number) => setTimeout(() => (fn(), emit()), ms)
    if (action === 'stop' && i.state === 'running') {
      i.state = 'stopping'
      net.stop(i.id, 3000)
      later(() => ((i.state = 'stopped'), (i.checks = 'init')), 3000)
    } else if (action === 'start' && i.state === 'stopped') {
      i.state = 'pending'
      i.publicIp = `18.231.${octet()}.${octet()}` // IP público muda ao parar/iniciar
      later(() => (i.state = 'running'), 3000)
      later(() => (i.checks = 'ok'), 8000)
    } else if (action === 'terminate') {
      i.state = 'shutting-down'
      net.stop(i.id, 3000)
      later(() => (i.state = 'terminated'), 3000)
    }
    emit()
  },

  publicDns: (i: Instance) => `ec2-${i.publicIp.replace(/\./g, '-')}.sa-east-1.compute.aws.sim`,
  findByHost(host: string) {
    return instances.find((i) => i.state !== 'terminated' && (i.publicIp === host || aws.publicDns(i) === host))
  },
  /** Uma regra libera `port` para quem vem de `fromIp`? */
  allows(i: Instance, port: number, fromIp: string) {
    const g = groups.find((x) => x.id === i.sgId)
    return !!g?.rules.some((r) => r.port === port && (r.source === '0.0.0.0/0' || r.source === `${fromIp}/32`))
  },

  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

net.resolvePublic = (host) => {
  const i = aws.findByHost(host)
  return i && i.state === 'running' ? { machineId: i.id, portOpen: (p) => aws.allows(i, p, MY_IP) } : null
}

function createServerFs(ami: Ami): VFS {
  const home = `/home/${ami.user}`
  const pretty = ami.os === 'ubuntu' ? 'Ubuntu 24.04.1 LTS' : ami.os === 'debian' ? 'Debian GNU/Linux 12 (bookworm)' : 'Amazon Linux 2023'
  const root = dir({
    home: dir({
      [ami.user]: dir({
        '.bashrc': file('# ~/.bashrc\n'),
        '.profile': file('# ~/.profile\n'),
        '.ssh': dir({ authorized_keys: file('ssh-rsa AAAA... chave-do-par\n', 0o600) }, 0o700),
      }),
    }),
    etc: dir({ 'os-release': file(`PRETTY_NAME="${pretty}"\n`), hostname: file('ip-server\n') }),
    tmp: dir(),
    var: dir({ log: dir({ syslog: file('') }), www: dir() }),
    usr: dir({ bin: dir(), local: dir({ bin: dir() }) }),
    opt: dir(),
  })
  return new VFS(root, home)
}

// ---------- ssh ----------

function welcome(i: Instance) {
  const now = new Date().toUTCString()
  if (i.ami.os === 'amazon')
    return `   ,     #_\n   ~\\_  ####_        Amazon Linux 2023\n  ~~  \\_#####\\\n  ~~     \\###|\n  ~~       \\#/ ___   https://aws.sim/linux/amazon-linux-2023\n   ~~       V~' '->\n    ~~~         /\n      ~~._.   _/\n         _/ _/\n       _/m/'`
  return [
    `Welcome to ${i.ami.os === 'ubuntu' ? 'Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-1016-aws x86_64)' : 'Debian GNU/Linux 12 (bookworm)'}`,
    '',
    ' * Documentation:  https://help.ubuntu.sim',
    ' * Management:     https://landscape.sim',
    '',
    `  System information as of ${now}`,
    '',
    '  System load:  0.08              Processes:             104',
    '  Usage of /:   24.1% of 6.71GB   Users logged in:       0',
    `  Memory usage: 21%               IPv4 address for enX0: ${i.privateIp}`,
    '',
    'Expanded Security Maintenance for Applications is not enabled.',
    '',
    `${i.machine.aptUpdated ? 0 : 12} updates can be applied immediately.`,
  ].join('\n')
}

registerCommand('ssh', {
  help: 'acessa um servidor remoto: ssh -i chave.pem usuario@ip',
  run: (args, { sh }) => {
    let keyPath: string | null = null
    let target: string | undefined
    let strict = true
    const remoteCmd: string[] = []
    for (let k = 0; k < args.length; k++) {
      if (target) remoteCmd.push(args[k])
      else if (args[k] === '-i') keyPath = args[++k]
      else if (args[k] === '-p') k++
      else if (args[k] === '-o') {
        const opt = args[++k] ?? ''
        if (/^StrictHostKeyChecking=(no|accept-new)$/i.test(opt)) strict = false
      } else if (!args[k].startsWith('-')) target = args[k]
    }
    if (!target) return fail('usage: ssh [-i identity_file] [-o option] [-p port] destination [command]', 255)
    if (sh.remoteLabel) return fail(`${C.dim}(no simulador, saia deste servidor com exit antes de abrir outra conexão)${C.reset}`, 255)
    const fromIp = sh.machine.ip ?? MY_IP
    const interactive = sh.machine.interactive !== false
    const [user, host] = target.includes('@') ? target.split('@') : [sh.user, target]
    const inst = aws.findByHost(host)
    if (!inst) {
      if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return fail(`ssh: connect to host ${host} port 22: Operation timed out`, 255)
      return fail(`ssh: Could not resolve hostname ${host}: nodename nor servname provided, or not known`, 255)
    }
    if (inst.state === 'pending') return fail(`ssh: connect to host ${host} port 22: Connection refused\n${C.dim}(a instância ainda está iniciando; aguarde o estado "Executando")${C.reset}`, 255)
    if (inst.state !== 'running') return fail(`ssh: connect to host ${host} port 22: Operation timed out`, 255)
    if (!aws.allows(inst, 22, fromIp))
      return fail(`ssh: connect to host ${host} port 22: Operation timed out\n${C.dim}Dica: o security group da instância libera a porta 22 para este IP (${fromIp})?${C.reset}`, 255)
    const denied = (extra = '') => fail(`${extra}${user}@${host}: Permission denied (publickey).`, 255)
    if (!keyPath) return denied()
    const keyAbs = sh.fs.resolve(sh.cwd, keyPath)
    const keyNode = sh.fs.get(keyAbs)
    if (!keyNode || keyNode.type !== 'file') return denied(`Warning: Identity file ${keyPath} not accessible: No such file or directory.\n`)
    if (keyNode.mode & 0o077) {
      const perm = keyNode.mode.toString(8).padStart(4, '0')
      return denied(
        `${C.red}@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@         WARNING: UNPROTECTED PRIVATE KEY FILE!          @\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@${C.reset}\nPermissions ${perm} for '${keyPath}' are too open.\nIt is required that your private key files are NOT accessible by others.\nThis private key will be ignored.\nLoad key "${keyPath}": bad permissions\n`,
      )
    }
    const pair = keyPairs.find((k) => k.name === inst.keyName)
    if (!pair || !keyNode.content.includes(pair.material.slice(0, 64))) return denied()
    if (user === 'root') return fail(`Please login as the user "${inst.ami.user}" rather than the user "root".\n\nConnection to ${host} closed.`, 255)
    if (user !== inst.ami.user) return denied()

    const connect = (prefix: string): Result => {
      const remote = new Shell(inst.fs, inst.ami.user, `ip-${inst.privateIp.replace(/\./g, '-')}`, inst.machine)
      remote.remoteLabel = host
      if (remoteCmd.length) {
        // ssh host 'comando': executa e volta, sem sessão interativa
        const r = remote.execute(remoteCmd.join(' '))
        net.killSession(remote.sessionId) // processos sem nohup morrem quando a conexão fecha
        if (r.prompt) return fail(`${prefix}${r.out}\n${C.red}erro: o comando remoto pediu uma entrada interativa${C.reset}`, 1)
        return { out: prefix + r.out, code: r.code }
      }
      if (!interactive) return fail(`${prefix}Pseudo-terminal will not be allocated because stdin is not a terminal.`, 1)
      return { out: `${prefix}${welcome(inst)}\n\nLast login: ${new Date(Date.now() - 3_600_000).toUTCString()} from ${MY_IP}`, code: 0, session: { push: remote } }
    }
    const khPath = `${sh.fs.home}/.ssh/known_hosts`
    let known = ''
    try {
      known = sh.fs.read(khPath)
    } catch {
      /* sem known_hosts */
    }
    if (known.includes(`${host} ssh-ed25519 ${inst.hostKey}`)) return connect('')
    if (!strict) {
      sh.fs.mkdir(`${sh.fs.home}/.ssh`, true)
      sh.fs.write(khPath, `${host} ssh-ed25519 ${inst.hostKey}\n`, true)
      return connect(`Warning: Permanently added '${host}' (ED25519) to the list of known hosts.\n`)
    }
    if (!interactive) return fail('Host key verification failed.', 255)
    if (known.split('\n').some((l) => l.startsWith(host + ' ')))
      return fail(`${C.red}@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@${C.reset}\nHost key verification failed.`, 255)
    const fp = `SHA256:${hashOf(inst.hostKey).slice(0, 43)}`
    const ask = (text: string): Result => ({
      out: '',
      code: 0,
      prompt: {
        text,
        answer: (a) => {
          const v = a.trim().toLowerCase()
          if (v === 'yes' || a.trim() === fp) {
            sh.fs.mkdir(`${sh.fs.home}/.ssh`, true)
            sh.fs.write(khPath, `${host} ssh-ed25519 ${inst.hostKey}\n`, true)
            return connect(`Warning: Permanently added '${host}' (ED25519) to the list of known hosts.\n`)
          }
          if (v === 'no') return fail('Host key verification failed.', 255)
          return ask("Please type 'yes', 'no' or the fingerprint: ")
        },
      },
    })
    return {
      out: `The authenticity of host '${host} (${inst.publicIp})' can't be established.\nED25519 key fingerprint is ${fp}.\nThis key is not known by any other names.`,
      code: 0,
      prompt: ask('Are you sure you want to continue connecting (yes/no/[fingerprint])? ').prompt,
    }
  },
})

// ---------- gerenciador de pacotes ----------

const CATALOG: Record<string, { version: string; deps?: string[]; size: string }> = {
  nodejs: { version: '18.19.1+dfsg-6ubuntu5', size: '12.4 MB' },
  npm: { version: '9.2.0~ds1-2', deps: ['nodejs'], size: '21.8 MB' },
  git: { version: '1:2.43.0-1ubuntu7.1', size: '3.7 MB' },
  curl: { version: '8.5.0-2ubuntu10.4', size: '0.2 MB' },
  nginx: { version: '1.24.0-2ubuntu7.1', size: '0.5 MB' },
  htop: { version: '3.3.0-4build1', size: '0.2 MB' },
  'docker.io': { version: '24.0.7-0ubuntu4.1', deps: ['containerd'], size: '28.6 MB' },
  containerd: { version: '1.7.12-0ubuntu4.1', size: '38.1 MB' },
  unzip: { version: '6.0-28ubuntu4', size: '0.2 MB' },
}

function packageManager(name: 'apt' | 'apt-get' | 'dnf' | 'yum') {
  const isApt = name.startsWith('apt')
  registerCommand(name, {
    help: isApt ? 'instala programas no Ubuntu/Debian: sudo apt install <pacote>' : 'instala programas no Amazon Linux: sudo dnf install <pacote>',
    run: (args, { sh, sudo }) => {
      const m = sh.machine
      const supported = isApt ? m.os === 'ubuntu' || m.os === 'debian' : m.os === 'amazon'
      if (!supported) return fail(`${name}: comando não encontrado${m.os === 'mac' ? `${C.dim} (este é o seu computador; ${name} existe nos servidores Linux)${C.reset}` : ''}`, 127)
      const [cmd, ...rest] = args
      const yes = rest.includes('-y') || rest.includes('--yes')
      const pkgs = rest.filter((a) => !a.startsWith('-'))
      if (!cmd) return ok(`Uso: ${name} update | install <pacote>`)
      if (!sudo) {
        return fail(
          isApt
            ? `${cmd === 'update' ? 'Reading package lists... Done\n' : ''}E: Could not open lock file /var/lib/${cmd === 'update' ? 'apt/lists' : 'dpkg'}/lock${cmd === 'update' ? '' : '-frontend'} - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock, are you root?\n${C.dim}Dica: instalar programas exige privilégio de administrador. Use sudo na frente.${C.reset}`
            : 'Error: This command has to be run with superuser privileges (under the root user on most systems).',
          100,
        )
      }
      if (cmd === 'update' || cmd === 'makecache') {
        m.aptUpdated = true
        return ok(
          isApt
            ? [
                'Hit:1 http://sa-east-1.ec2.archive.ubuntu.sim/ubuntu noble InRelease',
                'Get:2 http://sa-east-1.ec2.archive.ubuntu.sim/ubuntu noble-updates InRelease [126 kB]',
                'Get:3 http://sa-east-1.ec2.archive.ubuntu.sim/ubuntu noble-backports InRelease [126 kB]',
                'Get:4 http://security.ubuntu.sim/ubuntu noble-security InRelease [126 kB]',
                'Get:5 http://sa-east-1.ec2.archive.ubuntu.sim/ubuntu noble/universe amd64 Packages [15.0 MB]',
                'Fetched 31.4 MB in 5s (6,280 kB/s)',
                'Reading package lists... Done',
                'Building dependency tree... Done',
                'Reading state information... Done',
                '12 packages can be upgraded. Run \'apt list --upgradable\' to see them.',
              ].join('\n')
            : 'Amazon Linux 2023 repository   41 MB/s |  28 MB     00:00\nMetadata cache created.',
        )
      }
      if (cmd === 'upgrade') return ok('Reading package lists... Done\nCalculating upgrade... Done\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.')
      if (cmd !== 'install') return fail(`E: Operação inválida ${cmd}`, 100)
      if (!pkgs.length) return ok('0 upgraded, 0 newly installed, 0 to remove.')
      const head = 'Reading package lists... Done\nBuilding dependency tree... Done\nReading state information... Done'
      for (const p of pkgs) {
        if (!CATALOG[p] || (!m.aptUpdated && isApt && p !== 'git'))
          return fail(`${head}\nE: Unable to locate package ${p}${!m.aptUpdated ? `\n${C.dim}Dica: a lista de pacotes deste servidor está vazia. Rode sudo ${name} update primeiro.${C.reset}` : ''}`, 100)
      }
      const already = pkgs.filter((p) => m.packages.has(p))
      const toInstall = [...new Set(pkgs.flatMap((p) => [...(CATALOG[p].deps ?? []), p]))].filter((p) => !m.packages.has(p))
      const alreadyMsg = already.map((p) => `${p} is already the newest version (${CATALOG[p].version}).`).join('\n')
      if (!toInstall.length) return ok(`${head}\n${alreadyMsg}\n0 upgraded, 0 newly installed, 0 to remove and 12 not upgraded.`)
      const plan = `${head}${alreadyMsg ? '\n' + alreadyMsg : ''}\nThe following NEW packages will be installed:\n  ${toInstall.join(' ')}\n0 upgraded, ${toInstall.length} newly installed, 0 to remove and 12 not upgraded.\nNeed to get ${toInstall.length * 7 + 3}.4 MB of archives.\nAfter this operation, ${toInstall.length * 41 + 12} MB of additional disk space will be used.`
      const doInstall = (): Result => {
        toInstall.forEach((p) => m.packages.add(p))
        if (toInstall.includes('docker.io')) m.packages.add('docker') // o pacote docker.io fornece o comando docker
        return ok(
          [
            ...toInstall.map((p, k) => `Get:${k + 1} http://sa-east-1.ec2.archive.ubuntu.sim/ubuntu noble/universe amd64 ${p} amd64 ${CATALOG[p].version} [${CATALOG[p].size}]`),
            `Fetched ${toInstall.length * 7 + 3}.4 MB in 3s (11.2 MB/s)`,
            ...toInstall.map((p) => `Setting up ${p} (${CATALOG[p].version}) ...`),
            'Processing triggers for man-db (2.12.0-4build2) ...',
          ].join('\n'),
        )
      }
      if (yes) {
        const r = doInstall()
        return { ...r, out: `${plan}\n${r.out}` }
      }
      return {
        out: plan,
        code: 0,
        prompt: { text: 'Do you want to continue? [Y/n] ', answer: (a) => (a.trim() === '' || /^y/i.test(a.trim()) ? doInstall() : fail('Abort.', 1)) },
      }
    },
  })
}
packageManager('apt')
packageManager('apt-get')
packageManager('dnf')
packageManager('yum')

// ---------- progresso salvo ----------
type InstanceJSON = Omit<Instance, 'fs' | 'machine'> & { fs: VfsJSON; machine: MachineJSON }
export function awsDump() {
  return {
    account: { ...account },
    loggedIn,
    sgCounter,
    instances: instances.map((i): InstanceJSON => ({ ...i, fs: vfsDump(i.fs), machine: machineDump(i.machine) })),
    keyPairs,
    groups,
  }
}
export function awsLoad(d: ReturnType<typeof awsDump>) {
  Object.assign(account, d.account)
  loggedIn = d.loggedIn
  sgCounter = d.sgCounter
  // instâncias que estavam ligando/desligando terminam a transição (os timers não sobrevivem ao recarregar)
  const settle: Partial<Record<Instance['state'], Instance['state']>> = { pending: 'running', stopping: 'stopped', 'shutting-down': 'terminated' }
  instances.splice(
    0,
    instances.length,
    ...d.instances.map((i) => {
      const state = settle[i.state] ?? i.state
      return { ...i, state, checks: state === 'running' ? ('ok' as const) : i.checks, fs: vfsLoad(i.fs), machine: machineLoad(i.machine) }
    }),
  )
  keyPairs.splice(0, keyPairs.length, ...d.keyPairs)
  groups.splice(0, groups.length, ...d.groups)
}
