import type { FallbackEntry } from "./model-requirements"
import { findProviderModelMetadata, readProviderModelsCache } from "./connected-providers-cache"
import { log } from "./logger"

/**
 * A parent running on `anthropic-cybersec/<model>` keeps its subagents there.
 *
 * `anthropic-cybersec` is a provider Vibeterm adds to opencode's config: the
 * Claude models some Meridian account holds Cyber Verification Program access
 * on, each sent with `x-meridian-require: cvp` so Meridian routes it only to
 * such an account. A subagent whose model comes from a category, an agent pin,
 * a `provider` pin or a fallback chain naming plain `anthropic/<model>` would
 * send the same work to any account. So when the parent runs on
 * `anthropic-cybersec`, such a child model moves to `anthropic-cybersec/<model>`
 * if the engine loaded that model under the provider, and stays on
 * `anthropic/<model>`, logged, if it did not (no account has CVP on it).
 *
 * Vibeterm applies the same rule to the sessions it spawns and prompts
 * (opencode-tools `_lib/cybersec-inheritance`).
 */
export const CYBERSEC_PROVIDER = "anthropic-cybersec"
const CYBERSEC_SOURCE_PROVIDER = "anthropic"

type ModelRef = { readonly providerID: string; readonly modelID: string }

export type CybersecListed = (modelID: string) => boolean

export function isCybersecModel(model: { readonly providerID?: string } | undefined): boolean {
  return model?.providerID === CYBERSEC_PROVIDER
}

/** Whether the engine loaded `modelID` under `anthropic-cybersec` (the provider-models cache it reported). */
export function isCybersecListed(modelID: string): boolean {
  return findProviderModelMetadata(CYBERSEC_PROVIDER, modelID, readProviderModelsCache()) !== undefined
}

export interface CybersecContext {
  readonly sessionID: string
  readonly agent?: string
  readonly listed?: CybersecListed
}

/** The child's model, moved from `anthropic` to `anthropic-cybersec` under a cybersec parent when listed there. */
export function inheritCybersecModel<T extends ModelRef>(
  parent: ModelRef | undefined,
  child: T | undefined,
  context: CybersecContext,
): T | undefined {
  if (!child || !isCybersecModel(parent) || child.providerID !== CYBERSEC_SOURCE_PROVIDER) return child
  const listed = context.listed ?? isCybersecListed
  const fields = { sessionID: context.sessionID, agent: context.agent, model: `${child.providerID}/${child.modelID}` }
  if (!listed(child.modelID)) {
    log("[cybersec] child kept on anthropic: model not listed under anthropic-cybersec", fields)
    return child
  }
  log("[cybersec] child moved to anthropic-cybersec", fields)
  return { ...child, providerID: CYBERSEC_PROVIDER }
}

/**
 * The child's fallback chain with `anthropic` replaced by `anthropic-cybersec`
 * in every entry whose model is listed there. An entry whose model is not
 * listed keeps `anthropic`, logged.
 */
export function inheritCybersecFallbackChain(
  parent: ModelRef | undefined,
  chain: FallbackEntry[] | undefined,
  context: CybersecContext,
): FallbackEntry[] | undefined {
  if (!chain || !isCybersecModel(parent)) return chain
  const listed = context.listed ?? isCybersecListed
  return chain.map((entry) => {
    if (!entry.providers.includes(CYBERSEC_SOURCE_PROVIDER)) return entry
    if (!listed(entry.model)) {
      log("[cybersec] fallback entry kept on anthropic: model not listed under anthropic-cybersec", {
        sessionID: context.sessionID,
        agent: context.agent,
        model: entry.model,
      })
      return entry
    }
    const providers = entry.providers.map((provider) => (provider === CYBERSEC_SOURCE_PROVIDER ? CYBERSEC_PROVIDER : provider))
    return { ...entry, providers: [...new Set(providers)] }
  })
}
