import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { createOpencodeClient } from "@opencode-ai/sdk"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import type { PluginContext } from "../../plugin/types"
import { createHashlineEditTool } from "./tools"
import { computeLineHash } from "./hash-computation"
import { clearFormatterCache } from "./formatter-trigger"

describe("hashline edit session location", () => {
  test.each([false, true])("resolves relative rename before writing with a formatter: %s", async (formatted) => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "omo-hashline-session-"))
    const source = join(directory, "source.txt")
    const target = `${basename(directory)}-renamed.txt`
    const formatterPath = join(directory, "format.mjs")
    writeFileSync(source, "original")
    writeFileSync(formatterPath, 'import { readFileSync, writeFileSync } from "node:fs"; const file = process.argv[2]; writeFileSync(file, readFileSync(file, "utf8").toUpperCase())')
    const metadata: Parameters<ToolContext["metadata"]>[0][] = []
    const context: ToolContext = {
      sessionID: "hashline-location", messageID: "message-location", agent: "sisyphus",
      directory, worktree: directory, abort: new AbortController().signal,
      metadata: (value) => { metadata.push(value) }, ask: async () => {},
    }
    const pluginContext: PluginContext = {
      directory, worktree: directory,
      project: { id: "location", worktree: directory, time: { created: 0 } },
      serverUrl: new URL("http://formatter.invalid"), $: Bun.$,
      experimental_workspace: { register: () => {} },
      client: createOpencodeClient({ baseUrl: "http://formatter.invalid", fetch: async () => Response.json({
        formatter: { fixture: { command: [process.execPath, formatterPath, "$FILE"], extensions: [".txt"] } },
      }) }),
    }
    const tool = createHashlineEditTool(formatted ? pluginContext : undefined)
    expect(directory).not.toBe(process.cwd())
    clearFormatterCache()
    try {
      // when
      const result = await tool.execute({ filePath: source, rename: target,
        edits: [{ op: "replace", pos: `1#${computeLineHash(1, "original")}`, lines: "changed" }],
      }, context)

      // then
      expect(readFileSync(join(directory, target), "utf8")).toBe(formatted ? "CHANGED" : "changed")
      expect(existsSync(source)).toBe(false)
      expect(result).toBe(`Moved ${source} to ${join(directory, target)}`)
      expect(metadata.at(-1)?.metadata?.filePath).toBe(join(directory, target))
    } finally {
      clearFormatterCache()
      rmSync(directory, { recursive: true, force: true })
      rmSync(join(process.cwd(), target), { force: true })
    }
  })

  test("creates, edits and deletes relative files in the session directory", async () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "omo-hashline-relative-"))
    const file = `${basename(directory)}.txt`
    const context: ToolContext = {
      sessionID: "hashline-relative", messageID: "message-relative", agent: "sisyphus",
      directory, worktree: directory, abort: new AbortController().signal,
      metadata: () => {}, ask: async () => {},
    }
    const tool = createHashlineEditTool()
    expect(directory).not.toBe(process.cwd())
    try {
      // when
      await tool.execute({ filePath: file, edits: [{ op: "append", lines: "first" }] }, context)
      await tool.execute({ filePath: file, edits: [{ op: "replace", pos: `1#${computeLineHash(1, "first")}`, lines: "second" }] }, context)

      // then
      expect(readFileSync(join(directory, file), "utf8")).toBe("second")
      expect(await tool.execute({ filePath: file, delete: true, edits: [] }, context)).toBe(`Successfully deleted ${join(directory, file)}`)
      expect(existsSync(join(directory, file))).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(join(process.cwd(), file), { force: true })
    }
  })
})
