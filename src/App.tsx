import { useState } from 'react'
import { MenuBar } from './components/MenuBar'
import { Dock } from './components/Dock'
import { Window } from './components/Window'
import { TerminalApp } from './apps/Terminal'
import { FinderApp } from './apps/Finder'
import { GuideApp } from './apps/Guide'
import { BrowserApp } from './apps/browser/Browser'
import { currentShell, useOS } from './store/os'
import { MailApp } from './apps/Mail'
import { EditorApp } from './apps/Editor'
import { StartScreen } from './components/StartScreen'

export default function App() {
  const screen = useOS((s) => s.screen)
  return screen === 'start' ? <StartScreen /> : <Desktop />
}

function Desktop() {
  const windows = useOS((s) => s.windows)

  // a área de trabalho começa vazia: o aluno abre os apps pelo Dock
  const [welcome, setWelcome] = useState(() => {
    const s = useOS.getState()
    return !Object.values(s.windows).some((w) => w?.open) && s.missionIdx === 0 && s.stepIdx === 0
  })
  const anyOpen = Object.values(windows).some((w) => w?.open)

  const cwd = useOS((s) => s.cwd)
  useOS((s) => s.depth)
  const sh = currentShell()
  const cwdShort = cwd === sh.fs.home ? '~' : cwd.split('/').pop() || '/'

  return (
    <div className="desktop">
      <div className="wallpaper" />
      <MenuBar />
      {windows.finder?.open && (
        <Window id="finder" title="Finder">
          <FinderApp />
        </Window>
      )}
      {windows.terminal?.open && (
        <Window id="terminal" title={`${cwdShort} — ${sh.isContainer ? `docker exec ${sh.remoteLabel}` : sh.remoteLabel ? `ssh ${sh.user}@${sh.remoteLabel}` : `${sh.user}@${sh.host}`} — ${sh.isContainer ? 'sh' : 'bash'}`} dark>
          <TerminalApp />
        </Window>
      )}
      {windows.mail?.open && (
        <Window id="mail" title="Mail">
          <MailApp />
        </Window>
      )}
      {windows.editor?.open && (
        <Window id="editor" title="Editor" dark>
          <EditorApp />
        </Window>
      )}
      {windows.browser?.open && (
        <Window id="browser" title="Navegador">
          <BrowserApp />
        </Window>
      )}
      {windows.guide?.open && (
        <Window id="guide" title="Guia">
          <GuideApp />
        </Window>
      )}
      {welcome && !anyOpen && (
        <div className="notif" role="status">
          <div className="notif-icon">📖</div>
          <div className="notif-body">
            <b>Bem-vindo(a) ao DevOps Lab</b>
            <span>Explore o computador. Os apps ficam no Dock, lá embaixo. Se ficar perdido(a), o Guia explica cada passo.</span>
          </div>
          <button aria-label="Fechar aviso" onClick={() => setWelcome(false)}>×</button>
        </div>
      )}
      <Dock />
    </div>
  )
}
