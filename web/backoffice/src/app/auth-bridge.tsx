import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { setAuthEvents } from '@/api/client'

/**
 * Liga as reações globais do cliente HTTP à navegação: 401 limpa o cache e vai ao
 * login guardando o endereço atual em `next`; 403 `PASSWORD_CHANGE_REQUIRED` vai à
 * troca de senha.
 */
export function AuthEventsBridge() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const location = useLocation()
  const current = useRef(location)
  current.current = location

  useEffect(() => {
    setAuthEvents({
      onUnauthorized() {
        const { pathname, search } = current.current
        if (pathname === '/login') return
        queryClient.clear()
        navigate(`/login?next=${encodeURIComponent(pathname + search)}`, {
          replace: true,
        })
      },
      onPasswordChangeRequired() {
        if (current.current.pathname !== '/password')
          navigate('/password', { replace: true })
      },
    })
    return () => setAuthEvents(null)
  }, [navigate, queryClient])

  return null
}
