// Mundo aberto: depois da trilha, outros times da DevLab convidam o aluno para montar CI/CD
// nos repositórios deles. Cada projeto tem critérios verificados automaticamente.
import { load } from 'js-yaml'
import { github, makeCommit, type RemoteRepo, type Tree, type User } from './github'
import { mail } from './mail'
import { actions, type Run } from './actions'
import { aws } from './aws'
import { docker } from './docker'
import { net, callExport } from './node'

// ---------- pessoas ----------

const PEOPLE: User[] = [
  { login: 'erza-scarlet', name: 'Erza Scarlet', email: 'erza@devlab.sim', password: '-', verified: true, avatar: 6, tokens: [], bot: true },
  { login: 'killua-zoldyck', name: 'Killua Zoldyck', email: 'killua@devlab.sim', password: '-', verified: true, avatar: 23, tokens: [], bot: true },
  { login: 'kurisu-makise', name: 'Kurisu Makise', email: 'kurisu@devlab.sim', password: '-', verified: true, avatar: 16, tokens: [], bot: true },
  { login: 'okabe-rintarou', name: 'Rintarou Okabe', email: 'okabe@devlab.sim', password: '-', verified: true, avatar: 30, tokens: [], bot: true },
  { login: 'nami', name: 'Nami', email: 'nami@devlab.sim', password: '-', verified: true, avatar: 21, tokens: [], bot: true },
  { login: 'levi-ackerman', name: 'Levi Ackerman', email: 'levi@devlab.sim', password: '-', verified: true, avatar: 12, tokens: [], bot: true },
]
const person = (login: string) => PEOPLE.find((p) => p.login === login)!

// ---------- conteúdo dos repositórios ----------

const lock = (name: string, deps: Record<string, string> = {}) =>
  JSON.stringify(
    {
      name,
      version: '1.0.0',
      lockfileVersion: 3,
      requires: true,
      packages: { '': { name, version: '1.0.0', dependencies: deps }, ...Object.fromEntries(Object.entries(deps).map(([d, v]) => [`node_modules/${d}`, { version: v.replace('^', '') }])) },
    },
    null,
    2,
  ) + '\n'
const pkg = (name: string, scripts: Record<string, string>, deps: Record<string, string> = {}, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name, version: '1.0.0', private: true, scripts, ...(Object.keys(deps).length ? { dependencies: deps } : {}), ...extra }, null, 2) + '\n'
const GITIGNORE = 'node_modules/\n.env\n'

