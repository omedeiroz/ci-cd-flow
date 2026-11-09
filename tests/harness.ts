// Utilitários para dirigir o simulador nos testes: um "aluno" que digita comandos,
// responde prompts, entra e sai de servidores e acompanha o progresso das missões.
import { vi, expect } from 'vitest'
import { createLocalFs, type VFS } from '../src/engine/fs'
import { Shell, type Machine, type Result } from '../src/engine/shell'
import { missions, type SimEvent } from '../src/engine/missions'
import { actions } from '../src/engine/actions'
import { net } from '../src/engine/node'
import '../src/engine/docker'
import '../src/engine/editor'

export const strip = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')

export function createStudent() {
  const fs: VFS = createLocalFs()
  const machine: Machine = { id: 'local', os: 'mac', packages: new Set(['git', 'nodejs', 'npm', 'curl', 'docker']), aptUpdated: false }
  const local = new Shell(fs, 'dev', 'devops-lab', machine)
  const stack: Shell[] = [local]
  const seen = new Set<string>()
  let missionIdx = 0
  let step = 0
  const passed: string[] = []

  const ev = (e: SimEvent) => {
    if (e.kind === 'ui') seen.add(e.name)
    const m = missions[missionIdx]
    while (step < m.steps.length && m.steps[step].check({ fs, cwd: cur().cwd, event: e, seen })) {
      passed.push(m.steps[step].id)
      step++
      e = { kind: 'tick' }
    }
  }
  const cur = () => stack[stack.length - 1]
  local.onCommand = (e) => ev({ kind: 'cmd', ...e })

  /** Digita uma linha; `answers` responde prompts (senha, yes/no...) na ordem. */
  const run = (line: string, answers: string[] = []): Result & { all: string } => {
    let r = cur().execute(line)
    let all = strip(r.out)
    while (r.prompt) {
      const a = answers.shift()
      if (a === undefined) throw new Error(`Prompt sem resposta: ${r.prompt.text}`)
      r = r.prompt.answer(a)
      all += '\n' + strip(r.out)
    }
    if (r.session === 'pop') net.killSession(stack.pop()!.sessionId)
    else if (r.session) {
      r.session.push.onCommand = local.onCommand
      stack.push(r.session.push)
    }
    return { ...r, all }
  }

  return {
    fs,
    machine,
    local,
    run,
    ev,
    cur,
    seen,
    passed,
    get step() {
      return step
    },
    mission(idx: number) {
      missionIdx = idx
      step = 0
      passed.length = 0
    },
    /** Garante que todos os passos da missão atual passaram. */
    expectMissionDone() {
      expect(passed).toEqual(missions[missionIdx].steps.map((s) => s.id))
    },
  }
}

/** Avança o relógio falso. */
export const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms)

/** Avança o tempo até todas as execuções do repositório terminarem. */
export async function waitRuns(repo: string) {
  for (let i = 0; i < 400; i++) {
    await tick(500)
    if (actions.runs(repo).every((r) => r.status === 'completed')) return actions.runs(repo)[0]
  }
  throw new Error(`Pipeline de ${repo} não terminou`)
}

export const runLogs = (repo: string) =>
  actions
    .runs(repo)[0]
    .jobs.flatMap((j) => j.steps.flatMap((s) => s.log))
    .join('\n')
