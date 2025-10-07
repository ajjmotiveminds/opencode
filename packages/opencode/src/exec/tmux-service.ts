/**
 * Tmux service for managing sessions, windows, and panes
 * 
 * Improved implementation based on OpenHands approach:
 * - Uses capture-pane for reliable output capture
 * - Uses send-keys directly instead of wrapper scripts
 * - Supports PS1 prompt metadata for exit code detection
 */

import { $ } from "bun"
import { Log } from "../util/log"
import { CmdOutputMetadata } from "./tmux-metadata"

const log = Log.create({ service: "tmux-service" })

export type TmuxConfig = {
  socket: string
  session: string
}

export class TmuxService {
  constructor(private config: TmuxConfig) {}

  /**
   * Check if tmux socket exists and session is available
   */
  async healthcheck(): Promise<void> {
    const socketExists = await $`test -S ${this.config.socket}`.quiet().nothrow()
    if (socketExists.exitCode !== 0) {
      throw new Error(`Tmux socket not found at ${this.config.socket}`)
    }

    await this.ensureSession(this.config.session)
  }

  /**
   * Ensure session exists, create if not
   */
  async ensureSession(session: string): Promise<void> {
    const has = await $`tmux -S ${this.config.socket} has-session -t ${session}`.quiet().nothrow()
    
    if (has.exitCode !== 0) {
      log.info("Creating tmux session", { session })
      await $`tmux -S ${this.config.socket} new-session -d -s ${session} 'exec bash -l'`.quiet()
      // Disable automatic-rename globally for this session
      await $`tmux -S ${this.config.socket} set-option -t ${session} automatic-rename off`.quiet()
      
      // Set history limit to large value to avoid losing history
      await $`tmux -S ${this.config.socket} set-option -t ${session} -g history-limit 10000`.quiet()
    }
  }

  /**
   * Ensure window exists in session, create if not
   * @returns Window ID
   */
  async ensureWindow(session: string, windowName: string): Promise<string> {
    const listing = await $`tmux -S ${this.config.socket} list-windows -t ${session} -F '#{window_id} #{window_name}'`
      .text()
      .catch(() => "")

    const windows = listing
      .split("\n")
      .map(line => line.trim().split(" "))
      .filter(parts => parts.length === 2)

    const found = windows.find(([_, name]) => name === windowName)
    if (found) {
      log.info("Found existing window", { session, windowName, windowId: found[0] })
      return found[0]
    }

    log.info("Creating tmux window", { session, windowName })
    
    // Create window and get the window index with -P flag
    const result = await $`tmux -S ${this.config.socket} new-window -d -t ${session} -n ${windowName} -P -F '#{window_index}' 'bash --norc --noprofile'`.text()
    const windowIndex = result.trim()
    
    // Disable automatic-rename immediately using window index
    await $`tmux -S ${this.config.socket} set-window-option -t ${session}:${windowIndex} automatic-rename off`.quiet()
    
    // Rename the window to ensure it has the correct name
    await $`tmux -S ${this.config.socket} rename-window -t ${session}:${windowIndex} ${windowName}`.quiet()

    // Re-query to get the window ID
    const againListing = await $`tmux -S ${this.config.socket} list-windows -t ${session} -F '#{window_id} #{window_name}'`.text()
    const againWindows = againListing
      .split("\n")
      .map(line => line.trim().split(" "))
      .filter(parts => parts.length === 2)

    const created = againWindows.find(([_, name]) => name === windowName)
    if (!created) {
      throw new Error(`Failed to create window ${session}:${windowName}`)
    }

    log.info("Created tmux window", { session, windowName, windowId: created[0] })
    
    // Configure PS1 prompt for metadata extraction
    await this.setupPs1Prompt(windowName)
    
    return created[0]
  }

  /**
   * Setup PS1 prompt for metadata extraction
   */
  async setupPs1Prompt(windowName: string): Promise<void> {
    const paneId = await this.getPaneId(this.config.session, windowName)
    
    log.info("Setting up PS1 prompt", { paneId, windowName })
    
    // Set PS1 using a simpler approach - write the exact prompt value
    // First, export variables that we'll use in PS1
    const commands = [
      `PS1='${CmdOutputMetadata.toPs1Prompt()}'`,
      `PS2=''`,
      `PROMPT_COMMAND=''`,
    ]
    
    for (const cmd of commands) {
      await $`tmux -S ${this.config.socket} send-keys -t ${paneId} ${cmd} Enter`.quiet()
      await Bun.sleep(50)
    }
    
    await Bun.sleep(100) // Wait for all commands to take effect
    
    // Clear screen and history
    await this.clearScreen(paneId)
    await Bun.sleep(100)
  }

  /**
   * Get pane ID for a window (assumes single pane per window)
   */
  async getPaneId(session: string, windowName: string): Promise<string> {
    const out = await $`tmux -S ${this.config.socket} list-panes -t ${session}:${windowName} -F '#{pane_id}'`.text()
    const panes = out.split("\n").map(s => s.trim()).filter(Boolean)
    
    if (panes.length === 0) {
      throw new Error(`No pane found in ${session}:${windowName}`)
    }

    return panes[0]
  }

  /**
   * Capture pane content using tmux capture-pane
   * This is more reliable than pipe-pane with files
   */
  async capturePaneContent(paneId: string): Promise<string> {
    try {
      const result = await $`tmux -S ${this.config.socket} capture-pane -J -p -S - -t ${paneId}`.text()
      // Join lines and remove trailing whitespace from each line to avoid double newlines
      return result
        .split("\n")
        .map(line => line.trimEnd())
        .join("\n")
    } catch (error) {
      // Pane might not exist yet or was closed
      log.warn("Failed to capture pane content", { paneId, error })
      return ""
    }
  }

  /**
   * Send Ctrl-C to pane
   */
  async sendCtrlC(paneId: string): Promise<void> {
    await $`tmux -S ${this.config.socket} send-keys -t ${paneId} C-c`.quiet().nothrow()
  }

  /**
   * Send command to pane and execute it
   * Uses send-keys directly which is simpler and more reliable than script injection
   */
  async sendCommand(paneId: string, command: string, enterKey = true): Promise<void> {
    if (enterKey) {
      await $`tmux -S ${this.config.socket} send-keys -t ${paneId} ${command} Enter`.quiet()
    } else {
      await $`tmux -S ${this.config.socket} send-keys -t ${paneId} ${command}`.quiet()
    }
  }

  /**
   * Clear screen and history
   */
  async clearScreen(paneId: string): Promise<void> {
    await $`tmux -S ${this.config.socket} send-keys -t ${paneId} C-l`.quiet()
    await Bun.sleep(100)
    await $`tmux -S ${this.config.socket} clear-history -t ${paneId}`.quiet()
  }

  /**
   * Generate short ID for file naming
   */
  static shortId(s: string): string {
    return s.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "chat"
  }

  /**
   * Generate window name for chat ID
   */
  static windowNameFor(chatId: string): string {
    return `cs:${TmuxService.shortId(chatId)}`
  }
}