const LANDING: Tree = {
  'README.md': `# landing-page

Página de lançamento do produto **DevLab Cloud**. Site estático (HTML + CSS), sem build.

## Tarefa para o time de DevOps

- [ ] Rodar \`npm run lint\` a cada push (valida o HTML: título, idioma e texto alternativo nas imagens)
- [ ] Publicar a pasta \`public/\` no **GitHub Pages** automaticamente pelo GitHub Actions
- [ ] O site precisa passar no lint (acessibilidade importa!)

Endereço esperado: https://devlab.github.sim/landing-page/
`,
  'package.json': pkg('landing-page', { lint: 'node scripts/check-html.js' }),
  'package-lock.json': lock('landing-page'),
  '.gitignore': GITIGNORE,
  'scripts/check-html.js': `// Validador simples de HTML do time de front-end.
const fs = require('fs')
const path = require('path')

const dir = 'public'
let errors = 0
for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(dir, file))
  const report = (msg) => {
    console.log(\`  \${dir}/\${file}: \${msg}\`)
    errors++
  }
  if (!/<html[^>]*\\slang="/.test(html)) report('a tag <html> precisa do atributo lang')
  if (!/<title>[^<]+<\\/title>/.test(html)) report('a página precisa de um <title>')
  const imgs = html.match(/<img\\b[^>]*>/g) || []
  imgs.forEach((tag, i) => {
    if (!/\\salt="[^"]+"/.test(tag)) report(\`imagem \${i + 1} sem texto alternativo (alt): \${tag}\`)
  })
}
if (errors) {
  console.log(\`\\n✖ \${errors} problema(s) encontrado(s)\`)
  process.exit(1)
}
console.log('✔ HTML OK')
`,
  'public/index.html': `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>DevLab Cloud</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <header>
    <img src="logo.svg" class="logo">
    <nav><a href="#planos">Planos</a> <a href="#contato">Contato</a></nav>
  </header>
  <main>
    <h1>Deploy sem drama.</h1>
    <p>Do git push à produção em minutos, com testes, containers e rollback de um clique.</p>
    <a class="cta" href="#planos">Começar grátis</a>
    <img src="hero.svg" class="hero">
  </main>
  <section id="planos">
    <div class="card"><h3>Hobby</h3><p>R$ 0</p></div>
    <div class="card destaque"><h3>Time</h3><p>R$ 49/mês</p></div>
    <div class="card"><h3>Empresa</h3><p>Fale com a gente</p></div>
  </section>
  <footer id="contato">contato@devlab.sim</footer>
</body>
</html>
`,
  'public/style.css': `body { margin: 0; font-family: system-ui, sans-serif; color: #1b1340; background: linear-gradient(160deg, #f3efff, #e6f6ff); }
header { display: flex; justify-content: space-between; align-items: center; padding: 18px 40px; }
.logo { height: 36px; }
nav a { margin-left: 18px; color: #4b3fb5; text-decoration: none; font-weight: 600; }
main { text-align: center; padding: 50px 20px 20px; }
h1 { font-size: 46px; margin: 0 0 10px; }
.cta { display: inline-block; margin: 18px 0 30px; padding: 12px 26px; border-radius: 30px; background: #6b4eff; color: #fff; text-decoration: none; font-weight: 700; }
.hero { width: min(560px, 90%); }
#planos { display: flex; gap: 16px; justify-content: center; padding: 30px; }
.card { background: #fff; border-radius: 14px; padding: 18px 26px; box-shadow: 0 6px 20px #6b4eff22; text-align: center; }
.destaque { outline: 3px solid #6b4eff; }
footer { text-align: center; padding: 30px; color: #6a6390; }
`,
  'public/logo.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 36"><circle cx="18" cy="18" r="16" fill="#6b4eff"/><path d="M10 18h16M18 10v16" stroke="#fff" stroke-width="4" stroke-linecap="round"/><text x="42" y="25" font-family="system-ui" font-weight="800" font-size="20" fill="#1b1340">DevLab Cloud</text></svg>
`,
  'public/hero.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 560 220"><rect x="10" y="20" width="540" height="190" rx="18" fill="#fff"/><rect x="10" y="20" width="540" height="34" rx="18" fill="#1b1340"/><circle cx="36" cy="37" r="6" fill="#ff5f57"/><circle cx="56" cy="37" r="6" fill="#febc2e"/><circle cx="76" cy="37" r="6" fill="#28c840"/><text x="40" y="96" font-family="monospace" font-size="18" fill="#1b1340">$ git push</text><text x="40" y="130" font-family="monospace" font-size="18" fill="#1f883d">✓ testes  ✓ build  ✓ deploy</text><text x="40" y="164" font-family="monospace" font-size="18" fill="#6b4eff">🚀 no ar em 42s</text></svg>
`,
}

