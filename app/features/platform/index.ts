// Public API of the platform feature (the platform console, step T2a, D142): what the app shell
// (middleware, plugins) needs. The console's pages are rendered by their route files.
export {
  isPlatformPath,
  PLATFORM_CHANGE_PASSWORD,
  ACTIVITY_PATH,
  CAFES_PATH,
  HEALTH_PATH,
  PLATFORM_HOME,
  PLATFORM_SIGN_IN,
  PLATFORM_TWO_FACTOR,
  platformRedirectTarget,
  usePlatformSession,
} from './composables/usePlatformSession'
