/**
 * Tests for BashTmuxTool
 * 
 * Note: These tests require a running tmux session.
 * For CI/CD, either mock the TmuxExecutor or set up tmux in the test environment.
 */

import { describe, expect, test, beforeAll, afterAll, mock } from "bun:test"
import path from "path"
import { BashTmuxTool } from "../../src/tool/bash-tmux"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { TmuxExecutor } from "../../src/exec/tmux-executor"
import { $ } from "bun"

const ctx = {
  sessionID: "test-session",
  messageID: "test-msg",
  toolCallID: "test-call",
  agent: "build",
  abort: AbortSignal.any([]),
  metadata: mock(() => {}),
}

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

// Check if tmux is available
const TMUX_AVAILABLE = await checkTmuxAvailable()

async function checkTmuxAvailable(): Promise<boolean> {
  try {
    await $`which tmux`.quiet()
    return true
  } catch {
    return false
  }
}

// Set up test tmux session if available
const TEST_TMUX_SOCKET = "/tmp/opencode-test.sock"
const TEST_TMUX_SESSION = "opencode-test"

async function setupTestTmux() {
  if (!TMUX_AVAILABLE) return

  try {
    // Clean up any existing test session
    await $`tmux -S ${TEST_TMUX_SOCKET} kill-session -t ${TEST_TMUX_SESSION}`.quiet().nothrow()
  } catch {}

  try {
    // Create test session
    await $`tmux -S ${TEST_TMUX_SOCKET} new-session -d -s ${TEST_TMUX_SESSION} 'cd ${projectRoot} && bash -l'`.quiet()
    await $`chmod 666 ${TEST_TMUX_SOCKET}`.quiet()
    
    // Give tmux a moment to initialize
    await Bun.sleep(100)
  } catch (error) {
    console.warn("Failed to set up test tmux:", error)
  }
}

async function teardownTestTmux() {
  if (!TMUX_AVAILABLE) return

  try {
    await $`tmux -S ${TEST_TMUX_SOCKET} kill-session -t ${TEST_TMUX_SESSION}`.quiet().nothrow()
    await $`rm -f ${TEST_TMUX_SOCKET}`.quiet().nothrow()
  } catch {}
}

