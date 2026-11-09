# DevOps Lab

Simulador de um computador (visual inspirado no macOS) para aprender DevOps na prática:
terminal Linux, Git/GitHub, servidores AWS e pipelines de CI/CD. Tudo é simulado no navegador.

## Rodar

```bash
npm install
npm run dev
```

## Testes

```bash
npm test          # roda todos os testes uma vez
npm run test:watch
```

Os testes (Vitest, em `tests/`) dirigem o simulador como um aluno faria: digitam comandos, respondem prompts, entram em servidores e acompanham o Guia. Cobrem o shell e as ferramentas, as Missões 1 a 6 de ponta a ponta, os 6 projetos do mundo aberto e o progresso salvo. Os timers do simulador (instância ligando, steps do pipeline, convites) rodam com relógio falso, então a suíte inteira leva poucos segundos.

- `tests/harness.ts`: o "aluno" de teste (`createStudent`), `waitRuns` e `tick`
- `tests/shell.test.ts`: shell, chmod, pipes, `&&`/`||`, node/npm, Node 18 vs 20
- `tests/missions-1-3.test.ts`, `mission4..6.test.ts`: as missões guiadas
- `tests/openworld.test.ts`: os 6 projetos do mundo aberto
- `tests/persistence.test.ts`: salvar, bagunçar e restaurar o estado

O workflow `.github/workflows/ci.yml` roda lint, testes e build a cada push e pull request.

## Progresso salvo

Todo o estado do simulador (arquivos, repositórios, GitHub, e-mails, AWS, containers, execuções do pipeline, editor, missão e janelas) é salvo automaticamente no `localStorage` do navegador (`src/store/persist.ts`) e restaurado ao abrir. Sessões SSH e pipelines em andamento não sobrevivem ao recarregar (os pipelines aparecem como cancelados). O menu ∞ tem "Salvar agora" e "Recomeçar do zero".

## Estrutura

```
src/
  engine/        # lógica pura, sem React
    fs.ts        # sistema de arquivos virtual (uma instância por máquina)
    shell.ts     # interpretador de comandos (pipes, >, >>, &&, ;, variáveis, Tab)
    missions.ts  # missões do tutorial: explicação, dica e verificação automática
  store/os.ts    # estado global (Zustand): janelas, missão atual, singletons do motor
  store/persist.ts # progresso salvo no navegador (snapshot/restore de todos os módulos)
  components/    # MenuBar, Dock, Window, Icons
    git.ts       # git simulado: branches, upstream, fetch/pull/merge, conflitos, push autenticado por token
    merge.ts     # merge de 3 vias (texto e árvores) com marcadores de conflito
    github.ts    # github.sim: contas, convites, tokens, repositórios, branches, pull requests, proteção de branch
    team.ts      # colegas da Missão 7: revisão automática do PR e a mudança da Bulma que gera o conflito
    mail.ts      # caixa de entrada (GitHub e AWS "enviam" e-mails)
    node.ts      # npm/node/curl e serviços de rede por máquina; os testes do projeto rodam de verdade
    aws.ts       # console.aws.sim: IAM, EC2, pares de chaves, security groups, ssh, apt/dnf
    actions.ts   # GitHub Actions: lê .github/workflows/*.yml a cada push e executa jobs num runner simulado
    editor.ts    # estado do editor de código e o comando `code`
    docker.ts    # Docker: build em camadas com cache, containers, portas, exec, registry ghcr.sim
    openworld.ts # mundo aberto: repositórios, pessoas, convites e critérios de cada projeto
    bootstrap.ts # monta o estado das missões anteriores ao pular direto para uma missão
  apps/          # Terminal (xterm.js), Finder, Guia, Mail, Navegador com abas (GitHub, AWS, localhost, IP público)
  components/    # MenuBar, Dock, Window, ícones e avatares anime (SVG originais)
```

## Como adicionar um comando

Em `src/engine/shell.ts`, adicione uma entrada em `commands`:

```ts
meucomando: { help: 'descrição', run: (args, { sh, stdin }) => ok('saída') },
```

## Como adicionar um passo de missão

Em `src/engine/missions.ts`, cada passo tem `check({ fs, cwd, event })`, chamado
após cada comando, navegação, ação de interface ou mudança de estado (`tick`).
Quando retorna `true`, o Guia avança. `hint` e `browse` podem ser funções do
estado (IP da instância, e-mail da conta...).

## Comandos interativos

Um comando pode devolver `prompt` (pergunta com resposta oculta ou não, como a
senha do `git push` ou o "yes/no" do `ssh`) e `session` (entrar/sair de uma
máquina remota).

## Roadmap

- [x] Missão 1: terminal básico
- [x] Missão 2: Git (`clone`, `status`, `add`, `commit`, `push`, `pull`, `log`, `diff`), GitHub simulado, Navegador, `npm install/test/start`, `curl`
- [x] Missão 2 (v0.3): conta no GitHub, verificação por e-mail, convite, token de acesso, abas no navegador
- [x] Missão 3: login IAM, EC2, par de chaves, `chmod 400`, `ssh`, `apt`, `nohup`, Security Group
- [x] Mundo aberto: 6 repositórios de outros times (GitHub Pages, lint, bug real, matrix Node 18/20, cron + workflow_dispatch, infra do zero com porta 80)
- [x] Editor estilo VS Code: barra de atividades, Explorer com status do git, pesquisa, controle de código-fonte, abrir pasta, Ctrl+P, paleta de comandos, terminal integrado
- [x] Missão 6: pipeline com Docker: GITHUB_TOKEN e permissions, imagem com tag do commit, deploy com docker pull, rollback
- [x] Missão 7: branches e pull requests: proteção da main, `git switch -c`, `push -u`, CI em pull requests, revisão de código, conflito com merge de 3 vias, merge e limpeza
- [x] Missão 8: staging e produção: servidor de staging, environments com secrets próprios, teste de fumaça, aprovação obrigatória para produção e deploy rejeitado
- [x] Missão 5: Docker: Dockerfile, .dockerignore, build com cache, run/ps/logs/exec, registry ghcr.sim (login/tag/push), Docker no servidor (grupo docker, --restart)
- [x] Missão 4: editor de código, workflow do GitHub Actions (CI), teste quebrado de propósito, secrets e job de deploy via SSH na EC2 (CD)
