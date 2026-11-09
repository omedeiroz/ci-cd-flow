import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { persist } from './store/persist'
import { useOS } from './store/os'

// trocar de save ou começar um jogo novo recarrega a página (motor limpo) e continua aqui
const boot = persist.takeBoot()
if (boot?.action === 'continue') {
  if (persist.restore(boot.slot)) useOS.setState({ screen: 'desktop', flash: 'Progresso carregado. Continue de onde parou!' })
} else if (boot?.action === 'new') {
  persist.newGame(boot.slot, boot.profile)
  if (boot.mission > 0) useOS.getState().startMission(boot.mission)
  useOS.setState({ screen: 'desktop' })
  persist.save()
}
persist.start()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