describe("tool.bash-tmux", () => {
  beforeAll(async () => {
    if (TMUX_AVAILABLE) {
      await setupTestTmux()
    }
  })

  afterAll(async () => {
    if (TMUX_AVAILABLE) {
      await teardownTestTmux()
    }
  })

  if (!TMUX_AVAILABLE) {
    test.skip("tmux not available - skipping integration tests", () => {})
    return
  }

  test("basic echo command", async () => {
    // Set environment for test
    process.env["TMUX_SOCKET"] = TEST_TMUX_SOCKET
    process.env["TMUX_SESSION"] = TEST_TMUX_SESSION

    const tool = await BashTmuxTool.init()

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await tool.execute(
          {
            command: "echo 'tmux test'",
            description: "Echo test message in tmux",
          },
          ctx,
        )

        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("tmux test")
      },
    })
  })

  test("command with exit code", async () => {
    process.env["TMUX_SOCKET"] = TEST_TMUX_SOCKET
    process.env["TMUX_SESSION"] = TEST_TMUX_SESSION

    const tool = await BashTmuxTool.init()

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await tool.execute(
          {
            command: "bash -c 'exit 42'",
            description: "Exit with code 42",
          },
          ctx,
        )

        expect(result.metadata.exit).toBe(42)
      },
    })
  })

  test("multi-line output", async () => {
    process.env["TMUX_SOCKET"] = TEST_TMUX_SOCKET
    process.env["TMUX_SESSION"] = TEST_TMUX_SESSION

    const tool = await BashTmuxTool.init()

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await tool.execute(
          {
            command: "echo 'line1' && echo 'line2' && echo 'line3'",
            description: "Multi-line output test",
          },
          ctx,
        )

        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("line1")
        expect(result.metadata.output).toContain("line2")
        expect(result.metadata.output).toContain("line3")
      },
    })
  })

  test("cd ../ should fail outside of project root", async () => {
    process.env["TMUX_SOCKET"] = TEST_TMUX_SOCKET
    process.env["TMUX_SESSION"] = TEST_TMUX_SESSION

    const tool = await BashTmuxTool.init()

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await expect(
          tool.execute(
            {
              command: "cd ../",
              description: "Try to cd to parent directory",
            },
            ctx,
          ),
        ).rejects.toThrow("This command references paths outside of")
      },
    })
  })

  test("metadata streaming", async () => {
    process.env["TMUX_SOCKET"] = TEST_TMUX_SOCKET
    process.env["TMUX_SESSION"] = TEST_TMUX_SESSION

    const tool = await BashTmuxTool.init()
    const metadataCalls: any[] = []

    const streamingCtx = {
      ...ctx,
      metadata: mock((data: any) => {
        metadataCalls.push(data)
      }),
    }

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        await tool.execute(
          {
            command: "echo 'streaming test'",
            description: "Test metadata streaming",
          },
          streamingCtx,
        )

        // Should have at least initial + final metadata calls
        expect(metadataCalls.length).toBeGreaterThan(1)
        
        // Final call should have output
        const finalCall = metadataCalls[metadataCalls.length - 1]
        expect(finalCall.metadata.output).toContain("streaming test")
        expect(finalCall.metadata.exit).toBeDefined()
      },
    })
  })

  test("timeout handling", async () => {
    process.env["TMUX_SOCKET"] = TEST_TMUX_SOCKET
    process.env["TMUX_SESSION"] = TEST_TMUX_SESSION

    const tool = await BashTmuxTool.init()

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await tool.execute(
          {
            command: "sleep 10",
            timeout: 500, // 500ms timeout
            description: "Test timeout",
          },
          ctx,
        )
        
        // Should complete with timeout message rather than throwing
        expect(result.metadata.exit).toBe(-1)
        expect(result.metadata.output).toContain("timed out")
      },
    })
  })

  test("creates window per chat session", async () => {
    process.env["TMUX_SOCKET"] = TEST_TMUX_SOCKET
    process.env["TMUX_SESSION"] = TEST_TMUX_SESSION

    const tool = await BashTmuxTool.init()

    const ctx1 = { ...ctx, sessionID: "chat-abc123" }
    const ctx2 = { ...ctx, sessionID: "chat-def456" }

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        // Execute command in first chat
        await tool.execute(
          {
            command: "echo 'chat1'",
            description: "Command in chat 1",
          },
          ctx1,
        )

        // Execute command in second chat
        await tool.execute(
          {
            command: "echo 'chat2'",
            description: "Command in chat 2",
          },
          ctx2,
        )

        // Check that windows were created
        const windows = await $`tmux -S ${TEST_TMUX_SOCKET} list-windows -t ${TEST_TMUX_SESSION} -F '#{window_name}'`.text()
        
        expect(windows).toContain("cs:chatab") // shortened chat ID (first 6 alphanumeric chars)
        expect(windows).toContain("cs:chatde")  // shortened chat ID
      },
    })
  })

  test("working directory is respected", async () => {
    process.env["TMUX_SOCKET"] = TEST_TMUX_SOCKET
    process.env["TMUX_SESSION"] = TEST_TMUX_SESSION

    const tool = await BashTmuxTool.init()

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await tool.execute(
          {
            command: "pwd",
            description: "Print working directory",
          },
          ctx,
        )

        expect(result.metadata.exit).toBe(0)
        // Check that output contains "opencode" which is part of the path
        expect(result.metadata.output).toContain("opencode")
      },
    })
  })
})

