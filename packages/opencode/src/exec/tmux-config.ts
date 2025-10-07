/**
 * Tmux configuration and utilities
 */

export namespace Tmux {
  /**
   * Check if tmux execution is enabled
   */
  export function isEnabled(): boolean {
    return process.env["TMUX_ENABLED"] === "true"
  }

  /**
   * Get tmux socket path
   */
  export function socket(): string {
    return process.env["TMUX_SOCKET"] ?? "/shared/tmux.sock"
  }

  /**
   * Get tmux session name
   */
  export function session(): string {
    return process.env["TMUX_SESSION"] ?? "agent"
  }

  /**
   * Get full tmux config
   */
  export function config() {
    return {
      enabled: isEnabled(),
      socket: socket(),
      session: session(),
    }
  }
}
