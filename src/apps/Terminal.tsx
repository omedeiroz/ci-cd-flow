import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { currentShell, localFs, localMachine, onCommand, useOS } from '../store/os'
import { net } from '../engine/node'
import { C, Shell, type Prompt, type Result } from '../engine/shell'

const nl = (s: string) => s.replace(/\r?\n/g, '\r\n')

/** `embedded`: terminal integrado do editor, com sessão própria começando na pasta aberta. */
export function TerminalApp({ embedded }: { embedded?: { cwd: string } } = {}) {
  const host = useRef<HTMLDivElement>(null)
  const stackRef = useRef<Shell[] | null>(null)
  if (embedded && !stackRef.current) {
    const sh = new Shell(localFs, 'dev', 'devops-lab', localMachine)
    sh.cwd = embedded.cwd
    sh.onCommand = onCommand
    stackRef.current = [sh]
  }
  const api = useRef<{ setLine: (t: string) => void; focus: () => void } | null>(null)
  const typeRequest = useOS((s) => s.typeRequest)
  const focused = useOS((s) => s.focused === 'terminal')

  useEffect(() => {
    const term = new XTerm({
      fontFamily: '"JetBrains Mono", Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: '#1e1f23',
        foreground: '#e6e6e6',
        cursor: '#e6e6e6',
        selectionBackground: '#3d5a80',
        black: '#1e1f23',
        blue: '#6cb6ff',
        green: '#5af78e',
        cyan: '#57c7ff',
        red: '#ff6b6b',
        yellow: '#f3f99d',
        magenta: '#ff6ac1',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current!)
    fit.fit()

    const cur = (): Shell => (stackRef.current ? stackRef.current[stackRef.current.length - 1] : currentShell())
    let line = ''
    let cursor = 0
    let histIdx = cur().history.length
    let pending: Prompt | null = null // pergunta interativa em andamento (senha, yes/no...)

    const promptText = () => (pending ? pending.text : cur().prompt())
    const visible = () => (pending?.hidden ? '' : line)
    const plainLen = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').length
    let cursorRow = 0 // linha (relativa ao início do prompt) onde o cursor está; linhas longas quebram
    /** Redesenha prompt + linha, inclusive quando a linha quebra em várias linhas do terminal. */
    const redraw = () => {
      const cols = term.cols
      const p = promptText()
      const text = visible()
      const total = plainLen(p) + text.length
      const at = plainLen(p) + (pending?.hidden ? 0 : cursor)
      let out = (cursorRow > 0 ? `\x1b[${cursorRow}A` : '') + '\r\x1b[J' + p + text
      const endRow = total > 0 && total % cols === 0 ? total / cols - 1 : Math.floor(total / cols)
      const row = at > 0 && at % cols === 0 && at === total ? endRow : Math.floor(at / cols)
      if (endRow > row) out += `\x1b[${endRow - row}A`
      if (!(at === total && total % cols === 0 && total > 0)) out += `\x1b[${(at % cols) + 1}G`
      cursorRow = row
      term.write(out)
    }
    const setLine = (t: string) => {
      line = t
      cursor = t.length
      redraw()
    }
    const reset = () => {
      line = ''
      cursor = 0
      cursorRow = 0
    }

    /** Mostra o resultado de um comando e trata prompts e trocas de sessão. */
    const handle = (r: Result) => {
      if (r.out) term.write(nl(r.out) + (r.out.endsWith('\x1b[H') ? '' : '\r\n'))
      cursorRow = 0
      if (r.session) {
        const stack = stackRef.current
        if (stack) {
          if (r.session === 'pop') {
            if (stack.length > 1) net.killSession(stack.pop()!.sessionId)
          } else {
            r.session.push.onCommand = onCommand
            stack.push(r.session.push)
          }
        } else {
          const { pushSession, popSession } = useOS.getState()
          if (r.session === 'pop') popSession()
          else pushSession(r.session.push)
        }
        histIdx = cur().history.length
      }
      pending = r.prompt ?? null
      reset()
      term.write(promptText())
    }

    if (!embedded) term.writeln(`${C.dim}Último login: ${new Date().toLocaleString('pt-BR')} em ttys001${C.reset}`)
    if (!embedded && useOS.getState().depth > 1) term.writeln(`${C.yellow}Sessão SSH ativa em ${cur().remoteLabel}${C.reset}`)
    if (!embedded) {
      term.writeln(`Digite ${C.cyan}help${C.reset} para ver os comandos disponíveis.`)
      term.writeln('')
    }
    term.write(promptText())

    const disp = term.onData((data) => {
      switch (data) {
        case '\r': {
          cursor = line.length
          redraw() // leva o cursor ao fim da linha antes de quebrar
          term.write('\r\n')
          cursorRow = 0
          if (pending) {
            const p = pending
            pending = null
            handle(p.answer(line))
            return
          }
          const sh = cur()
          handle(sh.execute(line))
          histIdx = cur().history.length
          return
        }
        case '\x7f':
          if (cursor > 0) {
            line = line.slice(0, cursor - 1) + line.slice(cursor)
            cursor--
            redraw()
          }
          return
        case '\x1b[3~':
          line = line.slice(0, cursor) + line.slice(cursor + 1)
          redraw()
          return
        case '\x1b[A': {
          if (pending) return
          const h = cur().history
          if (histIdx > 0) setLine(h[--histIdx])
          return
        }
        case '\x1b[B': {
          if (pending) return
          const h = cur().history
          if (histIdx < h.length - 1) setLine(h[++histIdx])
          else ((histIdx = h.length), setLine(''))
          return
        }
        case '\x1b[D':
          if (cursor > 0 && !pending?.hidden) (cursor--, redraw())
          return
        case '\x1b[C':
          if (cursor < line.length && !pending?.hidden) (cursor++, redraw())
          return
        case '\x1b[H':
        case '\x01':
          cursor = 0
          redraw()
          return
        case '\x1b[F':
        case '\x05':
          cursor = line.length
          redraw()
          return
        case '\t': {
          if (pending) return
          const tail = line.slice(cursor)
          const { line: next, options } = cur().complete(line.slice(0, cursor))
          if (options.length > 1) {
            cursor = line.length
            redraw()
            term.write('\r\n' + options.join('  ') + '\r\n')
            cursorRow = 0
          }
          line = next + tail
          cursor = next.length
          redraw()
          return
        }
        case '\x03':
          cursor = line.length
          redraw()
          term.write('^C\r\n')
          cursorRow = 0
          pending = null
          reset()
          term.write(promptText())
          return
        case '\x15':
          line = line.slice(cursor)
          cursor = 0
          redraw()
          return
        case '\x0c':
          term.clear()
          cursorRow = 0
          redraw()
          return
        case '\x04':
          if (!line && !pending && cur().remoteLabel) {
            term.write('\r\n')
            handle(cur().execute('exit'))
          }
          return
      }
      // texto normal (inclui colar)
      const clean = data.replace(/[\x00-\x1f]/g, (c) => (c === '\n' || c === '\r' ? ' ' : ''))
      const txt = data.length > 1 ? clean.trimEnd() : clean // ao colar, ignora a quebra de linha final
      if (!txt || txt.startsWith('\x1b')) return
      line = line.slice(0, cursor) + txt + line.slice(cursor)
      cursor += txt.length
      redraw()
    })

    api.current = {
      setLine: (t) => {
        if (pending) return
        setLine(t)
      },
      focus: () => term.focus(),
    }
    term.focus()

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* janela minimizada */
      }
    })
    ro.observe(host.current!)

    return () => {
      ro.disconnect()
      disp.dispose()
      term.dispose()
      api.current = null
    }
  }, [])

  useEffect(() => {
    if (typeRequest && api.current && !embedded) {
      api.current.setLine(typeRequest.text)
      api.current.focus()
    }
  }, [typeRequest])

  useEffect(() => {
    if (focused && !embedded) api.current?.focus()
  }, [focused, embedded])

  return <div className="term-host" ref={host} />
}
