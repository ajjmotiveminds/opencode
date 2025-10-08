/**
 * Tmux-backed bash tool (V2)
 * 
 * Executes bash commands inside tmux using OSC-133 shell integration
 * for reliable command completion detection.
 */

import z from "zod/v4"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { TmuxExecutorV2 } from "../exec/tmux-executor-v2"
import { Permission } from "../permission"
import { Filesystem } from "../util/filesystem"
import { lazy } from "../util/lazy"
import { Log } from "../util/log"
import { Wildcard } from "../util/wildcard"
import { $ } from "bun"
import { Agent } from "../agent/agent"
import DESCRIPTION from "./bash.txt"

const MAX_OUTPUT_LENGTH = 30_000
const DEFAULT_TIMEOUT = 60_000
const MAX_TIMEOUT = 600_000

const log = Log.create({ service: "bash-tmux-tool-v2" })

// Shared bash parser (same as BashTool)
const parser = lazy(async () => {
  try {
    const { default: Parser } = await import("tree-sitter")
    const Bash = await import("tree-sitter-bash")
    const p = new Parser()
    p.setLanguage(Bash.language as any)
    return p
  } catch (e) {
    const { default: Parser } = await import("web-tree-sitter")
    const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, { with: { type: "wasm" } })
    await Parser.init({
      locateFile() {
        return treeWasm
      },
    })
    const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
      with: { type: "wasm" },
    })
    const bashLanguage = await Parser.Language.load(bashWasm)
    const p = new Parser()
    p.setLanguage(bashLanguage)
    return p
  }
})

export const BashTmuxToolV2 = Tool.define("bash_tmux", {
  description: DESCRIPTION + "\n\nThis version executes commands in a tmux session with OSC-133 shell integration for reliable completion detection.",
  parameters: z.object({
    command: z.string().describe("The command to execute"),
    timeout: z.number().describe("Optional timeout in milliseconds").optional(),
    description: z
      .string()
      .describe(
        "Clear, concise description of what this command does in 5-10 words. Examples:\nInput: ls\nOutput: Lists files in current directory\n\nInput: git status\nOutput: Shows working tree status\n\nInput: npm install\nOutput: Installs package dependencies\n\nInput: mkdir foo\nOutput: Creates directory 'foo'",
      ),
  }),
  async execute(params, ctx) {
    const timeout = Math.min(params.timeout ?? DEFAULT_TIMEOUT, MAX_TIMEOUT)
    const tree = await parser().then((p) => p.parse(params.command))
    const permissions = await Agent.get(ctx.agent).then((x) => x.permission.bash)

    // Permission checking (same as BashTool)
    const askPatterns = new Set<string>()
    for (const node of tree.rootNode.descendantsOfType("command")) {
      const command = []
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (!child) continue
        if (
          child.type !== "command_name" &&
          child.type !== "word" &&
          child.type !== "string" &&
          child.type !== "raw_string" &&
          child.type !== "concatenation"
        ) {
          continue
        }
        command.push(child.text)
      }

      // Path validation for file operations
      if (["cd", "rm", "cp", "mv", "mkdir", "touch", "chmod", "chown"].includes(command[0])) {
        for (const arg of command.slice(1)) {
          if (arg.startsWith("-") || (command[0] === "chmod" && arg.startsWith("+"))) continue
          const resolved = await $`realpath ${arg}`
            .quiet()
            .nothrow()
            .text()
            .then((x) => x.trim())
          log.info("resolved path", { arg, resolved })
          if (resolved && !Filesystem.contains(Instance.directory, resolved)) {
            throw new Error(
              `This command references paths outside of ${Instance.directory} so it is not allowed to be executed.`,
            )
          }
        }
      }

      // Permission check
      if (command[0] !== "cd") {
        const action = Wildcard.all(node.text, permissions)
        if (action === "deny") {
          throw new Error(
            `The user has specifically restricted access to this command, you are not allowed to execute it. Here is the configuration: ${JSON.stringify(permissions)}`,
          )
        }
        if (action === "ask") {
          const pattern = (() => {
            let head = ""
            let sub: string | undefined
            for (let i = 0; i < node.childCount; i++) {
              const child = node.child(i)
              if (!child) continue
              if (child.type === "command_name") {
                if (!head) {
                  head = child.text
                }
                continue
              }
              if (!sub && child.type === "word") {
                if (!child.text.startsWith("-")) sub = child.text
              }
            }
            if (!head) return
            return sub ? `${head} ${sub} *` : `${head} *`
          })()
          if (pattern) {
            askPatterns.add(pattern)
          }
        }
      }
    }

    if (askPatterns.size > 0) {
      const patterns = Array.from(askPatterns)
      await Permission.ask({
        type: "bash",
        pattern: patterns,
        sessionID: ctx.sessionID,
        messageID: ctx.messageID,
        callID: ctx.callID,
        title: params.command,
        metadata: {
          command: params.command,
          patterns,
        },
      })
    }

    // Get tmux config from environment
    const tmuxSocket = process.env["TMUX_SOCKET"] ?? "/shared/tmux.sock"
    const tmuxSession = process.env["TMUX_SESSION"] ?? "agent"
    const shellType = (process.env["TMUX_SHELL_TYPE"] ?? "bash") as "bash" | "zsh" | "fish"

    const executor = new TmuxExecutorV2({
      socket: tmuxSocket,
      session: tmuxSession,
      shellType,
    })

    let streamed = ""
    
    // Initialize metadata with empty output
    ctx.metadata({
      metadata: {
        output: "",
        description: params.description,
      },
    })

    log.info("Executing command via tmux (v2)", { 
      command: params.command, 
      sessionID: ctx.sessionID,
      socket: tmuxSocket,
      session: tmuxSession,
      shellType,
    })

    const { output, cancel } = executor.run({
      cmd: params.command,
      cwd: Instance.directory,
      chatId: ctx.sessionID,
      timeoutMs: timeout,
      signal: ctx.abort,
      onReady: (info) => {
        log.info("Tmux execution ready", info)
        ctx.metadata({
          metadata: {
            transport: "tmux",
            ...info,
            description: params.description,
          },
        })
      },
      onStdout: (chunk) => {
        streamed += chunk
        const preview =
          streamed.length > MAX_OUTPUT_LENGTH
            ? streamed.slice(0, MAX_OUTPUT_LENGTH) + "\n\n(Output was truncated due to length limit)"
            : streamed
        ctx.metadata({
          metadata: {
            output: preview,
            description: params.description,
          },
        })
      },
      onExit: (code) => {
        log.info("Command exited", { code })
      },
    })

    // Handle cancellation
    if (ctx.abort) {
      ctx.abort.addEventListener("abort", () => {
        log.info("Cancelling command execution")
        cancel()
      })
    }

    let result
    try {
      result = await output
    } catch (error) {
      log.error("Command execution failed", { error })
      throw error
    }

    let { combined, exitCode } = result

    // Truncate if needed
    if (combined.length > MAX_OUTPUT_LENGTH) {
      combined = combined.slice(0, MAX_OUTPUT_LENGTH) + "\n\n(Output was truncated due to length limit)"
    }

    // Final metadata update
    ctx.metadata({
      metadata: {
        output: combined,
        exit: exitCode,
        description: params.description,
      },
    })

    return {
      title: params.command,
      metadata: {
        output: combined,
        exit: exitCode,
        description: params.description,
      },
      output: combined,
    }
  },
})

