/**
 * Tmux service for managing sessions, windows, and panes
 * 
 * This is a comprehensive tmux control implementation based on tmux-mcp,
 * using OSC-133 shell integration for reliable command tracking.
 */

import { $ } from "bun"
import { Log } from "../util/log"
import {
  installShellIntegration,
  parseLastCommandViaOSC133,
  shSingleQuoteEscape,
  type ShellType,
} from "./shell-integration"

const log = Log.create({ service: "tmux-service-v2" })

// ===== Types =====

export interface TmuxSession {
  id: string
  name: string
  attached: boolean
  windows: number
}

export interface TmuxWindow {
  id: string
  name: string
  active: boolean
  sessionId: string
}

export interface TmuxPane {
  id: string
  windowId: string
  active: boolean
  title: string
}

export interface TmuxConfig {
  socket?: string
  session: string
  shellType?: ShellType
}

interface CommandExecution {
  id: string
  paneId: string
  command: string
  status: "pending" | "completed" | "error"
  startTime: Date
  result?: string
  exitCode?: number
  rawMode?: boolean
}

// ===== TmuxService Class =====

export class TmuxServiceV2 {
  private socket?: string
  private session: string
  private shellType: ShellType
  private activeCommands = new Map<string, CommandExecution>()

  constructor(config: TmuxConfig) {
    this.socket = config.socket
    this.session = config.session
    this.shellType = config.shellType ?? "bash"
  }

  // ===== Core tmux command execution =====

  private async executeTmux(command: string): Promise<string> {
    try {
      const socketArg = this.socket ? `-S ${this.socket}` : ""
      const fullCmd = `tmux ${socketArg} ${command}`
      const result = await $`sh -c ${fullCmd}`.text()
      return result.trim()
    } catch (error: any) {
      throw new Error(`Failed to execute tmux command: ${error.message}`)
    }
  }

  private async sendKeys(paneId: string, text: string, enter = true): Promise<void> {
    const payload = `'${shSingleQuoteEscape(text)}'`
    await this.executeTmux(`send-keys -t '${paneId}' ${payload}${enter ? " Enter" : ""}`)
  }

  // ===== Health check =====

  async healthcheck(): Promise<void> {
    try {
      if (this.socket) {
        const socketExists = await $`test -S ${this.socket}`.quiet().nothrow()
        if (socketExists.exitCode !== 0) {
          throw new Error(`Tmux socket not found at ${this.socket}`)
        }
      }

      await this.ensureSession(this.session)
    } catch (error) {
      throw new Error(`Tmux healthcheck failed: ${error}`)
    }
  }

  // ===== Session management =====

  async listSessions(): Promise<TmuxSession[]> {
    const format = "#{session_id}:#{session_name}:#{?session_attached,1,0}:#{session_windows}"
    const output = await this.executeTmux(`list-sessions -F '${format}'`)
    if (!output) return []
    
    return output.split("\n").map((line) => {
      const [id, name, attached, windows] = line.split(":")
      return {
        id,
        name,
        attached: attached === "1",
        windows: parseInt(windows, 10),
      }
    })
  }

  async findSessionByName(name: string): Promise<TmuxSession | null> {
    try {
      const sessions = await this.listSessions()
      return sessions.find((s) => s.name === name) || null
    } catch {
      return null
    }
  }

  async ensureSession(sessionName: string): Promise<void> {
    try {
      await this.executeTmux(`has-session -t '${sessionName}'`)
      log.debug("Session exists", { sessionName })
    } catch {
      log.info("Creating tmux session", { sessionName })
      await this.executeTmux(`new-session -d -s '${sessionName}'`)
      
      // Set history limit to large value to avoid losing history
      await this.executeTmux(`set-option -t '${sessionName}' -g history-limit 10000`)
    }
  }

  async createSession(name: string): Promise<TmuxSession | null> {
    await this.executeTmux(`new-session -d -s '${name}'`)
    return this.findSessionByName(name)
  }

  async killSession(sessionId: string): Promise<void> {
    await this.executeTmux(`kill-session -t '${sessionId}'`)
  }

  // ===== Window management =====

  async listWindows(sessionId: string): Promise<TmuxWindow[]> {
    const format = "#{window_id}:#{window_name}:#{?window_active,1,0}"
    const output = await this.executeTmux(`list-windows -t '${sessionId}' -F '${format}'`)
    if (!output) return []
    
    return output.split("\n").map((line) => {
      const [id, name, active] = line.split(":")
      return { id, name, active: active === "1", sessionId }
    })
  }

