// As tarefas criadas no app ficam na memória do processo: sobrevivem a recarregar a página
// (vão no save), mas somem quando o servidor reinicia.
import { expect, it } from 'vitest'
import { createStudent } from './harness'
import { prepareMission } from '../src/engine/bootstrap'
import { apiRoute, net, netDump, netLoad } from '../src/engine/node'

it('tarefas na memória do servidor', () => {
  const s = createStudent()
  prepareMission(3, s.fs, s.local)
  s.run('cd ~/projetos/todo-api && npm start &')
  const svc = net.get('local', 3000)!
  expect(net.todos(svc)).toHaveLength(3)

  expect(net.todoAdd(svc, '')).toBe('title é obrigatório') // validação do próprio código
  expect(net.todoAdd(svc, 'Estudar Docker')).toBeNull()
  net.todoToggle(svc, 2)
  expect(net.todos(svc).map((t) => [t.title, t.done])).toContainEqual(['Estudar Docker', false])
  expect(net.todos(svc).find((t) => t.id === 2)!.done).toBe(true)
  expect(apiRoute(svc, '/todos')).toContain('Estudar Docker')

  // "F5": salvar e restaurar mantém
  const dump = JSON.parse(JSON.stringify(netDump(() => 'local')))
  netLoad(dump, () => s.fs)
  const again = net.get('local', 3000)!
  expect(net.todos(again)).toHaveLength(4)
  expect(net.todos(again).find((t) => t.id === 2)!.done).toBe(true)

  // curl fala com as mesmas rotas do src/server.js
  expect(s.run(`curl -X POST http://localhost:3000/todos -H 'Content-Type: application/json' -d '{"title":"Via curl"}'`).all).toContain('"title":"Via curl"')
  expect(s.run('curl -X PATCH http://localhost:3000/todos/5').all).toContain('"done":true')
  expect(s.run(`curl -i -X POST http://localhost:3000/todos -d '{"title":""}'`).all).toContain('HTTP/1.1 500')
  expect(s.run('curl -X DELETE http://localhost:3000/todos/1').all).toContain('Cannot DELETE /todos/1')
  expect(s.run('curl http://localhost:3000/').all).toContain('<title>Tarefas</title>')
  expect(s.run('curl http://localhost:3000/app.js').all).toContain("fetch('/todos')")
  expect(net.todos(again)).toHaveLength(5)

  // reiniciar o processo apaga
  s.run('npm stop')
  s.run('npm start &')
  expect(net.todos(net.get('local', 3000)!)).toHaveLength(3)
})
