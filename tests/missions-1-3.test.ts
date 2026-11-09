// Trilha completa das Missões 1 a 3, como um aluno faria, na mesma sessão.
import { describe, expect, it } from 'vitest'
import { createStudent, tick } from './harness'
import { github } from '../src/engine/github'
import { mail } from '../src/engine/mail'
import { aws, AMIS } from '../src/engine/aws'
import { net } from '../src/engine/node'

const s = createStudent()

describe('trilha guiada', () => {
  it('Missão 1: terminal', () => {
    s.mission(0)
    s.run('pwd')
    s.run('ls')
    s.run('cat LEIA-ME.txt')
    s.run('mkdir projetos')
    s.run('cd projetos')
    s.run('echo "meu primeiro arquivo" > notas.txt')
    s.run('ls -l')
    s.expectMissionDone()
  })

  it('Missão 2: conta no GitHub, convite, clone, push com token', async () => {
    s.mission(1)
    s.ev({ kind: 'browse', url: 'https://github.sim', userTab: false })
    expect(Object.keys(github.validateSignup('-ruim', 'x', '123'))).toEqual(['login', 'email', 'password'])
    github.signup('arthur-dev', 'arthur@exemplo.com', 'senha1234', 7)
    const verify = mail.all().find((m) => m.subject.includes('Confirme'))!
    const url = (verify.body.find((b) => b.kind === 'button') as { url: string }).url
    github.verify(new URL(url).searchParams.get('token')!)
    await tick(3000) // o convite chega alguns segundos depois
    const inv = github.invitationsFor('arthur-dev')[0]
    expect(inv.inviter).toBe('senku-ishigami')
    github.respondInvite(inv.id, true)
    s.ev({ kind: 'tick' })

    s.run('git config --global user.name "arthur-dev"')
    s.run('git config --global user.email "arthur@exemplo.com"')
    s.run('cd ~/projetos && git clone https://github.sim/devlab/todo-api.git')
    s.run('cd todo-api && ls -a')
    s.run('git log --oneline')
    expect(s.run('npm install && npm test').code).toBe(0)
    s.run('npm start')
    s.ev({ kind: 'browse', url: 'http://localhost:3000', userTab: false }) // aba que o aluno não abriu: não conta
    s.ev({ kind: 'browse', url: 'http://localhost:3000', userTab: true })
    s.run('echo "Mantido também por @arthur-dev" >> README.md')
    s.run('git status')
    s.run('git add README.md && git commit -m "docs: mantenedor"')

    // senha da conta é recusada; token sem escopo repo também
    expect(s.run('git push', ['arthur-dev', 'senha1234']).all).toContain('password authentication was removed')
    const semRepo = github.createToken('t1', ['workflow'], '30')
    expect(s.run('git push', ['arthur-dev', semRepo.value]).all).toContain('403')
    const tok = github.createToken('t2', ['repo'], '30')
    s.ev({ kind: 'tick' })
    expect(s.run('git push', ['arthur-dev', tok.value]).code).toBe(0)
    expect(github.head('devlab/todo-api')!.author).toBe('arthur-dev')
    s.expectMissionDone()
  })

  it('Missão 3: EC2, chave, ssh, apt, nohup e Security Group', async () => {
    s.mission(2)
    aws.sendCredentials()
    s.ev({ kind: 'ui', name: 'mail:Seu acesso à AWS do projeto' })
    expect(aws.login('4821-3390-1177', 'aluno-devops', 'errada')).not.toBe('ok')
    expect(aws.login('4821-3390-1177', 'aluno-devops', aws.account.password)).toBe('change')
    expect(aws.changePassword(aws.account.password, 'fraca', 'fraca')).toBeTruthy()
    expect(aws.changePassword(aws.account.password, 'Nova#Senha1', 'Nova#Senha1')).toBeNull()
    s.ev({ kind: 'tick' })

    aws.createKeyPair('todo-key', 'RSA', s.fs)
    const sg = aws.createGroup('', 'wizard', [{ type: 'SSH', port: 22, source: '0.0.0.0/0' }])
    const inst = aws.launch({ name: 'todo-api-server', ami: AMIS[0], type: 't2.micro', keyName: 'todo-key', sgId: sg.id })
    s.ev({ kind: 'tick' })
    expect(s.run(`ssh -i ~/Downloads/todo-key.pem ubuntu@${inst.publicIp}`).all).toContain('Connection refused') // ainda ligando
    await tick(12_000)
    s.ev({ kind: 'tick' })

    expect(s.run(`ssh -i ~/Downloads/todo-key.pem ubuntu@${inst.publicIp}`).all).toContain('UNPROTECTED PRIVATE KEY FILE')
    s.run('chmod 400 ~/Downloads/todo-key.pem')
    expect(s.run(`ssh -i ~/Downloads/todo-key.pem root@${inst.publicIp}`).all).toContain('Please login as the user "ubuntu"')
    s.run(`ssh -i ~/Downloads/todo-key.pem ubuntu@${inst.publicIp}`, ['talvez', 'yes'])
    expect(s.cur().host).toMatch(/^ip-/)

    expect(s.run('node -v').code).toBe(127)
    expect(s.run('apt install nodejs').all).toContain('are you root?')
    expect(s.run('sudo apt install nodejs').all).toContain('Unable to locate package')
    s.run('sudo apt update && sudo apt install nodejs npm', ['Y'])
    expect(s.run('node -v').all).toBe('v18.19.1')
    s.run('git clone https://github.sim/devlab/todo-api.git && cd todo-api && npm install')
    s.run('nohup npm start &')
    expect(s.run('curl localhost:3000/health').all).toBe('{"status":"ok"}')

    s.ev({ kind: 'browse', url: `http://${inst.publicIp}:3000`, userTab: true })
    aws.setRules(sg.id, [
      { type: 'SSH', port: 22, source: '0.0.0.0/0' },
      { type: 'TCP personalizado', port: 3000, source: '0.0.0.0/0' },
    ])
    s.ev({ kind: 'tick' })
    s.ev({ kind: 'browse', url: `http://${inst.publicIp}:3000`, userTab: true })
    s.run('exit')
    expect(net.get(inst.id, 3000)?.persistent).toBe(true) // nohup: continua no ar
    s.expectMissionDone()
  })
})
