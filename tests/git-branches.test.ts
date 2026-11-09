// Branches, merge de 3 vias, conflitos, upstream e proteção de branch no git simulado.
import { expect, it } from 'vitest'
import { createStudent } from './harness'
import { prepareMission } from '../src/engine/bootstrap'
import { github, makeCommit } from '../src/engine/github'

it('git: branches, conflito, merge e proteção', () => {
  const s = createStudent()
  prepareMission(3, s.fs, s.local)
  const key = 'devlab/todo-api'
  const root = '/home/dev/projetos/todo-api'
  s.run('cd ~/projetos/todo-api')

  expect(s.run('git switch -c feat/x').all).toContain("Alternado para um novo branch 'feat/x'")
  s.fs.write(`${root}/README.md`, s.fs.read(`${root}/README.md`) + '\nlinha do aluno\n')
  s.run('git commit -am "docs: linha do aluno"')
  expect(s.run('git push').all).toContain('git push --set-upstream origin feat/x')
  const pushed = s.run('git push -u origin feat/x')
  expect(pushed.all).toContain('* [new branch]      feat/x -> feat/x')
  expect(pushed.all).toContain('/pull/new/feat/x')
  expect(github.branchNames(key)).toContain('feat/x')
  expect(s.run('git status').all).toContain("atualizado com 'origin/feat/x'")

  // alguém mexe na mesma região do README no main
  const main = github.get(key)!.commits
  const t = main[main.length - 1]
  github.setCommits(key, [...main, makeCommit(t, { ...t.tree, 'README.md': t.tree['README.md'] + '\nlinha da Bulma\n' }, 'docs: Bulma', 'Bulma Briefs', 'bulma@devlab.sim')], 'bulma-briefs')

  expect(s.run('git merge origin/main').all).toContain('Já está atualizado')
  expect(s.run('git fetch').all).toContain('-> origin/main')
  const m = s.run('git merge origin/main')
  expect(m.code).toBe(1)
  expect(m.all).toContain('CONFLITO (conteúdo): Conflito de merge em README.md')
  expect(s.fs.read(`${root}/README.md`)).toContain('<<<<<<< HEAD')
  expect(s.run('git status').all).toContain('ambos modificados:  README.md')
  expect(s.run('git commit -m x').all).toContain('não mesclados')
  expect(s.run('git switch main').code).not.toBe(0)

  s.fs.write(`${root}/README.md`, s.fs.read(`${root}/README.md`).replace(/<<<<<<< HEAD\n|=======\n|>>>>>>> origin\/main\n/g, ''))
  s.run('git add README.md')
  const c = s.run('git commit -m "Merge origin/main"')
  expect(c.code).toBe(0)
  expect(s.run('git log').all).toMatch(/Merge: \w{7} \w{7}/)
  expect(s.run('git push').code).toBe(0)

  // main protegido: push direto é recusado
  github.setProtection(key, 'main', { requirePr: true, approvals: 1, requireChecks: false })
  s.run('git switch main')
  s.fs.write(`${root}/x.txt`, 'x')
  s.run('git add . && git commit -m "direto no main"')
  expect(s.run('git pull').all).toContain('branches divergentes')
  const pl = s.run('git pull --no-rebase')
  expect(pl.all).toContain("Merge made by the 'ort' strategy.")
  const rej = s.run('git push')
  expect(rej.all).toContain('GH006')
  expect(rej.code).toBe(1)

  // abort e restore
  s.run('git switch feat/x')
  expect(s.run('git branch').all).toContain('* feat/x')
  expect(s.run('git branch -d feat/x').all).toContain('em uso')
  s.run('git switch main')
  // já enviado ao origin: o git deixa apagar, com aviso
  expect(s.run('git branch -d feat/x').all).toContain("mesclado em\n         'refs/remotes/origin/feat/x'")
  s.run('git switch -c tmp && git switch main')
  s.run('git switch tmp')
  s.fs.write(`${root}/y.txt`, 'y')
  s.run('git add . && git commit -m "só local" && git switch main')
  expect(s.run('git branch -d tmp').all).toContain('não foi totalmente mesclado')
  expect(s.run('git branch -D tmp').all).toContain('Branch tmp excluído')
  expect(s.fs.exists(`${root}/y.txt`)).toBe(false)
})
