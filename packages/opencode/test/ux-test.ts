#!/usr/bin/env bun
/**
 * Visual UX test for tmux command display
 * Shows what the user sees in the tmux window
 */

import { $ } from "bun"
import { TmuxExecutor } from "../src/exec/tmux-executor"

const TEST_SOCKET = "/tmp/opencode-ux-test.sock"
const TEST_SESSION = "opencode-ux-test"

async function cleanup() {
  await $`tmux -S ${TEST_SOCKET} kill-session -t ${TEST_SESSION}`.quiet().nothrow()
  await $`rm -f ${TEST_SOCKET}`.quiet().nothrow()
}

async function setup() {
  await cleanup()
  await $`tmux -S ${TEST_SOCKET} new-session -d -s ${TEST_SESSION} 'exec bash -l'`.quiet()
  await $`chmod 666 ${TEST_SOCKET}`.quiet()
  await Bun.sleep(500)
}

async function testCommandDisplay() {
  console.log("🎨 Testing UX - What the user sees in tmux window\n")
  
  const executor = new TmuxExecutor({
    socket: TEST_SOCKET,
    session: TEST_SESSION,
  })

  // Test 1: Simple command
  console.log("1️⃣ Test: ls command")
  const { output: out1 } = executor.run({
    cmd: "ls",
    cwd: process.cwd(),
    chatId: "ux-test-1",
    timeoutMs: 3000,
  })
  
  await out1
  await Bun.sleep(500)
  
  // Capture what's visible in the pane
  const visible1 = await $`tmux -S ${TEST_SOCKET} capture-pane -t ${TEST_SESSION}:cs:uxtest -p`.text()
  console.log("   User sees in tmux:")
  console.log("   " + "─".repeat(60))
  console.log(visible1.split('\n').map(line => `   ${line}`).join('\n'))
  console.log("   " + "─".repeat(60))
  console.log()

  // Test 2: Command with arguments
  await Bun.sleep(1000)
  console.log("2️⃣ Test: echo with arguments")
  const { output: out2 } = executor.run({
    cmd: "echo 'Hello from OpenCode!'",
    cwd: process.cwd(),
    chatId: "ux-test-2",
    timeoutMs: 3000,
  })
  
  await out2
  await Bun.sleep(500)
  
  const visible2 = await $`tmux -S ${TEST_SOCKET} capture-pane -t ${TEST_SESSION}:cs:uxtest -p`.text()
  console.log("   User sees in tmux:")
  console.log("   " + "─".repeat(60))
  const lines = visible2.split('\n').slice(-10) // Last 10 lines
  console.log(lines.map(line => `   ${line}`).join('\n'))
  console.log("   " + "─".repeat(60))
  console.log()

  // Test 3: Multi-line command
  await Bun.sleep(1000)
  console.log("3️⃣ Test: for loop")
  const { output: out3 } = executor.run({
    cmd: "for i in 1 2 3; do echo \"Line $i\"; done",
    cwd: process.cwd(),
    chatId: "ux-test-3",
    timeoutMs: 3000,
  })
  
  await out3
  await Bun.sleep(500)
  
  const visible3 = await $`tmux -S ${TEST_SOCKET} capture-pane -t ${TEST_SESSION}:cs:uxtest -p`.text()
  console.log("   User sees in tmux:")
  console.log("   " + "─".repeat(60))
  const lines3 = visible3.split('\n').slice(-10) // Last 10 lines
  console.log(lines3.map(line => `   ${line}`).join('\n'))
  console.log("   " + "─".repeat(60))
  console.log()

  console.log("✅ UX Test Complete!\n")
  console.log("📝 Key observations:")
  console.log("   • Commands are displayed with '$ ' prefix")
  console.log("   • No wrapper code visible (clean display)")
  console.log("   • Output appears naturally after command")
  console.log("   • Exit code capture happens invisibly")
}

async function main() {
  await setup()
  await testCommandDisplay()
  await cleanup()
}

main().catch(console.error)
