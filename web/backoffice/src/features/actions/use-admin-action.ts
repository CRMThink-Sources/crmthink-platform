import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { toast } from 'sonner'

/**
 * Ação × consultas que ela invalida. Fica num lugar só para ser revisado junto: toda
 * ação de operador grava na auditoria (`['audit']`) e costuma mexer no painel.
 */
const AUDIT: QueryKey = ['audit']
const OVERVIEW: QueryKey = ['overview']

export const INVALIDATES = {
  /** O prefixo cobre detalhe, linha do tempo, tentativas e eventos da instalação. */
  installation: (id: number): QueryKey[] => [
    ['installation', id],
    ['installations'],
    OVERVIEW,
    AUDIT,
  ],
  events: (installationId?: number): QueryKey[] => [
    ['events'],
    ...(installationId
      ? ([['installation', installationId]] as QueryKey[])
      : []),
    OVERVIEW,
    AUDIT,
  ],
  apps: (appCode?: string): QueryKey[] => [
    ['apps'],
    ...(appCode ? ([['app', appCode]] as QueryKey[]) : []),
    AUDIT,
  ],
  sweeps: (): QueryKey[] => [
    OVERVIEW,
    ['installations'],
    ['installation'],
    ['events'],
    ['stripe-events'],
    AUDIT,
  ],
  system: (): QueryKey[] => [AUDIT],
  operators: (): QueryKey[] => [['operators'], AUDIT],
} as const

type Options<TVars, TResult> = {
  /** Chama a API. `reason` já validado (ou `undefined` quando a ação não o pede). */
  run: (vars: TVars, reason: string | undefined) => Promise<TResult>
  invalidates: (result: TResult, vars: TVars) => QueryKey[]
  /** Texto do aviso de sucesso. Nunca inclua segredos aqui. */
  success: (result: TResult, vars: TVars) => string
  /** Erro da API/rede, logo que chega (ex.: levar erros de validação aos campos). */
  onError?: (error: Error) => void
}

/**
 * Padrão de ação do operador: roda a mutação, avisa o resultado e atualiza as telas
 * afetadas. Em erro, devolve `null` e deixa o erro em `error` para o diálogo mostrar,
 * mantendo-o aberto com o que foi digitado.
 *
 * `gcTime: 0`: a resposta de uma ação pode trazer segredo (chave de API, senha
 * provisória); ela não pode ficar guardada no cache de mutações.
 */
export function useAdminAction<TVars, TResult>(
  options: Options<TVars, TResult>,
) {
  const queryClient = useQueryClient()
  const mutation = useMutation<
    TResult,
    Error,
    { vars: TVars; reason: string | undefined }
  >({
    gcTime: 0,
    mutationFn: ({ vars, reason }) => options.run(vars, reason),
    onError: error => options.onError?.(error),
    onSuccess: async (result, { vars }) => {
      toast.success(options.success(result, vars))
      await Promise.all(
        options
          .invalidates(result, vars)
          .map(queryKey => queryClient.invalidateQueries({ queryKey })),
      )
    },
  })

  return {
    /** `{ result }` em sucesso; `null` em erro (veja `error`). */
    async execute(
      vars: TVars,
      reason?: string,
    ): Promise<{ result: TResult } | null> {
      try {
        return { result: await mutation.mutateAsync({ vars, reason }) }
      } catch {
        return null
      }
    },
    pending: mutation.isPending,
    error: mutation.error,
    /** Esquece o erro e o resultado (ao fechar o diálogo). */
    reset: mutation.reset,
  }
}
