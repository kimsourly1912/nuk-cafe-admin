// Public API of the platform feature (the platform console, step T2a, D142): what the app shell
// (middleware, plugins) needs. The console's pages are rendered by their route files.
export {
  isPlatformPath,
  PLATFORM_CHANGE_PASSWORD,
  PLATFORM_HOME,
  PLATFORM_SIGN_IN,
  platformRedirectTarget,
  usePlatformSession,
} from './composables/usePlatformSession'
