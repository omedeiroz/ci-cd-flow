// Mundo aberto: resolve os 6 projetos e confere que cada critério é verificado.
import { beforeAll, describe, expect, it } from 'vitest'
import { createStudent, runLogs, tick, waitRuns } from './harness'
import { prepareMission } from '../src/engine/bootstrap'
import { github } from '../src/engine/github'
import { aws, AMIS } from '../src/engine/aws'
import { actions } from '../src/engine/actions'
import { openWorld, PROJECTS } from '../src/engine/openworld'

const s = createStudent()
const P = '/home/dev/projetos'
const write = (path: string, content: string) => {
  s.fs.mkdir(path.split('/').slice(0, -1).join('/'), true)
  s.fs.write(path, content)
}
const status = (id: string) => openWorld.status(PROJECTS.find((p) => p.id === id)!, github.student()!.login)

beforeAll(async () => {
  prepareMission(5, s.fs, s.local)
  await waitRuns('devlab/todo-api')
  openWorld.start(github.student()!)
  await tick(15_000)
  for (const inv of github.invitationsFor(github.student()!.login).filter((i) => i.status === 'pending')) github.respondInvite(inv.id, true)
  openWorld.syncAdmins(github.student()!.login)
  for (const p of PROJECTS) s.run(`cd ${P} && git clone https://github.sim/devlab/${p.repo}.git`)
})

