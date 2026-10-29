/**
 * Destino do `?next=` depois do login: só caminhos internos do backoffice. Bloqueia
 * `//outro.site` e URLs absolutas (redirecionamento aberto).
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/'
  if (value.startsWith('/login') || value.startsWith('/password')) return '/'
  return value
}
