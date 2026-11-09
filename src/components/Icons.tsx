// Ícones próprios do simulador (não usam assets da Apple).
import type { AppId } from '../store/os'

const Squircle = ({ id, from, to, children }: { id: string; from: string; to: string; children: React.ReactNode }) => (
  <svg viewBox="0 0 100 100" width="100%" height="100%">
    <defs>
      <linearGradient id={`g-${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor={from} />
        <stop offset="1" stopColor={to} />
      </linearGradient>
      <linearGradient id={`s-${id}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity=".35" />
        <stop offset=".5" stopColor="#fff" stopOpacity="0" />
      </linearGradient>
    </defs>
    <path d="M50 4C88 4 96 12 96 50s-8 46-46 46S4 88 4 50 12 4 50 4z" fill={`url(#g-${id})`} />
    <path d="M50 4C88 4 96 12 96 50s-8 46-46 46S4 88 4 50 12 4 50 4z" fill={`url(#s-${id})`} />
    {children}
  </svg>
)

export function AppIcon({ id }: { id: AppId }) {
  switch (id) {
    case 'finder':
      return (
        <Squircle id={id} from="#7cc8ff" to="#1e6fe0">
          <path d="M26 34h18l6 6h24v32H26z" fill="#fff" opacity=".95" />
          <path d="M26 44h48v28H26z" fill="#d8ecff" />
          <path d="M34 54h32M34 62h20" stroke="#4a95ea" strokeWidth="3.5" strokeLinecap="round" />
        </Squircle>
      )
    case 'terminal':
      return (
        <Squircle id={id} from="#4a4f57" to="#14161a">
          <rect x="16" y="20" width="68" height="58" rx="8" fill="#0b0d10" stroke="#3a3f46" strokeWidth="2" />
          <path d="M28 40l10 8-10 8" stroke="#5af78e" strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M44 60h18" stroke="#e6e6e6" strokeWidth="5" strokeLinecap="round" />
        </Squircle>
      )
    case 'guide':
      return (
        <Squircle id={id} from="#ffcf5c" to="#f08a1c">
          <path d="M22 30q14-6 28 2v42q-14-8-28-2z" fill="#fff" />
          <path d="M78 30q-14-6-28 2v42q14-8 28-2z" fill="#fff4dc" />
          <path d="M28 40q8-3 16 1M28 48q8-3 16 1M28 56q8-3 16 1M56 41q8-4 16-1M56 49q8-4 16-1" stroke="#f0a43a" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </Squircle>
      )
    case 'mail':
      return (
        <Squircle id={id} from="#6cc4ff" to="#1673e6">
          <rect x="18" y="28" width="64" height="44" rx="6" fill="#fff" />
          <path d="M20 31l30 22 30-22" stroke="#1673e6" strokeWidth="4" fill="none" strokeLinejoin="round" />
        </Squircle>
      )
    case 'editor':
      return (
        <Squircle id={id} from="#3aa0ff" to="#0b5cc4">
          <path d="M40 32 22 50l18 18" stroke="#fff" strokeWidth="7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M60 32l18 18-18 18" stroke="#bfe0ff" strokeWidth="7" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </Squircle>
      )
    case 'browser':
      return (
        <Squircle id={id} from="#f4f6f9" to="#cfd6e0">
          <circle cx="50" cy="50" r="30" fill="#2f8cff" />
          <ellipse cx="50" cy="50" rx="13" ry="30" fill="none" stroke="#fff" strokeWidth="3" />
          <path d="M20 50h60M24 36h52M24 64h52" stroke="#fff" strokeWidth="3" />
        </Squircle>
      )
    case 'github':
      return (
        <Squircle id={id} from="#3b3f45" to="#1b1d21">
          <circle cx="36" cy="30" r="7" fill="none" stroke="#fff" strokeWidth="5" />
          <circle cx="36" cy="72" r="7" fill="none" stroke="#fff" strokeWidth="5" />
          <circle cx="66" cy="42" r="7" fill="none" stroke="#a371f7" strokeWidth="5" />
          <path d="M36 37v28M66 49q0 12-26 18" stroke="#fff" strokeWidth="5" fill="none" strokeLinecap="round" />
        </Squircle>
      )
    case 'cloud':
      return (
        <Squircle id={id} from="#2b3445" to="#121825">
          <path d="M32 66a14 14 0 0 1 2-28 18 18 0 0 1 34 4 12 12 0 0 1 0 24z" fill="#ff9d2e" />
          <path d="M34 74q16 8 34 0" stroke="#ff9d2e" strokeWidth="4" fill="none" strokeLinecap="round" />
        </Squircle>
      )
  }
}

export const FolderIcon = ({ size = 56 }: { size?: number }) => (
  <svg viewBox="0 0 64 52" width={size} height={size * 0.81}>
    <path d="M2 8a4 4 0 0 1 4-4h18l6 6h28a4 4 0 0 1 4 4v4H2z" fill="#4aa3f0" />
    <rect x="2" y="14" width="60" height="36" rx="4" fill="#6cbaf7" />
    <rect x="2" y="14" width="60" height="3" fill="#8cccfa" />
  </svg>
)

export const FileIcon = ({ size = 48, ext = '' }: { size?: number; ext?: string }) => (
  <svg viewBox="0 0 44 56" width={size * 0.79} height={size}>
    <path d="M2 4a3 3 0 0 1 3-3h24l13 13v38a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3z" fill="#fff" stroke="#cfd3d9" />
    <path d="M29 1v10a3 3 0 0 0 3 3h10" fill="#eceff3" stroke="#cfd3d9" />
    {ext && (
      <text x="22" y="44" textAnchor="middle" fontSize="9" fontWeight="700" fill="#7a828e" fontFamily="system-ui">
        {ext.toUpperCase().slice(0, 4)}
      </text>
    )}
  </svg>
)

export const LogoMark = () => (
  <svg viewBox="0 0 32 16" width="22" height="12">
    <path
      d="M8 3C5.2 3 3 5.2 3 8s2.2 5 5 5c4 0 12-10 16-10 2.8 0 5 2.2 5 5s-2.2 5-5 5C20 13 12 3 8 3z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
    />
  </svg>
)
