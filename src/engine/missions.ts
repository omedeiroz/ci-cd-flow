// Motor de missões: cada passo tem explicação, dica e uma verificação automática.
import type { VFS } from './fs'
import type { CommandEvent } from './shell'
import { allRepos, aheadBy, findRepo, readConfig, repoStatus } from './git'
import { github } from './github'
import { net } from './node'
import { aws, STAGING_NAME } from './aws'
import { load } from 'js-yaml'
import { editor } from './editor'
import { actions } from './actions'
import { loadTodos } from './node'
import { docker } from './docker'
import { documents, team, TEAM_REPO } from './team'

export type SimEvent =
  | ({ kind: 'cmd' } & CommandEvent)
  | { kind: 'browse'; url: string; userTab: boolean }
  | { kind: 'ui'; name: string }
  | { kind: 'tick' } // algum estado mudou (timer da AWS, convite chegou...)
export type CheckCtx = { fs: VFS; cwd: string; event: SimEvent; seen: Set<string> }
export type HintCtx = { login: string; email: string; ip: string; key: string; prevTag: string; stagingIp: string }

/** Verdadeiro se o evento é o comando `name` (e, opcionalmente, o subcomando `sub`) executado com sucesso. */
const ran = (e: SimEvent, name: string, sub?: string) => e.kind === 'cmd' && e.name === name && e.code === 0 && (!sub || e.args[0] === sub)
const browsed = (e: SimEvent, re: RegExp) => e.kind === 'browse' && re.test(e.url)

export type Step = {
  id: string
  title: string
  /** Parágrafos da explicação. Trechos entre `crases` viram código. */
  body: string[]
  /** Comando sugerido (botão "Digitar no terminal"). Pode depender do estado (IP, e-mail...). */
  hint?: string | ((h: HintCtx) => string)
  /** Endereço que o aluno deve digitar no navegador (só exibido, sem atalho). */
  browse?: string | ((h: HintCtx) => string)
  /** Trecho de código para o aluno colar no editor (botões Copiar / Inserir no editor). */
  snippet?: { file: string; code: string; mode: 'replace' | 'append' }
  check: (ctx: CheckCtx) => boolean
  success: string
}

export type Mission = {
  id: string
  title: string
  short: string
  summary: string
  steps: Step[]
}

const HOME = '/home/dev'
const staging = () => aws.instances().find((i) => i.name === STAGING_NAME && i.state !== 'terminated')
const production = () => aws.instances().find((i) => i.name !== STAGING_NAME && i.state === 'running')
const waitingProd = () => actions.runs(TEAM_REPO).some((r) => r.jobs.some((j) => j.environment === 'staging' && j.conclusion === 'success') && r.jobs.some((j) => j.environment === 'production' && (j.status === 'waiting' || !!j.review)))
const studentPr = () => github.pulls(TEAM_REPO).filter((p) => p.author === github.student()?.login).sort((a, b) => b.number - a.number)[0]
const repoRoot = (fs: VFS) => allRepos(fs).find((r) => r.remoteKey === 'devlab/todo-api')?.root
const ORIGINAL_TODOS = JSON.stringify([
  { id: 1, title: 'Aprender o terminal', done: true },
  { id: 2, title: 'Clonar o repositório', done: false },
  { id: 3, title: 'Configurar o pipeline de CI/CD', done: false },
])

export const DOCKERIGNORE = `node_modules
npm-debug.log
.git
.github
.env
`

export const DOCKER_CI_YML = `name: CI/CD

on:
  push:
    branches: [main]

env:
  IMAGE: ghcr.sim/devlab/todo-api

jobs:
  test:
    name: Testes
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npm test

  build:
    name: Build da imagem
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - name: Baixar o código
        uses: actions/checkout@v4

      - name: Login no registry
        run: echo "\${{ secrets.GITHUB_TOKEN }}" | docker login ghcr.sim -u \${{ github.actor }} --password-stdin

      - name: Build e push da imagem
        run: |
          docker build -t $IMAGE:\${{ github.sha }} -t $IMAGE:latest .
          docker push $IMAGE:\${{ github.sha }}
          docker push $IMAGE:latest

  deploy:
    name: Deploy na EC2
    needs: build
    runs-on: ubuntu-latest
    steps:
      - name: Configurar a chave SSH
        run: |
          mkdir -p ~/.ssh
          echo "\${{ secrets.EC2_SSH_KEY }}" > ~/.ssh/deploy.pem
          chmod 400 ~/.ssh/deploy.pem

      - name: Trocar o container
        run: |
          ssh -o StrictHostKeyChecking=no -i ~/.ssh/deploy.pem ubuntu@\${{ secrets.EC2_HOST }} "docker pull $IMAGE:\${{ github.sha }} && docker rm -f todo; docker run -d -p 3000:3000 --restart unless-stopped --name todo $IMAGE:\${{ github.sha }}"
`

/** Workflow da Missão 7: roda os testes em todo pull request; build e deploy só no push para a main. */
export const PR_CI_YML = DOCKER_CI_YML.replace(
  'on:\n  push:\n    branches: [main]\n',
  'on:\n  push:\n    branches: [main]\n  pull_request:\n    branches: [main]\n',
).replace("    needs: test\n    runs-on: ubuntu-latest\n", "    needs: test\n    if: github.event_name == 'push'\n    runs-on: ubuntu-latest\n")

export const FEATURE_TODOS = `
function pendingCount() {
  return todos.filter((t) => !t.done).length
}

module.exports.pendingCount = pendingCount
`
export const FEATURE_TEST = `
const { pendingCount } = require('../src/todos')

test('conta as tarefas pendentes', () => {
  assert.strictEqual(pendingCount(), listTodos().filter((t) => !t.done).length)
})
`
export const FEATURE_ROUTE = `
const { pendingCount } = require('./todos')
app.get('/todos/pendentes', (req, res) => res.json({ pendentes: pendingCount() }))
`

const DEPLOY_STEPS = (smoke: boolean) => `    steps:
      - name: Configurar a chave SSH
        run: |
          mkdir -p ~/.ssh
          echo "\${{ secrets.EC2_SSH_KEY }}" > ~/.ssh/deploy.pem
          chmod 400 ~/.ssh/deploy.pem

      - name: Trocar o container
        run: |
          ssh -o StrictHostKeyChecking=no -i ~/.ssh/deploy.pem ubuntu@\${{ secrets.EC2_HOST }} "docker pull $IMAGE:\${{ github.sha }} && docker rm -f todo; docker run -d -p 3000:3000 --restart unless-stopped --name todo $IMAGE:\${{ github.sha }}"
${smoke ? `
      - name: Teste de fumaça
        run: curl -f http://\${{ secrets.EC2_HOST }}:3000/todos/pendentes
` : ''}`

/** Workflow da Missão 8: staging automático, produção só com aprovação. */
export const ENV_CI_YML =
  PR_CI_YML.slice(0, PR_CI_YML.indexOf('  deploy:\n')) +
  `  staging:
    name: Deploy em staging
    needs: build
    runs-on: ubuntu-latest
    environment: staging
${DEPLOY_STEPS(true)}
  production:
    name: Deploy em produção
    needs: staging
    runs-on: ubuntu-latest
    environment: production
${DEPLOY_STEPS(true)}`

export const CI_YML = `name: CI

on:
  push:
    branches: [main]

jobs:
  test:
    name: Testes
    runs-on: ubuntu-latest
    steps:
      - name: Baixar o código
        uses: actions/checkout@v4

      - name: Instalar o Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Instalar dependências
        run: npm ci

      - name: Rodar os testes
        run: npm test
`

export const DEPLOY_YML = `
  deploy:
    name: Deploy na EC2
    needs: test
    runs-on: ubuntu-latest
    steps:
      - name: Configurar a chave SSH
        run: |
          mkdir -p ~/.ssh
          echo "\${{ secrets.EC2_SSH_KEY }}" > ~/.ssh/deploy.pem
          chmod 400 ~/.ssh/deploy.pem

      - name: Atualizar e reiniciar a aplicação
        run: |
          ssh -o StrictHostKeyChecking=no -i ~/.ssh/deploy.pem ubuntu@\${{ secrets.EC2_HOST }} "cd todo-api && git pull && npm install && npm stop; nohup npm start &"
`

