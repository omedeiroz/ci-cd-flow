// Missão 8: environments staging/production, secrets por environment e aprovação de deploy.
import { expect, it } from 'vitest'
import { createStudent, tick, waitRuns } from './harness'
import { ENV_CI_YML } from '../src/engine/missions'
import { prepareMission, provisionStaging } from '../src/engine/bootstrap'
import { github } from '../src/engine/github'
import { actions, actionsDump, actionsLoad } from '../src/engine/actions'
import { aws, STAGING_NAME } from '../src/engine/aws'
import { team } from '../src/engine/team'
import { docker } from '../src/engine/docker'

/** Espera até um job ficar esperando aprovação. */
async function waitGate(key: string) {
  for (let i = 0; i < 400; i++) {
    await tick(500)
    const r = actions.runs(key).find((x) => x.status === 'waiting')
    if (r) return r
  }
  throw new Error('nenhum deploy esperando aprovação')
}

async function prFlow(s: ReturnType<typeof createStudent>, key: string, branch: string, me: string) {
  const pr = github.createPull(key, { title: branch, body: '', head: branch, base: 'main', author: me })
  if (typeof pr === 'string') throw new Error(pr)
  await waitRuns(key)
  await tick(7000)
  expect(github.pullStatus(key, pr.number).blockers).toEqual([])
  expect(github.mergePull(key, pr.number, me)).toBeNull()
  github.deleteBranch(key, branch)
  s.ev({ kind: 'tick' })
}

it('Missão 8: staging, aprovação e rejeição', async () => {
  const s = createStudent()
  prepareMission(7, s.fs, s.local)
  const key = 'devlab/todo-api'
  const root = '/home/dev/projetos/todo-api'
  await waitRuns(key)
  expect(github.protection(key, 'main')?.requirePr).toBe(true)
  expect(github.head(key)!.tree['src/todos.js']).toContain('pendingCount')
  team.start()
  const st = provisionStaging()!
  expect(st.name).toBe(STAGING_NAME)
  const prod = aws.instances().find((i) => i.name !== STAGING_NAME)!
  s.mission(7)
  const me = github.student()!.login

  s.ev({ kind: 'ui', name: 'mail:Antes da produção, staging' })
  const pem = `~/Downloads/${prod.keyName}.pem`
  s.run(`ssh -i ${pem} ubuntu@${st.publicIp}`, ['yes'])
  expect(s.run('docker ps').code).toBe(0)
  s.run('exit')

  github.createEnvironment(key, 'staging')
  github.createEnvironment(key, 'production')
  github.setEnvSecret(key, 'staging', 'EC2_HOST', st.publicIp)
  github.setEnvSecret(key, 'production', 'EC2_HOST', prod.publicIp)
  s.ev({ kind: 'tick' })
  github.setEnvReviewers(key, 'production', [me])
  s.ev({ kind: 'tick' })

  s.run('cd ~/projetos/todo-api && git switch main && git pull && git switch -c ci/staging')
  s.fs.write(`${root}/.github/workflows/ci.yml`, ENV_CI_YML)
  s.ev({ kind: 'tick' })
  s.run('git commit -am "ci: staging e produção com aprovação" && git push -u origin ci/staging')
  await prFlow(s, key, 'ci/staging', me)

  const run = await waitGate(key)
  expect(run.jobs.map((j) => [j.key, j.status, j.conclusion])).toEqual([
    ['test', 'completed', 'success'],
    ['build', 'completed', 'success'],
    ['staging', 'completed', 'success'],
    ['production', 'waiting', undefined],
  ])
  const head = github.head(key)!.hash
  expect(docker.state(st.id).containers.some((c) => c.status === 'running' && c.imageRef.endsWith(head))).toBe(true)
  expect(docker.state(prod.id).containers.some((c) => c.status === 'running' && c.imageRef.endsWith(head))).toBe(false)
  const smoke = run.jobs.find((j) => j.key === 'staging')!.steps.flatMap((x) => x.log).join('\n')
  expect(smoke).toContain('pendentes')
  s.ev({ kind: 'browse', url: `http://${st.publicIp}:3000/todos/pendentes`, userTab: true })

  expect(actions.reviewDeployment(run.id, true, 'bulma-briefs')).toContain('não é revisor')
  // recarregar a página não perde o deploy que espera aprovação
  actionsLoad(JSON.parse(JSON.stringify(actionsDump())))
  await tick(100)
  expect(actions.get(run.id)!.status).toBe('waiting')
  expect(actions.reviewDeployment(run.id, true, me, 'staging ok')).toBeNull()
  await waitRuns(key)
  expect(actions.get(run.id)!.conclusion).toBe('success')
  expect(docker.state(prod.id).containers.some((c) => c.status === 'running' && c.imageRef.endsWith(head))).toBe(true)
  s.ev({ kind: 'tick' })

  // segunda mudança: rejeitada em produção
  s.run('git switch main && git pull && git switch -c feat/titulo')
  const f = `${root}/src/todos.js`
  s.fs.write(f, s.fs.read(f).replace("'Aprender o terminal'", "'Aprender o terminal 🐧'"))
  s.run('git commit -am "feat: título" && git push -u origin feat/titulo')
  await prFlow(s, key, 'feat/titulo', me)
  const run2 = await waitGate(key)
  expect(actions.reviewDeployment(run2.id, false, me, 'achei um problema')).toBeNull()
  await tick(1000)
  expect(run2.conclusion).toBe('failure')
  expect(docker.state(prod.id).containers.some((c) => c.status === 'running' && c.imageRef.endsWith(head))).toBe(true)
  s.ev({ kind: 'tick' })
  s.expectMissionDone()
})