const SHORTY_SRC = `// Encurtador de links
var links = {}
var counter = 1000

function encode(n) {
  return n.toString(36)
}

function shorten(url) {
  if (url == undefined || url == '') throw new Error('url é obrigatória')
  if (!url.startsWith('http')) throw new Error('url inválida')
  var code = encode(counter++)
  links[code] = url
  return code
}

function resolve(code) {
  var url = links[code]
  if (url == undefined) return null
  return url
}

module.exports = { shorten, resolve }
`
const SHORTY: Tree = {
  'README.md': `# shorty

Encurtador de links: \`POST /links\` cria, \`GET /:code\` redireciona.

## Tarefa para o time de DevOps

- [ ] Pipeline de CI que roda **lint e testes** em todo push
- [ ] O lint precisa passar (o código está cheio de \`var\` e \`==\`…)
- [ ] Commits na main sempre verdes

Regras do lint: veja \`scripts/lint.js\`.
`,
  'package.json': pkg('shorty', { start: 'node src/server.js', test: 'node --test tests/', lint: 'node scripts/lint.js' }, { express: '^4.19.2' }),
  'package-lock.json': lock('shorty', { express: '^4.19.2' }),
  '.gitignore': GITIGNORE,
  'src/shortener.js': SHORTY_SRC,
  'src/server.js': `const express = require('express')
const { shorten, resolve } = require('./shortener')
const app = express()
app.use(express.json())
app.post('/links', (req, res) => res.status(201).json({ code: shorten(req.body.url) }))
app.get('/:code', (req, res) => {
  const url = resolve(req.params.code)
  return url ? res.redirect(url) : res.status(404).end()
})
const PORT = process.env.PORT || 3000
app.listen(PORT, () => console.log(\`shorty em http://localhost:\${PORT}\`))
`,
  'tests/shortener.test.js': `const test = require('node:test')
const assert = require('node:assert')
const { shorten, resolve } = require('../src/shortener')

test('encurta e resolve um link', () => {
  const code = shorten('https://devlab.sim')
  assert.strictEqual(resolve(code), 'https://devlab.sim')
})

test('recusa url vazia', () => {
  assert.throws(() => shorten(''))
})

test('código desconhecido resolve para null', () => {
  assert.strictEqual(resolve('naoexiste'), null)
})
`,
  'scripts/lint.js': `// Lint do time: regras simples, mas obrigatórias.
const fs = require('fs')
const path = require('path')

const RULES = [
  { re: /\\bvar\\s/, msg: 'Unexpected var, use let or const instead', rule: 'no-var' },
  { re: /[^=!<>]==(?!=)|!=(?!=)/, msg: "Expected '===' and instead saw '=='", rule: 'eqeqeq' },
]
let problems = 0
for (const file of fs.readdirSync('src').filter((f) => f.endsWith('.js'))) {
  const lines = fs.readFileSync(path.join('src', file)).split('\\n')
  const found = []
  lines.forEach((line, i) => {
    for (const r of RULES) if (r.re.test(line)) found.push(\`  \${i + 1}:\${line.search(r.re) + 1}  error  \${r.msg}  \${r.rule}\`)
  })
  if (found.length) {
    console.log(\`src/\${file}\`)
    found.forEach((f) => console.log(f))
    console.log('')
    problems += found.length
  }
}
if (problems) {
  console.log(\`✖ \${problems} problems (\${problems} errors, 0 warnings)\`)
  process.exit(1)
}
console.log('✔ lint sem problemas')
`,
}

const STATUS: Tree = {
  'README.md': `# status-bot

Bot que publica no chat do time o uptime dos serviços.

## Tarefa para o time de DevOps

- [ ] Criar o pipeline de CI com os testes
- [ ] **Os testes estão falhando** desde o último commit. Alguém precisa achar o bug em \`src/uptime.js\` e corrigir
- [ ] Main verde de novo
`,
  'package.json': pkg('status-bot', { test: 'node --test tests/', status: 'node scripts/post-status.js' }),
  'package-lock.json': lock('status-bot'),
  '.gitignore': GITIGNORE,
  'src/uptime.js': `// Formata segundos como "1d 2h 3m"
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400)
  const hours = Math.round((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts = []
  if (days) parts.push(days + 'd')
  if (hours) parts.push(hours + 'h')
  parts.push(minutes + 'm')
  return parts.join(' ')
}

module.exports = { formatUptime }
`,
  'scripts/post-status.js': `const { formatUptime } = require('../src/uptime')
console.log('todo-api: no ar há ' + formatUptime(93784))
`,
  'tests/uptime.test.js': `const test = require('node:test')
const assert = require('node:assert')
const { formatUptime } = require('../src/uptime')

test('menos de uma hora', () => {
  assert.strictEqual(formatUptime(59), '0m')
})

test('hora e meia', () => {
  assert.strictEqual(formatUptime(5400), '1h 30m')
})

test('dias, horas e minutos', () => {
  assert.strictEqual(formatUptime(90061), '1d 1h 1m')
})
`,
}
const STATUS_BUGGY = STATUS['src/uptime.js']

