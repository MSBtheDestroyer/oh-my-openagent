import { describe, expect, test } from "bun:test"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createSkillTool } from "./tools"

describe("skill tool session location", () => {
  test("uses the session directory for pathless skills and command discovery", async () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "omo-skill-session-"))
    mkdirSync(join(directory, ".claude", "commands"), { recursive: true })
    writeFileSync(join(directory, ".claude", "commands", "session-command.md"), "---\ndescription: location\n---\n!`" + JSON.stringify(process.execPath) + " probe.mjs`")
    writeFileSync(join(directory, "probe.mjs"), 'import { readFileSync } from "node:fs"; process.stdout.write(readFileSync("marker", "utf8"))')
    writeFileSync(join(directory, "marker"), "session-command-result")
    const context: ToolContext = {
      sessionID: "skill-location", messageID: "message-location", agent: "sisyphus",
      directory, worktree: directory, abort: new AbortController().signal,
      metadata: () => {}, ask: async () => {},
    }
    const tool = createSkillTool({
      directory, pluginsEnabled: false,
      skills: [{ name: "pathless", scope: "user", definition: { name: "pathless", description: "location", template: "skill body" } }],
    })
    expect(directory).not.toBe(process.cwd())
    try {
      // when
      const skill = await tool.execute({ name: "pathless" }, context)
      const command = await tool.execute({ name: "session-command" }, context)

      // then
      expect(skill).toContain(`**Base directory**: ${directory}`)
      expect(command).toContain("session-command-result")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
