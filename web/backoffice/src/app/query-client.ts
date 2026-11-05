import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api/client'

/**
 * Cache das leituras. Erro 4xx não tenta de novo (é resposta, não falha de rede);
 * 5xx e rede tentam 2 vezes. Nada de refetch ao focar a janela: o operador pede.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (failures, error) =>
          !(error instanceof ApiError && error.status < 500) && failures < 2,
      },
      mutations: { retry: false },
    },
  })
}
