// Merge de 3 vias (como o git): junta as mudanças de dois lados a partir de um ancestral comum
// e marca conflito quando os dois mexeram na mesma região do arquivo.
import type { Commit, Tree } from './github'

type Hunk = { s: number; e: number; lines: string[]; side: 'o' | 't' }

/** Regiões do `base` que foram trocadas em `side` (via maior subsequência comum). */
function hunks(base: string[], side: string[], tag: 'o' | 't'): Hunk[] {
  const n = base.length
  const m = side.length
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = base[i] === side[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: Hunk[] = []
  let i = 0
  let j = 0
  let si = 0
  let sj = 0
  const flush = () => {
    if (i > si || j > sj) out.push({ s: si, e: i, lines: side.slice(sj, j), side: tag })
  }
  while (i < n || j < m) {
    if (i < n && j < m && base[i] === side[j]) {
      flush()
      i++
      j++
      si = i
      sj = j
    } else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) j++
    else i++
  }
  flush()
  return out
}

function apply(base: string[], s: number, e: number, hs: Hunk[]) {
  const out: string[] = []
  let p = s
  for (const h of [...hs].sort((a, b) => a.s - b.s)) {
    out.push(...base.slice(p, h.s), ...h.lines)
    p = h.e
  }
  out.push(...base.slice(p, e))
  return out
}

/** Mescla um arquivo. Devolve o texto e se houve conflito (com marcadores <<<<<<< ======= >>>>>>>). */
export function mergeText(base: string, ours: string, theirs: string, labels: { ours: string; theirs: string }): { text: string; conflict: boolean } {
  const B = base.split('\n')
  const all = [...hunks(B, ours.split('\n'), 'o'), ...hunks(B, theirs.split('\n'), 't')].sort((a, b) => a.s - b.s || a.e - b.e)
  const res: string[] = []
  let pos = 0
  let conflict = false
  for (let i = 0; i < all.length; ) {
    let gs = all[i].s
    let ge = all[i].e
    const group = [all[i]]
    let j = i + 1
    while (j < all.length && (all[j].s < ge || (all[j].s === ge && (gs === ge || all[j].s === all[j].e)))) {
      ge = Math.max(ge, all[j].e)
      gs = Math.min(gs, all[j].s)
      group.push(all[j])
      j++
    }
    res.push(...B.slice(pos, gs))
    const os = group.filter((h) => h.side === 'o')
    const ts = group.filter((h) => h.side === 't')
    if (!os.length) res.push(...apply(B, gs, ge, ts))
    else if (!ts.length) res.push(...apply(B, gs, ge, os))
    else {
      const o = apply(B, gs, ge, os)
      const t = apply(B, gs, ge, ts)
      if (o.join('\n') === t.join('\n')) res.push(...o)
      else {
        conflict = true
        res.push(`<<<<<<< ${labels.ours}`, ...o, '=======', ...t, `>>>>>>> ${labels.theirs}`)
      }
    }
    pos = ge
    i = j
  }
  res.push(...B.slice(pos))
  return { text: res.join('\n'), conflict }
}

/** Mescla árvores inteiras. */
export function mergeTrees(base: Tree, ours: Tree, theirs: Tree, labels: { ours: string; theirs: string }): { tree: Tree; conflicts: string[] } {
  const tree: Tree = {}
  const conflicts: string[] = []
  for (const p of new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)])) {
    const b = base[p]
    const o = ours[p]
    const t = theirs[p]
    let r: string | undefined
    if (o === t) r = o
    else if (o === b) r = t
    else if (t === b) r = o
    else if (o === undefined || t === undefined) {
      // modificado de um lado e removido do outro: mantém o modificado e marca conflito
      r = o ?? t
      conflicts.push(p)
    } else {
      const m = mergeText(b ?? '', o, t, labels)
      r = m.text
      if (m.conflict) conflicts.push(p)
    }
    if (r !== undefined) tree[p] = r
  }
  return { tree, conflicts }
}

/** Último commit de `ours` que também está em `theirs` (o ancestral comum). */
export function mergeBase(ours: Commit[], theirs: Commit[]): Commit | null {
  const set = new Set(theirs.map((c) => c.hash))
  for (let i = ours.length - 1; i >= 0; i--) if (set.has(ours[i].hash)) return ours[i]
  return null
}

/** Histórico depois de um merge: o nosso + os commits só deles + o commit de merge. */
export function unionHistory(ours: Commit[], theirs: Commit[]): Commit[] {
  const have = new Set(ours.map((c) => c.hash))
  return [...ours, ...theirs.filter((c) => !have.has(c.hash))]
}
