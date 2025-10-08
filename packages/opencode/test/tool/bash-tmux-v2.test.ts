/**
 * Tests for BashTmuxToolV2 with OSC-133 shell integration
 * 
 * Note: These tests require a running tmux session.
 */

import { describe, expect, test, beforeAll, afterAll, mock } from "bun:test"
import path from "path"
import { BashTmuxToolV2 } from "../../src/tool/bash-tmux-v2"
import { Log } from "../../src/util/log"
import { Instance } from "../../src/project/instance"
import { TmuxExecutorV2 } from "../../src/exec/tmux-executor-v2"
import { TmuxServiceV2 } from "../../src/exec/tmux-service-v2"
import { parseLastCommandViaOSC133, clearShellIntegrationState } from "../../src/exec/shell-integration"
import { $ } from "bun"

const ctx = {
  sessionID: "test-session-v2",
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
const TEST_TMUX_SOCKET = "/tmp/opencode-test-v2.sock"
const TEST_TMUX_SESSION = "opencode-test-v2"

async function setupTestTmux() {
  if (!TMUX_AVAILABLE) return

  try {
    // Clean up any existing test session
    await $`tmux -S ${TEST_TMUX_SOCKET} kill-session -t ${TEST_TMUX_SESSION}`.quiet().nothrow()
  } catch {}

  try {
    // Create test session
    await $`tmux -S ${TEST_TMUX_SOCKET} new-session -d -s ${TEST_TMUX_SESSION} 'bash'`.quiet()
    await $`chmod 666 ${TEST_TMUX_SOCKET}`.quiet()
    
    // Give tmux a moment to initialize
    await Bun.sleep(200)
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
  
  // Clear shell integration state
  clearShellIntegrationState()
}

describe("tool.bash-tmux-v2", () => {
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
    process.env["TMUX_SHELL_TYPE"] = "bash"

    const tool = await BashTmuxToolV2.init()

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await tool.execute(
          {
            command: "echo 'tmux v2 test'",
            description: "Echo test message in tmux v2",
          },
          ctx,
        )

        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("tmux v2 test")
      },
    })
  }, 10000)

  test("command with exit code", async () => {
    process.env["TMUX_SOCKET"] = TEST_TMUX_SOCKET
    process.env["TMUX_SESSION"] = TEST_TMUX_SESSION
    process.env["TMUX_SHELL_TYPE"] = "bash"

    const tool = await BashTmuxToolV2.init()

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
  }, 10000)

  test("multi-line output", async () => {
    process.env["TMUX_SOCKET"] = TEST_TMUX_SOCKET
    process.env["TMUX_SESSION"] = TEST_TMUX_SESSION
    process.env["TMUX_SHELL_TYPE"] = "bash"

    const tool = await BashTmuxToolV2.init()

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
  }, 10000)

  test("metadata streaming", async () => {
    process.env["TMUX_SOCKET"] = TEST_TMUX_SOCKET
    process.env["TMUX_SESSION"] = TEST_TMUX_SESSION
    process.env["TMUX_SHELL_TYPE"] = "bash"

    const tool = await BashTmuxToolV2.init()
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
  }, 10000)

  test("timeout handling", async () => {
    process.env["TMUX_SOCKET"] = TEST_TMUX_SOCKET
    process.env["TMUX_SESSION"] = TEST_TMUX_SESSION
    process.env["TMUX_SHELL_TYPE"] = "bash"

    const tool = await BashTmuxToolV2.init()

    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const result = await tool.execute(
          {
            command: "sleep 10",
            timeout: 1000, // 1 second timeout
            description: "Test timeout",
          },
          ctx,
        )
        
        // Should complete with timeout message rather than throwing
        expect(result.metadata.exit).toBe(-1)
        expect(result.metadata.output).toContain("timed out")
      },
    })
  }, 15000)
})

