/**
 * Tmux control tool for direct session, window, and pane management
 * 
 * Provides comprehensive tmux control functionality similar to tmux-mcp
 */

import z from "zod/v4"
import { Tool } from "./tool"
import { TmuxServiceV2 } from "../exec/tmux-service-v2"
import { Log } from "../util/log"
import DESCRIPTION from "./tmux.txt"

const log = Log.create({ service: "tmux-control-tool" })

// Get tmux config from environment
const getTmuxConfig = () => ({
  socket: process.env["TMUX_SOCKET"],
  session: process.env["TMUX_SESSION"] ?? "agent",
  shellType: (process.env["TMUX_SHELL_TYPE"] ?? "bash") as "bash" | "zsh" | "fish",
})

export const TmuxControlTool = Tool.define("tmux_control", {
  description: DESCRIPTION,
  parameters: z.object({
    operation: z.enum([
      "list-sessions",
      "find-session",
      "create-session",
      "kill-session",
      "list-windows",
      "create-window",
      "kill-window",
      "list-panes",
      "split-pane",
      "kill-pane",
      "capture-pane",
      "execute-command",
      "get-command-result",
    ]).describe("The tmux operation to perform"),
    
    // Session parameters
    sessionName: z.string().optional().describe("Session name (for find-session, create-session)"),
    sessionId: z.string().optional().describe("Session ID (for kill-session, list-windows, create-window)"),
    
    // Window parameters
    windowName: z.string().optional().describe("Window name (for create-window)"),
    windowId: z.string().optional().describe("Window ID (for kill-window, list-panes, split-pane)"),
    
    // Pane parameters
    paneId: z.string().optional().describe("Pane ID (for split-pane, kill-pane, capture-pane, execute-command)"),
    direction: z.enum(["horizontal", "vertical"]).optional().describe("Split direction (for split-pane)"),
    size: z.number().min(1).max(99).optional().describe("Pane size percentage (for split-pane)"),
    
    // Capture parameters
    lines: z.number().optional().describe("Number of lines to capture (for capture-pane)"),
    colors: z.boolean().optional().describe("Include color codes (for capture-pane)"),
    
    // Execute command parameters
    command: z.string().optional().describe("Command to execute (for execute-command)"),
    rawMode: z.boolean().optional().describe("Raw mode for interactive apps (for execute-command)"),
    noEnter: z.boolean().optional().describe("Send keys without Enter (for execute-command)"),
    
    // Command result parameters
    commandId: z.string().optional().describe("Command ID to check (for get-command-result)"),
  }),
  async execute(params, ctx) {
    const config = getTmuxConfig()
    const service = new TmuxServiceV2(config)

    log.info("Tmux control operation", { 
      operation: params.operation,
      sessionID: ctx.sessionID,
    })

    try {
      switch (params.operation) {
        // ===== Session operations =====
        case "list-sessions": {
          const sessions = await service.listSessions()
          return {
            title: "Tmux Sessions",
            output: JSON.stringify(sessions, null, 2),
            metadata: { sessions },
          }
        }

        case "find-session": {
          if (!params.sessionName) {
            throw new Error("sessionName is required for find-session")
          }
          const session = await service.findSessionByName(params.sessionName)
          if (!session) {
            return {
              title: "Session Not Found",
              output: `Session not found: ${params.sessionName}`,
              metadata: { sessions: [] },
            }
          }
          return {
            title: `Session: ${session.name}`,
            output: JSON.stringify(session, null, 2),
            metadata: { sessions: [session] },
          }
        }

        case "create-session": {
          if (!params.sessionName) {
            throw new Error("sessionName is required for create-session")
          }
          const session = await service.createSession(params.sessionName)
          return {
            title: "Session Created",
            output: session 
              ? JSON.stringify(session, null, 2)
              : `Failed to create session: ${params.sessionName}`,
            metadata: { sessions: session ? [session] : [] },
          }
        }

        case "kill-session": {
          if (!params.sessionId) {
            throw new Error("sessionId is required for kill-session")
          }
          await service.killSession(params.sessionId)
          return {
            title: "Session Killed",
            output: `Session ${params.sessionId} has been killed`,
            metadata: { sessions: [] },
          }
        }

        // ===== Window operations =====
        case "list-windows": {
          if (!params.sessionId) {
            throw new Error("sessionId is required for list-windows")
          }
          const windows = await service.listWindows(params.sessionId)
          return {
            title: "Tmux Windows",
            output: JSON.stringify(windows, null, 2),
            metadata: { sessions: [] },
          }
        }

        case "create-window": {
          if (!params.sessionId || !params.windowName) {
            throw new Error("sessionId and windowName are required for create-window")
          }
          const window = await service.createWindow(params.sessionId, params.windowName)
          return {
            title: "Window Created",
            output: window
              ? JSON.stringify(window, null, 2)
              : `Failed to create window: ${params.windowName}`,
            metadata: { sessions: [] },
          }
        }

        case "kill-window": {
          if (!params.windowId) {
            throw new Error("windowId is required for kill-window")
          }
          await service.killWindow(params.windowId)
          return {
            title: "Window Killed",
            output: `Window ${params.windowId} has been killed`,
            metadata: { sessions: [] },
          }
        }

        // ===== Pane operations =====
        case "list-panes": {
          if (!params.windowId) {
            throw new Error("windowId is required for list-panes")
          }
          const panes = await service.listPanes(params.windowId)
          return {
            title: "Tmux Panes",
            output: JSON.stringify(panes, null, 2),
            metadata: { sessions: [] },
          }
        }

        case "split-pane": {
          if (!params.paneId) {
            throw new Error("paneId is required for split-pane")
          }
          const newPane = await service.splitPane(
            params.paneId,
            params.direction || "vertical",
            params.size
          )
          return {
            title: "Pane Split",
            output: newPane
              ? JSON.stringify(newPane, null, 2)
              : `Failed to split pane ${params.paneId}`,
            metadata: { sessions: [] },
          }
        }

        case "kill-pane": {
          if (!params.paneId) {
            throw new Error("paneId is required for kill-pane")
          }
          await service.killPane(params.paneId)
          return {
            title: "Pane Killed",
            output: `Pane ${params.paneId} has been killed`,
            metadata: { sessions: [] },
          }
        }

        case "capture-pane": {
          if (!params.paneId) {
            throw new Error("paneId is required for capture-pane")
          }
          const content = await service.capturePaneContent(
            params.paneId,
            params.lines || 200
          )
          return {
            title: "Pane Content",
            output: content || "No content captured",
            metadata: { sessions: [] },
          }
        }

        // ===== Command execution =====
        case "execute-command": {
          if (!params.paneId || !params.command) {
            throw new Error("paneId and command are required for execute-command")
          }

          const effectiveRawMode = params.noEnter || params.rawMode
          const commandId = await service.executeCommand(
            params.paneId,
            params.command,
            effectiveRawMode,
            params.noEnter
          )

          if (effectiveRawMode) {
            const modeText = params.noEnter 
              ? "Keys sent without Enter" 
              : "Interactive command started (rawMode)"
            return {
              title: "Command Executed",
              output: `${modeText}.\n\nStatus tracking is disabled.\nUse capture-pane with paneId '${params.paneId}' to verify the command outcome.\n\nCommand ID: ${commandId}`,
              metadata: { sessions: [] },
            }
          }

          return {
            title: "Command Started",
            output: `Command execution started.\n\nCommand ID: ${commandId}\n\nUse get-command-result with commandId to check status and output.`,
            metadata: { sessions: [] },
          }
        }

        case "get-command-result": {
          if (!params.commandId) {
            throw new Error("commandId is required for get-command-result")
          }

          const command = await service.checkCommandStatus(params.commandId)
          if (!command) {
            return {
              title: "Command Not Found",
              output: `Command not found: ${params.commandId}`,
              metadata: { sessions: [] },
            }
          }

          let resultText: string
          if (command.status === "pending") {
            if (command.result) {
              resultText = `Status: ${command.status}\nCommand: ${command.command}\n\n--- Message ---\n${command.result}`
            } else {
              resultText = `Command still executing...\nStarted: ${command.startTime.toISOString()}\nCommand: ${command.command}`
            }
          } else {
            resultText = `Status: ${command.status}\nExit code: ${command.exitCode}\nCommand: ${command.command}\n\n--- Output ---\n${command.result}`
          }

          return {
            title: "Command Result",
            output: resultText,
            metadata: { sessions: [] },
          }
        }

        default:
          throw new Error(`Unknown operation: ${params.operation}`)
      }
    } catch (error) {
      log.error("Tmux control operation failed", { error, operation: params.operation })
      throw error
    }
  },
})