describe('mundo aberto', () => {
  it('chegam 6 convites, um de cada time', () => {
    expect(PROJECTS.map((p) => status(p.id))).toEqual(Array(6).fill('andamento'))
  })

  it('landing-page: lint de HTML e GitHub Pages', async () => {
    const d = `${P}/landing-page`
    write(`${d}/.github/workflows/pages.yml`, `name: Pages
on:
  push:
    branches: [main]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run lint
  deploy:
    needs: lint
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: public
      - uses: actions/deploy-pages@v4
`)
    s.run(`cd ${d} && git add . && git commit -m "ci: pages" && git push`)
    expect((await waitRuns('devlab/landing-page')).jobs[0].conclusion).toBe('failure') // imagens sem alt
    const html = `${d}/public/index.html`
    s.fs.write(html, s.fs.read(html).replace('class="logo">', 'class="logo" alt="Logo">').replace('class="hero">', 'class="hero" alt="Pipeline">'))
    s.run('git commit -am "fix: alt" && git push')
    await waitRuns('devlab/landing-page')
    expect(runLogs('devlab/landing-page')).toContain('Get Pages site failed') // Pages ainda desativado
    actions.setPagesEnabled('devlab/landing-page', true)
    actions.rerun(actions.runs('devlab/landing-page')[0].id)
    expect((await waitRuns('devlab/landing-page')).conclusion).toBe('success')
    expect(actions.pages('devlab/landing-page')?.files?.['index.html']).toContain('alt="Logo"')
    expect(status('landing-page')).toBe('concluido')
  })

  it('shorty: lint e testes', async () => {
    const d = `${P}/shorty`
    expect(s.run(`cd ${d} && npm run lint`).all).toContain('6 problems')
    const f = `${d}/src/shortener.js`
    s.fs.write(f, s.fs.read(f).replace(/\bvar /g, 'let ').replace(/ == /g, ' === '))
    write(`${d}/.github/workflows/ci.yml`, 'name: CI\non: push\njobs:\n  ci:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm ci\n      - run: npm run lint\n      - run: npm test\n')
    s.run('git add . && git commit -m "ci: lint e testes" && git push')
    expect((await waitRuns('devlab/shorty')).conclusion).toBe('success')
    expect(status('shorty')).toBe('concluido')
  })

  it('status-bot: bug de arredondamento', async () => {
    const d = `${P}/status-bot`
    expect(s.run(`cd ${d} && npm test`).all).toContain('esperado "1h 30m", recebido "2h 30m"')
    write(`${d}/.github/workflows/ci.yml`, 'name: CI\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm test\n')
    s.run('git add . && git commit -m "ci: testes" && git push')
    expect((await waitRuns('devlab/status-bot')).conclusion).toBe('failure')
    const f = `${d}/src/uptime.js`
    s.fs.write(f, s.fs.read(f).replace('Math.round', 'Math.floor'))
    s.run('git commit -am "fix: horas" && git push')
    expect((await waitRuns('devlab/status-bot')).conclusion).toBe('success')
    expect(status('status-bot')).toBe('concluido')
  })

  it('compat-lib: matrix Node 18 e 20', async () => {
    const d = `${P}/compat-lib`
    write(`${d}/.github/workflows/ci.yml`, `name: CI
on: push
jobs:
  test:
    name: Node \${{ matrix.node-version }}
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [18, 20]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: \${{ matrix.node-version }}
      - run: npm test
`)
    s.run(`cd ${d} && git add . && git commit -m "ci: matrix" && git push`)
    const first = await waitRuns('devlab/compat-lib')
    expect(first.jobs.map((j) => `${j.name}:${j.conclusion}`)).toEqual(['Node 18:failure', 'Node 20:success'])
    const f = `${d}/src/rank.js`
    s.fs.write(f, s.fs.read(f).replace('players.toSorted(', '[...players].sort('))
    s.run('git commit -am "fix: node 18" && git push')
    expect((await waitRuns('devlab/compat-lib')).conclusion).toBe('success')
    expect(status('compat-lib')).toBe('concluido')
  })

  it('nightly-report: cron + workflow_dispatch', async () => {
    const d = `${P}/nightly-report`
    write(`${d}/.github/workflows/report.yml`, "name: Relatório\non:\n  schedule:\n    - cron: '0 9 * * 1-5'\n  workflow_dispatch:\njobs:\n  report:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - run: npm run report\n")
    s.run(`cd ${d} && git add . && git commit -m "ci: relatório" && git push`)
    expect(actions.workflows('devlab/nightly-report')[0]).toMatchObject({ dispatch: true, cron: '0 9 * * 1-5' })
    expect(actions.dispatch('devlab/nightly-report', '.github/workflows/report.yml', github.student()!.login)).toBeNull()
    expect((await waitRuns('devlab/nightly-report')).event).toBe('workflow_dispatch')
    expect(runLogs('devlab/nightly-report')).toContain('Total do dia: R$ 5773')
    expect(status('nightly-report')).toBe('concluido')
    await tick(120_000) // o agendamento dispara sozinho
    expect(actions.runs('devlab/nightly-report').some((r) => r.event === 'schedule')).toBe(true)
  })

  it('catalogo-api: instância nova, Docker e porta 80', async () => {
    const d = `${P}/catalogo-api`
    const sg = aws.createGroup('catalogo', 'catálogo', [
      { type: 'SSH', port: 22, source: '0.0.0.0/0' },
      { type: 'HTTP', port: 80, source: '0.0.0.0/0' },
    ])
    const inst = aws.launch({ name: 'catalogo-api-server', ami: AMIS[0], type: 't2.micro', keyName: aws.keyPairs()[0].name, sgId: sg.id })
    aws.forceReady(inst)
    s.run(`ssh -o StrictHostKeyChecking=no -i ~/Downloads/${inst.keyName}.pem ubuntu@${inst.publicIp} "sudo apt update && sudo apt install -y docker.io && sudo usermod -aG docker ubuntu"`)
    github.setSecret('devlab/catalogo-api', 'CATALOGO_HOST', inst.publicIp)
    github.setSecret('devlab/catalogo-api', 'CATALOGO_SSH_KEY', s.fs.read(`/home/dev/Downloads/${inst.keyName}.pem`))
    write(`${d}/.github/workflows/cd.yml`, `name: CD
on:
  push:
    branches: [main]
env:
  IMAGE: ghcr.sim/devlab/catalogo-api
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test
  build:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      packages: write
    steps:
      - uses: actions/checkout@v4
      - run: echo "\${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.sim -u \${{ github.actor }} --password-stdin
      - run: |
          docker build -t $IMAGE:\${{ github.sha }} .
          docker push $IMAGE:\${{ github.sha }}
  deploy:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: |
          mkdir -p ~/.ssh
          echo "\${{ secrets.CATALOGO_SSH_KEY }}" > ~/.ssh/k.pem
          chmod 400 ~/.ssh/k.pem
          ssh -o StrictHostKeyChecking=no -i ~/.ssh/k.pem ubuntu@\${{ secrets.CATALOGO_HOST }} "docker pull $IMAGE:\${{ github.sha }} && docker rm -f catalogo; docker run -d -p 80:8080 --restart unless-stopped --name catalogo $IMAGE:\${{ github.sha }}"
`)
    s.run(`cd ${d} && git add . && git commit -m "ci: catálogo" && git push`)
    expect((await waitRuns('devlab/catalogo-api')).conclusion).toBe('success')
    expect(s.run(`curl http://${inst.publicIp}/products`).all).toContain('Teclado mecânico')
    expect(status('catalogo-api')).toBe('concluido')
  })
})