const COMPAT: Tree = {
  'README.md': `# compat-lib

Biblioteca de ranking usada por vários serviços. Alguns ainda rodam **Node 18**, outros **Node 20**.

## Tarefa para o time de DevOps

- [ ] CI que roda os testes nas **duas versões do Node** (18 e 20), usando matrix
- [ ] Os testes precisam passar nas duas. Hoje quebram no 18 (descubra por quê)
`,
  'package.json': pkg('compat-lib', { test: 'node --test tests/' }, {}, { engines: { node: '>=18' } }),
  'package-lock.json': lock('compat-lib'),
  '.gitignore': GITIGNORE,
  'src/rank.js': `// Ordena jogadores por pontuação, sem alterar a lista original.
function rank(players) {
  return players.toSorted((a, b) => b.score - a.score).map((p, i) => ({ ...p, position: i + 1 }))
}

function top(players, n) {
  return rank(players).slice(0, n)
}

module.exports = { rank, top }
`,
  'tests/rank.test.js': `const test = require('node:test')
const assert = require('node:assert')
const { rank, top } = require('../src/rank')

const players = [
  { name: 'Mayuri', score: 30 },
  { name: 'Daru', score: 90 },
  { name: 'Suzuha', score: 60 },
]

test('ordena por pontuação', () => {
  assert.deepStrictEqual(rank(players).map((p) => p.name), ['Daru', 'Suzuha', 'Mayuri'])
})

test('não altera a lista original', () => {
  rank(players)
  assert.strictEqual(players[0].name, 'Mayuri')
})

test('top N', () => {
  assert.strictEqual(top(players, 1)[0].position, 1)
})
`,
}

const REPORT: Tree = {
  'README.md': `# nightly-report

Gera o relatório de vendas do dia anterior para o time comercial.

## Tarefa para o time de DevOps

- [ ] Workflow que roda \`npm run report\` **todo dia útil às 9h (UTC)** usando \`schedule\` + cron
- [ ] Também precisa dar para rodar **na hora, por um botão** (gatilho \`workflow_dispatch\`)
- [ ] Rodar uma vez pelo botão para conferir

Dica de cron: minuto hora dia-do-mês mês dia-da-semana.
`,
  'package.json': pkg('nightly-report', { report: 'node scripts/report.js' }),
  'package-lock.json': lock('nightly-report'),
  '.gitignore': GITIGNORE,
  'data/sales.json': JSON.stringify(
    [
      { produto: 'Plano Hobby', qtd: 120, preco: 0 },
      { produto: 'Plano Time', qtd: 37, preco: 49 },
      { produto: 'Plano Empresa', qtd: 4, preco: 990 },
    ],
    null,
    2,
  ) + '\n',
  'scripts/report.js': `const fs = require('fs')
const sales = JSON.parse(fs.readFileSync('data/sales.json'))
console.log('📊 Relatório de vendas')
let total = 0
for (const s of sales) {
  const subtotal = s.qtd * s.preco
  total += subtotal
  console.log(\`  \${s.produto.padEnd(14)} \${String(s.qtd).padStart(4)} x R$ \${s.preco} = R$ \${subtotal}\`)
}
console.log(\`Total do dia: R$ \${total}\`)
`,
}

