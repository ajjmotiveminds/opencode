/**
 * Command output metadata extracted from PS1 prompts
 * 
 * This system uses a custom PS1 prompt that embeds metadata as JSON,
 * allowing us to reliably detect command completion and capture exit codes.
 */

export namespace CmdOutputMetadata {
  /**
   * Metadata captured from PS1 prompt
   */
  export type Info = {
    exitCode: number
    pid: number
    username?: string
    hostname?: string
    workingDir?: string
    pyInterpreterPath?: string
    prefix?: string  // Prefix to add to command output
    suffix?: string  // Suffix to add to command output
  }

  /** Markers for PS1 prompt metadata */
  export const PS1_BEGIN = "\n###PS1JSON###\n"
  export const PS1_END = "\n###PS1END###"

  /**
   * Generate PS1 prompt string that outputs metadata as JSON
   * 
   * The PS1 is constructed so that bash variables like $?, \u, \h get expanded
   * when the prompt is displayed, not when PS1 is set.
   */
  export function toPs1Prompt(): string {
    // We need to construct the PS1 carefully so bash expands variables correctly
    // Use $(command) for command substitution and \u, \h for user/hostname
    const json = `{
  "pid": "$!",
  "exit_code": "$?",
  "username": "$(whoami)",
  "hostname": "$(hostname)",
  "working_dir": "$(pwd)",
  "py_interpreter_path": "$(which python 2>/dev/null || echo '')"
}`
    return `${PS1_BEGIN}${json}${PS1_END}\n`
  }

  /**
   * Find all PS1 metadata blocks in output
   */
  export function matchesPs1Metadata(content: string): RegExpMatchArray[] {
    // Don't trim the markers - we need the newlines for proper matching
    const normalized = content.replace(/\r/g, "")
    const pattern = new RegExp(
      `${escapeRegex(PS1_BEGIN)}(.*?)${escapeRegex(PS1_END)}`,
      "gms"
    )
    return Array.from(normalized.matchAll(pattern))
  }

  /**
   * Extract metadata from a PS1 match
   */
  export function fromPs1Match(match: RegExpMatchArray): Info {
    try {
      const raw = JSON.parse(match[1])
      return {
        exitCode: parseIntSafe(raw.exit_code, -1),
        pid: parseIntSafe(raw.pid, -1),
        username: raw.username,
        hostname: raw.hostname,
        workingDir: raw.working_dir,
        pyInterpreterPath: raw.py_interpreter_path,
      }
    } catch (e) {
      return {
        exitCode: -1,
        pid: -1,
      }
    }
  }

  function parseIntSafe(value: any, defaultValue: number): number {
    try {
      const num = parseInt(String(value), 10)
      return isNaN(num) ? defaultValue : num
    } catch {
      return defaultValue
    }
  }

  function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }
}
