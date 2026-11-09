// Renderizador de Markdown mínimo (títulos, listas, código, negrito, links).
import type { ReactNode } from 'react'

function inline(text: string, key: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*|https?:\/\/\S+)/)
  return parts.map((p, i) => {
    const k = `${key}-${i}`
    if (p.startsWith('`')) return <code key={k}>{p.slice(1, -1)}</code>
    if (p.startsWith('**')) return <strong key={k}>{p.slice(2, -2)}</strong>
    if (/^https?:\/\//.test(p)) return <span key={k} className="md-link">{p}</span>
    return <span key={k}>{p}</span>
  })
}

export function Markdown({ source }: { source: string }) {
  const out: ReactNode[] = []
  const lines = source.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++])
      out.push(<pre key={i}>{code.join('\n')}</pre>)
      i++
      continue
    }
    const h = line.match(/^(#{1,3})\s+(.*)/)
    if (h) {
      const Tag = `h${h[1].length}` as 'h1'
      out.push(<Tag key={i}>{inline(h[2], `h${i}`)}</Tag>)
      i++
      continue
    }
    if (/^\s*[-*]\s/.test(line)) {
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        items.push(<li key={i}>{inline(lines[i].replace(/^\s*[-*]\s(\[[ x]\]\s)?/, ''), `li${i}`)}</li>)
        i++
      }
      out.push(<ul key={`ul${i}`}>{items}</ul>)
      continue
    }
    if (line.trim()) {
      const para: string[] = []
      while (i < lines.length && lines[i].trim() && !/^(#|```|\s*[-*]\s)/.test(lines[i])) para.push(lines[i++])
      out.push(<p key={`p${i}`}>{inline(para.join(' '), `p${i}`)}</p>)
      continue
    }
    i++
  }
  return <div className="markdown">{out}</div>
}
