import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { __resetModelCache } from "../../shared/model-availability"
import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { __resetTimingConfig, __setTimingConfig } from "./timing"
import * as executor from "./executor"
import { createDelegateTask } from "./tools"
import type { DelegateTaskToolOptions } from "./types"

type LaunchInput = Record<string, unknown> & {
  readonly agent?: string
  readonly model?: { readonly providerID: string; readonly modelID: string; readonly variant?: string }
  readonly fallbackChain?: unknown
  readonly providerPin?: string
}

const toolContext = {
  sessionID: "parent-session",
  messageID: "parent-message",
  agent: "sisyphus",
  abort: new AbortController().signal,
}

function createHarness(options: Partial<DelegateTaskToolOptions> = {}) {
  const launches: LaunchInput[] = []
  const manager = {
    launch: async (input: LaunchInput) => {
      launches.push(input)
      return {
        id: `bg_${launches.length}`,
        sessionId: `ses_child_${launches.length}`,
        status: "running",
        agent: input.agent,
      }
    },
    getTask: () => undefined,
  }
  const client = {
    app: {
      agents: async () => ({
        data: [{ name: "explore", mode: "subagent", model: { providerID: "openai", modelID: "gpt-6-luna-fast" } }],
      }),
    },
    config: { get: async () => ({ data: { model: "anthropic/claude-sonnet-5-5" } }) },
    session: {
      get: async () => ({ data: { directory: "/tmp" } }),
      create: async () => ({ data: { id: "ses_child" } }),
      prompt: async () => ({ data: {} }),
      promptAsync: async () => ({ data: {} }),
      messages: async () => ({ data: [] }),
      status: async () => ({ data: {} }),
    },
  }
  const tool = createDelegateTask(
    unsafeTestValue({
      manager,
      client,
      directory: "/tmp",
      userCategories: { quick: { model: "anthropic/claude-haiku-5-5" } },
      agentOverrides: { "sisyphus-junior": { model: "openai/gpt-6.1-sol", variant: "xhigh" } },
      sisyphusJuniorModel: "openai/gpt-6.1-sol",
      ...options,
    }),
  )
  return { tool, launches }
}

async function run(tool: ReturnType<typeof createDelegateTask>, args: Record<string, unknown>): Promise<string> {
  const result = await tool.execute(
    unsafeTestValue({ description: "pin test", prompt: "say hi", load_skills: [], ...args }),
    unsafeTestValue(toolContext),
  )
  return typeof result === "string" ? result : JSON.stringify(result)
}

const CYBER_PARENT = {
  sessionID: "parent-session",
  messageID: "parent-message",
  agent: "sisyphus",
  model: { providerID: "anthropic-cybersec", modelID: "claude-opus-5-5" },
}

describe("task under an anthropic-cybersec parent", () => {
  const spies: Array<ReturnType<typeof spyOn>> = []

  beforeEach(() => {
    __resetModelCache()
    __setTimingConfig({ WAIT_FOR_SESSION_INTERVAL_MS: 1, WAIT_FOR_SESSION_TIMEOUT_MS: 50 })
    spies.push(
      spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai", "anthropic", "anthropic-cybersec"]),
      spyOn(connectedProvidersCache, "readProviderModelsCache").mockReturnValue({
        connected: ["openai", "anthropic", "anthropic-cybersec"],
        models: {
          openai: ["gpt-6.1-sol", "gpt-6-luna-fast"],
          anthropic: ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"],
          "anthropic-cybersec": ["claude-sonnet-5-5", "claude-opus-5-5"],
        },
        updatedAt: "2026-11-18T00:00:00.000Z",
      }),
      spyOn(executor, "resolveParentContext").mockResolvedValue(CYBER_PARENT),
    )
  })

  afterEach(() => {
    __resetTimingConfig()
    releaseAllPromptAsyncReservationsForTesting()
    for (const spy of spies.splice(0)) spy.mockRestore()
  })

  test("#given a category pinned to a listed anthropic model #then the child runs on anthropic-cybersec", async () => {
    const { tool, launches } = createHarness({ userCategories: { writing: { model: "anthropic/claude-sonnet-5-5" } } })
    await run(tool, { category: "writing", run_in_background: true })
    expect(launches[0]?.model).toMatchObject({ providerID: "anthropic-cybersec", modelID: "claude-sonnet-5-5" })
  })

  test("#given a category pinned to an unlisted anthropic model #then the child keeps anthropic", async () => {
    const { tool, launches } = createHarness()
    await run(tool, { category: "quick", run_in_background: true })
    expect(launches[0]?.model).toMatchObject({ providerID: "anthropic", modelID: "claude-haiku-5-5" })
  })

  test("#given the provider: anthropic override #then the pinned anthropic model moves to anthropic-cybersec when listed", async () => {
    const { tool, launches } = createHarness({
      providerModels: { anthropic: { agents: {}, categories: { quick: { model: "anthropic/claude-opus-5-5" } } } },
    })
    await run(tool, { category: "quick", provider: "anthropic", run_in_background: true })
    expect(launches[0]?.model).toMatchObject({ providerID: "anthropic-cybersec", modelID: "claude-opus-5-5" })
  })

  test("#given a subagent whose agent pin is anthropic #then its model and fallback chain move to anthropic-cybersec", async () => {
    const { tool, launches } = createHarness({
      agentOverrides: { explore: { model: "anthropic/claude-sonnet-5-5", fallback_models: ["anthropic/claude-opus-5-5", "anthropic/claude-haiku-5-5"] } },
    })
    await run(tool, { subagent_type: "explore", run_in_background: true })
    expect(launches[0]?.model).toMatchObject({ providerID: "anthropic-cybersec", modelID: "claude-sonnet-5-5" })
    expect(launches[0]?.fallbackChain).toEqual([
      expect.objectContaining({ providers: ["anthropic-cybersec"], model: "claude-opus-5-5" }),
      expect.objectContaining({ providers: ["anthropic"], model: "claude-haiku-5-5" }),
    ])
  })

  test("#given a subagent pinned to another provider #then it is left alone", async () => {
    const { tool, launches } = createHarness()
    await run(tool, { subagent_type: "explore", run_in_background: true })
    expect(launches[0]?.model).toMatchObject({ providerID: "openai", modelID: "gpt-6-luna-fast" })
  })
})