describe("exec.tmux-executor-v2", () => {
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
    const executor = new TmuxExecutorV2({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
      shellType: "bash",
    })

    // Should not throw
    await executor.healthcheck()
    expect(true).toBe(true)
  }, 5000)

  test("executor basic execution", async () => {
    const executor = new TmuxExecutorV2({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
      shellType: "bash",
    })

    let chunks = ""
    const { output } = executor.run({
      cmd: "echo 'executor v2 test'",
      cwd: projectRoot,
      chatId: "test-exec-v2",
      timeoutMs: 5000,
      onStdout: (chunk) => {
        chunks += chunk
      },
    })

    const result = await output
    expect(result.exitCode).toBe(0)
    expect(result.combined).toContain("executor v2 test")
  }, 10000)

  test("executor captures exit codes", async () => {
    const executor = new TmuxExecutorV2({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
      shellType: "bash",
    })

    const { output } = executor.run({
      cmd: "bash -c 'exit 5'",
      cwd: projectRoot,
      chatId: "test-exit-v2",
      timeoutMs: 5000,
    })

    const result = await output
    expect(result.exitCode).toBe(5)
  }, 10000)

  test("executor streams output", async () => {
    const executor = new TmuxExecutorV2({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
      shellType: "bash",
    })

    const chunks: string[] = []
    const { output } = executor.run({
      cmd: "for i in 1 2 3; do echo line$i; sleep 0.3; done",
      cwd: projectRoot,
      chatId: "test-stream-v2",
      timeoutMs: 5000,
      onStdout: (chunk) => {
        chunks.push(chunk)
      },
    })

    const result = await output
    
    // Should have received output
    const combined = result.combined
    expect(combined).toContain("line1")
    expect(combined).toContain("line2")
    expect(combined).toContain("line3")
  }, 10000)

  test("executor cancellation", async () => {
    const executor = new TmuxExecutorV2({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
      shellType: "bash",
    })

    const { output, cancel } = executor.run({
      cmd: "sleep 30",
      cwd: projectRoot,
      chatId: "test-cancel-v2",
      timeoutMs: 30000,
    })

    // Cancel after a short delay
    setTimeout(() => cancel(), 500)

    await expect(output).rejects.toThrow()
  }, 5000)

  test("executor onReady callback", async () => {
    const executor = new TmuxExecutorV2({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
      shellType: "bash",
    })

    let readyInfo: any = null
    const { output } = executor.run({
      cmd: "echo 'ready test'",
      cwd: projectRoot,
      chatId: "test-ready-v2",
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
  }, 10000)

  test("executor onExit callback", async () => {
    const executor = new TmuxExecutorV2({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
      shellType: "bash",
    })

    let exitCode: number | null = null
    const { output } = executor.run({
      cmd: "bash -c 'exit 7'",
      cwd: projectRoot,
      chatId: "test-on-exit-v2",
      timeoutMs: 5000,
      onExit: (code) => {
        exitCode = code
      },
    })

    await output

    expect(exitCode).not.toBeNull()
    expect(Number(exitCode)).toEqual(7)
  }, 10000)
})

