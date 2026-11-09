// Missão 6: pipeline com Docker (GITHUB_TOKEN, imagem com tag do commit) e rollback.
import { expect, it } from 'vitest'
import { createStudent, runLogs, waitRuns } from './harness'
import { DOCKER_CI_YML } from '../src/engine/missions'
import { prepareMission } from '../src/engine/bootstrap'
import { github } from '../src/engine/github'
import { aws } from '../src/engine/aws'
import { docker } from '../src/engine/docker'

it('Missão 6: CI/CD com Docker e rollback', async () => {
  const s = createStudent()
  prepareMission(5, s.fs, s.local)
  const repo = 'devlab/todo-api'
  const root = '/home/dev/projetos/todo-api'
  const old = await waitRuns(repo) // o deploy antigo (npm start) falha: a porta é do container
  expect(old.conclusion).toBe('failure')
  expect(runLogs(repo)).toContain('EADDRINUSE')

  s.mission(5)
  const inst = aws.instances()[0]
  s.ev({ kind: 'ui', name: 'mail:O pipeline não sabe que agora é container' })
  s.ev({ kind: 'ui', name: 'gh:actions' })

  // sem permissions: packages: write, o push da imagem é negado
  s.fs.write(`${root}/.github/workflows/ci.yml`, DOCKER_CI_YML.replace(/    permissions:\n      contents: read\n      packages: write\n/, ''))
  s.run('cd ~/projetos/todo-api && git commit -am "ci: docker sem permissions" && git push')
  expect((await waitRuns(repo)).conclusion).toBe('failure')
  expect(runLogs(repo)).toContain('does not match expected scopes')

  s.fs.write(`${root}/.github/workflows/ci.yml`, DOCKER_CI_YML)
  s.ev({ kind: 'tick' })
  s.run('git commit -am "ci: build e deploy com Docker" && git push')
  const ok = await waitRuns(repo)
  expect(ok.jobs.map((j) => j.conclusion)).toEqual(['success', 'success', 'success'])
  s.ev({ kind: 'ui', name: 'gh:package' })

  const src = `${root}/src/todos.js`
  s.fs.write(src, s.fs.read(src).replace("'Clonar o repositório'", "'Containerizar a aplicação'"))
  s.run('git commit -am "feat: atualiza tarefas" && git push')
  await waitRuns(repo)
  expect(s.run(`curl http://${inst.publicIp}:3000/todos`).all).toContain('Containerizar a aplicação')
  s.ev({ kind: 'browse', url: `http://${inst.publicIp}:3000`, userTab: true })

  const shaTags = Object.keys(docker.registry()['devlab/todo-api'].tags).filter((t) => /^[0-9a-f]{40}$/.test(t))
  const prev = shaTags[shaTags.length - 2]
  expect(prev).toBeTruthy()
  s.run(`ssh -i ~/Downloads/todo-key.pem ubuntu@${inst.publicIp}`, ['yes'])
  s.run(`docker rm -f todo; docker run -d -p 3000:3000 --restart unless-stopped --name todo ghcr.sim/devlab/todo-api:${prev}`)
  s.run('exit')
  expect(s.run(`curl http://${inst.publicIp}:3000/todos`).all).toContain('Clonar o repositório')
  expect(github.head(repo)).toBeTruthy()
  s.expectMissionDone()
})
