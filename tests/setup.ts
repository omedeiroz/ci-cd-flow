import { vi } from 'vitest'

// O simulador usa timers para coisas "demoradas" (instância ligando, steps do pipeline, convites).
// Com relógio falso, os testes avançam o tempo na hora em vez de esperar de verdade.
vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
