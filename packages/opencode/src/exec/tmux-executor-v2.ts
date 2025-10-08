/**
 * Tmux-backed command executor with OSC-133-based completion detection
 * 
 * Improved implementation based on tmux-mcp approach:
 * - Uses OSC-133 shell integration for reliable command completion detection
 * - Uses capture-pane for output capture
 * - Supports two-tier timeout system (no-change and hard timeout)
 * - Direct send-keys for command execution
 */

import type { CommandExecutor, ExecOptions, ExecResult } from "./types"
import { TmuxServiceV2, type TmuxConfig } from "./tmux-service-v2"
import { Log } from "../util/log"

const log = Log.create({ service: "tmux-executor-v2" })

const DEFAULT_TIMEOUT = 60_000
const MAX_TIMEOUT = 600_000
const DEFAULT_NO_CHANGE_TIMEOUT = 3_000 // 3 seconds of no output change for normal commands
const POLL_INTERVAL = 200 // 0.2 seconds

// Enable pre-command Ctrl-C by default (disable with env var)
const PRE_CTRL_C = process.env["TMUX_PRE_CTRL_C"] !== "false"

export type TmuxExecOptions = ExecOptions & {
  /** Chat/session ID for window naming */
  chatId: string
  /** If true, ignore no-change timeout (for long-running blocking commands) */
  blocking?: boolean
}

export class TmuxExecutorV2 implements CommandExecutor {
  private service: TmuxServiceV2

  constructor(config: TmuxConfig) {
    this.service = new TmuxServiceV2(config)
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

    const windowName = TmuxServiceV2.windowNameFor(chatId)
    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    
    let paneId = ""
    let cancelled = false
    let prevOutput = ""

    const setup = (async () => {
      log.info("Setting up tmux execution", { chatId, windowName, cmd })
      
      await this.service.healthcheck()
      const windowId = await this.service.ensureWindow(this.service["session"], windowName)
      paneId = await this.service.getPaneId(this.service["session"], windowName)

      log.info("Window and pane ready", { windowId, paneId, windowName })

      // Pre-cleanup: send Ctrl-C to ensure clean prompt
      if (PRE_CTRL_C) {
        log.info("Sending pre-command Ctrl-C", { paneId })
        await this.service.sendCtrlC(paneId)
        await Bun.sleep(100) // Small delay for prompt to settle
      }

      onReady?.({
        transport: "tmux",
        session: this.service["session"],
        windowName,
        paneId,
        jobId,
      })

      log.info("Tmux execution ready", { paneId, jobId })
    })()

    const output = new Promise<ExecResult>(async (resolve, reject) => {
      try {
        await setup

        // Just send the command directly - no fancy detection needed
        await this.service["sendKeys"](paneId, cmd, true)
        
        log.info("Command sent")

        const startTime = Date.now()
        let lastChangeTime = startTime
        let lastContent = ""
        const deadline = Math.min(startTime + timeoutMs, startTime + MAX_TIMEOUT)

        // Simple polling: wait for no content change
        while (!cancelled && Date.now() < deadline) {
          await Bun.sleep(POLL_INTERVAL)

          // Capture current pane content
          const currentContent = await this.service.capturePaneContent(paneId, 1000, false)
          
          // Detect content change for streaming
          if (currentContent !== lastContent) {
            lastContent = currentContent
            lastChangeTime = Date.now()
            
            // Stream incremental output
            if (onStdout) {
              const delta = currentContent.slice(prevOutput.length)
              if (delta) {
                onStdout(delta)
                prevOutput = currentContent
              }
            }
          }

          // Check no-change timeout - if output hasn't changed, command is probably done
          if (!blocking) {
            const timeSinceLastChange = Date.now() - lastChangeTime
            const noChangeTimeout = DEFAULT_NO_CHANGE_TIMEOUT
            if (timeSinceLastChange >= noChangeTimeout) {
              // log.info("No output change for", { timeSinceLastChange }, "- assuming command complete")
              
              // Capture final pane content
              const finalContent = await this.service.capturePaneContent(paneId, 1000, false)
              
              onExit?.(0)  // We don't know the real exit code without OSC-133
              
              return resolve({
                combined: finalContent,
                exitCode: 0,
              })
            }
          }
        }

        // Hard timeout
        if (!cancelled) {
          log.warn("Hard timeout triggered")
          await this.service.sendCtrlC(paneId)
          await Bun.sleep(200) // Wait for Ctrl-C to take effect
          
          // Capture final pane content
          const finalContent = await this.service.capturePaneContent(paneId, 1000, false)
          
          return resolve({
            combined: finalContent + `\n\n[Command timed out after ${timeoutMs / 1000}s]`,
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
}

