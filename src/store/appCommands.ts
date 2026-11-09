// Ações que cada app expõe para a barra de menus (Arquivo, Editar, Visualizar...).
import { useEffect } from 'react'
import type { AppId } from './os'

export type AppCommands = Partial<Record<string, () => void>>
const registry = new Map<AppId, AppCommands>()

/** O app registra suas ações (a versão mais recente vale, a cada renderização). */
export function useAppCommands(id: AppId | null, cmds: AppCommands) {
  useEffect(() => {
    if (id) registry.set(id, cmds)
  })
  useEffect(() => () => void (id && registry.delete(id)), [id])
}
export const appCommand = (id: AppId | null, name: string) => (id ? registry.get(id)?.[name] : undefined)
