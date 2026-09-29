// Public API of the counter feature (the cashier's workspace, step 6.3b, D102): what the app shell
// (middleware, plugins) needs. The counter's pages are rendered by their route files.
export {
  COUNTER_CHANGE_PASSWORD_PATH,
  COUNTER_HOME_PATH,
  COUNTER_SIGN_IN_PATH,
  counterRedirectTarget,
  isCounterPath,
  useCounterSession,
} from './composables/useCounterSession'
