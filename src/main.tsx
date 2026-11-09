import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { persist } from './store/persist'
import { useOS } from './store/os'

if (persist.restore()) useOS.setState({ flash: 'Progresso restaurado. Continue de onde parou!' })
persist.start()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
