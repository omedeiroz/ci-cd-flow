import { describe, expect, it } from 'vitest'
import { createStudent } from './harness'

describe('shell', () => {
  it('navega, cria arquivos e redireciona saída', () => {
    const s = createStudent()
    expect(s.run('pwd').all).toBe('/home/dev')
    s.run('mkdir -p a/b && cd a/b && echo "oi" > x.txt && echo "tchau" >> x.txt')
    expect(s.run('cat x.txt').all).toBe('oi\ntchau')
    expect(s.run('cd .. && pwd').all).toBe('/home/dev/a')
    expect(s.run('cd naoexiste').code).not.toBe(0)
  })

  it('pipes, && e ||', () => {
    const s = createStudent()
    expect(s.run('cat LEIA-ME.txt | grep -i terminal | wc').all).toMatch(/^\d+ /)
    expect(s.run('false && echo nao').all).toBe('')
    expect(s.run('false || echo sim').all).toBe('sim')
    expect(s.run('false && echo a || echo b').all).toBe('b')
    expect(s.run('true && echo a || echo b').all).toBe('a')
  })

  it('variáveis e aspas', () => {
    const s = createStudent()
    s.run('NOME=mundo')
    expect(s.run('echo "olá $NOME"').all).toBe('olá mundo')
    expect(s.run("echo 'olá $NOME'").all).toBe('olá $NOME')
    expect(s.run('echo "aberta').code).not.toBe(0)
  })

  it('chmod com modo octal e simbólico', () => {
    const s = createStudent()
    s.run('touch k.pem && chmod 400 k.pem')
    expect(s.run('ls -l k.pem').all).toMatch(/\n-r-------- /)
    s.run('chmod u+w k.pem')
    expect(s.run('ls -l k.pem').all).toMatch(/\n-rw------- /)
    s.run('chmod +x k.pem')
    expect(s.run('ls -l k.pem').all).toMatch(/\n-rwx--x--x /)
    expect(s.run('chmod 9z9 k.pem').code).not.toBe(0)
  })

  it('autocompleta comandos e caminhos', () => {
    const s = createStudent()
    expect(s.local.complete('cat LE').line).toBe('cat LEIA-ME.txt ')
    expect(s.local.complete('cd Doc').line).toBe('cd Documentos/')
  })

  it('comando inexistente devolve 127', () => {
    expect(createStudent().run('blabla').code).toBe(127)
  })
})

describe('node e npm', () => {
  it('executa arquivos JavaScript com fs e process.exit', () => {
    const s = createStudent()
    s.run('mkdir app && cd app')
    s.fs.write('/home/dev/app/package.json', JSON.stringify({ name: 'app', version: '1.0.0', scripts: { check: 'node check.js' } }))
    s.fs.write('/home/dev/app/dados.txt', 'abc')
    s.fs.write('/home/dev/app/check.js', "const fs = require('fs')\nconsole.log('tamanho', fs.readFileSync('dados.txt').length)\nprocess.exit(fs.existsSync('x') ? 0 : 3)")
    const r = s.run('npm run check')
    expect(r.all).toContain('tamanho 3')
    expect(r.code).toBe(3)
  })

  it('simula Node 18 sem os recursos do Node 20', () => {
    const s = createStudent()
    s.fs.writeTree('/home/dev/lib', {
      'package.json': JSON.stringify({ name: 'lib', version: '1.0.0', scripts: { test: 'node --test tests/' } }),
      'src/a.js': 'module.exports = (l) => l.toSorted()',
      'tests/a.test.js': "const t = require('node:test'); const assert = require('node:assert'); const f = require('../src/a'); t('ordena', () => assert.deepStrictEqual(f([2, 1]), [1, 2]))",
    })
    s.run('cd ~/lib')
    expect(s.run('npm test').code).toBe(0)
    s.machine.nodeVersion = 'v18.20.4'
    const r = s.run('npm test')
    expect(r.code).toBe(1)
    expect(r.all).toContain('toSorted is not a function')
    // e o recurso volta a existir depois
    expect(typeof [].toSorted).toBe('function')
  })
})
