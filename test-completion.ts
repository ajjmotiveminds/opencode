#!/usr/bin/env bun

import { TmuxExecutor } from "./packages/opencode/src/exec/tmux-executor"
import { Log } from "./packages/opencode/src/util/log"

Log.init({ print: true })

const TEST_TMUX_SOCKET = "/tmp/opencode-test.sock"
const TEST_TMUX_SESSION = "opencode-test"

const executor = new TmuxExecutor({
  socket: TEST_TMUX_SOCKET,
  session: TEST_TMUX_SESSION,
})

console.log("Testing quick command completion...")

const start = Date.now()
const { output } = executor.run({
  cmd: "echo 'fast command'",
  cwd: process.cwd(),
  chatId: "speed-test",
  timeoutMs: 5000,
  onStdout: (chunk) => {
    console.log(`[${Date.now() - start}ms] STDOUT:`, chunk)
  },
  onExit: (code) => {
    console.log(`[${Date.now() - start}ms] EXIT CODE:`, code)
  },
  onReady: () => {
    console.log(`[${Date.now() - start}ms] READY`)
  },
})

try {
  const result = await output
  const elapsed = Date.now() - start
  console.log(`\n✓ Command completed in ${elapsed}ms`)
  console.log("Result:", result)
  
  if (elapsed > 2000) {
    console.log("\n⚠️  WARNING: Command took longer than expected!")
    console.log("This suggests completion detection may not be working properly.")
  } else {
    console.log("\n✓ Completion detection is working correctly!")
  }
} catch (error) {
  console.error("ERROR:", error)
}

process.exit(0)
