/**
 * Shell integration utilities for OSC-133 command tracking
 * 
 * OSC-133 is a standard for shell integration that allows terminals to track:
 * - When a command starts (B marker)
 * - When a command completes with exit code (C;<exitcode> marker)
 * - When prompt is ready (D marker)
 * 
 * This approach is more robust than PS1-based tracking because it works
 * consistently across different shells (bash, zsh, fish) and doesn't interfere
 * with the visible prompt.
 */

import { Log } from "../util/log"

const log = Log.create({ service: "shell-integration" })

export type ShellType = "bash" | "zsh" | "fish"

// OSC-133 escape sequence components
export const BEL = "\x07"
export const ST = "\x1b\\"
export const OSC = "\x1b]"

// Helper to escape special regex characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Regex patterns for OSC-133 markers
// B marker: command execution begins
export const reB = () => new RegExp(`\\x1b\\]133;B(?:${escapeRegex(BEL)}|${escapeRegex(ST)})`)
// C marker: command completes with exit code
export const reC = () => new RegExp(`\\x1b\\]133;C;(\\d+)(?:${escapeRegex(BEL)}|${escapeRegex(ST)})`)
// D marker: prompt ready
export const reD = () => new RegExp(`\\x1b\\]133;D(?:;[^\\x07\\x1b]*)?(?:${escapeRegex(BEL)}|${escapeRegex(ST)})`)

/**
 * Shell quoting helper for tmux send-keys
 */
export function shSingleQuoteEscape(s: string): string {
  return s.replace(/'/g, `'\\''`)
}

/**
 * Track which panes have shell integration hooks installed
 */
const panesWithHooks = new Set<string>()

/**
 * Install shell integration hooks in a pane for OSC-133 command tracking
 * 
 * @param executeTmux - Function to execute tmux commands
 * @param sendKeys - Function to send keys to a pane
 * @param paneId - Target pane ID
 * @param shellType - Shell type (bash, zsh, fish)
 */
export async function installShellIntegration(
  executeTmux: (cmd: string) => Promise<string>,
  sendKeys: (paneId: string, text: string, enter?: boolean) => Promise<void>,
  paneId: string,
  shellType: ShellType
): Promise<void> {
  // Skip if already installed
  if (panesWithHooks.has(paneId)) {
    log.debug("Shell integration already installed", { paneId })
    return
  }

  log.info("Installing shell integration hooks", { paneId, shellType })

  // Enable tmux passthrough if supported
  try {
    await executeTmux(`set -g allow-passthrough on`)
  } catch {
    // Ignore if tmux version doesn't support it
  }

  // Install shell-specific hooks
  if (shellType === "bash") {
    // Use PROMPT_COMMAND and DEBUG trap
    // PROMPT_COMMAND fires when prompt is about to be displayed (after a command finishes)
    // We print C;<ec> then D. DEBUG trap fires before each command -> B.
    const bashInit =
      `PROMPT_COMMAND='__ec=$?; printf "\\033]133;C;%d\\007" "$__ec"; printf "\\033]133;D\\007";'` +
      `; trap 'printf "\\033]133;B\\007"' DEBUG`
    await sendKeys(paneId, bashInit, true)
    
    // Run a no-op command to trigger the PROMPT_COMMAND and establish first markers
    await new Promise(resolve => setTimeout(resolve, 100))
    await sendKeys(paneId, ":", true)  // ":" is a bash no-op command
    
  } else if (shellType === "zsh") {
    // preexec() before command -> B
    // precmd() before prompt display (after command finishes) -> C;<ec>, D
    const zshInit =
      `preexec() { printf "\\033]133;B\\007"; } ; ` +
      `precmd() { local ec=$?; printf "\\033]133;C;%d\\007" "$ec"; printf "\\033]133;D\\007"; }`
    await sendKeys(paneId, zshInit, true)
    
    // Run a no-op command to trigger the hooks
    await new Promise(resolve => setTimeout(resolve, 100))
    await sendKeys(paneId, ":", true)
    
  } else if (shellType === "fish") {
    // fish has fish_preexec / fish_postexec
    const fishInit =
      `functions -q fish_preexec; or function fish_preexec; printf "\\033]133;B\\007"; end; ` +
      `functions -q fish_postexec; or function fish_postexec --argument-names ec; ` +
      `printf "\\033]133;C;%d\\007" "$ec"; printf "\\033]133;D\\007"; end`
    await sendKeys(paneId, fishInit, true)
    
    // Run a no-op command to trigger the hooks
    await new Promise(resolve => setTimeout(resolve, 100))
    await sendKeys(paneId, ":", true)
  }

  // Give shell time to complete the no-op and display the prompt with markers
  await new Promise(resolve => setTimeout(resolve, 300))

  panesWithHooks.add(paneId)
  log.info("Shell integration hooks installed", { paneId, shellType })
}

/**
 * Parse OSC-133 command execution from pane buffer
 * 
 * Finds the last command block (B ... C;<exitcode> ... D) and extracts:
 * - Exit code from the C marker
 * - Output between C and D markers
 * 
 * @param buffer - Captured pane content
 * @returns Parsed command execution info
 */
export function parseLastCommandViaOSC133(buffer: string): {
  found: boolean
  exitCode?: number
  output?: string
} {
  const regexB = reB()
  const regexC = reC()
  const regexD = reD()

  // Find the last B marker (command start)
  let lastB = -1
  {
    let m: RegExpExecArray | null
    const bGlobal = new RegExp(regexB.source, "g")
    while ((m = bGlobal.exec(buffer))) {
      lastB = m.index + m[0].length
    }
  }
  
  if (lastB < 0) {
    return { found: false }
  }

  // Find the first C marker after that B (command completion with exit code)
  const afterB = buffer.slice(lastB)
  const mC = regexC.exec(afterB)
  if (!mC) {
    return { found: false }
  }
  
  const ec = Number(mC[1])
  const cStartIdx = lastB + mC.index

  // Find the first D marker after that C (prompt ready)
  const cEndIdx = lastB + mC.index + mC[0].length
  const afterC = buffer.slice(cEndIdx)
  const mD = regexD.exec(afterC)
  if (!mD) {
    return { found: false }
  }

  // Output is everything between end-of-B and start-of-C
  // This is the actual command output
  const output = buffer.slice(lastB, cStartIdx).trim()

  return { found: true, exitCode: ec, output }
}

/**
 * Count the number of completed command cycles in the buffer
 * A completed cycle is B -> C -> D
 */
export function countCompletedCommands(buffer: string): number {
  const regexB = reB()
  const regexC = reC()
  const regexD = reD()

  // Find all B markers
  const bPositions: number[] = []
  {
    let m: RegExpExecArray | null
    const bGlobal = new RegExp(regexB.source, "g")
    while ((m = bGlobal.exec(buffer))) {
      bPositions.push(m.index + m[0].length)
    }
  }

  let completedCount = 0

  // For each B marker, check if there's a matching C and D
  for (const bPos of bPositions) {
    const afterB = buffer.slice(bPos)
    const mC = regexC.exec(afterB)
    if (!mC) continue

    const cEndIdx = bPos + mC.index + mC[0].length
    const afterC = buffer.slice(cEndIdx)
    const mD = regexD.exec(afterC)
    if (!mD) continue

    // Found a complete B->C->D cycle
    completedCount++
  }

  return completedCount
}

/**
 * Clear shell integration state for testing or cleanup
 */
export function clearShellIntegrationState(): void {
  panesWithHooks.clear()
}

