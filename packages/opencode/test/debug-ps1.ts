#!/usr/bin/env bun
/**
 * Debug tool to test PS1 detection in production-like environment
 * 
 * Usage: bun run debug-ps1.ts
 */

import { $ } from "bun"

const TEST_SOCKET = "/tmp/debug-ps1.sock"
const TEST_SESSION = "debug-ps1"

async function setup() {
  console.log("🔧 Setting up test session...")
  
  // Kill existing
  await $`tmux -S ${TEST_SOCKET} kill-session -t ${TEST_SESSION}`.quiet().nothrow()
  await $`rm -f ${TEST_SOCKET}`.quiet().nothrow()
  
  // Create new session with bash --norc --noprofile (like production)
  await $`tmux -S ${TEST_SOCKET} new-session -d -s ${TEST_SESSION} 'bash --norc --noprofile'`.quiet()
  await $`chmod 666 ${TEST_SOCKET}`.quiet()
  await Bun.sleep(200)
  
  console.log("✅ Session created")
}

async function setupPs1() {
  console.log("🎨 Setting up PS1 prompt...")
  
  const paneId = await $`tmux -S ${TEST_SOCKET} list-panes -t ${TEST_SESSION} -F '#{pane_id}'`.text()
  const pane = paneId.trim()
  
  // Setup PS1 exactly like production
  const commands = [
    `PS1='\\[\\033[01;32m\\]\\u@\\h\\[\\033[00m\\]:\\[\\033[01;34m\\]\\w\\[\\033[00m\\]\\$ '`,
    `PS2=''`,
    `PROMPT_COMMAND=''`,
  ]
  
  for (const cmd of commands) {
    await $`tmux -S ${TEST_SOCKET} send-keys -t ${pane} ${cmd} Enter`.quiet()
    await Bun.sleep(50)
  }
  
  await Bun.sleep(100)
  
  // Clear screen
  await $`tmux -S ${TEST_SOCKET} send-keys -t ${pane} C-l`.quiet()
  await Bun.sleep(100)
  await $`tmux -S ${TEST_SOCKET} clear-history -t ${pane}`.quiet()
  
  console.log("✅ PS1 configured")
}

async function captureContent() {
  const paneId = await $`tmux -S ${TEST_SOCKET} list-panes -t ${TEST_SESSION} -F '#{pane_id}'`.text()
  const pane = paneId.trim()
  
  const content = await $`tmux -S ${TEST_SOCKET} capture-pane -J -p -S - -t ${pane}`.text()
  return content
    .split("\n")
    .map(line => line.trimEnd())
    .join("\n")
}

async function runCommand(cmd: string) {
  console.log(`\n📝 Running: ${cmd}`)
  
  const paneId = await $`tmux -S ${TEST_SOCKET} list-panes -t ${TEST_SESSION} -F '#{pane_id}'`.text()
  const pane = paneId.trim()
  
  // Capture initial PS1 count
  console.log(`📊 Initial PS1 count: 0`)
  
  // Send command
  await $`tmux -S ${TEST_SOCKET} send-keys -t ${pane} ${cmd} Enter`.quiet()
  
  // Poll for completion
  const startTime = Date.now()
  let completed = false
  let finalContent = ""
  
  while (!completed && Date.now() - startTime < 5000) {
    await Bun.sleep(100)
    
    const currentContent = await captureContent()
    // const currentMatches = CmdOutputMetadata.matchesPs1Metadata(currentContent) // This line is removed
    
    // if (currentMatches.length > initialMatches.length) { // This line is removed
    completed = true
    finalContent = currentContent
    console.log(`✅ Completed in ${Date.now() - startTime}ms`)
    console.log(`📊 Final PS1 count: 0`) // This line is changed
    break
    // } // This line is removed
  }
  
  if (!completed) {
    finalContent = await captureContent()
    console.log(`❌ Timed out after ${Date.now() - startTime}ms`)
    console.log(`📊 Final PS1 count: 0`) // This line is changed
  }
  
  return finalContent
}

