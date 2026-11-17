import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearClaudeHooksConfigCache, loadClaudeHooksConfig, resetPluginHooksState } from "../hooks/claude-code-hooks/config"
import type { PluginComponents } from "./plugin-components-loader"
import { applyHookConfig } from "./hook-config-handler"

describe("applyHookConfig", () => {
  const directories: string[] = []

  afterEach(() => {
    clearClaudeHooksConfigCache()
    resetPluginHooksState()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  test("registers and clears plugin hooks under the session key consumed by the loader", async () => {
    // given
    const first = mkdtempSync(join(tmpdir(), "omo-hook-session-first-"))
    const second = mkdtempSync(join(tmpdir(), "omo-hook-session-second-"))
    directories.push(first, second)
    const components = (command: string): PluginComponents => ({
      commands: {}, skills: {}, agents: {}, mcpServers: {}, plugins: [], errors: [],
      hooksConfigs: [{ hooks: { Stop: [{ matcher: "*", hooks: [{ type: "command", command }] }] } }],
    })
    expect(first).not.toBe(process.cwd())
    expect(second).not.toBe(process.cwd())

    // when
    applyHookConfig({ directory: first, pluginComponents: components("fixture-first-hook") })
    applyHookConfig({ directory: second, pluginComponents: components("fixture-second-hook") })
    const firstConfig = await loadClaudeHooksConfig(undefined, first)
    const secondConfig = await loadClaudeHooksConfig(undefined, second)
    applyHookConfig({ directory: first, pluginComponents: { ...components("unused"), hooksConfigs: [] } })
    const clearedFirst = await loadClaudeHooksConfig(undefined, first)
    const retainedSecond = await loadClaudeHooksConfig(undefined, second)
    const commands = (config: typeof firstConfig) => (config?.Stop ?? []).flatMap((matcher) =>
      matcher.hooks.flatMap((hook) => hook.type === "command" ? [hook.command] : []),
    ).filter((command) => command.startsWith("fixture-"))

    // then
    expect(commands(firstConfig)).toEqual(["fixture-first-hook"])
    expect(commands(secondConfig)).toEqual(["fixture-second-hook"])
    expect(commands(clearedFirst)).toEqual([])
    expect(commands(retainedSecond)).toEqual(["fixture-second-hook"])
  })
})