const CATALOG: Tree = {
  'README.md': `# catalogo-api

API do catálogo de produtos. Lê a porta da variável \`PORT\` (padrão **8080**).

## Tarefa para o time de DevOps

Ainda não existe infraestrutura para este serviço. Montar do zero:

- [ ] Uma **nova instância EC2** só para o catálogo (não use a da todo-api)
- [ ] Pipeline: testes → build e push da imagem \`ghcr.sim/devlab/catalogo-api\` → deploy na instância nova
- [ ] O site precisa abrir em **http://IP-DA-INSTÂNCIA/**, ou seja, na porta 80, não na 8080
- [ ] Container com reinício automático
`,
  'package.json': pkg('catalogo-api', { start: 'node src/server.js', test: 'node --test tests/' }, { express: '^4.19.2' }),
  'package-lock.json': lock('catalogo-api', { express: '^4.19.2' }),
  '.gitignore': GITIGNORE,
  '.dockerignore': 'node_modules\n.git\n.github\n',
  Dockerfile: `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
EXPOSE 8080
CMD ["npm", "start"]
`,
  'src/catalog.js': `const products = [
  { id: 1, name: 'Teclado mecânico', price: 349.9, emoji: '⌨️' },
  { id: 2, name: 'Monitor 27"', price: 1299, emoji: '🖥️' },
  { id: 3, name: 'Cadeira gamer', price: 899, emoji: '🪑' },
  { id: 4, name: 'Headset', price: 259.9, emoji: '🎧' },
]

function listProducts() {
  return products
}

module.exports = { listProducts }
`,
  'src/server.js': `const express = require('express')
const { listProducts } = require('./catalog')
const app = express()
app.get('/health', (req, res) => res.json({ status: 'ok' }))
app.get('/products', (req, res) => res.json(listProducts()))
const PORT = process.env.PORT || 8080
app.listen(PORT, () => console.log(\`catálogo em http://localhost:\${PORT}\`))
`,
  'tests/catalog.test.js': `const test = require('node:test')
const assert = require('node:assert')
const { listProducts } = require('../src/catalog')

test('lista produtos', () => {
  assert.ok(listProducts().length > 0)
})

test('todo produto tem preço', () => {
  assert.ok(listProducts().every((p) => p.price > 0))
})
`,
}

function repo(name: string, description: string, owner: User, files: Tree, stars: number): RemoteRepo {
  const day = 86_400_000
  const c1 = makeCommit(null, files, 'feat: primeira versão', owner.name, owner.email, Date.now() - 9 * day)
  return { owner: 'devlab', name, description, stars, branch: 'main', commits: [c1], collaborators: [owner.login], admins: [owner.login], secrets: {} }
}

// ---------- projetos ----------

export type Project = {
  id: string
  repo: string
  from: string
  title: string
  stack: string
  brief: string
  criteria: string[]
  tips: string[]
  done: () => boolean
}

const runsOf = (r: string) => actions.runs(`devlab/${r}`)
const lastDone = (r: string): Run | undefined => runsOf(r).find((x) => x.status === 'completed')
const logs = (run: Run) => run.jobs.flatMap((j) => j.steps.flatMap((s) => s.log)).join('\n')
const headTree = (r: string) => github.head(`devlab/${r}`)?.tree ?? {}
const wfDefs = (r: string) =>
  Object.entries(headTree(r))
    .filter(([p]) => p.startsWith('.github/workflows/'))
    .map(([, c]) => {
      try {
        return (load(c) ?? {}) as { on?: unknown; jobs?: Record<string, { strategy?: { matrix?: Record<string, unknown> } }> }
      } catch {
        return {}
      }
    })