describe("exec.tmux-service-v2", () => {
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

  test("list sessions", async () => {
    const service = new TmuxServiceV2({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
    })

    const sessions = await service.listSessions()
    expect(sessions.length).toBeGreaterThan(0)
    expect(sessions.some((s) => s.name === TEST_TMUX_SESSION)).toBe(true)
  })

  test("find session by name", async () => {
    const service = new TmuxServiceV2({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
    })

    const session = await service.findSessionByName(TEST_TMUX_SESSION)
    expect(session).not.toBeNull()
    expect(session?.name).toBe(TEST_TMUX_SESSION)
  })

  test("ensure window", async () => {
    const service = new TmuxServiceV2({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
    })

    const windowId = await service.ensureWindow(TEST_TMUX_SESSION, "test-window")
    expect(windowId).toBeTruthy()

    // Calling again should return same window
    const windowId2 = await service.ensureWindow(TEST_TMUX_SESSION, "test-window")
    expect(windowId2).toBe(windowId)
  })

  test("list windows", async () => {
    const service = new TmuxServiceV2({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
    })

    const sessions = await service.listSessions()
    const testSession = sessions.find((s) => s.name === TEST_TMUX_SESSION)
    expect(testSession).toBeDefined()

    const windows = await service.listWindows(testSession!.id)
    expect(windows.length).toBeGreaterThan(0)
  })

  test("capture pane content", async () => {
    const service = new TmuxServiceV2({
      socket: TEST_TMUX_SOCKET,
      session: TEST_TMUX_SESSION,
    })

    const windowId = await service.ensureWindow(TEST_TMUX_SESSION, "capture-test")
    const paneId = await service.getPaneId(TEST_TMUX_SESSION, "capture-test")

    // Send a command to create some content
    await service.executeCommand(paneId, "echo 'capture test'", false, false)
    await Bun.sleep(1000)

    const content = await service.capturePaneContent(paneId, 100, false)
    expect(content).toBeTruthy()
  })

  test("shortId generates valid identifiers", () => {
    expect(TmuxServiceV2.shortId("abc-123-def")).toBe("abc123")
    expect(TmuxServiceV2.shortId("test@#$%")).toBe("test")
    expect(TmuxServiceV2.shortId("")).toBe("chat")
  })

  test("windowNameFor generates valid window names", () => {
    const name1 = TmuxServiceV2.windowNameFor("chat-abc-123")
    expect(name1).toMatch(/^cs:/)
    expect(name1.length).toBeLessThanOrEqual(10)
    
    const name2 = TmuxServiceV2.windowNameFor("different-chat")
    expect(name2).not.toBe(name1)
  })
})

describe("shell-integration", () => {
  test("parseLastCommandViaOSC133 finds command with markers", () => {
    const buffer = `
      $ echo test
      \x1b]133;B\x07
      test
      \x1b]133;C;0\x07
      \x1b]133;D\x07
      $ 
    `

    const result = parseLastCommandViaOSC133(buffer)
    expect(result.found).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.output).toBe("test")
  })

  test("parseLastCommandViaOSC133 returns not found for incomplete markers", () => {
    const buffer = `
      $ echo test
      \x1b]133;B\x07
      test
    `

    const result = parseLastCommandViaOSC133(buffer)
    expect(result.found).toBe(false)
  })

  test("parseLastCommandViaOSC133 captures exit code", () => {
    const buffer = `
      $ false
      \x1b]133;B\x07
      \x1b]133;C;1\x07
      \x1b]133;D\x07
      $ 
    `

    const result = parseLastCommandViaOSC133(buffer)
    expect(result.found).toBe(true)
    expect(result.exitCode).toBe(1)
    expect(result.output).toBe("")
  })

  test("parseLastCommandViaOSC133 finds last command when multiple present", () => {
    const buffer = `
      $ echo first
      \x1b]133;B\x07
      first
      \x1b]133;C;0\x07
      \x1b]133;D\x07
      $ echo second
      \x1b]133;B\x07
      second
      \x1b]133;C;0\x07
      \x1b]133;D\x07
      $ 
    `

    const result = parseLastCommandViaOSC133(buffer)
    expect(result.found).toBe(true)
    expect(result.exitCode).toBe(0)
    expect(result.output).toBe("second")
  })
})

// Mock tests for when tmux is not available
describe("tool.bash-tmux-v2 (mocked)", () => {
  test("tool definition exists", async () => {
    const tool = await BashTmuxToolV2.init()
    
    expect(tool).toBeDefined()
    expect(tool.description).toBeDefined()
    expect(tool.parameters).toBeDefined()
    expect(tool.execute).toBeDefined()
  })

  test("parameters schema validation", async () => {
    const tool = await BashTmuxToolV2.init()
    
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

