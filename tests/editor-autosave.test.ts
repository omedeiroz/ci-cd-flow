// Salvamento automático do editor: salva 1 s depois da última alteração.
import { expect, it } from 'vitest'
import { createStudent, tick } from './harness'
import { editor, editorDump, editorLoad } from '../src/engine/editor'

it('auto save salva depois de parar de digitar', async () => {
  const s = createStudent()
  s.fs.write('/home/dev/notas.txt', 'a')
  editor.openFile(s.fs, '/home/dev/notas.txt')
  editor.setContent('/home/dev/notas.txt', 'ab')
  await tick(1500)
  expect(s.fs.read('/home/dev/notas.txt')).toBe('a') // desligado: nada muda

  editor.setAutoSave(true)
  expect(s.fs.read('/home/dev/notas.txt')).toBe('ab') // ao ligar, salva o pendente
  editor.setContent('/home/dev/notas.txt', 'abc')
  await tick(500)
  editor.setContent('/home/dev/notas.txt', 'abcd')
  await tick(700)
  expect(s.fs.read('/home/dev/notas.txt')).toBe('ab') // ainda digitando
  await tick(400)
  expect(s.fs.read('/home/dev/notas.txt')).toBe('abcd')

  const d = JSON.parse(JSON.stringify(editorDump()))
  expect(d.autoSave).toBe(true)
  editor.setAutoSave(false)
  editorLoad(d, s.fs)
  expect(editor.autoSave).toBe(true)
})
