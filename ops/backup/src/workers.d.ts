// The few Workflows types the backup uses (D225), so it needs no Workers type package (like the watchdog, D224).
declare module 'cloudflare:workers' {
  type Duration = `${number} ${'second' | 'seconds' | 'minute' | 'minutes' | 'hour' | 'hours'}`

  interface StepConfig {
    retries?: { limit: number, delay: Duration, backoff?: 'constant' | 'linear' | 'exponential' }
    timeout?: Duration
  }

  export interface WorkflowStep {
    do: <T>(name: string, config: StepConfig, callback: () => Promise<T>) => Promise<T>
  }

  export interface WorkflowEvent<T> {
    payload: Readonly<T> | undefined
    timestamp: Date
    instanceId: string
  }

  export abstract class WorkflowEntrypoint<Env = unknown, T = unknown> {
    protected env: Env
    abstract run(event: WorkflowEvent<T>, step: WorkflowStep): Promise<unknown>
  }
}

declare module 'cloudflare:workflows' {
  /** Thrown in a step: no more retries; the error reaches `run` (D227). */
  export class NonRetryableError extends Error {
    constructor(message: string, name?: string)
  }
}
