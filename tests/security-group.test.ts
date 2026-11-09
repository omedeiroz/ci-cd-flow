// Regra criada no grupo errado: o Guia avisa e dá para trocar o grupo da instância.
import { expect, it } from 'vitest'
import { createStudent } from './harness'
import { prepareMission } from '../src/engine/bootstrap'
import { aws } from '../src/engine/aws'
import { missions } from '../src/engine/missions'

it('regra no grupo default não libera a instância; trocar o grupo libera', () => {
  const s = createStudent()
  prepareMission(3, s.fs, s.local)
  const inst = aws.instances()[0]
  const own = aws.group(inst.sgId)!
  aws.setRules(own.id, own.rules.filter((r) => r.port !== 3000))
  const def = aws.groups().find((g) => g.name === 'default')!
  aws.setRules(def.id, [{ type: 'TCP personalizado', port: 3000, source: '0.0.0.0/0' }])
  expect(aws.allows(inst, 3000, '8.8.8.8')).toBe(false)

  const step = missions[2].steps.find((x) => x.id === 'sg')!
  expect(step.diagnose!()).toContain('"default"')

  aws.setInstanceGroup(inst.id, def.id)
  expect(aws.allows(inst, 3000, '8.8.8.8')).toBe(true)
  expect(step.diagnose!()).toBeNull()
})
