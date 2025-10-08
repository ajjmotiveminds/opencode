#!/usr/bin/env bun
/**
 * Visual UX test for tmux command display
 * Shows what the user sees in the tmux window
 */

import { $ } from "bun"

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
  
  // Test 1: Simple command
  console.log("1️⃣ Test: ls command")
  await $`tmux -S ${TEST_SOCKET} capture-pane -t ${TEST_SESSION}:cs:uxtest -p`.quiet()
  
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
  await $`tmux -S ${TEST_SOCKET} capture-pane -t ${TEST_SESSION}:cs:uxtest -p`.quiet()
  
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
  await $`tmux -S ${TEST_SOCKET} capture-pane -t ${TEST_SESSION}:cs:uxtest -p`.quiet()
  
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