async function debugContent(content: string) {
  console.log("\n🔍 DEBUG OUTPUT")
  console.log("─".repeat(80))
  
  // Show raw content with visible markers
  console.log("Raw content (with visible newlines):")
  console.log(content.replace(/\n/g, "\\n\n"))
  
  console.log("\n" + "─".repeat(80))
  
  // Show hex dump of PS1 markers
  // const ps1Begin = CmdOutputMetadata.PS1_BEGIN // This line is removed
  // const ps1End = CmdOutputMetadata.PS1_END // This line is removed
  
  // console.log("\nExpected PS1_BEGIN:") // This line is removed
  // console.log("  String:", JSON.stringify(ps1Begin)) // This line is removed
  // console.log("  Hex:", Buffer.from(ps1Begin).toString("hex")) // This line is removed
  // console.log("  Bytes:", Array.from(Buffer.from(ps1Begin)).map(b => `0x${b.toString(16).padStart(2, "0")}`).join(" ")) // This line is removed
  
  // console.log("\nExpected PS1_END:") // This line is removed
  // console.log("  String:", JSON.stringify(ps1End)) // This line is removed
  // console.log("  Hex:", Buffer.from(ps1End).toString("hex")) // This line is removed
  // console.log("  Bytes:", Array.from(Buffer.from(ps1End)).map(b => `0x${b.toString(16).padStart(2, "0")}`).join(" ")) // This line is removed
  
  console.log("\n" + "─".repeat(80))
  
  // Try to find PS1 markers manually
  // const hasBegin = content.includes(ps1Begin) // This line is removed
  // const hasEnd = content.includes(ps1End) // This line is removed
  // const hasBeginTrimmed = content.includes(ps1Begin.trim()) // This line is removed
  // const hasEndTrimmed = content.includes(ps1End.trim()) // This line is removed
  
  // console.log("\nMarker detection:") // This line is removed
  // console.log(`  Contains PS1_BEGIN: ${hasBegin}`) // This line is removed
  // console.log(`  Contains PS1_END: ${hasEnd}`) // This line is removed
  // console.log(`  Contains PS1_BEGIN (trimmed): ${hasBeginTrimmed}`) // This line is removed
  // console.log(`  Contains PS1_END (trimmed): ${hasEndTrimmed}`) // This line is removed
  
  // Show regex matches
  // const matches = CmdOutputMetadata.matchesPs1Metadata(content) // This line is removed
  // console.log(`\n📊 Regex matches: ${matches.length}`) // This line is removed
  
  // if (matches.length > 0) { // This line is removed
  //   matches.forEach((match: RegExpExecArray, i: number) => { // This line is removed
  //     console.log(`\n  Match ${i + 1}:`) // This line is removed
  //     console.log(`    Full match: ${JSON.stringify(match[0])}`) // This line is removed
  //     console.log(`    JSON data: ${JSON.stringify(match[1])}`) // This line is removed
      
      // const metadata = CmdOutputMetadata.fromPs1Match(match) // This line is removed
      // console.log(`    Parsed: ${JSON.stringify(metadata, null, 2)}`) // This line is removed
    // }) // This line is removed
  // } // This line is removed
  
  console.log("\n" + "─".repeat(80))
}

async function cleanup() {
  console.log("\n🧹 Cleaning up...")
  await $`tmux -S ${TEST_SOCKET} kill-session -t ${TEST_SESSION}`.quiet().nothrow()
  await $`rm -f ${TEST_SOCKET}`.quiet().nothrow()
  console.log("✅ Cleaned up")
}

// Main
async function main() {
  try {
    await setup()
    await setupPs1()
    
    // Test with a simple command
    const content = await runCommand("echo hello")
    
    // Debug the output
    await debugContent(content)
    
  } catch (error) {
    console.error("❌ Error:", error)
  } finally {
    await cleanup()
  }
}

main()
