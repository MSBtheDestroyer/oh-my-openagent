import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { createTaskCreateTool } from "./task-create"
import { createTaskGetTool } from "./task-get"
import { createTaskList } from "./task-list"
import { createTaskUpdateTool } from "./task-update"

describe("task tools by session location", () => {
  test("creates, reads, updates and lists tasks in session-relative storage", async () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "omo-task-tools-session-"))
    const config = { sisyphus: { tasks: { storage_path: basename(directory), claude_code_compat: false } } }
    const context: ToolContext = {
      sessionID: "session-location", messageID: "message-location", agent: "sisyphus",
      directory, worktree: directory, abort: new AbortController().signal,
      metadata: () => {}, ask: async () => {},
    }
    expect(directory).not.toBe(process.cwd())
    try {
      // when
      const createdOutput = await createTaskCreateTool(config).execute({ subject: "session task" }, context)
      if (typeof createdOutput !== "string") throw new Error("Expected task JSON")
      const created = JSON.parse(createdOutput)
      const id: string = created.task.id
      const updated = await createTaskUpdateTool(config).execute({ id, subject: "updated task" }, context)
      const fetched = await createTaskGetTool(config).execute({ id }, context)
      const listed = await createTaskList(config).execute({}, context)

      // then
      const stored = JSON.parse(readFileSync(join(directory, basename(directory), `${id}.json`), "utf8"))
      expect(stored).toMatchObject({ id, subject: "updated task", threadID: "session-location" })
      for (const output of [updated, fetched, listed]) {
        expect(typeof output).toBe("string")
        expect(output).toContain("updated task")
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
      rmSync(join(process.cwd(), basename(directory)), { recursive: true, force: true })
    }
  })
})
