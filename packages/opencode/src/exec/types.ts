/**
 * Execution abstraction for running commands across different backends
 * (tmux, local exec, ssh, etc.)
 */

export type ExecEvents = {
  /** Called when stdout data is received */
  onStdout?: (chunk: string) => void
  /** Called when stderr data is received */
  onStderr?: (chunk: string) => void
  /** Called when execution is ready/started with backend-specific info */
  onReady?: (info: Record<string, any>) => void
  /** Called when execution completes with exit code */
  onExit?: (code: number) => void
}

export type ExecOptions = {
  /** Command to execute */
  cmd: string
  /** Working directory */
  cwd: string
  /** Timeout in milliseconds */
  timeoutMs?: number
  /** Abort signal for cancellation */
  signal?: AbortSignal
} & ExecEvents

export type ExecResult = {
  /** Combined stdout/stderr output */
  combined: string
  /** Exit code from command */
  exitCode: number
}

/**
 * Command executor interface
 */
export interface CommandExecutor {
  /**
   * Run a command with streaming output
   * @returns Handle with output promise and cancel function
   */
  run(opts: ExecOptions): {
    output: Promise<ExecResult>
    cancel: () => Promise<void>
  }

  /**
   * Optional health check to verify executor is operational
   */
  healthcheck?(): Promise<void>
}
