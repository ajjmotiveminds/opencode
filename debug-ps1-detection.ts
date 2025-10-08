import { CmdOutputMetadata } from "./packages/opencode/src/exec/tmux-metadata"
import { $ } from "bun"

const socket = "/tmp/opencode-test.sock"
const session = "opencode-test"

// Kill and recreate session
await $`tmux -S ${socket} kill-session -t ${session}`.quiet().nothrow()
await $`tmux -S ${socket} new-session -d -s ${session} 'bash --norc --noprofile'`.quiet()
await $`chmod 666 ${socket}`.quiet()
await Bun.sleep(500)

const paneId = "%0"

// Setup PS1
const ps1 = CmdOutputMetadata.toPs1Prompt()
console.log("PS1 Template:", ps1)

await $`tmux -S ${socket} send-keys -t ${paneId} "PS1='${ps1}'" Enter`.quiet()
await Bun.sleep(100)
await $`tmux -S ${socket} send-keys -t ${paneId} C-l`.quiet()
await Bun.sleep(100)
await $`tmux -S ${socket} clear-history -t ${paneId}`.quiet()
await Bun.sleep(100)

// Capture after setup
const afterSetup = await $`tmux -S ${socket} capture-pane -p -S - -t ${paneId}`.text()
console.log("\n=== AFTER SETUP ===")
console.log(afterSetup)
console.log("=== END ===\n")

const initialMatches = CmdOutputMetadata.matchesPs1Metadata(afterSetup)
console.log("Initial PS1 count:", initialMatches.length)

// Send a command
await $`tmux -S ${socket} send-keys -t ${paneId} "echo 'test'" Enter`.quiet()
await Bun.sleep(500)

// Capture after command
const afterCommand = await $`tmux -S ${socket} capture-pane -p -S - -t ${paneId}`.text()
console.log("\n=== AFTER COMMAND ===")
console.log(afterCommand)
console.log("=== END ===\n")

const afterMatches = CmdOutputMetadata.matchesPs1Metadata(afterCommand)
console.log("After command PS1 count:", afterMatches.length)

if (afterMatches.length > 0) {
  console.log("\nLast match metadata:")
  console.log(CmdOutputMetadata.fromPs1Match(afterMatches[afterMatches.length - 1]))
}

process.exit(0)
