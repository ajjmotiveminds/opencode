import { TmuxExecutor } from "./packages/opencode/src/exec/tmux-executor"
import { Log } from "./packages/opencode/src/util/log"

Log.init({ print: true })

const TEST_TMUX_SOCKET = "/tmp/opencode-test.sock"
const TEST_TMUX_SESSION = "opencode-test"

const executor = new TmuxExecutor({
  socket: TEST_TMUX_SOCKET,
  session: TEST_TMUX_SESSION,
})

console.log("Testing PS1 detection...")

const { output } = executor.run({
  cmd: "echo 'test' && echo 'done'",
  cwd: process.cwd(),
  chatId: "debug-ps1",
  timeoutMs: 3000,
  onStdout: (chunk) => {
    console.log("CHUNK:", JSON.stringify(chunk))
  },
  onExit: (code) => {
    console.log("EXIT CODE:", code)
  },
})

try {
  const result = await output
  console.log("SUCCESS:", result)
} catch (error) {
  console.error("ERROR:", error)
}

process.exit(0)
