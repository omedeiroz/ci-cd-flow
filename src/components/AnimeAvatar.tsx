// Avatares originais em estilo anime, gerados a partir de uma semente (não representam personagens existentes).

const HAIR = ['#f28db2', '#8e7cc3', '#2b3a67', '#24242c', '#c9ced6', '#f39c4a', '#5cc8a8', '#c0392b', '#f1d17a', '#3fa7b5', '#7a4a2e', '#4a6fd1']
const EYES = ['#3b82f6', '#16a34a', '#9333ea', '#dc2626', '#d97706', '#0891b2', '#db2777', '#4b5563']
const BG = ['#fde2e4', '#e2ece9', '#dfe7fd', '#fff1c1', '#e9e0fb', '#d7f3f9', '#ffe5d0', '#e5f5d8']
const SHIRT = ['#334155', '#1e3a8a', '#7c2d12', '#065f46', '#6b21a8', '#be123c', '#0f766e', '#f8fafc']
const SKIN = ['#ffe3d3', '#fbd6c0', '#f2c4a4', '#e0a882']

const pick = <T,>(arr: T[], seed: number, salt: number) => arr[Math.abs(Math.imul(seed + 1, 2654435761) ^ (salt * 40503)) % arr.length]

export const AVATAR_COUNT = 48

/**
 * Sementes escolhíveis pelo jogador, sem repetir combinação de cabelo e penteado:
 * 1000–1047 = traços femininos, 2000–2047 = traços masculinos.
 */
export const FEMININE_AVATARS = Array.from({ length: 48 }, (_, i) => 1000 + ((i * 7) % 48))
export const MASCULINE_AVATARS = Array.from({ length: 48 }, (_, i) => 2000 + ((i * 7) % 48))
export const PLAYER_AVATARS = FEMININE_AVATARS.flatMap((f, i) => [MASCULINE_AVATARS[i], f])

/** Personagens masculinos do enredo (as sementes antigas continuam valendo nos saves). */
const LEGACY: Record<number, number> = {
  1: 2006, // Senku Ishigami
  25: 2039, // Shikamaru Nara
  23: 2016, // Killua Zoldyck
  30: 2022, // Rintarou Okabe
  12: 2027, // Levi Ackerman
}

