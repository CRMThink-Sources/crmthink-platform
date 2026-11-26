/**
 * Textos fixos da página de instalação em cada idioma. Os padrões em português do
 * tema (título, boas-vindas, termos) ficam em `DEFAULT_THEME` (`install-page.ts`).
 */

export const LANGUAGES = ['pt', 'en', 'es'] as const
export type Language = (typeof LANGUAGES)[number]

/** Idioma de quem não é de portal em português. */
export const FALLBACK_LANGUAGE: Language = 'en'

export const HTML_LANG: Record<Language, string> = {
  pt: 'pt-BR',
  en: 'en',
  es: 'es',
}

/** O Bitrix24 usa `br` para o português; `pt` é aceito por garantia. */
export const PORTUGUESE_CODES = ['br', 'pt']

export const DEFAULT_TEXTS = {
  en: {
    title: 'Installation',
    welcomeText: 'Click Install to finish the installation on your Bitrix24.',
    termsText: 'terms of use',
  },
  es: {
    title: 'Instalación',
    welcomeText:
      'Haz clic en Instalar para completar la instalación en tu Bitrix24.',
    termsText: 'términos de uso',
  },
}

export const UI_TEXTS = {
  pt: {
    install: 'Instalar',
    termsPrefix: 'Ao clicar em Instalar, você aceita os ',
    installing: 'Instalando… isso pode levar alguns segundos.',
    pending: 'A instalação não foi concluída pelo aplicativo.',
    retry: 'Tentar novamente',
    done: 'Instalação concluída!',
    genericError: 'Não foi possível instalar agora. Tente novamente.',
  },
  en: {
    install: 'Install',
    termsPrefix: 'By clicking Install, you accept the ',
    installing: 'Installing… this may take a few seconds.',
    pending: 'The app could not finish the installation.',
    retry: 'Try again',
    done: 'Installation complete!',
    genericError:
      'We could not complete the installation right now. Please try again.',
  },
  es: {
    install: 'Instalar',
    termsPrefix: 'Al hacer clic en Instalar, aceptas los ',
    installing: 'Instalando… esto puede tardar unos segundos.',
    pending: 'La aplicación no pudo completar la instalación.',
    retry: 'Intentar de nuevo',
    done: '¡Instalación completada!',
    genericError:
      'No se pudo completar la instalación ahora. Inténtalo de nuevo.',
  },
} satisfies Record<Language, Record<string, string>>

/**
 * Mensagens por `code` de `POST /v1/install[/retry]`. Em português a página mostra a
 * mensagem da própria API; código fora desta lista vira `genericError`.
 */
export const ERROR_TEXTS: Record<
  Exclude<Language, 'pt'>,
  Record<string, string>
> = {
  en: {
    APP_NOT_FOUND: 'Application not found or inactive.',
    BITRIX_TOKEN_REJECTED:
      'Bitrix24 rejected the access. Reload the page and try again.',
    TOKEN_APP_MISMATCH: 'This access belongs to another application.',
    NOT_PORTAL_ADMIN: 'Only a portal administrator can install the app.',
    MEMBER_ID_MISMATCH:
      'The portal identification does not match. Reload the page and try again.',
    DOMAIN_MISMATCH:
      'The portal domain does not match. Reload the page and try again.',
    BITRIX_UNAVAILABLE: 'Bitrix24 is unavailable right now. Please try again.',
    CRMTHINK_UNAVAILABLE:
      'We could not register the installation right now. Please try again.',
    EVENT_BIND_FAILED:
      'We could not register the installation events on your portal. Please try again.',
    INSTALLATION_MISMATCH: 'No installation was found for this portal.',
    INSTALLATION_NOT_PENDING:
      'This installation cannot be retried. Reload the page.',
  },
  es: {
    APP_NOT_FOUND: 'Aplicación no encontrada o inactiva.',
    BITRIX_TOKEN_REJECTED:
      'Bitrix24 rechazó el acceso. Recarga la página e inténtalo de nuevo.',
    TOKEN_APP_MISMATCH: 'Este acceso pertenece a otra aplicación.',
    NOT_PORTAL_ADMIN:
      'Solo un administrador del portal puede instalar la aplicación.',
    MEMBER_ID_MISMATCH:
      'La identificación del portal no coincide. Recarga la página e inténtalo de nuevo.',
    DOMAIN_MISMATCH:
      'El dominio del portal no coincide. Recarga la página e inténtalo de nuevo.',
    BITRIX_UNAVAILABLE:
      'Bitrix24 no está disponible en este momento. Inténtalo de nuevo.',
    CRMTHINK_UNAVAILABLE:
      'No se pudo registrar la instalación ahora. Inténtalo de nuevo.',
    EVENT_BIND_FAILED:
      'No se pudieron registrar los eventos de instalación en tu portal. Inténtalo de nuevo.',
    INSTALLATION_MISMATCH: 'No se encontró una instalación para este portal.',
    INSTALLATION_NOT_PENDING:
      'Esta instalación no se puede reintentar. Recarga la página.',
  },
}

/** Página de app inexistente ou inativo (sem BX24: só o `LANG` da abertura). */
export const UNAVAILABLE_TEXTS: Record<
  Language,
  { title: string; message: string }
> = {
  pt: {
    title: 'Instalação indisponível',
    message: 'Aplicativo não encontrado ou inativo.',
  },
  en: {
    title: 'Installation unavailable',
    message: 'Application not found or inactive.',
  },
  es: {
    title: 'Instalación no disponible',
    message: 'Aplicación no encontrada o inactiva.',
  },
}
