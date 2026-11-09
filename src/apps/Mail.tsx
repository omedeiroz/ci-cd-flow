import { useState } from 'react'
import { mail, type Mail } from '../engine/mail'
import { useOS } from '../store/os'
import { AnimeAvatar } from '../components/AnimeAvatar'

const when = (ms: number) => {
  const d = new Date(ms)
  return new Date().toDateString() === d.toDateString() ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('pt-BR')
}

function Sender({ m, size }: { m: Mail; size: number }) {
  if (m.avatar !== undefined) return <AnimeAvatar seed={m.avatar} size={size} />
  return (
    <span className={`mail-logo ${m.logo}`} style={{ width: size, height: size, fontSize: size * 0.45 }}>
      {m.logo === 'aws' ? '☁' : '⑂'}
    </span>
  )
}

export function MailApp() {
  useOS((s) => s.version)
  const list = mail.all()
  const [sel, setSel] = useState<string | null>(null)
  const current = sel ? mail.get(sel) : undefined
  const open = (m: Mail) => {
    setSel(m.id)
    mail.markRead(m.id)
    useOS.getState().onEvent({ kind: 'ui', name: `mail:${m.subject}` })
  }

  return (
    <div className="mail">
      <aside>
        <div className="side-title">Favoritos</div>
        <div className="side-item active">
          📥 Entrada {mail.unread() > 0 && <span className="mail-count">{mail.unread()}</span>}
        </div>
        <div className="side-item">📤 Enviados</div>
        <div className="side-item">🗑 Lixeira</div>
      </aside>
      <section className="mail-list">
        <div className="mail-list-head">
          <b>Entrada</b>
          <span>{list.length} mensagens{mail.unread() ? `, ${mail.unread()} não lidas` : ''}</span>
        </div>
        {list.map((m) => (
          <div key={m.id} className={`mail-item ${m.id === sel ? 'sel' : ''} ${m.read ? '' : 'unread'}`} onClick={() => open(m)}>
            <span className="dot" />
            <div className="mail-item-body">
              <div className="mail-row">
                <b>{m.from}</b>
                <span>{when(m.date)}</span>
              </div>
              <div className="mail-subj">{m.subject}</div>
              <div className="mail-prev">{m.preview}</div>
            </div>
          </div>
        ))}
      </section>
      <section className="mail-read">
        {!current ? (
          <div className="mail-empty">Nenhuma mensagem selecionada</div>
        ) : (
          <>
            <div className="mail-head">
              <Sender m={current} size={40} />
              <div>
                <b>{current.from}</b>
                <div className="mail-meta">&lt;{current.fromAddr}&gt; · Para: {current.to}</div>
                <div className="mail-h-subj">{current.subject}</div>
              </div>
              <span className="mail-meta">{new Date(current.date).toLocaleString('pt-BR')}</span>
            </div>
            <div className="mail-body">
              {current.body.map((b, i) =>
                b.kind === 'p' ? (
                  <p key={i}>{b.text}</p>
                ) : b.kind === 'code' ? (
                  <pre key={i}>{b.text}</pre>
                ) : b.kind === 'kv' ? (
                  <table key={i} className="mail-kv">
                    <tbody>
                      {b.rows.map(([k, v]) => (
                        <tr key={k}>
                          <td>{k}</td>
                          <td><code>{v}</code></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <button key={i} className="mail-btn" onClick={() => useOS.getState().openBrowser(b.url, true)}>
                    {b.label}
                  </button>
                ),
              )}
            </div>
          </>
        )}
      </section>
    </div>
  )
}