export function AnimeAvatar({ seed: raw, size = 32 }: { seed: number; size?: number }) {
  const seed = LEGACY[raw] ?? raw
  if (seed >= 2000) return <MasculineAvatar seed={seed} size={size} />
  // sementes >= 1000: combinação explícita (cada uma diferente); abaixo disso, "aleatória" por hash
  const v = seed - 1000
  const explicit = v >= 0
  const hair = explicit ? HAIR[v % HAIR.length] : pick(HAIR, seed, 1)
  const eye = explicit ? EYES[(v * 5 + Math.floor(v / 12)) % EYES.length] : pick(EYES, seed, 2)
  const bg = explicit ? BG[(v * 3 + 1) % BG.length] : pick(BG, seed, 3)
  const shirt = explicit ? SHIRT[(v * 11 + 2) % SHIRT.length] : pick(SHIRT, seed, 4)
  const skin = explicit ? SKIN[(v + Math.floor(v / 4)) % SKIN.length] : pick(SKIN, seed, 5)
  const style = explicit ? Math.floor(v / 12) % 4 : seed % 4 // 0 curto espetado, 1 longo, 2 maria-chiquinha, 3 chanel
  const extra = explicit ? (v * 7) % 3 : Math.floor(seed / 4) % 3 // 0 nada, 1 mecha (ahoge), 2 presilha
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

/** Variação com traços masculinos: cabelo curto, sobrancelhas marcadas, queixo mais anguloso, sem blush. */
function MasculineAvatar({ seed, size }: { seed: number; size: number }) {
  const v = (seed - 2000) % 48
  const hair = HAIR[v % HAIR.length]
  const eye = EYES[(v * 5 + Math.floor(v / 12)) % EYES.length]
  const bg = BG[(v * 3 + 5) % BG.length]
  const shirt = SHIRT[(v * 11 + 5) % SHIRT.length]
  const skin = SKIN[(v + Math.floor(v / 4) + 1) % SKIN.length]
  const style = Math.floor(v / 12) % 4 // 0 espetado, 1 bagunçado, 2 franja de lado, 3 curto arrumado
  const ahoge = v % 5 === 0
  const id = `avm${seed}`
  const fringe = [
    'M17 30 Q15 16 22 12 L18 5 L27 10 L30 2 L35 9 L43 4 L42 12 Q49 16 47 30 L44 24 L41 28 L37 21 L33 27 L29 21 L25 27 L22 23 Z',
    'M17 30 Q15 13 32 11 Q49 13 47 30 L45 22 L42 27 L39 19 L35.5 25 L32 18 L28.5 25 L25 19 L22 26 L19 21 Z',
    'M17 30 Q15 12 33 11 Q49 12 47 30 L46 22 Q40 19 33 23 Q27 26 21 22 Q19 26 17 30 Z',
    'M18 27 Q17 12 32 11 Q47 12 46 27 Q41 18 32 18 Q23 18 18 27 Z',
  ][style]
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className="anime-avatar" aria-hidden>
      <defs>
        <clipPath id={`${id}-c`}>
          <circle cx="32" cy="32" r="32" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-c)`}>
        <rect width="64" height="64" fill={bg} />
        {/* cabelo de trás, curto */}
        <path d="M16 31 Q14 10 32 10 Q50 10 48 31 L46 34 L18 34 Z" fill={hair} />
        {/* corpo */}
        <path d="M10 64 Q12 52 32 52 Q52 52 54 64 Z" fill={shirt} />
        <path d="M26 46 h12 v8 q-6 3 -12 0 z" fill={skin} filter="brightness(.92)" />
        <path d="M26 53 L32 58 L38 53" stroke="#fff" strokeOpacity=".35" strokeWidth="1.4" fill="none" />
        {/* rosto (queixo mais anguloso) */}
        <path d="M18 31 Q18.5 44 32 50 Q45.5 44 46 31 Q46 19 32 19 Q18 19 18 31 Z" fill={skin} />
        <ellipse cx="17.6" cy="35" rx="2" ry="3" fill={skin} />
        <ellipse cx="46.4" cy="35" rx="2" ry="3" fill={skin} />
        {/* olhos e sobrancelhas */}
        {[25.5, 38.5].map((cx) => (
          <g key={cx}>
            <ellipse cx={cx} cy="37" rx="3.7" ry="3.8" fill="#fff" />
            <ellipse cx={cx} cy="37.4" rx="2.9" ry="3.3" fill={eye} />
            <ellipse cx={cx} cy="38" rx="1.5" ry="2" fill="#1b1b24" opacity=".75" />
            <circle cx={cx - 1} cy="35.9" r="1" fill="#fff" />
            <path d={`M${cx - 4.2} 34.6 Q${cx} 32.9 ${cx + 4.2} 34.2`} stroke="#1b1b24" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            <path d={cx < 32 ? `M${cx - 4.6} 30.6 L${cx + 3.8} 29.4` : `M${cx - 3.8} 29.4 L${cx + 4.6} 30.6`} stroke="#2a2230" strokeWidth="2" strokeLinecap="round" />
          </g>
        ))}
        <path d="M32 40 L31.2 42.4 L32.4 42.6" stroke="#000" strokeOpacity=".18" strokeWidth=".9" fill="none" strokeLinecap="round" />
        <path d={v % 3 === 0 ? 'M29.5 45 Q32 46.8 34.5 45' : 'M30 45.2 L34 45.2'} stroke="#7a3b3b" strokeWidth="1.1" fill="none" strokeLinecap="round" />
        {/* franja */}
        <path d={fringe} fill={hair} />
        <path d="M24 15 Q30 12.6 36 14" stroke="#fff" strokeOpacity=".3" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        {ahoge && <path d="M31 11 Q28 2 36 3 Q31 5 33 11" fill={hair} />}
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
