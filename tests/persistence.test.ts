// @vitest-environment jsdom
// Progresso salvo: salvar, bagunçar o estado e restaurar deve voltar exatamente ao que era.
import { expect, it } from 'vitest'
import { waitRuns } from './harness'
import { localFs, shell, useOS } from '../src/store/os'
import { persist } from '../src/store/persist'
import { github } from '../src/engine/github'
import { aws } from '../src/engine/aws'
import { docker } from '../src/engine/docker'
import { mail } from '../src/engine/mail'

const KEY = 'devops-lab:save:v1'
const normalized = () => {
  const d = JSON.parse(localStorage.getItem(KEY)!)
  delete d.savedAt
  return d
}

it('salva e restaura o estado inteiro do simulador', async () => {
  useOS.getState().startMission(5) // monta conta, repositório, EC2, imagem e container
  await waitRuns('devlab/todo-api')
  shell.execute('cd ~/projetos/todo-api && echo "progresso" > salvo.txt')
  persist.save()
  const before = normalized()
  expect(JSON.stringify(before).length).toBeLessThan(2_000_000) // cabe com folga no localStorage

  // bagunça tudo
  localFs.remove('/home/dev/projetos', true)
  github.setSecret('devlab/todo-api', 'BAGUNCA', 'x')
  aws.setState(aws.instances()[0].id, 'terminate')
  mail.send({ from: 'x', fromAddr: 'x', to: 'x', subject: 'bagunça', preview: '', body: [] })
  useOS.setState({ missionIdx: 0, stepIdx: 0 })

  expect(persist.restore()).toBe(true)
  expect(localFs.read('/home/dev/projetos/todo-api/salvo.txt')).toBe('progresso\n')
  expect(github.get('devlab/todo-api')!.secrets.BAGUNCA).toBeUndefined()
  expect(aws.instances()[0].state).toBe('running')
  expect(docker.state(aws.instances()[0].id).containers[0].status).toBe('running')
  expect(mail.all().some((m) => m.subject === 'bagunça')).toBe(false)
  expect(useOS.getState().missionIdx).toBe(5)

  // salvar de novo gera exatamente o mesmo conteúdo
  persist.save()
  expect(normalized()).toEqual(before)

  // e o motor continua funcionando depois de restaurar
  const r = shell.execute(`curl http://${aws.instances()[0].publicIp}:3000/health`)
  expect(r.out).toBe('{"status":"ok"}')

})

it('ignora um salvamento corrompido', () => {
  localStorage.setItem(KEY, '{isso não é json')
  expect(persist.restore()).toBe(false)
})