export const PROJECTS: Project[] = [
  {
    id: 'landing-page',
    repo: 'landing-page',
    from: 'erza-scarlet',
    title: 'Landing page no GitHub Pages',
    stack: 'HTML estático · GitHub Pages',
    brief:
      'Nosso site de lançamento sai semana que vem e hoje ele só existe no repositório. Quero que cada push na main valide o HTML e publique no GitHub Pages, sem ninguém copiar arquivo na mão. E o lint de acessibilidade é inegociável.',
    criteria: ['Workflow roda o npm run lint a cada push', 'O site passa no lint', 'Site publicado no GitHub Pages pelo Actions'],
    tips: [
      'Pages precisa ser ativado em Configurações > Pages, com a origem "GitHub Actions"',
      'As actions oficiais são actions/configure-pages, actions/upload-pages-artifact (com path) e actions/deploy-pages',
      'O deploy-pages exige permissions: pages: write e id-token: write',
    ],
    done: () => {
      const site = actions.pages('devlab/landing-page')
      const html = site?.files?.['index.html'] ?? ''
      const imgsOk = (html.match(/<img\b[^>]*>/g) ?? []).every((t) => /\salt="[^"]+"/.test(t))
      return !!site?.files && imgsOk && runsOf('landing-page').some((r) => r.conclusion === 'success' && logs(r).includes('HTML OK') && logs(r).includes('Reported success'))
    },
  },
  {
    id: 'shorty',
    repo: 'shorty',
    from: 'killua-zoldyck',
    title: 'Lint e testes no shorty',
    stack: 'Node.js · lint + testes',
    brief:
      'O shorty não tem CI nenhum, e todo PR vira discussão de estilo. Quero lint e testes rodando em todo push, e só aceito verde. Aviso: o lint vai reclamar bastante do código atual.',
    criteria: ['Workflow com npm run lint e npm test', 'Lint sem erros (sem var, sem ==)', 'Última execução da main verde'],
    tips: ['Rode npm run lint na sua máquina antes de dar push: é mais rápido que esperar o CI', 'Troque var por const/let e == por ===. Atenção: o == undefined também cobre null…'],
    done: () => {
      const r = lastDone('shorty')
      return !!r && r.conclusion === 'success' && logs(r).includes('lint sem problemas') && /aprovados \d+/.test(logs(r))
    },
  },
  {
    id: 'status-bot',
    repo: 'status-bot',
    from: 'kurisu-makise',
    title: 'Caçar o bug do status-bot',
    stack: 'Node.js · depuração',
    brief:
      'Os testes do status-bot começaram a falhar e ninguém percebeu, porque não temos CI. O bot está anunciando "2h 30m" quando são 1h30. Coloca o CI no ar e encontra o bug, por favor. Hipótese: alguém mexeu num arredondamento.',
    criteria: ['Workflow de CI com os testes', 'Bug em src/uptime.js corrigido', 'Pipeline verde'],
    tips: ['Leia a mensagem do teste que falha: esperado x recebido', 'Math.round arredonda 1,5 para 2. O que você quer aqui é truncar.'],
    done: () => {
      const r = lastDone('status-bot')
      return !!r && r.conclusion === 'success' && headTree('status-bot')['src/uptime.js'] !== STATUS_BUGGY && /aprovados 3/.test(logs(r))
    },
  },
  {
    id: 'compat-lib',
    repo: 'compat-lib',
    from: 'okabe-rintarou',
    title: 'Matrix Node 18 e 20',
    stack: 'Node.js · strategy.matrix',
    brief:
      'A compat-lib é usada por serviços em Node 18 e em Node 20. Alguém usou um recurso novo e quebrou os serviços antigos em produção! Quero o CI testando nas duas versões ao mesmo tempo, e a biblioteca funcionando nas duas.',
    criteria: ['Workflow com strategy.matrix rodando Node 18 e 20', 'Testes passando nas duas versões'],
    tips: [
      'Com matrix, o mesmo job roda uma vez para cada valor: node-version: [18, 20], e no setup-node use ${{ matrix.node-version }}',
      'toSorted() só existe a partir do Node 20. Uma alternativa compatível: [...lista].sort(...)',
    ],
    done: () => {
      const r = lastDone('compat-lib')
      const mx = r?.jobs.map((j) => Object.values(j.matrix ?? {}).join(',')) ?? []
      return !!r && r.conclusion === 'success' && mx.some((m) => /\b18\b/.test(m)) && mx.some((m) => /\b20\b/.test(m))
    },
  },
  {
    id: 'nightly-report',
    repo: 'nightly-report',
    from: 'nami',
    title: 'Relatório agendado',
    stack: 'Node.js · schedule + workflow_dispatch',
    brief:
      'Todo dia eu rodo o relatório de vendas na mão, e quando esqueço o comercial me cobra. Quero que ele rode sozinho todo dia útil às 9h (UTC), e que eu consiga disparar na hora por um botão quando precisar.',
    criteria: ['on.schedule com cron válido (dias úteis às 9h UTC)', 'Gatilho workflow_dispatch', 'Uma execução manual (botão Run workflow) com sucesso'],
    tips: ['Cron dos dias úteis às 9h: 0 9 * * 1-5', 'Depois do push, o botão "Run workflow" aparece na aba Actions ao selecionar o workflow'],
    done: () => {
      const okDef = wfDefs('nightly-report').some((d) => {
        const on = d.on as Record<string, unknown> | undefined
        const cron = (on?.schedule as { cron?: string }[] | undefined)?.[0]?.cron?.trim() ?? ''
        return !!on && 'workflow_dispatch' in on && /^0 9 \* \* (1-5|MON-FRI)$/i.test(cron)
      })
      return okDef && runsOf('nightly-report').some((r) => r.event === 'workflow_dispatch' && r.conclusion === 'success' && logs(r).includes('Total do dia'))
    },
  },
  {
    id: 'catalogo-api',
    repo: 'catalogo-api',
    from: 'levi-ackerman',
    title: 'Infra do zero para o catálogo',
    stack: 'Docker · EC2 nova · porta 80',
    brief:
      'O catálogo precisa ir para produção e não existe nada: nem servidor, nem pipeline. Uma instância separada, imagem no registry, deploy automático, e o site abrindo na porta 80. A aplicação escuta na 8080. Faça direito: sem atalho e sem gambiarra.',
    criteria: [
      'Uma instância EC2 nova, só do catálogo',
      'Pipeline: testes → imagem ghcr.sim/devlab/catalogo-api → deploy',
      'Site respondendo em http://IP/ (porta 80) a partir do container',
    ],
    tips: [
      'docker run -p 80:8080: porta 80 do servidor → porta 8080 do container',
      'O Security Group da instância nova precisa liberar a porta 80 (HTTP) e a 22 para o runner',
      'Use secrets com outros nomes (ex.: CATALOGO_HOST e CATALOGO_SSH_KEY) e lembre do permissions: packages: write',
    ],
    done: () =>
      aws.instances().some((i) => {
        const svc = net.get(i.id, 80)
        if (!svc?.via) return false
        const ctr = docker.state(i.id).containers.find((c) => c.status === 'running' && c.ports.some((p) => p.host === 80))
        if (!ctr || !/ghcr\.sim\/devlab\/catalogo-api:[0-9a-f]{40}$/.test(ctr.imageRef)) return false
        if (net.get(i.id, 3000)) return false // não pode ser a mesma instância da todo-api
        try {
          return callExport<unknown[]>(svc.fs, svc.root, 'src/catalog.js', 'listProducts').length > 0 && runsOf('catalogo-api').some((r) => r.conclusion === 'success')
        } catch {
          return false
        }
      }),
  },
]

