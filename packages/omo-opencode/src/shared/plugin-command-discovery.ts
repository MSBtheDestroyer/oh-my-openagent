import {
  discoverInstalledPlugins,
  loadPluginCommands,
  loadPluginSkillsAsCommands,
} from "@oh-my-opencode/claude-code-compat-core/claude-code-plugin-loader"
import type { CommandDefinition } from "../features/claude-code-command-loader/types"

export interface PluginCommandDiscoveryOptions {
  directory?: string
  pluginsEnabled?: boolean
  enabledPluginsOverride?: Record<string, boolean>
}

export function discoverPluginCommandDefinitions(
  options?: PluginCommandDiscoveryOptions,
): Record<string, CommandDefinition> {
  if (options?.pluginsEnabled === false) {
    return {}
  }

  const { plugins } = discoverInstalledPlugins({
    directory: options?.directory,
    enabledPluginsOverride: options?.enabledPluginsOverride,
  })

  return {
    ...loadPluginCommands(plugins),
    ...loadPluginSkillsAsCommands(plugins),
  }
}