describe("exec.tmux-executor", () => {
  if (!TMUX_AVAILABLE) {
    test.skip("tmux not available - skipping executor tests", () => {})
    return
  }

  beforeAll(async () => {
    if (TMUX_AVAILABLE) {
      await setupTestTmux()
    }
  })

  afterAll(async () => {
    if (TMUX_AVAILABLE) {
      await teardownTestTmux()
    }
  })

  test("executor healthcheck", async () => {
    const executor = new TmuxExecutor({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
    })

    // Should not throw
    await executor.healthcheck()
    expect(true).toBe(true) // If we get here, healthcheck passed
  })

  test("executor basic execution", async () => {
    const executor = new TmuxExecutor({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
    })

    let chunks = ""
    const { output } = executor.run({
      cmd: "echo 'executor test'",
      cwd: projectRoot,
      chatId: "test-exec",
      timeoutMs: 5000,
      onStdout: (chunk) => {
        chunks += chunk
      },
    })

    const result = await output
    expect(result.exitCode).toBe(0)
    expect(chunks).toContain("executor test")
  })

  test("executor captures exit codes", async () => {
    const executor = new TmuxExecutor({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
    })

    const { output } = executor.run({
      cmd: "bash -c 'exit 5'",
      cwd: projectRoot,
      chatId: "test-exit",
      timeoutMs: 5000,
    })

    const result = await output
    expect(result.exitCode).toBe(5)
  })

  test("executor streams output in chunks", async () => {
    const executor = new TmuxExecutor({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
    })

    const chunks: string[] = []
    const { output } = executor.run({
      cmd: "for i in 1 2 3; do echo line$i; sleep 0.2; done",
      cwd: projectRoot,
      chatId: "test-stream",
      timeoutMs: 5000,
      onStdout: (chunk) => {
        chunks.push(chunk)
      },
    })

    await output
    
    // Should have received at least one chunk (may be multiple if timing allows)
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    
    // Combined output should contain all lines
    const combined = chunks.join("")
    expect(combined).toContain("line1")
    expect(combined).toContain("line2")
    expect(combined).toContain("line3")
  })

  test("executor cancellation", async () => {
    const executor = new TmuxExecutor({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
    })

    const { output, cancel } = executor.run({
      cmd: "sleep 30",
      cwd: projectRoot,
      chatId: "test-cancel",
      timeoutMs: 30000,
    })

    // Cancel after a short delay
    setTimeout(() => cancel(), 500)

    await expect(output).rejects.toThrow()
  })

  test("executor onReady callback", async () => {
    const executor = new TmuxExecutor({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
    })

    let readyInfo: any = null
    const { output } = executor.run({
      cmd: "echo 'ready test'",
      cwd: projectRoot,
      chatId: "test-ready",
      timeoutMs: 5000,
      onReady: (info) => {
        readyInfo = info
      },
    })

    await output

    expect(readyInfo).not.toBeNull()
    expect(readyInfo.transport).toBe("tmux")
    expect(readyInfo.session).toBe(TEST_TMUX_SESSION)
    expect(readyInfo.windowName).toContain("cs:")
    expect(readyInfo.paneId).toBeTruthy()
    expect(readyInfo.jobId).toBeTruthy()
  })

  test("executor onExit callback", async () => {
    const executor = new TmuxExecutor({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
    })

    let exitCode: number | null = null
    const { output } = executor.run({
      cmd: "bash -c 'exit 7'",
      cwd: projectRoot,
      chatId: "test-on-exit",
      timeoutMs: 5000,
      onExit: (code) => {
        exitCode = code
      },
    })

    await output

    expect(exitCode).not.toBeNull()
    expect(Number(exitCode)).toEqual(7)
  })
})

describe("exec.tmux-service", () => {
  if (!TMUX_AVAILABLE) {
    test.skip("tmux not available - skipping service tests", () => {})
    return
  }

  beforeAll(async () => {
    if (TMUX_AVAILABLE) {
      await setupTestTmux()
    }
  })

  afterAll(async () => {
    if (TMUX_AVAILABLE) {
      await teardownTestTmux()
    }
  })

  test("shortId generates valid identifiers", async () => {
    const { TmuxService } = await import("../../src/exec/tmux-service")
    
    expect(TmuxService.shortId("abc-123-def")).toBe("abc123")
    expect(TmuxService.shortId("test@#$%")).toBe("test")
    expect(TmuxService.shortId("")).toBe("chat")
  })

  test("windowNameFor generates valid window names", async () => {
    const { TmuxService } = await import("../../src/exec/tmux-service")
    
    const name1 = TmuxService.windowNameFor("chat-abc-123")
    expect(name1).toMatch(/^cs:/)
    expect(name1.length).toBeLessThanOrEqual(10)
    
    const name2 = TmuxService.windowNameFor("different-chat")
    expect(name2).not.toBe(name1)
  })
})

// Mock tests for when tmux is not available
describe("tool.bash-tmux (mocked)", () => {
  test("tool definition exists", async () => {
    const tool = await BashTmuxTool.init()
    
    expect(tool).toBeDefined()
    expect(tool.description).toBeDefined()
    expect(tool.parameters).toBeDefined()
    expect(tool.execute).toBeDefined()
  })

  test("parameters schema validation", async () => {
    const tool = await BashTmuxTool.init()
    
    const validParams = {
      command: "echo test",
      description: "Test command",
    }
    
    expect(() => tool.parameters.parse(validParams)).not.toThrow()
    
    const withTimeout = {
      command: "echo test",
      timeout: 5000,
      description: "Test with timeout",
    }
    
    expect(() => tool.parameters.parse(withTimeout)).not.toThrow()
  })
})