// ---------- liberação ----------

function sendInvite(p: Project, student: User) {
  const who = person(p.from)
  github.invite(`devlab/${p.repo}`, student.login, who.login)
  mail.send({
    from: who.name,
    fromAddr: who.email,
    avatar: who.avatar,
    to: student.email,
    subject: `[${p.repo}] ${p.title}`,
    preview: p.brief.slice(0, 90) + '…',
    body: [
      { kind: 'p', text: `Oi, @${student.login}!` },
      { kind: 'p', text: p.brief },
      { kind: 'p', text: `O que eu preciso:\n${p.criteria.map((c) => `• ${c}`).join('\n')}` },
      { kind: 'p', text: `Te convidei para o devlab/${p.repo} com permissão de administrador.\n— ${who.name.split(' ')[0]}` },
      { kind: 'button', label: 'Ver convite', url: `https://github.sim/devlab/${p.repo}/invitations` },
    ],
  })
}

let started = false
export const openWorld = {
  get started() {
    return started
  },
  start(student: User) {
    if (started) return
    started = true
    for (const p of PEOPLE) if (!github.user(p.login)) github.addUser(p)
    const repos: [string, string, Tree, number][] = [
      ['landing-page', 'Site de lançamento do DevLab Cloud', LANDING, 18],
      ['shorty', 'Encurtador de links interno', SHORTY, 9],
      ['status-bot', 'Bot de status dos serviços', STATUS, 5],
      ['compat-lib', 'Biblioteca de ranking compatível com Node 18 e 20', COMPAT, 31],
      ['nightly-report', 'Relatório diário de vendas', REPORT, 3],
      ['catalogo-api', 'API do catálogo de produtos', CATALOG, 12],
    ]
    for (const [name, desc, files, stars] of repos) if (!github.get(`devlab/${name}`)) github.addRepo(repo(name, desc, person(PROJECTS.find((x) => x.repo === name)!.from), files, stars))

    mail.send({
      from: 'Senku Ishigami',
      fromAddr: 'senku@devlab.sim',
      avatar: 1,
      to: student.email,
      subject: 'Você virou a referência de DevOps do time 🚀',
      preview: 'A notícia se espalhou. Vários times vão te chamar…',
      body: [
        { kind: 'p', text: 'A notícia se espalhou: a todo-api agora tem testes, container, deploy automático e rollback. Agora todo mundo quer o mesmo!' },
        { kind: 'p', text: 'Vários times vão te convidar para os repositórios deles. Cada um tem um desafio diferente e não tem roteiro: você já sabe o caminho. Os critérios de cada projeto estão no app Guia.' },
        { kind: 'p', text: 'Boa sorte. E lembre: main vermelha, ninguém faz deploy.' },
      ],
    })
    PROJECTS.forEach((p, i) => setTimeout(() => sendInvite(p, student), 1500 + i * 1800))
  },
  /** Ao restaurar o progresso: reenvia convites que ficaram pendentes de envio. */
  ensureInvites(student: User) {
    if (!started) return
    for (const p of PROJECTS) if (!github.invitationsFor(student.login).some((i) => i.repo === `devlab/${p.repo}`)) sendInvite(p, student)
  },
  /** Ao aceitar o convite do mundo aberto, o aluno vira admin (para cadastrar secrets e ativar Pages). */
  syncAdmins(login: string) {
    for (const p of PROJECTS) if (github.isCollaborator(login, `devlab/${p.repo}`) && !github.isAdmin(login, `devlab/${p.repo}`)) github.makeAdmin(login, `devlab/${p.repo}`)
  },
  status(p: Project, login: string): 'convite' | 'andamento' | 'concluido' | 'aguardando' {
    const inv = github.invitationsFor(login).find((i) => i.repo === `devlab/${p.repo}`)
    if (!inv) return 'aguardando'
    if (inv.status === 'pending') return 'convite'
    return p.done() ? 'concluido' : 'andamento'
  },
}

// ---------- progresso salvo ----------
export const openWorldDump = () => ({ started })
export function openWorldLoad(d: { started: boolean }) {
  started = d.started
}
