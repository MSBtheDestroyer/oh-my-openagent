import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolveCommandsInText } from "./resolve-commands-in-text"

describe("embedded command location", () => {
  test("keeps the session cwd through recursive command expansion", async () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "omo-command-session-"))
    const command = `${JSON.stringify(process.execPath)} value.mjs`
    writeFileSync(join(directory, "marker"), "session-value")
    writeFileSync(join(directory, "value.mjs"), 'import { readFileSync } from "node:fs"; process.stdout.write(readFileSync("marker", "utf8"))')
    writeFileSync(join(directory, "next-command"), `!\`${command}\``)
    writeFileSync(join(directory, "emit.mjs"), 'import { readFileSync } from "node:fs"; process.stdout.write(readFileSync("next-command", "utf8"))')
    expect(directory).not.toBe(process.cwd())
    try {
      // when
      const output = await resolveCommandsInText(`!\`${JSON.stringify(process.execPath)} emit.mjs\``, 0, 3, directory)

      // then
      expect(output).toBe("session-value")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
