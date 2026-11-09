import { useState } from 'react'
import { APPS, lockReason, useOS } from '../store/os'
import { AppIcon } from './Icons'
import { mail } from '../engine/mail'

const BASE = 52
const SPACING = BASE + 10

export function Dock() {
  const windows = useOS((s) => s.windows)
  const openApp = useOS((s) => s.openApp)
  const missionIdx = useOS((s) => s.missionIdx)
  useOS((s) => s.version)
  const unread = mail.unread()
  const [mouseX, setMouseX] = useState<number | null>(null)
  const [bounce, setBounce] = useState<string | null>(null)

  return (
    <div className="dock-wrap">
      <div
        className="dock"
        onMouseMove={(e) => setMouseX(e.clientX - e.currentTarget.getBoundingClientRect().left)}
        onMouseLeave={() => setMouseX(null)}
      >
        {APPS.map((app, i) => {
          const center = 12 + i * SPACING + BASE / 2
          const dist = mouseX === null ? Infinity : Math.abs(mouseX - center)
          const scale = 1 + 0.45 * Math.max(0, 1 - dist / 140)
          const running = windows[app.id]?.open
          const locked = lockReason(app, missionIdx)
          return (
            <div key={app.id} className="dock-item" style={{ width: BASE * scale, height: BASE * scale }}>
              <span className="tooltip">
                {app.name}
                {locked && <em> · {locked}</em>}
              </span>
              <button
                className={`dock-icon ${locked ? 'locked' : ''} ${bounce === app.id ? 'bounce' : ''}`}
                aria-label={app.name}
                onClick={() => {
                  if (locked) return
                  if (!running) {
                    setBounce(app.id)
                    setTimeout(() => setBounce(null), 600)
                  }
                  openApp(app.id)
                }}
              >
                <AppIcon id={app.id} />
                {locked && (
                  <span className="lock">
                    <svg viewBox="0 0 12 14" width="10" height="12"><rect x="1" y="6" width="10" height="7" rx="1.5" fill="currentColor" /><path d="M3.5 6V4a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg>
                  </span>
                )}
              </button>
              {app.id === 'mail' && unread > 0 && !locked && <span className="badge">{unread}</span>}
              <span className={`dot ${running ? 'on' : ''}`} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
