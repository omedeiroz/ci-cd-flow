// Avatares originais em estilo anime, gerados a partir de uma semente (não representam personagens existentes).

const HAIR = ['#f28db2', '#8e7cc3', '#2b3a67', '#24242c', '#c9ced6', '#f39c4a', '#5cc8a8', '#c0392b', '#f1d17a', '#3fa7b5', '#7a4a2e', '#4a6fd1']
const EYES = ['#3b82f6', '#16a34a', '#9333ea', '#dc2626', '#d97706', '#0891b2', '#db2777', '#4b5563']
const BG = ['#fde2e4', '#e2ece9', '#dfe7fd', '#fff1c1', '#e9e0fb', '#d7f3f9', '#ffe5d0', '#e5f5d8']
const SHIRT = ['#334155', '#1e3a8a', '#7c2d12', '#065f46', '#6b21a8', '#be123c', '#0f766e', '#f8fafc']
const SKIN = ['#ffe3d3', '#fbd6c0', '#f2c4a4', '#e0a882']

const pick = <T,>(arr: T[], seed: number, salt: number) => arr[Math.abs(Math.imul(seed + 1, 2654435761) ^ (salt * 40503)) % arr.length]

export const AVATAR_COUNT = 48

export function AnimeAvatar({ seed, size = 32 }: { seed: number; size?: number }) {
  const hair = pick(HAIR, seed, 1)
  const eye = pick(EYES, seed, 2)
  const bg = pick(BG, seed, 3)
  const shirt = pick(SHIRT, seed, 4)
  const skin = pick(SKIN, seed, 5)
  const style = seed % 4 // 0 curto espetado, 1 longo, 2 maria-chiquinha, 3 chanel
  const extra = Math.floor(seed / 4) % 3 // 0 nada, 1 mecha (ahoge), 2 presilha
  const id = `av${seed}`
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className="anime-avatar" aria-hidden>
      <defs>
        <clipPath id={`${id}-c`}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-c)`}>
        <rect width="64" height="64" fill={bg} />
        {/* cabelo de trás */}
        {style === 1 && <path d="M14 30 Q13 9 32 9 Q51 9 50 30 L53 64 L11 64 Z" fill={hair} />}
        {style === 2 && (
          <>
            <ellipse cx="11" cy="42" rx="6" ry="14" fill={hair} />
            <ellipse cx="53" cy="42" rx="6" ry="14" fill={hair} />
            <path d="M15 34 Q13 9 32 9 Q51 9 49 34 Z" fill={hair} />
          </>
        )}
        {style === 3 && <path d="M15 34 Q13 9 32 9 Q51 9 49 34 L50 47 Q44 49 40 45 L24 45 Q20 49 14 47 Z" fill={hair} />}
        {style === 0 && <path d="M16 32 Q14 10 32 10 Q50 10 48 32 Z" fill={hair} />}
        {/* corpo */}
        <path d="M12 64 Q14 53 32 53 Q50 53 52 64 Z" fill={shirt} />
        <path d="M27 47 h10 v8 q-5 3 -10 0 z" fill={skin} filter="brightness(.93)" />
        {/* rosto */}
        <path d="M18 32 Q18 49 32 51 Q46 49 46 32 Q46 19 32 19 Q18 19 18 32 Z" fill={skin} />
        {/* olhos */}
        {[25.5, 38.5].map((cx) => (
          <g key={cx}>
            <ellipse cx={cx} cy="36" rx="4.1" ry="4.9" fill="#fff" />
            <ellipse cx={cx} cy="36.6" rx="3.3" ry="4.3" fill={eye} />
            <ellipse cx={cx} cy="37.4" rx="1.7" ry="2.5" fill="#1b1b24" opacity=".75" />
            <circle cx={cx - 1.1} cy="34.6" r="1.25" fill="#fff" />
            <circle cx={cx + 1.3} cy="38.6" r=".6" fill="#fff" />
            <path d={`M${cx - 4.6} 33.4 Q${cx} 29.8 ${cx + 4.6} 33`} stroke="#1b1b24" strokeWidth="1.7" fill="none" strokeLinecap="round" />
          </g>
        ))}
        <ellipse cx="21.5" cy="42" rx="2.6" ry="1.2" fill="#ff8aa1" opacity=".45" />
        <ellipse cx="42.5" cy="42" rx="2.6" ry="1.2" fill="#ff8aa1" opacity=".45" />
        <path d={seed % 3 === 0 ? 'M30 44.5 Q32 47.5 34 44.5 Z' : 'M30.2 44.6 Q32 46 33.8 44.6'} stroke="#8a3b3b" strokeWidth="1" fill={seed % 3 === 0 ? '#c2545f' : 'none'} strokeLinecap="round" />
        {/* franja */}
        {style === 0 ? (
          <path d="M17 31 Q15 16 22 12 L17 5 L27 10 L30 2 L35 9 L43 4 L42 12 Q49 16 47 31 L44 24 L41 30 L37 21 L33 29 L29 21 L25 29 L22 23 Z" fill={hair} />
        ) : (
          <path d="M17 32 Q15 12 32 11 Q49 12 47 32 L44 25 L41 31 L37 22 L33.5 30 L30 22 L26 30 L22.5 23 Z" fill={hair} />
        )}
        <path d="M24 16 Q30 13 36 15" stroke="#fff" strokeOpacity=".35" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        {extra === 1 && <path d="M32 11 Q30 2 37 3 Q32 5 33 11" fill={hair} />}
        {extra === 2 && <rect x="40" y="19" width="6" height="2.6" rx="1.3" fill="#fbbf24" transform="rotate(-25 43 20)" />}
      </g>
    </svg>
  )
}

/** Avatar genérico (autor de commit sem conta no GitHub). */
export const GhostAvatar = ({ size = 32 }: { size?: number }) => (
  <svg viewBox="0 0 64 64" width={size} height={size} className="anime-avatar" aria-hidden>
    <circle cx="32" cy="32" r="32" fill="#d0d7de" />
    <circle cx="32" cy="26" r="11" fill="#f6f8fa" />
    <path d="M12 58 Q14 40 32 40 Q50 40 52 58 Z" fill="#f6f8fa" />
  </svg>
)
