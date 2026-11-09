// Missão 7: proteção de branch, branch de funcionalidade, PR com CI, revisão, conflito e merge.
import { expect, it } from 'vitest'
import { createStudent, tick, waitRuns } from './harness'
import { FEATURE_ROUTE, FEATURE_TEST, FEATURE_TODOS, PR_CI_YML } from '../src/engine/missions'
import { prepareMission } from '../src/engine/bootstrap'
import { github } from '../src/engine/github'
import { actions } from '../src/engine/actions'
import { aws } from '../src/engine/aws'
import { team } from '../src/engine/team'
import { mail } from '../src/engine/mail'
import { net, apiRoute } from '../src/engine/node'

it('Missão 7: branches e pull requests', async () => {
  const s = createStudent()
  prepareMission(6, s.fs, s.local)
  const key = 'devlab/todo-api'
  const root = '/home/dev/projetos/todo-api'
  await waitRuns(key)
  team.start()
  s.mission(6)
  const me = github.student()!.login

  s.ev({ kind: 'ui', name: 'mail:Nova regra no time: tudo entra por pull request' })
  github.setProtection(key, 'main', { requirePr: true, approvals: 1, requireChecks: true })
  s.ev({ kind: 'tick' })

  s.fs.write(`${root}/.github/workflows/ci.yml`, PR_CI_YML)
  s.run('cd ~/projetos/todo-api && git commit -am "ci: testes em pull requests"')
  s.ev({ kind: 'tick' })
  const rej = s.run('git push')
  expect(rej.all).toContain('GH006')

  s.run('git switch -c feat/pendentes')
  const w = (f: string, add: string) => s.fs.write(`${root}/${f}`, s.fs.read(`${root}/${f}`) + add)
  w('src/todos.js', FEATURE_TODOS)
  s.ev({ kind: 'tick' })
  w('tests/todos.test.js', FEATURE_TEST)
  const t = s.run('npm test')
  expect(t.all).toContain('conta as tarefas pendentes')
  expect(t.code).toBe(0)
  w('src/server.js', FEATURE_ROUTE)
  s.ev({ kind: 'tick' })
  expect(s.run('git add . && git commit -m "feat: contador de tarefas pendentes" && git push').all).toContain('--set-upstream origin feat/pendentes')
  expect(s.run('git push -u origin feat/pendentes').all).toContain('/pull/new/feat/pendentes')
  expect(actions.runs(key).filter((r) => r.ref === 'feat/pendentes')).toHaveLength(0) // push só na main

  const pr = github.createPull(key, { title: 'feat: contador de pendentes', body: 'Novo endpoint /todos/pendentes', head: 'feat/pendentes', base: 'main', author: me })
  if (typeof pr === 'string') throw new Error(pr)
  s.ev({ kind: 'tick' })
  await waitRuns(key)
  const prRun = actions.runs(key).find((r) => r.event === 'pull_request')!
  expect(prRun.jobs.map((j) => j.conclusion)).toEqual(['success', 'skipped', 'skipped'])
  s.ev({ kind: 'ui', name: 'gh:pull' })

  await tick(7000)
  expect(pr.reviews.at(-1)?.state).toBe('CHANGES_REQUESTED')
  expect(mail.all()[0].subject).toContain('PR #1')
  expect(github.mergePull(key, pr.number, me)).toBe('O merge está bloqueado.')

  s.fs.write(`${root}/README.md`, s.fs.read(`${root}/README.md`).replace(/(- GET \/health[^\n]*\n)/, '$1- GET /todos/pendentes — quantidade de tarefas pendentes\n'))
  s.run('git commit -am "docs: documenta /todos/pendentes" && git push')
  s.ev({ kind: 'tick' })
  await tick(6000)
  await waitRuns(key)
  expect(team.state().bulma).toBe('merged')
  expect(github.pulls(key).find((p) => p.author === 'bulma-briefs')?.state).toBe('merged')
  const st = github.pullStatus(key, pr.number)
  expect(st.conflicts).toEqual(['README.md'])
  expect(st.approvals).toBe(1)
  expect(st.blockers).toContain('conflicts')

  s.run('git fetch origin')
  const m = s.run('git merge origin/main')
  expect(m.all).toContain('CONFLITO')
  s.ev({ kind: 'tick' })
  s.fs.write(`${root}/README.md`, s.fs.read(`${root}/README.md`).replace(/^(<{7}|={7}|>{7}).*\n/gm, ''))
  expect(s.run('git add README.md && git commit --no-edit && git push').code).toBe(0)
  s.ev({ kind: 'tick' })
  await waitRuns(key)
  const ready = github.pullStatus(key, pr.number)
  expect(ready.blockers).toEqual([])

  expect(github.mergePull(key, pr.number, me)).toBeNull()
  github.deleteBranch(key, 'feat/pendentes')
  s.ev({ kind: 'tick' })
  await waitRuns(key)
  const deploy = actions.runs(key)[0]
  expect(deploy.event).toBe('push')
  expect(deploy.jobs.map((j) => j.conclusion)).toEqual(['success', 'success', 'success'])
  const inst = aws.instances()[0]
  const svc = net.get(inst.id, 3000)!
  expect(apiRoute(svc, '/todos/pendentes')).toMatch(/"pendentes":\d/)
  expect(apiRoute(svc, '/version')).toBe('{"version":"1.0.0"}')
  s.ev({ kind: 'browse', url: `http://${inst.publicIp}:3000/todos/pendentes`, userTab: true })

  const c = s.run('git switch main && git pull && git branch -d feat/pendentes')
  expect(c.all).toContain('Fast-forward')
  expect(c.all).toContain('Branch feat/pendentes excluído')
  s.ev({ kind: 'tick' })
  s.expectMissionDone()
})
