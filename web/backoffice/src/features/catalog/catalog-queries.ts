import { api, call } from '@/api/client'

export const catalogQuery = {
  queryKey: ['catalog'],
  queryFn: () => call(api.GET('/admin/catalog/products')),
  staleTime: 60_000,
}
