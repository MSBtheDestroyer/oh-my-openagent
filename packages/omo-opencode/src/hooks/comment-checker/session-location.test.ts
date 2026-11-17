import { describe, expect, test } from "bun:test"
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCommentCheckerHooks } from "./hook"
import { processApplyPatchEditsWithCli, processWithCli } from "./cli-runner"

describe("comment checker session location", () => {
  test.each(["edit", "apply_patch"])("runs %s checks with matching hook and subprocess cwd", async (tool) => {
    // given
    const directory = realpathSync(mkdtempSync(join(tmpdir(), "omo-comment-session-")))
    const scriptPath = join(directory, "checker.mjs")
    writeFileSync(join(directory, "session-marker"), "session-content")
    writeFileSync(scriptPath, `#!${process.execPath}
import { readFileSync } from "node:fs"
const input = JSON.parse(readFileSync(0, "utf8"))
process.stderr.write(JSON.stringify({ cwd: process.cwd(), hookCwd: input.cwd, marker: readFileSync("session-marker", "utf8") }))
process.exitCode = 2
`, { mode: 0o755 })
    const binaryPath = process.platform === "win32" ? join(directory, "checker.cmd") : scriptPath
    if (process.platform === "win32") writeFileSync(binaryPath, `@"${process.execPath}" "${scriptPath}" %*\r\n`)
    const hooks = createCommentCheckerHooks(undefined, {
      initializeCommentCheckerCli: () => {},
      getCommentCheckerCliPathPromise: async () => binaryPath,
      isCliPathUsable: (path): path is string => typeof path === "string",
      processWithCli,
      processApplyPatchEditsWithCli,
    }, directory)
    const input = { tool, sessionID: crypto.randomUUID(), callID: crypto.randomUUID() }
    const output = { title: "ok", output: "", metadata: {
      files: [{ filePath: "file.ts", before: "const a = 1", after: "// new comment\nconst a = 1", type: "update" }],
    } }
    expect(directory).not.toBe(process.cwd())
    try {
      // when
      await hooks["tool.execute.before"](input, {
        args: { filePath: "file.ts", oldString: "const a = 1", newString: "// new comment\nconst a = 1" },
      })
      await hooks["tool.execute.after"](input, output)

      // then
      expect(JSON.parse(output.output.trim())).toEqual({ cwd: directory, hookCwd: directory, marker: "session-content" })
    } finally {
      hooks.dispose()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
