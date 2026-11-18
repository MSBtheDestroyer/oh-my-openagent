/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import * as parentContextResolver from "../delegate-task/parent-context-resolver"
import { clearCallableAgentsCache } from "./agent-resolver"
import { createCallOmoAgent } from "./tools"

type LaunchInput = {
  model?: { providerID: string; modelID: string; variant?: string }
  fallbackChain?: Array<{ providers: string[]; model: string }>
}

const ctx = {
  client: { app: { agents: mock(() => Promise.resolve({ data: [{ name: "explore", mode: "subagent" }] })) } },
  directory: "/test",
} as unknown as PluginInput

async function launchExplore(parentModel: { providerID: string; modelID: string }, model: string): Promise<LaunchInput> {
  spyOn(parentContextResolver, "resolveParentContext").mockResolvedValue({
    sessionID: "parent", messageID: "msg", agent: "sisyphus", model: parentModel,
  })
  const launch = mock((_input: LaunchInput) =>
    Promise.resolve({ id: "bg_1", sessionId: "child", description: "t", agent: "explore", status: "pending" }),
  )
  const manager = { launch, getTask: mock(() => undefined) } as unknown as BackgroundManager
  const tool = createCallOmoAgent(ctx, manager, [], { explore: { model } })
  await tool.execute(
    { description: "t", prompt: "p", subagent_type: "explore", run_in_background: true },
    { sessionID: "parent", messageID: "msg", agent: "sisyphus", abort: new AbortController().signal } as never,
  )
  const call = launch.mock.calls[0]
  if (!call) throw new Error("Expected launch to be called")
  return call[0]
}

describe("call_omo_agent under an anthropic-cybersec parent", () => {
  const spies: Array<ReturnType<typeof spyOn>> = []
  beforeEach(() => {
    clearCallableAgentsCache()
    spies.push(spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
      connected: ["anthropic", "anthropic-cybersec"],
      models: { anthropic: ["claude-sonnet-5-5", "claude-haiku-5-5"], "anthropic-cybersec": ["claude-sonnet-5-5"] },
      updatedAt: "2026-11-18T00:00:00.000Z",
    }))
  })
  afterEach(() => {
    for (const spy of spies.splice(0)) spy.mockRestore()
    ;(parentContextResolver.resolveParentContext as unknown as { mockRestore?: () => void }).mockRestore?.()
  })

  test("moves a listed anthropic agent model to anthropic-cybersec", async () => {
    const launched = await launchExplore({ providerID: "anthropic-cybersec", modelID: "claude-opus-5-5" }, "anthropic/claude-sonnet-5-5")
    expect(launched.model).toEqual({ providerID: "anthropic-cybersec", modelID: "claude-sonnet-5-5" })
  })

  test("keeps an unlisted anthropic agent model on anthropic", async () => {
    const launched = await launchExplore({ providerID: "anthropic-cybersec", modelID: "claude-opus-5-5" }, "anthropic/claude-haiku-5-5")
    expect(launched.model).toEqual({ providerID: "anthropic", modelID: "claude-haiku-5-5" })
  })

  test("leaves a parent that is not on cybersec alone", async () => {
    const launched = await launchExplore({ providerID: "anthropic", modelID: "claude-opus-5-5" }, "anthropic/claude-sonnet-5-5")
    expect(launched.model).toEqual({ providerID: "anthropic", modelID: "claude-sonnet-5-5" })
  })
})
