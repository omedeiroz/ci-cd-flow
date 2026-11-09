// Atalho para pular missões: monta o estado que as missões anteriores teriam deixado.
import type { VFS } from './fs'
import type { Shell } from './shell'
import { Shell as ShellClass } from './shell'
import { github } from './github'
import { allRepos, readConfig, saveCredentials } from './git'
import { AMIS, aws } from './aws'
import { net } from './node'
import { CI_YML, DEPLOY_YML } from './missions'

export function prepareMission(idx: number, fs: VFS, sh: Shell) {
  if (!fs.isDir(`${fs.home}/projetos`)) fs.mkdir(`${fs.home}/projetos`, true)
  if (idx < 3) return
  const run = (line: string) => {
    const cwd = sh.cwd
    sh.execute(line)
    sh.history.pop()
    sh.cwd = cwd
  }

  // Missão 2: conta, identidade no git, clone e credenciais salvas
  const { user, token } = github.bootstrapStudent()
  const cfg = readConfig(fs)
  if (!cfg['user.name']) run(`git config --global user.name "${user.login}"`)
  if (!cfg['user.email']) run(`git config --global user.email "${user.email}"`)
  if (!allRepos(fs).some((r) => r.remoteKey === 'devlab/todo-api')) run('cd ~/projetos && git clone https://github.sim/devlab/todo-api.git')
  saveCredentials(fs, user.login, token)
  const root = allRepos(fs).find((r) => r.remoteKey === 'devlab/todo-api')?.root
  if (root && !fs.isDir(`${root}/node_modules`)) run(`cd ${root} && npm install`)

  // Missão 3: console, chave, instância com a aplicação no ar e porta 3000 liberada
  if (!aws.loggedIn) aws.forceLogin()
  let pair = aws.keyPairs()[0]
  if (!pair) {
    aws.createKeyPair('todo-key', 'RSA', fs)
    pair = aws.keyPairs()[0]
  }
  const pem = `${fs.home}/Downloads/${pair.name}.pem`
  if (fs.exists(pem)) fs.chmod(pem, 0o400)
  let inst = aws.instances().find((i) => i.state === 'running' || i.state === 'pending')
  if (!inst) {
    const sg = aws.createGroup('', 'launch-wizard (atalho)', [
      { type: 'SSH', port: 22, source: '0.0.0.0/0' },
      { type: 'TCP personalizado', port: 3000, source: '0.0.0.0/0' },
    ])
    inst = aws.launch({ name: 'todo-api-server', ami: AMIS[0], type: 't2.micro', keyName: pair.name, sgId: sg.id })
  }
  aws.forceReady(inst)
  const g = aws.group(inst.sgId)!
  if (!aws.allows(inst, 3000, '8.8.8.8')) aws.setRules(g.id, [...g.rules, { type: 'TCP personalizado', port: 3000, source: '0.0.0.0/0' }])
  if (!aws.allows(inst, 22, '20.201.28.151')) aws.setRules(g.id, [...aws.group(g.id)!.rules, { type: 'SSH', port: 22, source: '0.0.0.0/0' }])
  if (!net.get(inst.id, 3000)) {
    const remote = new ShellClass(inst.fs, inst.ami.user, 'server', inst.machine)
    remote.execute('sudo apt update && sudo apt install -y nodejs npm')
    if (!allRepos(inst.fs).length) remote.execute('git clone https://github.sim/devlab/todo-api.git')
    remote.execute('cd todo-api && npm install && nohup npm start &')
  }
  if (idx < 5) return

  // Missão 4: secrets, admin e pipeline com deploy (versão antiga, via npm)
  const key = 'devlab/todo-api'
  github.makeAdmin(user.login, key)
  const repo = github.get(key)!
  if (!repo.secrets.EC2_HOST) github.setSecret(key, 'EC2_HOST', inst.publicIp)
  if (!repo.secrets.EC2_SSH_KEY && fs.exists(pem)) github.setSecret(key, 'EC2_SSH_KEY', fs.read(pem))

  // Missão 5: imagem no registry e container no servidor
  const ws = new ShellClass(fs, sh.user, sh.host, sh.machine)
  ws.cwd = root ?? fs.home
  if (root && !fs.exists(`${root}/.dockerignore`)) fs.write(`${root}/.dockerignore`, 'node_modules\nnpm-debug.log\n.git\n.github\n.env\n')
  const pkgToken = github.createToken('docker (atalho)', ['write:packages'], '30').value
  ws.execute(`docker build -t todo-api . && docker tag todo-api ghcr.sim/devlab/todo-api:1.0`)
  ws.execute(`docker login ghcr.sim -u ${user.login} -p ${pkgToken}`)
  ws.execute('docker push ghcr.sim/devlab/todo-api:1.0')
  if (!inst.machine.packages.has('docker')) {
    const r1 = new ShellClass(inst.fs, inst.ami.user, 'server', inst.machine)
    r1.execute('sudo apt install -y docker.io && sudo usermod -aG docker ubuntu')
  }
  const r2 = new ShellClass(inst.fs, inst.ami.user, 'server', inst.machine)
  r2.cwd = `${inst.fs.home}/todo-api`
  if (!net.get(inst.id, 3000)?.via) r2.execute('npm stop; docker run -d -p 3000:3000 --restart unless-stopped --name todo ghcr.sim/devlab/todo-api:1.0')

  // por último, o push do workflow antigo: o deploy dele vai falhar (a porta é do container)
  if (root && !Object.keys(github.head(key)?.tree ?? {}).some((p) => p.startsWith('.github/workflows/'))) {
    fs.mkdir(`${root}/.github/workflows`, true)
    fs.write(`${root}/.github/workflows/ci.yml`, CI_YML.replace(/\s*$/, '\n') + DEPLOY_YML)
    ws.execute('git add .github && git commit -m "ci: pipeline com deploy na EC2" && git push')
  }
}
