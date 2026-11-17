import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { restoreEnvironment } from "../../../../../test-support/environment-integrity"
import { clearPluginComponentsCache, loadAllPluginComponents } from "./loader"

describe("plugin components by session location", () => {
  const directories: string[] = []
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.OPENCODE_DISABLE_CLAUDE_CODE
    delete process.env.OPENCODE_DISABLE_CLAUDE_CODE_PLUGINS
  })

  afterEach(() => {
    restoreEnvironment(originalEnv)
    clearPluginComponentsCache()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  test("discovers and caches project plugins and local MCPs separately from the engine cwd", async () => {
    // given
    const root = realpathSync(mkdtempSync(join(tmpdir(), "omo-plugin-location-")))
    directories.push(root)
    const first = join(root, "first")
    const second = join(root, "second")
    const plugins = Object.fromEntries([first, second].map((directory, index) => {
      const name = `session-${index}`
      const installPath = join(root, name)
      mkdirSync(directory)
      mkdirSync(join(installPath, "commands"), { recursive: true })
      writeFileSync(join(installPath, "commands", "run.md"), `---\ndescription: location\n---\n${name}`)
      writeFileSync(join(installPath, ".mcp.json"), JSON.stringify({
        mcpServers: {
          local: { command: name, scope: "local", projectPath: directory },
          other: { command: "wrong-project", scope: "local", projectPath: join(root, "absent") },
        },
      }))
      return [`${name}@test`, [{
        scope: "project", projectPath: directory, installPath, version: "1.0.0",
        installedAt: "2026-01-01T00:00:00Z", lastUpdated: "2026-01-01T00:00:00Z",
      }]]
    }))
    writeFileSync(join(root, "installed_plugins.json"), JSON.stringify({ version: 2, plugins }))
    clearPluginComponentsCache()
    const options = {
      pluginsHomeOverride: root,
      enabledPluginsOverride: { "session-0@test": true, "session-1@test": true },
    }
    expect(first).not.toBe(process.cwd())
    expect(second).not.toBe(process.cwd())

    // when
    const firstResult = await loadAllPluginComponents({ ...options, directory: first })
    const secondResult = await loadAllPluginComponents({ ...options, directory: second })
    const results = [firstResult, secondResult]
    const cachedFirst = await loadAllPluginComponents({ ...options, directory: first })

    // then
    for (const [index, result] of results.entries()) {
      expect(result.errors).toEqual([])
      expect(result.plugins.map((plugin) => plugin.name)).toEqual([`session-${index}`])
      expect(Object.keys(result.commands)).toEqual([`session-${index}:run`])
      expect(result.mcpServers).toEqual({
        [`session-${index}:local`]: { type: "local", command: [`session-${index}`], enabled: true },
      })
    }
    expect(Object.keys(cachedFirst.commands)).toEqual(["session-0:run"])
  })
})
