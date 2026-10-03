// Public API of the counter feature (the cashier's workspace, step 6.3b, D102): what the app shell
// (middleware, plugins) needs. The counter's pages are rendered by their route files.
export {
  counterChangePasswordPath,
  counterHomePath,
  counterRedirectTarget,
  counterSignInPath,
  isCounterPath,
  useCounterSession,
} from './composables/useCounterSession'