  async ensureWindow(sessionName: string, windowName: string): Promise<string> {
    const listing = await this.executeTmux(
      `list-windows -t '${sessionName}' -F '#{window_id} #{window_name}'`
    ).catch(() => "")

    const windows = listing
      .split("\n")
      .map((line) => line.trim().split(" "))
      .filter((parts) => parts.length === 2)

    const found = windows.find(([_, name]) => name === windowName)
    if (found) {
      log.info("Found existing window", { sessionName, windowName, windowId: found[0] })
      return found[0]
    }

    log.info("Creating tmux window", { sessionName, windowName })

    // Create window with bash in interactive mode (-i) and get the window index with -P flag
    const result = await this.executeTmux(
      `new-window -d -t '${sessionName}' -n '${windowName}' -P -F '#{window_index}' 'exec bash -i'`
    )
    const windowIndex = result.trim()

    // Disable automatic-rename immediately using window index
    await this.executeTmux(
      `set-window-option -t '${sessionName}:${windowIndex}' automatic-rename off`
    )

    // Rename the window to ensure it has the correct name
    await this.executeTmux(`rename-window -t '${sessionName}:${windowIndex}' '${windowName}'`)

    // Re-query to get the window ID
    const againListing = await this.executeTmux(
      `list-windows -t '${sessionName}' -F '#{window_id} #{window_name}'`
    )
    const againWindows = againListing
      .split("\n")
      .map((line) => line.trim().split(" "))
      .filter((parts) => parts.length === 2)

    const created = againWindows.find(([_, name]) => name === windowName)
    if (!created) {
      throw new Error(`Failed to create window ${sessionName}:${windowName}`)
    }

    log.info("Created tmux window", { sessionName, windowName, windowId: created[0] })
    return created[0]
  }

  async createWindow(sessionId: string, name: string): Promise<TmuxWindow | null> {
    await this.executeTmux(`new-window -t '${sessionId}' -n '${name}'`)
    const windows = await this.listWindows(sessionId)
    return windows.find((w) => w.name === name) || null
  }

  async killWindow(windowId: string): Promise<void> {
    await this.executeTmux(`kill-window -t '${windowId}'`)
  }

  // ===== Pane management =====

  async listPanes(windowId: string): Promise<TmuxPane[]> {
    const format = "#{pane_id}:#{pane_title}:#{?pane_active,1,0}"
    const output = await this.executeTmux(`list-panes -t '${windowId}' -F '${format}'`)
    if (!output) return []
    
    return output.split("\n").map((line) => {
      const [id, title, active] = line.split(":")
      return { id, windowId, title, active: active === "1" }
    })
  }

  async getPaneId(sessionName: string, windowName: string): Promise<string> {
    const out = await this.executeTmux(
      `list-panes -t '${sessionName}:${windowName}' -F '#{pane_id}'`
    )
    const panes = out.split("\n").map((s) => s.trim()).filter(Boolean)

    if (panes.length === 0) {
      throw new Error(`No pane found in ${sessionName}:${windowName}`)
    }

    return panes[0]
  }

  async capturePaneContent(
    paneId: string,
    lines: number = 200
  ): Promise<string> {
    try {
      // Always use -e flag to capture escape sequences (including OSC-133 markers)
      const result = await this.executeTmux(
        `capture-pane -p -e -t '${paneId}' -S -${lines} -E -`
      )
      return result
    } catch (error) {
      log.warn("Failed to capture pane content", { paneId, error })
      return ""
    }
  }

  async splitPane(
    targetPaneId: string,
    direction: "horizontal" | "vertical" = "vertical",
    size?: number
  ): Promise<TmuxPane | null> {
    let splitCommand = "split-window"
    splitCommand += direction === "horizontal" ? " -h" : " -v"
    splitCommand += ` -t '${targetPaneId}'`
    if (size !== undefined && size > 0 && size < 100) {
      splitCommand += ` -p ${size}`
    }
    await this.executeTmux(splitCommand)
    
    const windowInfo = await this.executeTmux(
      `display-message -p -t '${targetPaneId}' '#{window_id}'`
    )
    const panes = await this.listPanes(windowInfo)
    return panes.length > 0 ? panes[panes.length - 1] : null
  }

