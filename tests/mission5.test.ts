// Missão 5: Docker na máquina local, registry e no servidor.
import { expect, it } from 'vitest'
import { createStudent } from './harness'
import { DOCKERIGNORE } from '../src/engine/missions'
import { prepareMission } from '../src/engine/bootstrap'
import { github } from '../src/engine/github'
import { aws } from '../src/engine/aws'
import { docker } from '../src/engine/docker'
import { editor } from '../src/engine/editor'

it('Missão 5: containers com Docker', () => {
  const s = createStudent()
  prepareMission(4, s.fs, s.local)
  s.run('cd ~/projetos/todo-api && npm start') // o npm start da Missão 2 ainda rodando
  s.mission(4)
  const inst = aws.instances()[0]

  s.ev({ kind: 'ui', name: 'mail:Node 18 no servidor, Node 20 aqui: hora do Docker' })
  editor.openFile(s.fs, '/home/dev/projetos/todo-api/Dockerfile')
  s.ev({ kind: 'tick' })

  expect(s.run('docker build -t todo-api .').all).toMatch(/transferring context: 4\d\.\d+MB/)
  s.fs.write('/home/dev/projetos/todo-api/.dockerignore', DOCKERIGNORE)
  const rebuild = s.run('docker build -t todo-api .').all
  expect(rebuild).toContain('CACHED [3/5] COPY package*.json ./')
  expect(rebuild).toMatch(/transferring context: [\d.]+kB/)
  expect(s.run('docker images').all).toContain('<none>')

  expect(s.run('docker run -d -p 3000:3000 --name todo todo-api').all).toContain('port is already allocated')
  s.run('npm stop; docker run -d -p 3000:3000 --name todo todo-api')
  expect(s.run('docker ps && docker logs todo').all).toContain('Servidor rodando')
  expect(s.run('docker exec -it todo bash').code).toBe(126)
  s.run('docker exec -it todo sh')
  expect(s.run('node -v').all).toBe('v20.15.0')
  s.run('exit')
  s.ev({ kind: 'browse', url: 'http://localhost:3000', userTab: true })

  const login = github.student()!.login
  github.createToken('docker', ['write:packages'], '30')
  s.ev({ kind: 'tick' })
  const token = github.student()!.tokens.find((t) => t.scopes.includes('write:packages'))!.value
  expect(s.run('docker push ghcr.sim/devlab/todo-api:1.0').code).not.toBe(0)
  s.run(`docker login ghcr.sim -u ${login}`, [token])
  s.run('docker tag todo-api ghcr.sim/devlab/todo-api:1.0 && docker push ghcr.sim/devlab/todo-api:1.0')
  expect(docker.registry()['devlab/todo-api'].tags['1.0']).toBeTruthy()

  s.run(`ssh -i ~/Downloads/todo-key.pem ubuntu@${inst.publicIp}`, ['yes'])
  expect(s.run('docker ps').all).toContain('sudo apt install docker.io')
  s.run('sudo apt update && sudo apt install -y docker.io && sudo usermod -aG docker ubuntu')
  expect(s.run('docker ps').all).toContain('permission denied') // grupo só vale na próxima sessão
  s.run('exit')
  s.run(`ssh -i ~/Downloads/todo-key.pem ubuntu@${inst.publicIp}`)
  expect(s.run('groups').all).toBe('ubuntu docker')
  s.run('docker ps')
  s.run('cd ~/todo-api && npm stop; docker run -d -p 3000:3000 --restart unless-stopped --name todo ghcr.sim/devlab/todo-api:1.0')
  expect(s.run('docker exec todo node -v').all).toBe('v20.15.0')
  s.run('exit')
  s.ev({ kind: 'browse', url: `http://${inst.publicIp}:3000`, userTab: true })
  s.expectMissionDone()
})