export const missions: Mission[] = [
  {
    id: 'm1-terminal',
    title: 'Missão 1 · Primeiros passos no terminal',
    short: 'Terminal',
    summary:
      'Todo trabalho de DevOps passa pelo terminal. Servidores na nuvem normalmente não têm interface gráfica: você controla tudo digitando comandos.',
    steps: [
      {
        id: 'pwd',
        title: 'Descubra onde você está',
        body: [
          'O terminal está sempre "dentro" de alguma pasta, chamada de diretório atual.',
          'O comando `pwd` (print working directory) mostra qual é ela.',
        ],
        hint: 'pwd',
        check: ({ event }) => ran(event, 'pwd'),
        success: 'Isso! /home/dev é a sua pasta pessoal, também representada por ~ no prompt.',
      },
      {
        id: 'ls',
        title: 'Veja o que tem aqui',
        body: ['Use `ls` (list) para listar os arquivos e pastas do diretório atual.', 'Pastas aparecem em azul.'],
        hint: 'ls',
        check: ({ event }) => ran(event, 'ls'),
        success: 'Você encontrou um arquivo LEIA-ME.txt e duas pastas.',
      },
      {
        id: 'cat',
        title: 'Leia o arquivo LEIA-ME.txt',
        body: [
          'O comando `cat` mostra o conteúdo de um arquivo.',
          'Dica de produtividade: digite `cat LE` e aperte Tab para o terminal completar o nome.',
        ],
        hint: 'cat LEIA-ME.txt',
        check: ({ event }) => ran(event, 'cat') && event.kind === 'cmd' && event.args.some((a) => a.includes('LEIA-ME')),
        success: 'Esse é o roteiro do curso. Vamos preparar o terreno para o projeto.',
      },
      {
        id: 'mkdir',
        title: 'Crie a pasta "projetos"',
        body: [
          'Organização importa: vamos criar uma pasta para guardar os repositórios.',
          '`mkdir` (make directory) cria um diretório novo.',
        ],
        hint: 'mkdir projetos',
        check: ({ fs }) => fs.isDir(`${HOME}/projetos`),
        success: 'Pasta criada. Abra o Finder no Dock e veja que ela apareceu lá também.',
      },
      {
        id: 'cd',
        title: 'Entre na pasta',
        body: [
          '`cd` (change directory) muda o diretório atual.',
          'Repare que o prompt muda para mostrar onde você está. Para voltar um nível, use `cd ..`.',
        ],
        hint: 'cd projetos',
        check: ({ cwd }) => cwd === `${HOME}/projetos`,
        success: 'Agora o prompt mostra ~/projetos.',
      },
      {
        id: 'echo',
        title: 'Crie um arquivo com conteúdo',
        body: [
          '`echo` imprime um texto. Com `>` você redireciona essa saída para um arquivo, criando-o.',
          'Use `>>` para adicionar ao final sem apagar o que já existe.',
        ],
        hint: 'echo "meu primeiro arquivo" > notas.txt',
        check: ({ fs }) => {
          try {
            return fs.read(`${HOME}/projetos/notas.txt`).trim().length > 0
          } catch {
            return false
          }
        },
        success: 'Arquivo criado com conteúdo. Confira com `cat notas.txt`.',
      },
      {
        id: 'lsl',
        title: 'Liste com detalhes',
        body: [
          'Comandos aceitam opções (flags). `ls -l` mostra permissões, dono, tamanho e data.',
          'A primeira coluna (ex: `-rw-r--r--`) são as permissões. Elas serão importantes quando formos configurar o servidor.',
        ],
        hint: 'ls -l',
        check: ({ event }) => ran(event, 'ls') && event.kind === 'cmd' && event.args.some((a) => a.startsWith('-') && a.includes('l')),
        success: 'Missão concluída! Você já sabe navegar e manipular arquivos pelo terminal.',
      },
    ],
  },
  {
    id: 'm2-git',
    title: 'Missão 2 · Git e GitHub',
    short: 'Git e GitHub',
    summary:
      'O código da aplicação mora num repositório no GitHub. Você vai criar sua conta, entrar no time, trazer o código para sua máquina, rodar a aplicação e enviar sua primeira alteração.',
    steps: [
      {
        id: 'gh-open',
        title: 'Abra o GitHub',
        body: ['Abra o Navegador pelo Dock, clique na barra de endereço e digite o endereço abaixo. Depois aperte Enter.'],
        browse: 'github.sim',
        check: ({ event }) => browsed(event, /github\.sim/),
        success: 'Esse é o GitHub, onde o time guarda o código.',
      },
      {
        id: 'gh-signup',
        title: 'Crie sua conta',
        body: [
          'Clique em "Cadastre-se". Escolha um nome de usuário (ele aparece nos seus commits), use um e-mail seu e uma senha com pelo menos 8 caracteres, letras e números.',
          'Escolha também seu avatar. 😉',
        ],
        check: () => !!github.student(),
        success: 'Conta criada! Mas o GitHub ainda precisa confirmar seu e-mail.',
      },
      {
        id: 'gh-verify',
        title: 'Confirme seu e-mail',
        body: ['Abra o app Mail no Dock. O GitHub enviou uma mensagem: clique em "Verificar endereço de e-mail".', 'O link abre numa nova aba do Navegador.'],
        check: () => !!github.student()?.verified,
        success: 'E-mail confirmado. O Senku já foi avisado que você tem conta.',
      },
      {
        id: 'gh-invite',
        title: 'Aceite o convite para o repositório',
        body: [
          'O repositório devlab/todo-api é privado para escrita: só colaboradores podem enviar código.',
          'Em alguns segundos chega o convite do Senku, por e-mail e no sininho 🔔 do GitHub. Abra e clique em "Aceitar convite".',
        ],
        check: () => {
          const u = github.student()
          return !!u && github.isCollaborator(u.login, 'devlab/todo-api')
        },
        success: 'Agora você faz parte do time e pode enviar commits para o repositório.',
      },
      {
        id: 'git-name',
        title: 'Diga ao Git quem você é',
        body: ['Todo commit registra um autor. Configure seu nome uma única vez com `git config --global`.'],
        hint: ({ login }) => `git config --global user.name "${login || 'Seu Nome'}"`,
        check: ({ fs }) => !!readConfig(fs)['user.name'],
        success: 'Nome configurado. Ele fica salvo em ~/.gitconfig.',
      },
      {
        id: 'git-email',
        title: 'Configure seu e-mail',
        body: [
          'Use o mesmo e-mail da sua conta do GitHub: é assim que o GitHub reconhece que os commits são seus e mostra seu avatar neles.',
        ],
        hint: ({ email }) => `git config --global user.email "${email || 'voce@exemplo.com'}"`,
        check: ({ fs }) => !!readConfig(fs)['user.email'],
        success: 'Identidade pronta. Confira com `git config --list`.',
      },
      {
        id: 'clone',
        title: 'Clone o repositório',
        body: [
          '`git clone` baixa o repositório inteiro, com todo o histórico, para a pasta atual.',
          'Vamos fazer isso dentro de ~/projetos. No GitHub, o botão verde "Code" mostra a URL de clone.',
        ],
        hint: 'cd ~/projetos && git clone https://github.sim/devlab/todo-api.git',
        check: ({ fs }) => allRepos(fs).some((r) => r.remoteKey === 'devlab/todo-api'),
        success: 'Repositório clonado! Uma pasta todo-api foi criada.',
      },
      {
        id: 'explore',
        title: 'Entre no projeto e veja os arquivos ocultos',
        body: [
          'Entre na pasta e liste com `ls -a`, que mostra também arquivos que começam com ponto.',
          'A pasta `.git` é onde o Git guarda o histórico. O `.gitignore` lista o que o Git deve ignorar.',
        ],
        hint: 'cd todo-api && ls -a',
        check: ({ fs, cwd, event }) => ran(event, 'ls') && event.kind === 'cmd' && event.args.some((a) => a.startsWith('-') && a.includes('a')) && findRepo(fs, cwd)?.root === cwd,
        success: 'Viu a pasta .git? Sem ela, seria só uma pasta comum.',
      },
      {
        id: 'log',
        title: 'Veja o histórico de commits',
        body: ['Cada commit é uma "foto" do projeto, com autor, data e mensagem.', '`git log --oneline` mostra um resumo: o código amarelo é o identificador (hash) do commit.'],
        hint: 'git log --oneline',
        check: ({ event }) => ran(event, 'git', 'log'),
        success: 'Quatro commits de três pessoas do time. Em breve o seu aparece aí.',
      },
      {
        id: 'test',
        title: 'Instale as dependências e rode os testes',
        body: [
          '`npm install` baixa as bibliotecas listadas no package.json para a pasta node_modules.',
          '`npm test` roda os testes automatizados. É exatamente o primeiro passo que o pipeline de CI vai executar a cada push.',
          'O `&&` executa o segundo comando só se o primeiro der certo.',
        ],
        hint: 'npm install && npm test',
        check: ({ event }) => ran(event, 'npm', 'test'),
        success: '3 testes aprovados. Repare que node_modules não vai para o Git: está no .gitignore.',
      },
      {
        id: 'start',
        title: 'Suba a aplicação',
        body: ['`npm start` executa o script start do package.json, que liga o servidor na porta 3000 da sua máquina.'],
        hint: 'npm start',
        check: () => !!net.get('local', 3000),
        success: 'Servidor no ar! Teste também pelo terminal: `curl localhost:3000/todos`.',
      },
      {
        id: 'open-local',
        title: 'Abra a aplicação numa nova aba',
        body: ['No Navegador, clique no + ao lado das abas para abrir uma nova aba e digite o endereço abaixo.', '"localhost" é o nome da sua própria máquina.'],
        browse: 'localhost:3000',
        check: ({ event }) => event.kind === 'browse' && event.userTab && /localhost:3000/.test(event.url) && !!net.get('local', 3000),
        success: 'Funcionando na sua máquina. O objetivo do DevOps é que funcione igual no servidor.',
      },
      {
        id: 'edit',
        title: 'Faça uma alteração',
        body: ['Vamos adicionar uma linha ao final do README.md.', 'Lembre: `>>` adiciona ao final. Um `>` apagaria o arquivo inteiro!'],
        hint: ({ login }) => `echo "Mantido também por @${login || 'voce'}" >> README.md`,
        check: ({ fs }) => {
          const r = allRepos(fs).find((x) => x.remoteKey === 'devlab/todo-api')
          if (!r) return false
          const st = repoStatus(fs, r)
          return st.unstaged.length + st.untracked.length + st.staged.length > 0 || aheadBy(r) > 0
        },
        success: 'Arquivo alterado. Vamos ver como o Git enxerga isso.',
      },
      {
        id: 'status',
        title: 'Confira o status',
        body: ['`git status` mostra o que mudou desde o último commit. Arquivos em vermelho ainda não foram preparados.', 'Quer ver a mudança linha por linha? Use `git diff`.'],
        hint: 'git status',
        check: ({ event }) => ran(event, 'git', 'status'),
        success: 'O README.md aparece como modificado.',
      },
      {
        id: 'commit',
        title: 'Prepare e registre o commit',
        body: [
          'Commitar tem duas etapas: `git add` escolhe o que vai no commit (fica verde no status) e `git commit` registra.',
          'O prefixo "docs:" é uma convenção (Conventional Commits) para mudanças em documentação.',
        ],
        hint: 'git add README.md && git commit -m "docs: adiciona mantenedor ao README"',
        check: ({ fs }) => {
          const r = allRepos(fs).find((x) => x.remoteKey === 'devlab/todo-api')
          return !!r && aheadBy(r) > 0
        },
        success: 'Commit criado, mas por enquanto ele só existe na sua máquina.',
      },
      {
        id: 'token',
        title: 'Gere um token de acesso',
        body: [
          'O GitHub não aceita sua senha no terminal: no lugar dela, você usa um *personal access token*.',
          'No GitHub, clique no seu avatar > Configurações > Tokens de acesso > Gerar novo token. Marque o escopo `repo`.',
          'Copie o token na hora: ele só aparece uma vez!',
        ],
        check: () => !!github.student()?.tokens.some((t) => t.scopes.includes('repo')),
        success: 'Token criado. Guarde-o: você vai colar no terminal no próximo passo.',
      },
      {
        id: 'push',
        title: 'Envie para o GitHub',
        body: [
          '`git push` envia seus commits para o repositório remoto. O Git vai pedir:',
          '• Username: seu usuário do GitHub\n• Password: cole o token (Ctrl+V ou ⌘V). Nada aparece enquanto você digita; é normal.',
          'Na Missão 4, é esse push que vai disparar o pipeline automaticamente.',
        ],
        hint: 'git push',
        check: ({ fs }) => {
          const r = allRepos(fs).find((x) => x.remoteKey === 'devlab/todo-api')
          return !!r && aheadBy(r) === 0 && github.get('devlab/todo-api')!.commits.length > 4
        },
        success: 'Missão concluída! Abra o repositório no GitHub e veja seu commit, com seu avatar, no topo.',
      },
    ],
  },
  {
    id: 'm3-aws',
    title: 'Missão 3 · Servidor na AWS',
    short: 'Servidor na AWS',
    summary:
      'Hora de sair da sua máquina. Você vai criar um servidor Linux na nuvem (uma instância EC2), acessá-lo por SSH e colocar a todo-api no ar, acessível pela internet.',
    steps: [
      {
        id: 'aws-mail',
        title: 'Pegue suas credenciais',
        body: ['O Senku criou um usuário IAM para você. Abra o app Mail e leia o e-mail "Seu acesso à AWS do projeto".', 'IAM é o serviço que controla quem pode fazer o quê na conta.'],
        check: ({ event }) => event.kind === 'ui' && event.name.startsWith('mail:') && event.name.includes('AWS'),
        success: 'Anote os dados de acesso (ou deixe o e-mail aberto).',
      },
      {
        id: 'aws-login',
        title: 'Entre no console da AWS',
        body: [
          'Numa nova aba, acesse o console com o ID da conta, usuário e senha temporária.',
          'A AWS vai exigir uma senha nova: mínimo de 8 caracteres, com maiúscula, minúscula, número e símbolo.',
        ],
        browse: 'console.aws.sim',
        check: () => aws.loggedIn,
        success: 'Você está no console. Repare na região no canto superior: São Paulo.',
      },
      {
        id: 'launch',
        title: 'Crie uma instância EC2',
        body: [
          'Procure por EC2 nos serviços e clique em "Executar instâncias". Configure:',
          '• Nome: todo-api-server\n• Imagem: Ubuntu Server 24.04 LTS\n• Tipo: t2.micro (nível gratuito)\n• Par de chaves: crie um novo chamado todo-key. O arquivo .pem vai para seus Downloads\n• Rede: permita tráfego SSH',
        ],
        check: () => aws.instances().some((i) => i.state !== 'terminated'),
        success: 'Instância criada! Ela leva alguns segundos para ligar.',
      },
      {
        id: 'running',
        title: 'Espere a instância ficar pronta',
        body: [
          'Na lista de instâncias, espere o estado mudar para "Executando" e as verificações de status chegarem a "2/2 verificações aprovadas".',
          'Clique na instância e anote o IPv4 público: é o endereço do seu servidor na internet.',
        ],
        check: () => aws.instances().some((i) => i.state === 'running' && i.checks === 'ok'),
        success: 'Servidor ligado e saudável.',
      },
      {
        id: 'chmod',
        title: 'Proteja a chave privada',
        body: [
          'A chave .pem é a "senha" do servidor. O SSH se recusa a usar uma chave que outros usuários da máquina possam ler.',
          '`chmod 400` deixa o arquivo legível só por você (r-- --- ---). Confira com `ls -l ~/Downloads`.',
        ],
        hint: ({ key }) => `chmod 400 ~/Downloads/${key}.pem`,
        check: ({ fs }) =>
          Object.entries(fs.walkFiles(`${fs.home}/Downloads`)).some(([p]) => p.endsWith('.pem') && !((fs.get(`${fs.home}/Downloads/${p}`)?.mode ?? 0o777) & 0o077)),
        success: 'Chave protegida.',
      },
      {
        id: 'ssh',
        title: 'Conecte-se ao servidor',
        body: [
          'Use `ssh` com a chave (-i) e o usuário padrão da imagem Ubuntu, que é "ubuntu".',
          'Na primeira conexão, o SSH pergunta se você confia no servidor. Responda `yes`.',
          'Repare que o prompt muda de cor: os comandos agora rodam no servidor, não na sua máquina.',
        ],
        hint: ({ key, ip }) => `ssh -i ~/Downloads/${key}.pem ubuntu@${ip || '<IP-público>'}`,
        check: ({ event }) => ran(event, 'ssh'),
        success: 'Você está dentro do servidor na nuvem!',
      },
      {
        id: 'apt',
        title: 'Instale o Node.js no servidor',
        body: [
          'O servidor vem "pelado": tente `node -v` e veja que não existe.',
          '`apt` é o instalador de programas do Ubuntu. `apt update` atualiza a lista de pacotes e `apt install` instala. Os dois exigem `sudo` (administrador).',
        ],
        hint: 'sudo apt update && sudo apt install -y nodejs npm',
        check: () => aws.instances().some((i) => i.machine.packages.has('npm')),
        success: 'Node.js e npm instalados no servidor.',
      },
      {
        id: 'deploy',
        title: 'Baixe e prepare a aplicação',
        body: ['O mesmo fluxo da sua máquina: clonar e instalar dependências. O repositório é público para leitura, então o clone não pede senha.'],
        hint: 'git clone https://github.sim/devlab/todo-api.git && cd todo-api && npm install',
        check: () => aws.instances().some((i) => allRepos(i.fs).some((r) => i.fs.isDir(`${r.root}/node_modules`))),
        success: 'Código e dependências no servidor.',
      },
      {
        id: 'nohup',
        title: 'Suba a aplicação em segundo plano',
        body: [
          'Se você rodar só `npm start`, o servidor morre quando você fechar o SSH.',
          '`nohup` faz o processo ignorar o fim da sessão e o `&` no final o coloca em segundo plano. Os logs vão para o arquivo nohup.out.',
        ],
        hint: 'nohup npm start &',
        check: () => aws.instances().some((i) => net.get(i.id, 3000)?.persistent),
        success: 'Aplicação rodando no servidor. Confira com `curl localhost:3000/health`.',
      },
      {
        id: 'browse-ip',
        title: 'Acesse pelo IP público',
        body: ['Abra uma nova aba no Navegador e acesse o endereço abaixo.', 'Spoiler: vai ficar carregando até dar erro. Por quê?'],
        browse: ({ ip }) => `http://${ip || '<IP-público>'}:3000`,
        check: ({ event }) => event.kind === 'browse' && aws.instances().some((i) => event.url.includes(`${i.publicIp}:3000`)),
        success: 'Timeout! A aplicação está rodando, mas o firewall da AWS bloqueia a porta 3000.',
      },
      {
        id: 'sg',
        title: 'Libere a porta 3000 no Security Group',
        body: [
          'O Security Group é o firewall da instância. Hoje ele só libera a porta 22 (SSH).',
          'No console: EC2 > Security Groups > grupo da instância > Editar regras de entrada > Adicionar regra: TCP personalizado, porta 3000, origem 0.0.0.0/0 (qualquer lugar). Salve.',
        ],
        check: () => aws.instances().some((i) => i.state === 'running' && aws.allows(i, 3000, '8.8.8.8')),
        success: 'Porta liberada.',
      },
      {
        id: 'reload',
        title: 'Recarregue a página',
        body: ['Volte na aba do IP público e recarregue (↻).'],
        check: ({ event }) =>
          event.kind === 'browse' && aws.instances().some((i) => event.url.includes(`${i.publicIp}:3000`) && aws.allows(i, 3000, '8.8.8.8') && !!net.get(i.id, 3000)),
        success: 'A todo-api está na internet! Qualquer pessoa com o IP consegue acessar.',
      },
      {
        id: 'exit',
        title: 'Saia do servidor',
        body: ['Digite `exit` para encerrar a sessão SSH e voltar à sua máquina.', 'Depois recarregue a página: graças ao nohup, a aplicação continua no ar.'],
        hint: 'exit',
        check: ({ event }) => ran(event, 'exit') && aws.instances().some((i) => !!net.get(i.id, 3000)?.persistent),
        success: 'Missão concluída! Você fez um deploy manual. Na próxima missão, um pipeline vai fazer tudo isso sozinho a cada git push.',
      },
    ],
  },
  {
    id: 'm4-cicd',
    title: 'Missão 4 · Pipeline de CI/CD',
    short: 'Pipeline de CI/CD',
    summary:
      'Chega de deploy na mão. Você vai escrever um workflow do GitHub Actions que, a cada git push, roda os testes (CI) e, se passarem, atualiza o servidor na AWS sozinho (CD).',
    steps: [
      {
        id: 'ci-mail',
        title: 'Leia o e-mail do Senku',
        body: ['Abra o Mail: o Senku explicou o plano e te deu permissão de administrador no repositório (vai precisar dela para os secrets).'],
        check: ({ event }) => event.kind === 'ui' && event.name.startsWith('mail:') && event.name.includes('pipeline'),
        success: 'Plano entendido: CI primeiro, CD depois.',
      },
      {
        id: 'editor',
        title: 'Abra o projeto no editor de código',
        body: [
          'Editar YAML pelo terminal é sofrido. Na pasta do projeto, `code .` abre a pasta inteira no editor (igual ao VS Code).',
          'No editor, ⌘S / Ctrl+S salva o arquivo. Enquanto não salvar, a aba mostra um ●.',
        ],
        hint: 'cd ~/projetos/todo-api && code .',
        check: () => !!editor.root && allRepos(editor.fs ?? ({} as VFS)).some((r) => r.root === editor.root && r.remoteKey === 'devlab/todo-api'),
        success: 'Projeto aberto. Repare na barra de status embaixo: ela avisa se o YAML tiver erro.',
      },
      {
        id: 'ci-file',
        title: 'Escreva o workflow de CI',
        body: [
          'O GitHub procura workflows em `.github/workflows/`. No Explorer do editor, clique em ＋📄 e digite o caminho `.github/workflows/ci.yml` (as pastas são criadas sozinhas).',
          'Cole o conteúdo abaixo e salve. Lendo de cima para baixo:\n• `on: push`: roda a cada push na main\n• `jobs.test`: uma máquina Ubuntu nova (runner) que baixa o código, instala o Node, as dependências e roda os testes',
          'Em YAML, a indentação (espaços) faz parte da sintaxe. Nada de Tab!',
        ],
        snippet: { file: '.github/workflows/ci.yml', code: CI_YML, mode: 'replace' },
        check: ({ fs }) => {
          const root = repoRoot(fs)
          if (!root) return false
          try {
            const y = load(fs.read(`${root}/.github/workflows/ci.yml`)) as { jobs?: Record<string, { steps?: { run?: string }[] }> }
            return Object.values(y?.jobs ?? {}).some((j) => j.steps?.some((s) => /npm (run )?test/.test(s.run ?? '')))
          } catch {
            return false
          }
        },
        success: 'Workflow salvo. Mas ele só existe na sua máquina: o GitHub ainda não sabe dele.',
      },
      {
        id: 'ci-push',
        title: 'Envie o workflow',
        body: ['O pipeline mora no próprio repositório, junto do código, e é versionado como qualquer arquivo.'],
        hint: 'git add .github && git commit -m "ci: adiciona pipeline de testes" && git push',
        check: () => Object.keys(github.head('devlab/todo-api')?.tree ?? {}).some((p) => p.startsWith('.github/workflows/')),
        success: 'Push feito. O GitHub encontrou o workflow e já começou a executar!',
      },
      {
        id: 'ci-green',
        title: 'Acompanhe a execução',
        body: [
          'No GitHub, abra o repositório e clique na aba ▶ Actions. Clique na execução para ver os jobs e os logs de cada step em tempo real.',
          'Espere ficar verde ✓. A lista de commits também passa a mostrar o ✓ ao lado de cada commit.',
        ],
        browse: 'github.sim/devlab/todo-api/actions',
        check: ({ seen }) => seen.has('gh:actions') && actions.runs('devlab/todo-api').some((r) => r.conclusion === 'success'),
        success: 'Pipeline verde! Todo push agora é testado automaticamente.',
      },
      {
        id: 'break',
        title: 'Quebre um teste de propósito',
        body: [
          'Vamos ver o CI fazendo seu trabalho. No editor, abra `tests/todos.test.js` e, no primeiro teste, troque o `3` por `4`. Salve.',
          'Depois faça commit e push. O `-a` do commit adiciona sozinho os arquivos já rastreados que foram modificados.',
        ],
        hint: 'git commit -am "test: quebra proposital" && git push',
        check: () => actions.runs('devlab/todo-api').some((r) => r.conclusion === 'failure' && !r.error && r.jobs.some((j) => j.conclusion === 'failure')),
        success: 'Vermelho ✕! Abra a execução e leia o log do step "Rodar os testes". Repare também no e-mail que o GitHub mandou.',
      },
      {
        id: 'fix',
        title: 'Corrija e volte ao verde',
        body: ['Volte o `4` para `3`, salve, faça commit e push. Em times de verdade, ninguém mexe em produção enquanto a main está vermelha.'],
        hint: 'git commit -am "test: corrige o teste" && git push',
        check: () => {
          const done = actions.runs('devlab/todo-api').filter((r) => r.status === 'completed')
          return done.length > 0 && done[0].conclusion === 'success' && done.some((r) => r.conclusion === 'failure')
        },
        success: 'Verde de novo. Agora vem a parte do CD: entregar automaticamente.',
      },
      {
        id: 'secrets',
        title: 'Cadastre os secrets do deploy',
        body: [
          'O runner precisa do IP da EC2 e da chave .pem para entrar no servidor. Chave nunca vai para o código: ela fica nos *secrets* do repositório, criptografada.',
          'No GitHub: repositório > ⚙ Configurações > Secrets e variáveis > Actions > Novo repository secret. Crie dois:\n• EC2_HOST: o IPv4 público da instância (veja no console da AWS)\n• EC2_SSH_KEY: o conteúdo inteiro do .pem, de -----BEGIN até -----END',
          'Para copiar a chave, abra-a no editor com o comando abaixo, depois Ctrl+A e Ctrl+C.',
        ],
        hint: ({ key }) => `code ~/Downloads/${key}.pem`,
        check: () => {
          const s = github.get('devlab/todo-api')?.secrets ?? {}
          const host = s.EC2_HOST?.value.trim()
          const key = s.EC2_SSH_KEY?.value ?? ''
          return !!host && aws.instances().some((i) => i.publicIp === host || aws.publicDns(i) === host) && aws.keyPairs().some((k) => key.includes(k.material.slice(0, 64)))
        },
        success: 'Secrets cadastrados. Repare que nem você consegue ver o valor de novo: só atualizar ou remover.',
      },
      {
        id: 'deploy-job',
        title: 'Adicione o job de deploy',
        body: [
          'Cole o job abaixo no final do ci.yml (alinhado com o `test:`, 2 espaços) e salve. O que ele faz:\n• `needs: test`: só roda se os testes passarem\n• grava a chave do secret num arquivo e faz chmod 400 (lembra?)\n• entra na EC2 por ssh e roda: git pull, npm install, reinicia a aplicação',
          '`StrictHostKeyChecking=no` responde o "yes" da primeira conexão, porque o runner não tem teclado.',
        ],
        snippet: { file: '.github/workflows/ci.yml', code: DEPLOY_YML, mode: 'append' },
        hint: 'git commit -am "ci: adiciona deploy na EC2" && git push',
        check: () => actions.runs('devlab/todo-api').some((r) => r.jobs.length >= 2),
        success: 'Pipeline com dois jobs disparado. Vamos ver se o deploy passa.',
      },
      {
        id: 'deploy-ok',
        title: 'Veja o deploy acontecer',
        body: [
          'Na aba Actions, o gráfico mostra test → deploy. Abra o job "Deploy na EC2" e leia os logs: dá para ver o git pull rodando lá no servidor.',
          'Ficou vermelho? Leia o erro. Os mais comuns:\n• timeout na porta 22: o Security Group só libera SSH para o seu IP, mas o runner do GitHub vem de outro IP\n• Permission denied: o secret da chave está incompleto\n• cd: todo-api: o projeto não foi clonado no servidor (Missão 3)',
        ],
        browse: 'github.sim/devlab/todo-api/actions',
        check: () => actions.runs('devlab/todo-api').some((r) => r.conclusion === 'success' && r.jobs.some((j) => j.key !== 'test' && j.conclusion === 'success')),
        success: 'Deploy automático funcionando!',
      },
      {
        id: 'ship',
        title: 'Entregue uma mudança de ponta a ponta',
        body: [
          'A prova final: no editor, abra `src/todos.js` e mude a tarefa 3 para `done: true`. Se quiser, troque o título também. Salve, faça commit e push.',
          'Espere o pipeline ficar verde e abra (ou recarregue) a aplicação pelo IP público. Você não vai precisar tocar no servidor.',
        ],
        hint: 'git commit -am "feat: conclui a tarefa do pipeline" && git push',
        browse: ({ ip }) => `http://${ip || '<IP-público>'}:3000`,
        check: ({ event }) =>
          event.kind === 'browse' &&
          aws.instances().some((i) => {
            if (!event.url.includes(`${i.publicIp}:3000`)) return false
            const svc = net.get(i.id, 3000)
            if (!svc) return false
            try {
              return JSON.stringify(loadTodos(svc.fs, svc.root)) !== ORIGINAL_TODOS
            } catch {
              return false
            }
          }),
        success: '🎉 Trilha concluída! Código → push → testes → deploy → produção, sem tocar no servidor. Isso é CI/CD.',
      },
    ],
  },
  {
    id: 'm5-docker',
    title: 'Missão 5 · Containers com Docker',
    short: 'Docker',
    summary:
      'Sua máquina roda Node 20 e o servidor roda Node 18 (o que veio do apt). Um dia isso quebra. Com Docker, a aplicação viaja junto com tudo de que precisa, numa imagem que roda igual em qualquer lugar.',
    steps: [
      {
        id: 'dk-mail',
        title: 'Leia o e-mail do Senku',
        body: ['Abra o Mail. O Senku encontrou um problema de versão entre a sua máquina e o servidor.'],
        check: ({ event }) => event.kind === 'ui' && event.name.startsWith('mail:') && event.name.includes('Docker'),
        success: 'Confira você mesmo: `node -v` aqui e no servidor dão versões diferentes.',
      },
      {
        id: 'dockerfile',
        title: 'Entenda o Dockerfile',
        body: [
          'O repositório já tem uma receita de imagem. Abra no editor:',
          '• FROM node:20-alpine: começa de uma imagem pronta com Linux Alpine e Node 20\n• WORKDIR /app: a pasta de trabalho dentro da imagem\n• COPY package*.json ./ + RUN npm ci: instala as dependências\n• COPY . .: copia o resto do código\n• EXPOSE 3000 / CMD ["npm", "start"]: a porta e o comando que inicia o container',
          'Copiar o package.json antes do resto do código é de propósito: veremos o motivo no cache.',
        ],
        hint: 'cd ~/projetos/todo-api && code Dockerfile',
        check: () => !!editor.active?.endsWith('/Dockerfile'),
        success: 'Cada instrução vira uma camada da imagem.',
      },
      {
        id: 'build1',
        title: 'Construa a imagem',
        body: [
          '`docker build` lê o Dockerfile e gera uma imagem. `-t todo-api` dá um nome a ela; o `.` no final é o *contexto*: a pasta enviada para o Docker.',
          'Leia a saída com atenção: quanto ocupa o "transferring context"?',
        ],
        hint: 'docker build -t todo-api .',
        check: () => docker.state('local').images.some((i) => i.repo === 'todo-api'),
        success: 'Imagem criada. Mas o contexto tinha ~45 MB, porque a node_modules da sua máquina foi junto. Desnecessário (o npm ci já instala dentro da imagem) e perigoso: o COPY . . sobrescreve as dependências da imagem.',
      },
      {
        id: 'ignore',
        title: 'Crie o .dockerignore e reconstrua',
        body: [
          'O `.dockerignore` funciona como o .gitignore, mas para o contexto do build. Crie o arquivo na raiz do projeto (Explorer > ＋📄), cole o conteúdo, salve e rode o build de novo.',
          'Repare nos passos marcados como CACHED: o Docker reaproveita as camadas que não mudaram.',
        ],
        snippet: { file: '.dockerignore', code: DOCKERIGNORE, mode: 'replace' },
        hint: 'docker build -t todo-api .',
        check: ({ fs }) => {
          const root = repoRoot(fs)
          let ignore = ''
          try {
            ignore = root ? fs.read(`${root}/.dockerignore`) : ''
          } catch {
            return false
          }
          const img = docker.state('local').images.find((i) => i.repo === 'todo-api' && i.tag === 'latest')
          return /node_modules/.test(ignore) && !!img && !Object.keys(img.files).some((f) => f.includes('/node_modules/'))
        },
        success: 'Contexto de poucos kB e camadas em cache. Mude só o código e o npm ci nem roda de novo: é por isso que o package.json é copiado antes.',
      },
      {
        id: 'images',
        title: 'Liste as imagens',
        body: ['`docker images` mostra as imagens da máquina. A versão anterior virou `<none>` (imagem "órfã"), porque o nome todo-api passou para a nova.'],
        hint: 'docker images',
        check: ({ event }) => ran(event, 'docker', 'images'),
        success: 'Repare no tamanho: o Node e o Linux vão dentro da imagem.',
      },
      {
        id: 'run',
        title: 'Rode um container',
        body: [
          'Um container é uma imagem em execução.\n• -d: roda em segundo plano\n• -p 3000:3000: liga a porta 3000 da sua máquina à porta 3000 do container\n• --name todo: um nome fácil de lembrar',
          'Se o `npm start` da Missão 2 ainda estiver rodando, a porta 3000 está ocupada. Por isso o `npm stop` vem antes.',
        ],
        hint: 'npm stop; docker run -d -p 3000:3000 --name todo todo-api',
        check: () => docker.state('local').containers.some((c) => c.status === 'running' && c.ports.some((p) => p.host === 3000)),
        success: 'Container no ar! O número comprido que apareceu é o ID dele.',
      },
      {
        id: 'ps',
        title: 'Inspecione o container',
        body: ['`docker ps` lista os containers rodando (com `-a`, também os parados) e `docker logs` mostra o que a aplicação escreveu na saída.'],
        hint: 'docker ps && docker logs todo',
        check: ({ event }) => ran(event, 'docker', 'logs'),
        success: 'Logs são a primeira coisa a olhar quando um container não sobe.',
      },
      {
        id: 'exec',
        title: 'Entre no container',
        body: [
          '`docker exec -it todo sh` abre um shell *dentro* do container. Rode `node -v` lá dentro e depois `exit`.',
          'A imagem alpine é mínima: nem bash ela tem, só sh.',
        ],
        hint: 'docker exec -it todo sh',
        check: ({ event }) => ran(event, 'node') && event.kind === 'cmd' && /^[0-9a-f]{12}$/.test(event.host),
        success: 'Node 20 dentro do container, não importa o que está instalado fora. Digite exit para sair.',
      },
      {
        id: 'browse-ctr',
        title: 'Abra a aplicação servida pelo container',
        body: ['Numa nova aba, acesse localhost:3000. Repare no rodapé: quem responde agora é o container.'],
        browse: 'localhost:3000',
        check: ({ event }) => event.kind === 'browse' && /localhost:3000/.test(event.url) && !!net.get('local', 3000)?.via,
        success: 'Mesma aplicação, agora isolada num container.',
      },
      {
        id: 'pkg-token',
        title: 'Gere um token para o registry',
        body: [
          'Para levar a imagem ao servidor, vamos publicá-la num *registry*: o GitHub Container Registry (ghcr.sim).',
          'Gere um novo token (avatar > Configurações > Tokens) com o escopo `write:packages`.',
        ],
        check: () => !!github.student()?.tokens.some((t) => t.scopes.includes('write:packages')),
        success: 'Token pronto. Use-o como senha no próximo passo.',
      },
      {
        id: 'login',
        title: 'Faça login no registry',
        body: ['Username: seu usuário do GitHub. Password: cole o token novo (não aparece nada enquanto você digita).'],
        hint: ({ login }) => `docker login ghcr.sim -u ${login || 'seu-usuario'}`,
        check: () => !!docker.state('local').logins['ghcr.sim']?.scopes.includes('write:packages'),
        success: 'Login Succeeded.',
      },
      {
        id: 'push',
        title: 'Publique a imagem',
        body: [
          'O nome da imagem diz para onde ela vai: `ghcr.sim/devlab/todo-api:1.0` = registry/dono/nome:versão.',
          '`docker tag` cria esse nome para a imagem que você já tem e `docker push` envia. Depois veja o pacote na página do repositório no GitHub.',
        ],
        hint: 'docker tag todo-api ghcr.sim/devlab/todo-api:1.0 && docker push ghcr.sim/devlab/todo-api:1.0',
        check: () => !!docker.registry()['devlab/todo-api']?.tags['1.0'],
        success: 'Imagem publicada! Qualquer servidor agora consegue baixá-la.',
      },
      {
        id: 'srv-install',
        title: 'Instale o Docker no servidor',
        body: [
          'Entre no servidor e instale o pacote docker.io. Depois adicione o usuário ubuntu ao grupo docker, para não precisar de sudo em todo comando.',
          'Primeiro conecte com ssh (você já sabe o comando) e depois rode:',
        ],
        hint: 'sudo apt update && sudo apt install -y docker.io && sudo usermod -aG docker ubuntu',
        check: () => aws.instances().some((i) => i.machine.packages.has('docker') && !!i.machine.userGroups?.ubuntu?.includes('docker')),
        success: 'Instalado. Agora tente `docker ps`…',
      },
      {
        id: 'relogin',
        title: 'Entre de novo para o grupo valer',
        body: [
          'Deu "permission denied"? Normal: os grupos são lidos quando você entra. A sessão atual ainda não sabe que você está no grupo docker.',
          'Saia com `exit`, conecte de novo com ssh e rode `docker ps`. Confira com `groups`.',
        ],
        hint: 'docker ps',
        check: ({ event }) => ran(event, 'docker', 'ps') && event.kind === 'cmd' && event.host.startsWith('ip-'),
        success: 'Agora o usuário ubuntu fala com o Docker sem sudo.',
      },
      {
        id: 'srv-run',
        title: 'Rode a imagem no servidor',
        body: [
          'A aplicação antiga (nohup npm start) ainda ocupa a porta 3000: pare-a com npm stop dentro da pasta todo-api. Depois rode o container a partir do registry. O Docker baixa a imagem sozinho.',
          '`--restart unless-stopped` faz o container voltar sozinho se cair ou se o servidor reiniciar.',
        ],
        hint: 'cd ~/todo-api && npm stop; docker run -d -p 3000:3000 --restart unless-stopped --name todo ghcr.sim/devlab/todo-api:1.0',
        check: () => aws.instances().some((i) => docker.state(i.id).containers.some((c) => c.status === 'running' && c.ports.some((p) => p.host === 3000))),
        success: 'Container rodando no servidor, com Node 20, igual à sua máquina.',
      },
      {
        id: 'browse-srv',
        title: 'Confira pelo IP público',
        body: ['Abra (ou recarregue) o IP público na porta 3000. O rodapé deve dizer que quem responde é um container.'],
        browse: ({ ip }) => `http://${ip || '<IP-público>'}:3000`,
        check: ({ event }) => event.kind === 'browse' && aws.instances().some((i) => event.url.includes(`${i.publicIp}:3000`) && !!net.get(i.id, 3000)?.via),
        success:
          'Produção rodando em container! Só tem um detalhe: o pipeline da Missão 4 ainda faz git pull + npm start no servidor, e agora isso vai falhar (a porta é do container). Na próxima missão, o pipeline passa a construir e publicar a imagem sozinho.',
      },
    ],
  },
  {
    id: 'm6-cicd-docker',
    title: 'Missão 6 · CI/CD com Docker',
    short: 'CI/CD com Docker',
    summary:
      'Produção agora roda em container, mas o pipeline ainda faz deploy do jeito antigo. Você vai reescrevê-lo em três jobs: testar, construir e publicar a imagem, e trocar o container no servidor. Cada versão vira uma imagem que dá para reinstalar a qualquer momento.',
    steps: [
      {
        id: 'm6-mail',
        title: 'Leia o e-mail do Senku',
        body: ['Abra o Mail: o Senku notou que o pipeline vai quebrar no próximo deploy.'],
        check: ({ event }) => event.kind === 'ui' && event.name.startsWith('mail:') && event.name.includes('container'),
        success: 'Vamos confirmar o problema antes de consertar: sempre leia o erro primeiro.',
      },
      {
        id: 'see-fail',
        title: 'Veja o deploy antigo falhar',
        body: [
          'No GitHub, abra Actions e a última execução. Clique em "↻ Executar jobs novamente" e espere o job de deploy.',
          'Leia o log do step de deploy: quem está ocupando a porta 3000 no servidor?',
        ],
        browse: 'github.sim/devlab/todo-api/actions',
        check: ({ seen }) =>
          seen.has('gh:actions') &&
          actions.runs('devlab/todo-api').some((r) => r.jobs.some((j) => j.conclusion === 'failure' && j.steps.some((s) => s.log.some((l) => l.includes('EADDRINUSE'))))),
        success: 'EADDRINUSE: o npm start tenta abrir a porta 3000, mas ela é do container. O pipeline precisa falar Docker.',
      },
      {
        id: 'rewrite',
        title: 'Reescreva o workflow',
        body: [
          'Abra `.github/workflows/ci.yml` no editor e substitua todo o conteúdo pelo de abaixo (o botão "Inserir no editor" faz isso). Depois salve. Novidades:',
          '• `env.IMAGE`: uma variável usada em vários lugares\n• job `build`: constrói a imagem e publica no ghcr.sim com duas tags: o hash do commit (`github.sha`, a versão exata) e `latest`\n• `secrets.GITHUB_TOKEN`: um token temporário que o GitHub cria para cada execução, sem precisar cadastrar nada\n• `permissions: packages: write`: sem isso, o GITHUB_TOKEN só lê pacotes e o push é negado\n• job `deploy`: docker pull da versão exata e recriação do container',
        ],
        snippet: { file: '.github/workflows/ci.yml', code: DOCKER_CI_YML, mode: 'replace' },
        check: ({ fs }) => {
          const root = repoRoot(fs)
          if (!root) return false
          try {
            const y = load(fs.read(`${root}/.github/workflows/ci.yml`)) as { jobs?: Record<string, { steps?: { run?: string }[] }> }
            return Object.values(y?.jobs ?? {}).some((j) => j.steps?.some((s) => /docker (build|push)/.test(s.run ?? '')))
          } catch {
            return false
          }
        },
        success: 'Workflow novo salvo. Hora de mandar.',
      },
      {
        id: 'push-docker',
        title: 'Envie e acompanhe os três jobs',
        body: [
          'Faça commit e push e abra a execução no Actions. O gráfico agora tem test → build → deploy.',
          'Abra o job "Build da imagem": o log mostra o docker build (com as mesmas camadas da sua máquina) e o push para o registry. Repare que o token aparece como ***.',
        ],
        hint: 'git commit -am "ci: build e deploy com Docker" && git push',
        check: () =>
          actions.runs('devlab/todo-api').some((r) => r.conclusion === 'success' && r.jobs.length >= 3 && r.jobs.some((j) => j.steps.some((s) => s.log.some((l) => l.includes('docker push') || l.includes('digest: sha256'))))),
        success: 'Pipeline verde com Docker! A imagem desta versão foi publicada e já está rodando no servidor.',
      },
      {
        id: 'pkg-versions',
        title: 'Veja as versões no registry',
        body: [
          'No GitHub, abra a página do repositório e clique no pacote (📦 Packages). Cada push gerou uma tag com o hash do commit.',
          'É por isso que a tag não pode ser só `latest`: com o hash, você sabe exatamente qual código está em produção e consegue voltar para qualquer versão.',
        ],
        browse: 'github.sim/devlab/todo-api',
        check: ({ seen }) => seen.has('gh:package'),
        success: 'Cada versão está guardada no registry.',
      },
      {
        id: 'ship-docker',
        title: 'Entregue uma mudança',
        body: [
          'No editor, mude o título de uma tarefa em `src/todos.js` (por exemplo, a tarefa 2 para "Containerizar a aplicação 🐳"). Salve, faça commit e push.',
          'Quando o pipeline ficar verde, recarregue a aplicação pelo IP público.',
        ],
        hint: 'git commit -am "feat: atualiza tarefas" && git push',
        browse: ({ ip }) => `http://${ip || '<IP-público>'}:3000`,
        check: ({ event }) => {
          if (event.kind !== 'browse') return false
          const head = github.head('devlab/todo-api')?.hash
          return aws.instances().some(
            (i) =>
              event.url.includes(`${i.publicIp}:3000`) &&
              docker.state(i.id).containers.some((c) => c.status === 'running' && !!head && c.imageRef.endsWith(head)) &&
              actions.runs('devlab/todo-api').filter((r) => r.conclusion === 'success' && r.jobs.length >= 3).length >= 2,
          )
        },
        success: 'Mudança no ar, rodando a imagem exata do último commit.',
      },
      {
        id: 'rollback',
        title: 'Faça um rollback',
        body: [
          'Imagine que a última versão tem um bug em produção. Com imagens versionadas, voltar é rápido: rode no servidor a imagem do commit anterior.',
          'Entre no servidor com ssh e rode o comando abaixo (o hash já é o da versão anterior). Depois recarregue a página.',
          'Na vida real, o próximo push com a correção traz tudo para a versão nova de novo.',
        ],
        hint: ({ prevTag }) =>
          `docker rm -f todo; docker run -d -p 3000:3000 --restart unless-stopped --name todo ghcr.sim/devlab/todo-api:${prevTag || '<tag-anterior>'}`,
        check: () => {
          const head = github.head('devlab/todo-api')?.hash
          const tags = Object.keys(docker.registry()['devlab/todo-api']?.tags ?? {}).filter((t) => /^[0-9a-f]{40}$/.test(t))
          return aws.instances().some((i) =>
            docker.state(i.id).containers.some((c) => c.status === 'running' && tags.some((t) => c.imageRef.endsWith(t)) && !!head && !c.imageRef.endsWith(head)),
          )
        },
        success: '🎉 Rollback em segundos. Você tem um pipeline completo: testes, imagem versionada, deploy automático e volta rápida. Isso é CI/CD de verdade.',
      },
    ],
  },
  {
    id: 'm7-pull-requests',
    title: 'Missão 7 · Branches e Pull Requests',
    short: 'Branches e PRs',
    summary:
      'Num time, ninguém mexe direto na main. Você vai proteger o branch principal, criar um branch para uma funcionalidade nova, abrir um pull request, passar pela revisão de código e pelos checks do CI, resolver um conflito com a mudança de uma colega e só então mesclar. O deploy continua automático, mas agora só código revisado chega em produção.',
    steps: [
      {
        id: 'm7-mail',
        title: 'Leia o e-mail do Senku',
        body: ['Abra o Mail: o time vai mudar a forma de trabalhar.'],
        check: ({ event }) => event.kind === 'ui' && event.name.startsWith('mail:') && event.name.includes('pull request'),
        success: 'Regra nova: tudo entra por pull request. Vamos fazer o GitHub garantir isso.',
      },
      {
        id: 'protect',
        title: 'Proteja o branch main',
        body: [
          'No GitHub, abra Configurações › Branches e adicione uma regra para `main` com estas opções:',
          '• Exigir pull request antes do merge, com 1 aprovação\n• Exigir que os checks de status passem\n\nIsso é proteção de branch: nem quem é administrador consegue mandar commits direto para a main.',
        ],
        browse: 'github.sim/devlab/todo-api/settings/branches',
        check: () => {
          const p = github.protection(TEAM_REPO, 'main')
          return !!p && p.requirePr && p.approvals >= 1 && p.requireChecks
        },
        success: 'A main está protegida. Agora todo código passa por revisão e por testes.',
      },
      {
        id: 'pr-workflow',
        title: 'Rode o CI também nos pull requests',
        body: [
          'Hoje o workflow só roda em push na main. Para a revisão mostrar se os testes passam, ele precisa rodar em cada pull request também.',
          'Abra `.github/workflows/ci.yml` e insira a versão abaixo. Mudou pouco:\n• gatilho novo `pull_request` para a main\n• no job `build`, `if: github.event_name == \'push\'`: no PR só testamos; imagem e deploy só depois do merge (o `deploy` depende do build, então também fica de fora)',
          'Salve e faça commit (ainda sem push).',
        ],
        snippet: { file: '.github/workflows/ci.yml', code: PR_CI_YML, mode: 'replace' },
        hint: 'git commit -am "ci: testes em pull requests"',
        check: ({ fs }) => {
          const root = repoRoot(fs)
          const r = root ? findRepo(fs, root) : null
          const yml = r?.commits[r.commits.length - 1]?.tree['.github/workflows/ci.yml'] ?? ''
          try {
            const y = load(yml) as { on?: Record<string, unknown>; jobs?: Record<string, { if?: string }> }
            return !!y?.on && typeof y.on === 'object' && 'pull_request' in y.on && /event_name\s*==\s*'push'/.test(y.jobs?.build?.if ?? '')
          } catch {
            return false
          }
        },
        success: 'Commit feito. Agora tente enviar como sempre.',
      },
      {
        id: 'direct-push',
        title: 'Tente o push direto na main',
        body: ['Rode `git push`. Com a proteção ligada, o GitHub vai recusar. Leia a mensagem com calma: ela diz exatamente o que fazer.'],
        hint: 'git push',
        check: ({ fs, cwd, event }) => {
          if (event.kind !== 'cmd' || event.name !== 'git' || event.args[0] !== 'push' || event.code === 0) return false
          const r = findRepo(fs, cwd)
          return !!r && r.branch === 'main' && !!github.protection(TEAM_REPO, 'main')?.requirePr && aheadBy(r) > 0
        },
        success: 'GH006: "Changes must be made through a pull request". Era o esperado.',
      },
      {
        id: 'branch',
        title: 'Crie um branch para a funcionalidade',
        body: [
          'Branch é uma linha paralela de commits. Você trabalha nela à vontade, e a main só recebe o resultado depois da revisão.',
          'Crie o branch `feat/pendentes` a partir de onde você está. O commit do workflow vem junto, porque o branch novo começa no seu último commit.',
          'Confira com `git branch`: o asterisco marca o branch atual.',
        ],
        hint: 'git switch -c feat/pendentes',
        check: ({ fs }) => {
          const root = repoRoot(fs)
          const r = root ? findRepo(fs, root) : null
          return !!r && r.branch !== 'main'
        },
        success: 'Você está num branch próprio. Pode mexer sem medo.',
      },
      {
        id: 'feature',
        title: 'Escreva a funcionalidade',
        body: [
          'O time quer saber quantas tarefas faltam. Abra `src/todos.js` no editor e adicione a função `pendingCount` no fim do arquivo (o botão "Inserir no editor" acrescenta o trecho). Salve.',
        ],
        snippet: { file: 'src/todos.js', code: FEATURE_TODOS, mode: 'append' },
        check: ({ fs }) => {
          const root = repoRoot(fs)
          try {
            return !!root && /pendingCount/.test(fs.read(`${root}/src/todos.js`))
          } catch {
            return false
          }
        },
        success: 'Função criada.',
      },
      {
        id: 'feat-test',
        title: 'Teste a funcionalidade',
        body: ['Código novo vem com teste. Acrescente o teste abaixo em `tests/todos.test.js`, salve e rode `npm test` no terminal.'],
        snippet: { file: 'tests/todos.test.js', code: FEATURE_TEST, mode: 'append' },
        hint: 'npm test',
        check: ({ fs, event }) => {
          const root = repoRoot(fs)
          if (!root || !ran(event, 'npm', 'test')) return false
          try {
            return /pendingCount/.test(fs.read(`${root}/tests/todos.test.js`))
          } catch {
            return false
          }
        },
        success: 'Testes verdes, inclusive o novo.',
      },
      {
        id: 'route',
        title: 'Exponha o endpoint',
        body: ['Por fim, a rota HTTP: acrescente o trecho abaixo no fim de `src/server.js` e salve. Ela responde em `/todos/pendentes`.'],
        snippet: { file: 'src/server.js', code: FEATURE_ROUTE, mode: 'append' },
        check: ({ fs }) => {
          const root = repoRoot(fs)
          try {
            return !!root && /\/todos\/pendentes/.test(fs.read(`${root}/src/server.js`))
          } catch {
            return false
          }
        },
        success: 'Funcionalidade pronta. Hora de publicar o branch.',
      },
      {
        id: 'push-branch',
        title: 'Publique o branch',
        body: [
          'Faça commit de tudo e tente `git push`. O git responde que o branch não tem *upstream*: ele ainda não sabe para qual branch do GitHub enviar.',
          '`git push -u origin feat/pendentes` cria o branch no GitHub e liga os dois (`-u` = upstream). Depois disso, `git push` e `git pull` sozinhos já funcionam neste branch.',
        ],
        hint: 'git add . && git commit -m "feat: contador de tarefas pendentes" && git push -u origin feat/pendentes',
        check: ({ fs }) => {
          const root = repoRoot(fs)
          const r = root ? findRepo(fs, root) : null
          if (!r || r.branch === 'main' || r.upstreams?.[r.branch] !== r.branch) return false
          const t = github.branchHead(TEAM_REPO, r.branch)?.tree ?? {}
          return /pendingCount/.test(t['src/todos.js'] ?? '') && /\/todos\/pendentes/.test(t['src/server.js'] ?? '')
        },
        success: 'Branch no GitHub. Repare no link que o próprio git mostrou para abrir o pull request.',
      },
      {
        id: 'open-pr',
        title: 'Abra o pull request',
        body: [
          'No GitHub, o repositório mostra um aviso amarelo com o seu branch: clique em "Comparar e abrir pull request" (ou vá na aba Pull requests › Novo).',
          'Escreva um título claro e, na descrição, o que mudou e como testar. Revise a aba de arquivos e clique em "Criar pull request".',
        ],
        browse: 'github.sim/devlab/todo-api/pulls',
        check: () => github.pulls(TEAM_REPO).some((p) => p.author === github.student()?.login),
        success: 'PR aberto! O CI já começou a rodar e o Shikamaru foi chamado para revisar.',
      },
      {
        id: 'pr-checks',
        title: 'Acompanhe os checks',
        body: [
          'Na página do PR, veja a caixa de checks: o job Testes roda no código do seu branch. Build e Deploy aparecem como pulados, como você configurou.',
          'Com a proteção, o botão de merge só libera quando os checks passam e alguém aprova.',
        ],
        check: ({ seen }) => {
          if (!seen.has('gh:pull')) return false
          const pr = studentPr()
          if (!pr) return false
          const st = github.pullStatus(TEAM_REPO, pr.number)
          return st.checks.length > 0 && st.checks.every((c) => c.state !== 'pending') && st.checks.some((c) => c.state === 'success')
        },
        success: 'Checks verdes no seu branch, antes de chegar na main. É para isso que serve o CI em pull requests.',
      },
      {
        id: 'review',
        title: 'Atenda à revisão',
        body: [
          'O Shikamaru revisou e pediu uma alteração (veja no PR ou no Mail). Revisão de código não é bronca: é o time garantindo qualidade junto.',
          'Abra o `README.md` e, na seção "Endpoints", adicione logo depois da linha do `/health`:\n`- GET /todos/pendentes — quantidade de tarefas pendentes`',
          'Salve, faça commit e `git push`. O PR atualiza sozinho com o commit novo (e os checks rodam de novo).',
        ],
        hint: 'git commit -am "docs: documenta /todos/pendentes" && git push',
        check: () => {
          const pr = studentPr()
          return !!pr && documents(github.branchHead(TEAM_REPO, pr.head)?.tree['README.md'])
        },
        success: 'README documentado e enviado.',
      },
      {
        id: 'conflict',
        title: 'Traga a main para o seu branch',
        body: [
          'Enquanto você trabalhava, a Bulma mesclou o PR dela, que também mexeu na seção Endpoints do README. O seu PR agora diz que tem conflitos.',
          'Conflito acontece quando duas pessoas mudam as mesmas linhas: o git não adivinha qual versão vale, então você decide. Traga a main atualizada para o seu branch:',
          '`git fetch origin` baixa as novidades sem mexer nos seus arquivos. `git merge origin/main` junta a main no seu branch.',
        ],
        hint: 'git fetch origin && git merge origin/main',
        check: ({ fs }) => {
          const root = repoRoot(fs)
          const r = root ? findRepo(fs, root) : null
          const main = github.branchHead(TEAM_REPO, 'main')
          return !!r && !!main && team.state().bulma === 'merged' && r.branch !== 'main' && (!!r.merging || r.commits.some((c) => c.hash === main.hash))
        },
        success: 'Merge iniciado. Se apareceu CONFLITO, o próximo passo é resolver.',
      },
      {
        id: 'resolve',
        title: 'Resolva o conflito e envie',
        body: [
          'Abra o `README.md`. O git marcou o trecho em conflito:\n`<<<<<<< HEAD` (a sua versão)\n`=======`\n`>>>>>>> origin/main` (a versão da main)',
          'Aqui as duas linhas valem: deixe as duas e apague as três linhas de marcadores. Salve.',
          'Depois marque como resolvido com `git add README.md`, conclua com `git commit` (a mensagem de merge já vem pronta) e `git push`. Se não houve conflito, é só o `git push`.',
        ],
        hint: 'git add README.md && git commit --no-edit && git push',
        check: () => {
          const pr = studentPr()
          if (!pr) return false
          const st = github.pullStatus(TEAM_REPO, pr.number)
          const readme = st.headTip?.tree['README.md'] ?? ''
          return st.upToDate && !st.conflicts.length && !/^(<{7}|={7}|>{7})/m.test(readme) && documents(readme) && /GET \/version/.test(readme)
        },
        success: 'Conflito resolvido: o branch tem a sua mudança e a da Bulma.',
      },
      {
        id: 'merge',
        title: 'Faça o merge do pull request',
        body: [
          'Volte ao PR. Quando aparecer aprovação do Shikamaru e os checks estiverem verdes, o botão "Merge pull request" libera. Clique e confirme.',
          'Depois clique em "Excluir branch": o trabalho já está na main, o branch remoto não serve mais.',
        ],
        check: () => {
          const pr = github.pulls(TEAM_REPO).find((p) => p.author === github.student()?.login && p.state === 'merged')
          return !!pr && !!pr.headDeleted
        },
        success: 'Mesclado! O merge na main é um push, e o push dispara o pipeline completo.',
      },
      {
        id: 'deploy-pr',
        title: 'Veja o deploy da main',
        body: [
          'Abra o Actions: o merge gerou um run com evento push na main, agora com test → build → deploy.',
          'Quando ficar verde, abra `http://<IP-público>:3000/todos/pendentes` no navegador.',
        ],
        browse: ({ ip }) => `http://${ip || '<IP-público>'}:3000/todos/pendentes`,
        check: ({ event }) => {
          if (event.kind !== 'browse' || !event.url.includes(':3000/todos/pendentes')) return false
          const pr = github.pulls(TEAM_REPO).find((p) => p.author === github.student()?.login && p.state === 'merged')
          return !!pr && actions.runs(TEAM_REPO).some((r) => r.event === 'push' && r.conclusion === 'success' && r.jobs.length >= 3 && r.created >= (pr.mergedAt ?? 0))
        },
        success: 'A funcionalidade revisada está em produção.',
      },
      {
        id: 'cleanup',
        title: 'Arrume a casa',
        body: [
          'Na sua máquina, volte para a main, traga o merge e apague o branch local, que já foi mesclado:',
          '`git branch -d` só apaga branches cujo trabalho já está na main. Se não estiver, o git avisa e não deixa (proteção contra perder commits).',
        ],
        hint: 'git switch main && git pull && git branch -d feat/pendentes',
        check: ({ fs }) => {
          const root = repoRoot(fs)
          const r = root ? findRepo(fs, root) : null
          const pr = github.pulls(TEAM_REPO).find((p) => p.author === github.student()?.login && p.state === 'merged')
          return !!r && !!pr && r.branch === 'main' && !r.branches?.[pr.head] && r.commits.some((c) => c.hash === pr.mergeCommit)
        },
        success: '🎉 Fluxo completo de time: branch, pull request, CI no PR, revisão, conflito resolvido, merge e deploy automático. É assim que a maioria das empresas trabalha.',
      },
    ],
  },
  {
    id: 'm8-environments',
    title: 'Missão 8 · Staging e produção',
    short: 'Staging e produção',
    summary:
      'Até agora, todo merge ia direto para produção. Você vai criar um ambiente de staging: cada versão passa primeiro por um servidor de testes, com um teste de fumaça automático, e só chega em produção quando alguém aprova. É o mesmo pipeline, com uma porta de segurança no final.',
    steps: [
      {
        id: 'm8-mail',
        title: 'Leia o e-mail do Senku',
        body: ['Abra o Mail: o Senku criou um servidor novo para você.'],
        check: ({ event }) => event.kind === 'ui' && event.name.startsWith('mail:') && event.name.includes('staging'),
        success: 'Staging é uma cópia da produção, para testar antes de valer.',
      },
      {
        id: 'staging-ssh',
        title: 'Conheça o servidor de staging',
        body: [
          'No console da AWS aparece uma instância nova, `todo-api-staging`. Ela usa a mesma chave da produção e já tem o Docker instalado.',
          'Entre nela por SSH e rode `docker ps`: ainda não tem nenhum container. Depois saia com `exit`.',
        ],
        hint: ({ key, stagingIp }) => `ssh -i ~/Downloads/${key}.pem ubuntu@${stagingIp || '<IP-do-staging>'}`,
        check: ({ event }) => {
          const st = staging()
          return !!st && ran(event, 'docker', 'ps') && event.kind === 'cmd' && event.host === `ip-${st.privateIp.replace(/\./g, '-')}`
        },
        success: 'Servidor limpo e pronto. Agora o GitHub precisa saber que existem dois lugares para fazer deploy.',
      },
      {
        id: 'environments',
        title: 'Crie os environments',
        body: [
          'No GitHub, abra Configurações › Environments e crie dois: `staging` e `production`.',
          'Um environment é um destino de deploy, com secrets e regras próprios. O job que declara `environment: staging` recebe os secrets de staging.',
        ],
        browse: 'github.sim/devlab/todo-api/settings/environments',
        check: () => !!github.environment(TEAM_REPO, 'staging') && !!github.environment(TEAM_REPO, 'production'),
        success: 'Dois environments criados.',
      },
      {
        id: 'env-secrets',
        title: 'Um EC2_HOST para cada environment',
        body: [
          'Abra cada environment e adicione um secret `EC2_HOST`:\n• em `staging`: o IP público do servidor de staging\n• em `production`: o IP público da produção',
          'O mesmo nome, valores diferentes. O workflow usa sempre `secrets.EC2_HOST`, e o GitHub entrega o valor do environment do job. A chave SSH continua no secret do repositório, que vale para todos.',
        ],
        check: () => {
          const st = staging()
          const prod = production()
          return !!st && !!prod && github.environment(TEAM_REPO, 'staging')?.secrets.EC2_HOST?.value.trim() === st.publicIp && github.environment(TEAM_REPO, 'production')?.secrets.EC2_HOST?.value.trim() === prod.publicIp
        },
        success: 'Cada environment aponta para o seu servidor.',
      },
      {
        id: 'reviewers',
        title: 'Exija aprovação para produção',
        body: [
          'Ainda no environment `production`, marque "Revisores obrigatórios" e adicione você. A partir de agora, todo job de produção para e espera alguém da lista aprovar.',
          'Em `staging` não precisa: o deploy lá é automático.',
        ],
        check: () => {
          const me = github.student()?.login
          return !!me && !!github.environment(TEAM_REPO, 'production')?.reviewers.includes(me)
        },
        success: 'Produção protegida por aprovação.',
      },
      {
        id: 'env-workflow',
        title: 'Escreva o novo workflow num branch',
        body: [
          'A main está protegida, então a mudança no pipeline também vai por pull request. Crie um branch a partir da main atualizada.',
          'Depois troque o conteúdo de `.github/workflows/ci.yml` pelo de abaixo e salve. O job `deploy` virou dois:\n• `staging`: faz o deploy no servidor de staging e roda um teste de fumaça (`curl -f`, que falha se a rota não responder)\n• `production`: só começa se o staging passar e tem `environment: production`, então espera aprovação',
        ],
        hint: 'git switch main && git pull && git switch -c ci/staging',
        snippet: { file: '.github/workflows/ci.yml', code: ENV_CI_YML, mode: 'replace' },
        check: ({ fs }) => {
          const root = repoRoot(fs)
          const r = root ? findRepo(fs, root) : null
          if (!r || r.branch === 'main') return false
          try {
            const y = load(fs.read(`${root}/.github/workflows/ci.yml`)) as { jobs?: Record<string, { environment?: unknown }> }
            const envs = Object.values(y?.jobs ?? {}).map((j) => (typeof j.environment === 'string' ? j.environment : (j.environment as { name?: string } | undefined)?.name))
            return envs.includes('staging') && envs.includes('production')
          } catch {
            return false
          }
        },
        success: 'Workflow novo pronto no branch.',
      },
      {
        id: 'env-pr',
        title: 'Abra e mescle o pull request',
        body: [
          'Faça commit, `git push -u origin <seu-branch>` e abra o pull request no GitHub.',
          'Espere os checks e a aprovação do Shikamaru e clique em "Merge pull request".',
        ],
        hint: 'git commit -am "ci: staging e produção com aprovação" && git push -u origin ci/staging',
        check: () =>
          github
            .pulls(TEAM_REPO)
            .some((p) => p.state === 'merged' && p.author === github.student()?.login && /environment:\s*production/.test(p.merged?.to['.github/workflows/ci.yml'] ?? '')),
        success: 'Mesclado. O push na main disparou o pipeline novo.',
      },
      {
        id: 'staging-ok',
        title: 'Confira o staging',
        body: [
          'No Actions, abra a execução: test → build → staging passaram, e "Deploy em produção" está esperando (⏸).',
          'Antes de aprovar, veja com os próprios olhos: abra o staging no navegador.',
        ],
        browse: ({ stagingIp }) => `http://${stagingIp || '<IP-do-staging>'}:3000/todos/pendentes`,
        check: ({ event }) => {
          const st = staging()
          return !!st && event.kind === 'browse' && event.url.includes(`${st.publicIp}:3000`) && waitingProd()
        },
        success: 'Staging no ar com a versão nova. Produção ainda na anterior.',
      },
      {
        id: 'approve',
        title: 'Aprove o deploy em produção',
        body: [
          'Volte à execução no Actions, clique em "Revisar deployments", marque `production`, escreva um comentário e aprove.',
          'O job de produção roda e o servidor de produção recebe exatamente a mesma imagem que você acabou de ver em staging.',
        ],
        check: () => actions.runs(TEAM_REPO).some((r) => r.jobs.some((j) => j.environment === 'production' && j.review?.state === 'approved' && j.conclusion === 'success')),
        success: 'Em produção, com aprovação registrada: quem aprovou, quando e qual commit.',
      },
      {
        id: 'reject',
        title: 'Segure um deploy',
        body: [
          'A porta também serve para dizer "não". Faça outra mudança pequena num branch novo (por exemplo, o título de uma tarefa em `src/todos.js`), abra o PR e mescle quando aprovado.',
          'Quando o staging terminar, imagine que você achou um problema nele. Em "Revisar deployments", rejeite o deploy de produção.',
          'A produção continua na versão anterior, e o histórico mostra quem segurou e por quê.',
        ],
        hint: 'git switch main && git pull && git switch -c feat/titulo',
        check: () => actions.runs(TEAM_REPO).some((r) => r.jobs.some((j) => j.environment === 'production' && j.review?.state === 'rejected')),
        success: '🎉 Pipeline com staging, teste de fumaça e aprovação para produção. Nada chega aos usuários sem passar por um ambiente de teste e por uma pessoa.',
      },
    ],
  },
]
