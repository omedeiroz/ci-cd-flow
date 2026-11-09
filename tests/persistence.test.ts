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

const KEY = 'devops-lab:slot:1'
const normalized = () => {
  const d = JSON.parse(localStorage.getItem(KEY)!)
  delete d.savedAt
  delete d.playedMs
  return d
}

it('salva e restaura o estado inteiro do simulador', async () => {
  persist.newGame(1, { name: 'Arthur', avatar: 7 })
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

  expect(persist.restore(1)).toBe(true)
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
  localStorage.setItem('devops-lab:slot:3', '{isso não é json')
  expect(persist.restore(3)).toBe(false)
})

it('slots: lista, exporta, importa, apaga e migra o save antigo', () => {
  persist.save()
  const [meta] = persist.slots()
  expect(meta).toMatchObject({ id: 1, profile: { name: 'Arthur', avatar: 7 }, missionIdx: 5 })
  expect(meta.pct).toBeGreaterThan(40)

  const file = persist.exportSlot(1)!
  expect(JSON.parse(file).format).toBe('devops-lab-save')
  expect(persist.importSave('{"format":"outra-coisa"}', 2)).toContain('inválido')
  expect(persist.importSave(file, 2)).toBeNull()
  expect(persist.slots().map((s) => s.id)).toEqual([1, 2])
  expect(persist.slots()[1].profile.name).toBe('Arthur')

  persist.deleteSlot(2)
  expect(persist.slots().map((s) => s.id)).toEqual([1])

  // save de antes dos slots vira o slot 1
  const old = localStorage.getItem(KEY)!
  localStorage.clear()
  localStorage.setItem('devops-lab:save:v1', old)
  expect(persist.slots().map((s) => s.id)).toEqual([1])
  expect(persist.lastActive()).toBe(1)
  expect(localStorage.getItem('devops-lab:save:v1')).toBeNull()
})