  async killPane(paneId: string): Promise<void> {
    await this.executeTmux(`kill-pane -t '${paneId}'`)
  }

  // ===== Command execution with OSC-133 tracking =====

  /**
   * Execute a command in a pane with optional command tracking
   * 
   * @param paneId - Target pane ID
   * @param command - Command to execute
   * @param rawMode - If true, skip OSC-133 tracking (for interactive apps)
   * @param noEnter - If true, send keys without Enter (for TUI navigation)
   * @returns Command ID for tracking execution status
   */
  async executeCommand(
    paneId: string,
    command: string,
    rawMode?: boolean,
    noEnter?: boolean
  ): Promise<string> {
    const commandId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

    // Install shell hooks once per pane (unless in raw mode)
    if (!rawMode && !noEnter) {
      await installShellIntegration(
        (cmd) => this.executeTmux(cmd),
        (pId, text, enter) => this.sendKeys(pId, text, enter),
        paneId,
        this.shellType
      )
    }

    this.activeCommands.set(commandId, {
      id: commandId,
      paneId,
      command,
      status: "pending",
      startTime: new Date(),
      rawMode: rawMode || noEnter,
    })

    if (noEnter) {
      // Send special keys vs literal chars
      const specials = new Set([
        "Up", "Down", "Left", "Right", "Escape", "Tab", "Enter", "Space",
        "BSpace", "Delete", "Home", "End", "PageUp", "PageDown",
        "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
      ])
      
      if (specials.has(command)) {
        await this.executeTmux(`send-keys -t '${paneId}' ${command}`)
      } else {
        // Send character by character
        for (const ch of command) {
          await this.executeTmux(
            `send-keys -t '${paneId}' '${shSingleQuoteEscape(ch)}'`
          )
        }
      }
    } else {
      // Normal path: just send the command with ENTER
      await this.sendKeys(paneId, command, true)
    }

    return commandId
  }

  /**
   * Check command execution status using OSC-133 markers
   */
  async checkCommandStatus(commandId: string): Promise<CommandExecution | null> {
    const cmd = this.activeCommands.get(commandId)
    if (!cmd) return null

    if (cmd.status !== "pending") return cmd

    // For interactive/raw keystrokes we don't track completion
    if (cmd.rawMode) {
      cmd.result =
        "Status tracking is disabled for raw/keystroke mode. Use capture-pane to inspect the pane."
      return cmd
    }

    // Capture a generous slice of history
    const content = await this.capturePaneContent(cmd.paneId, 5000)

    const parsed = parseLastCommandViaOSC133(content)
    if (!parsed.found) {
      cmd.result = "Waiting for command to finish (no OSC-133 boundary observed yet)"
      return cmd
    }

    cmd.exitCode = parsed.exitCode!
    cmd.status = parsed.exitCode === 0 ? "completed" : "error"
    cmd.result = parsed.output ?? ""

    this.activeCommands.set(commandId, cmd)
    return cmd
  }

  /**
   * Get command execution info
   */
  getCommand(commandId: string): CommandExecution | null {
    return this.activeCommands.get(commandId) || null
  }

  /**
   * Get all active command IDs
   */
  getActiveCommandIds(): string[] {
    return Array.from(this.activeCommands.keys())
  }

  /**
   * Clean up old completed commands
   */
  cleanupOldCommands(maxAgeMinutes: number = 60): void {
    const now = new Date().getTime()
    for (const [id, cmd] of this.activeCommands.entries()) {
      const ageMin = (now - cmd.startTime.getTime()) / 60000
      if (cmd.status !== "pending" && ageMin > maxAgeMinutes) {
        this.activeCommands.delete(id)
      }
    }
  }

  // ===== Control commands =====

  async sendCtrlC(paneId: string): Promise<void> {
    await this.executeTmux(`send-keys -t '${paneId}' C-c`)
  }

  async sendCtrlL(paneId: string): Promise<void> {
    await this.executeTmux(`send-keys -t '${paneId}' C-l`)
  }

  // ===== Utility functions =====

  /**
   * Generate short ID for naming
   */
  static shortId(s: string): string {
    return s.replace(/[^a-zA-Z0-9]/g, "").slice(0, 6) || "chat"
  }

  /**
   * Generate window name for chat ID
   */
  static windowNameFor(chatId: string): string {
    return `cs:${TmuxServiceV2.shortId(chatId)}`
  }
}

