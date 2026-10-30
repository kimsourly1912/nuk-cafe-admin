import type { ErrorKind } from './classify-error'

export interface ErrorCopy {
  icon: string
  title: string
  /** The page's heading when it differs from the tab title. */
  heading?: string
  description: string
}

export interface ErrorCopyContext {
  /** In a cafe's admin or counter, not the customer site. */
  workspace: boolean
  cafeName: string
  /** The error's own message, for an error without a page of its own. */
  message: string
}

/** The words on each error page (English chrome). */
export function errorCopy(kind: ErrorKind, { workspace, cafeName, message }: ErrorCopyContext): ErrorCopy {
  switch (kind) {
    case 'cafe-not-found':
      return {
        icon: 'i-lucide-store',
        title: 'Cafe not found',
        heading: 'This cafe doesn\'t exist',
        description: 'We couldn\'t find a cafe at this address. Check the link or scan the cafe\'s QR code again.',
      }
    case 'cafe-paused': {
      const who = cafeName || 'This cafe'
      return {
        icon: 'i-app-cafe-paused',
        title: workspace ? 'This cafe is paused' : 'Ordering is paused',
        description: workspace
          ? `${who} is paused by the platform team, so its admin and counter are closed. Ask them to resume it.`
          : `${who} isn't taking orders at the moment. Please try again later.`,
      }
    }
    case 'page-not-found':
      return { icon: 'i-app-coffee-cup-not-found', title: 'Page not found', description: 'The page you\'re looking for doesn\'t exist or may have moved.' }
    case 'page-forbidden':
      return {
        icon: 'i-app-cafe-error',
        title: 'No access to this page',
        description: 'This account doesn\'t have permission to open this page.',
      }
    case 'generic':
      return { icon: 'i-app-cafe-error', title: 'Something went wrong', description: message }
  }
}
