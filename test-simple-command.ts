import { TmuxExecutor } from "./packages/opencode/src/exec/tmux-executor"
import { Log } from "./packages/opencode/src/util/log"

Log.init({ print: true, level: "debug" })

const socket = "/tmp/opencode-test.sock"
const session = "opencode-test"

const executor = new TmuxExecutor({ socket, session })

console.log("\n=== Running simple echo command ===\n")

const { output } = executor.run({
  cmd: "echo 'hello'",
  cwd: process.cwd(),
  chatId: "test-simple",
  timeoutMs: 3000,
  onStdout: (chunk) => console.log("OUTPUT:", JSON.stringify(chunk)),
  onExit: (code) => console.log("EXIT CODE:", code),
})

try {
  const result = await output
  console.log("\n=== SUCCESS ===")
  console.log(result)
} catch (error) {
  console.log("\n=== ERROR ===")
  console.error(error)
}

process.exit(0)
