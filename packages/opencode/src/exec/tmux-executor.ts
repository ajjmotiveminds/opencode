/**
 * Tmux-backed command executor with PS1-based completion detection
 * 
 * Improved implementation based on OpenHands approach:
 * - Uses PS1 prompt metadata for reliable command completion detection
 * - Uses capture-pane for output capture instead of files
 * - Supports two-tier timeout system (no-change and hard timeout)
 * - Direct send-keys for command execution
 */

import type { CommandExecutor, ExecOptions, ExecResult } from "./types"
import { TmuxService, type TmuxConfig } from "./tmux-service"
import { CmdOutputMetadata } from "./tmux-metadata"
import { BashEscape } from "./bash-escape"
import { Log } from "../util/log"

const log = Log.create({ service: "tmux-executor" })

const DEFAULT_TIMEOUT = 60_000
const MAX_TIMEOUT = 600_000
const NO_CHANGE_TIMEOUT = 30_000 // 30 seconds of no output change
const POLL_INTERVAL = 500 // 0.5 seconds

// Enable pre-command Ctrl-C by default (disable with env var)
const PRE_CTRL_C = process.env["TMUX_PRE_CTRL_C"] !== "false"

export type TmuxExecOptions = ExecOptions & {
  /** Chat/session ID for window naming */
  chatId: string
  /** If true, ignore no-change timeout (for long-running blocking commands) */
  blocking?: boolean
}

export class TmuxExecutor implements CommandExecutor {
  private service: TmuxService

  constructor(config: TmuxConfig) {
    this.service = new TmuxService(config)
  }

  async healthcheck(): Promise<void> {
    await this.service.healthcheck()
  }

