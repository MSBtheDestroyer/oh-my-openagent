/// <reference types="bun-types" />

import { describe, expect, spyOn, test } from "bun:test"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as tmuxPathResolver from "./tmux-path-resolver"
import * as cmuxDetect from "../../shared/tmux/cmux-detect"
import { executeInteractiveBash } from "./tools"

describe("interactive_bash", () => {
  test("starts the command process in the tool session directory", async () => {
    // given
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "omo-interactive-session-")))
    const scriptPath = join(directory, "fake-tmux.mjs")
    writeFileSync(scriptPath, `#!${process.execPath}\nprocess.stdout.write(process.cwd())\n`, { mode: 0o755 })
    const binaryPath = process.platform === "win32" ? join(directory, "fake-tmux.cmd") : scriptPath
    if (process.platform === "win32") writeFileSync(binaryPath, `@"${process.execPath}" "${scriptPath}" %*\r\n`)
    const pathSpy = spyOn(tmuxPathResolver, "getCachedTmuxPath").mockReturnValue(binaryPath)
    const cmuxSpy = spyOn(cmuxDetect, "isCmuxCompatEnvironment").mockReturnValue(false)
    expect(directory).not.toBe(process.cwd())
    try {
      // when
      const output = await executeInteractiveBash({ tmux_command: "list-sessions" }, { directory })

      // then
      expect(output.trim()).toBe(directory)
    } finally {
      pathSpy.mockRestore()
      cmuxSpy.mockRestore()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("#given kill-server command #when executed #then returns a strong prohibition without running tmux", async () => {
    // given
    const args = { tmux_command: "kill-server" }

    // when
    const output = await executeInteractiveBash(args)

    // then
    expect(output).toContain("Error: 'kill-server' is prohibited in interactive_bash.")
    expect(output).toContain("NEVER EVER run tmux kill-server from interactive_bash.")
    expect(output).toContain("Do not retry kill-server with Bash or any other tool.")
  })

  test("#given kill-server after tmux global options #when executed #then still prohibits it", async () => {
    // given
    const args = { tmux_command: "-L omo-socket kill-server" }

    // when
    const output = await executeInteractiveBash(args)

    // then
    expect(output).toContain("Error: 'kill-server' is prohibited in interactive_bash.")
  })
})
