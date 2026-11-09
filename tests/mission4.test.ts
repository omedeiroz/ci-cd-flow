// Missão 4: CI com GitHub Actions, teste quebrado de propósito, secrets e deploy via SSH.
import { expect, it } from 'vitest'
import { createStudent, runLogs, waitRuns } from './harness'
import { CI_YML, DEPLOY_YML } from '../src/engine/missions'
import { prepareMission } from '../src/engine/bootstrap'
import { github } from '../src/engine/github'
import { aws } from '../src/engine/aws'
import { editor } from '../src/engine/editor'

it('Missão 4: pipeline de CI/CD', async () => {
  const s = createStudent()
  prepareMission(3, s.fs, s.local)
  s.mission(3)
  const repo = 'devlab/todo-api'
  const root = '/home/dev/projetos/todo-api'
  const inst = aws.instances()[0]
  github.makeAdmin(github.student()!.login, repo)

  s.ev({ kind: 'ui', name: 'mail:Bora automatizar: pipeline de CI/CD' })
  s.run('cd ~/projetos/todo-api && code .')
  expect(editor.root).toBe(root)

  s.fs.mkdir(`${root}/.github/workflows`, true)
  s.fs.write(`${root}/.github/workflows/ci.yml`, CI_YML)
  s.ev({ kind: 'tick' })
  s.run('git add .github && git commit -m "ci: testes" && git push')
  expect((await waitRuns(repo)).conclusion).toBe('success')
  s.ev({ kind: 'ui', name: 'gh:actions' })

  const test = `${root}/tests/todos.test.js`
  s.fs.write(test, s.fs.read(test).replace('length, 3)', 'length, 4)'))
  s.run('git commit -am "test: quebra" && git push')
  expect((await waitRuns(repo)).conclusion).toBe('failure')
  expect(runLogs(repo)).toContain('esperado 4, recebido 3')

  s.fs.write(test, s.fs.read(test).replace('length, 4)', 'length, 3)'))
  s.run('git commit -am "test: corrige" && git push')
  expect((await waitRuns(repo)).conclusion).toBe('success')

  github.setSecret(repo, 'EC2_HOST', inst.publicIp)
  github.setSecret(repo, 'EC2_SSH_KEY', s.fs.read('/home/dev/Downloads/todo-key.pem'))
  s.ev({ kind: 'tick' })
  const wf = `${root}/.github/workflows/ci.yml`
  s.fs.write(wf, s.fs.read(wf).replace(/\s*$/, '\n') + DEPLOY_YML)
  s.run('git commit -am "ci: deploy" && git push')
  const deploy = await waitRuns(repo)
  expect(deploy.conclusion).toBe('success')
  expect(runLogs(repo)).toContain('***') // secrets mascarados no log
  expect(runLogs(repo)).not.toContain(inst.publicIp)

  const src = `${root}/src/todos.js`
  s.fs.write(src, s.fs.read(src).replace("done: false },\n]", "done: true },\n]"))
  s.run('git commit -am "feat: conclui tarefa" && git push')
  await waitRuns(repo)
  expect(s.run(`curl http://${inst.publicIp}:3000/todos`).all).toContain('"id":3,"title":"Configurar o pipeline de CI/CD","done":true')
  s.ev({ kind: 'browse', url: `http://${inst.publicIp}:3000`, userTab: true })
  s.expectMissionDone()
})