  run(opts: TmuxExecOptions): { output: Promise<ExecResult>; cancel: () => Promise<void> } {
    const {
      cmd,
      chatId,
      timeoutMs = DEFAULT_TIMEOUT,
      blocking = false,
      onStdout,
      onExit,
      onReady,
    } = opts

    const session = this.service["config"].session
    const windowName = TmuxService.windowNameFor(chatId)
    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    
    let paneId = ""
    let cancelled = false
    let prevOutput = ""

    const setup = (async () => {
      log.info("Setting up tmux execution", { chatId, windowName, cmd })
      
      await this.service.healthcheck()
      const windowId = await this.service.ensureWindow(session, windowName)
      paneId = await this.service.getPaneId(session, windowName)

      log.info("Window and pane ready", { windowId, paneId, windowName })

      // Pre-cleanup: send Ctrl-C to ensure clean prompt
      if (PRE_CTRL_C) {
        log.info("Sending pre-command Ctrl-C", { paneId })
        await this.service.sendCtrlC(paneId)
        await Bun.sleep(100) // Small delay for prompt to settle
      }

      onReady?.({
        transport: "tmux",
        session,
        windowName,
        paneId,
        jobId,
      })

      log.info("Tmux execution ready", { paneId, jobId })
    })()

    const output = new Promise<ExecResult>(async (resolve, reject) => {
      try {
        await setup

        // Get initial pane state before sending command
        const initialContent = await this.service.capturePaneContent(paneId)
        const initialPs1Matches = CmdOutputMetadata.matchesPs1Metadata(initialContent)
        const initialPs1Count = initialPs1Matches.length

        log.info("Initial state captured", { initialPs1Count })

        // Check if command is a special key
        const isSpecialKey = BashEscape.isSpecialKey(cmd)
        
        // Send command
        if (cmd.trim()) {
          const escapedCmd = isSpecialKey ? cmd : BashEscape.escapeSpecialChars(cmd)
          log.info("Sending command", { original: cmd, escaped: escapedCmd, isSpecialKey })
          
          await this.service.sendCommand(paneId, escapedCmd, !isSpecialKey)
        }

        const startTime = Date.now()
        let lastChangeTime = startTime
        let lastContent = initialContent
        const deadline = Math.min(startTime + timeoutMs, startTime + MAX_TIMEOUT)

        // Poll for command completion
        while (!cancelled && Date.now() < deadline) {
          await Bun.sleep(POLL_INTERVAL)

          // Capture current pane content
          const currentContent = await this.service.capturePaneContent(paneId)
          const ps1Matches = CmdOutputMetadata.matchesPs1Metadata(currentContent)
          const currentPs1Count = ps1Matches.length

          // Detect content change
          if (currentContent !== lastContent) {
            lastContent = currentContent
            lastChangeTime = Date.now()
            
            // Extract output between PS1 prompts
            const output = this.extractOutput(currentContent, ps1Matches, initialPs1Matches)
            if (output !== prevOutput) {
              const delta = output.slice(prevOutput.length)
              if (delta) {
                onStdout?.(delta)
                prevOutput = output
              }
            }
          }

          // Check if command completed (new PS1 prompt appeared)
          if (currentPs1Count > initialPs1Count || 
              currentContent.trim().endsWith(CmdOutputMetadata.PS1_END.trim())) {
            
            log.info("Command completed", { currentPs1Count, initialPs1Count })
            
            // Extract metadata from last PS1 prompt
            const metadata = ps1Matches.length > 0 
              ? CmdOutputMetadata.fromPs1Match(ps1Matches[ps1Matches.length - 1])
              : { exitCode: -1, pid: -1 }

            const finalOutput = this.extractOutput(currentContent, ps1Matches, initialPs1Matches)
            const cleanOutput = this.removeCommandPrefix(finalOutput, cmd)

            onExit?.(metadata.exitCode)
            
            // Clear screen for next command
            await this.service.clearScreen(paneId)
            
            return resolve({
              combined: cleanOutput,
              exitCode: metadata.exitCode,
            })
          }

          // Check no-change timeout (only if not blocking)
          if (!blocking) {
            const timeSinceLastChange = Date.now() - lastChangeTime
            if (timeSinceLastChange >= NO_CHANGE_TIMEOUT) {
              log.warn("No-change timeout triggered", { timeSinceLastChange })
              
              const output = this.extractOutput(currentContent, ps1Matches, initialPs1Matches)
              const cleanOutput = this.removeCommandPrefix(output, cmd)
              
              prevOutput = output
              
              return resolve({
                combined: cleanOutput + `\n\n[Command timed out after ${NO_CHANGE_TIMEOUT / 1000}s of no output. The command may still be running.]`,
                exitCode: -1,
              })
            }
          }
        }

        // Hard timeout
        if (!cancelled) {
          log.warn("Hard timeout triggered")
          await this.service.sendCtrlC(paneId)
          
          const currentContent = await this.service.capturePaneContent(paneId)
          const ps1Matches = CmdOutputMetadata.matchesPs1Metadata(currentContent)
          const output = this.extractOutput(currentContent, ps1Matches, initialPs1Matches)
          const cleanOutput = this.removeCommandPrefix(output, cmd)
          
          return resolve({
            combined: cleanOutput + `\n\n[Command timed out after ${timeoutMs / 1000}s]`,
            exitCode: -1,
          })
        }

        // Cancelled
        log.info("Command execution cancelled")
        reject(new Error("Command execution cancelled"))
        
      } catch (e) {
        log.error("Tmux execution error", { error: e, jobId })
        reject(e)
      }
    })

    const cancel = async () => {
      log.info("Cancelling tmux execution", { jobId, paneId })
      cancelled = true
      
      if (paneId) {
        await this.service.sendCtrlC(paneId)
      }
    }

    return { output, cancel }
  }

  /**
   * Extract command output between PS1 prompts
   */
  private extractOutput(
    content: string,
    ps1Matches: RegExpMatchArray[],
    _initialPs1Matches: RegExpMatchArray[]
  ): string {
    if (ps1Matches.length === 0) {
      return content
    }

    if (ps1Matches.length === 1) {
      // If only one match, get content after it
      const match = ps1Matches[0]
      return content.slice(match.index! + match[0].length + 1)
    }

    // Multiple matches: combine output between them
    let combined = ""
    for (let i = 0; i < ps1Matches.length - 1; i++) {
      const currentMatch = ps1Matches[i]
      const nextMatch = ps1Matches[i + 1]
      const segment = content.slice(
        currentMatch.index! + currentMatch[0].length + 1,
        nextMatch.index!
      )
      combined += segment + "\n"
    }
    
    // Add content after last match
    const lastMatch = ps1Matches[ps1Matches.length - 1]
    combined += content.slice(lastMatch.index! + lastMatch[0].length + 1)
    
    return combined
  }

  /**
   * Remove command echo from output
   */
  private removeCommandPrefix(output: string, command: string): string {
    return output.trimStart().replace(command.trimStart(), "").trimStart()
  }
}
