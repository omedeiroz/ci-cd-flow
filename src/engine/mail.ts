// Caixa de entrada do aluno. Os sistemas simulados (GitHub, AWS) "enviam" e-mails para cá.
import { github, onGithubMail } from './github'

export type MailBlock = { kind: 'p'; text: string } | { kind: 'code'; text: string } | { kind: 'kv'; rows: [string, string][] } | { kind: 'button'; label: string; url: string }
export type Mail = {
  id: string
  from: string
  fromAddr: string
  avatar?: number // avatar anime, quando quem envia é uma pessoa
  logo?: 'github' | 'aws'
  to: string
  subject: string
  preview: string
  date: number
  read: boolean
  body: MailBlock[]
}

const messages: Mail[] = []
const listeners = new Set<() => void>()
let seq = 1

export const mail = {
  all: () => [...messages].sort((a, b) => b.date - a.date),
  unread: () => messages.filter((m) => !m.read).length,
  get: (id: string) => messages.find((m) => m.id === id),
  send(m: Omit<Mail, 'id' | 'date' | 'read'>) {
    messages.push({ ...m, id: String(seq++), date: Date.now(), read: false })
    listeners.forEach((l) => l())
  },
  markRead(id: string) {
    const m = messages.find((x) => x.id === id)
    if (m && !m.read) {
      m.read = true
      listeners.forEach((l) => l())
    }
  },
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

// boas-vindas do curso
mail.send({
  from: 'Senku Ishigami',
  fromAddr: 'senku@devlab.sim',
  avatar: 1,
  to: 'você',
  subject: 'Bem-vindo(a) ao time DevLab!',
  preview: 'Que bom ter você com a gente. Comece pelo app Guia…',
  body: [
    { kind: 'p', text: 'Oi! Que bom ter você no time.' },
    { kind: 'p', text: 'Eu sou o Senku, tech lead do projeto todo-api. Nas próximas semanas você vai colocar essa API no ar com um pipeline de CI/CD completo.' },
    { kind: 'p', text: 'Comece pelo app Guia. Quando criar sua conta no GitHub, eu te adiciono ao repositório.' },
    { kind: 'p', text: 'Abraços,\nSenku' },
  ],
})

onGithubMail(
  (u, verifyUrl) =>
    mail.send({
      from: 'GitHub',
      fromAddr: 'noreply@github.sim',
      logo: 'github',
      to: u.email,
      subject: '[GitHub] Confirme seu endereço de e-mail',
      preview: `Quase lá, @${u.login}! Confirme seu e-mail para…`,
      body: [
        { kind: 'p', text: `Quase lá, @${u.login}!` },
        { kind: 'p', text: 'Para terminar de criar sua conta, confirme que este endereço de e-mail é seu.' },
        { kind: 'button', label: 'Verificar endereço de e-mail', url: verifyUrl },
        { kind: 'p', text: 'Se você não criou esta conta, ignore este e-mail.' },
      ],
    }),
  (u, inv) => {
    const inviter = github.user(inv.inviter)!
    mail.send({
      from: `${inviter.name} (via GitHub)`,
      fromAddr: 'noreply@github.sim',
      avatar: inviter.avatar,
      to: u.email,
      subject: `@${inviter.login} convidou você para colaborar em ${inv.repo}`,
      preview: `Você foi convidado(a) para ter acesso de escrita ao repositório ${inv.repo}…`,
      body: [
        { kind: 'p', text: `@${inviter.login} convidou você para colaborar no repositório ${inv.repo}.` },
        { kind: 'p', text: 'Como colaborador(a), você poderá enviar commits (git push) para este repositório.' },
        { kind: 'button', label: 'Ver convite', url: `https://github.sim/${inv.repo}/invitations` },
        { kind: 'p', text: 'Este convite expira em 7 dias.' },
      ],
    })
  },
)

// ---------- progresso salvo ----------
export function mailDump() {
  return { messages, seq }
}
export function mailLoad(d: ReturnType<typeof mailDump>) {
  messages.splice(0, messages.length, ...d.messages)
  seq = d.seq
}
