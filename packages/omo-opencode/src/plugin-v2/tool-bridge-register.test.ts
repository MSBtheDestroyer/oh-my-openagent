/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { dirname, join } from "node:path"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { Agent, Location } from "@opencode/plugin"
import { AssertInput } from "@opencode/plugin/permission"
import { CallID, type ToolContext, type ToolEditor } from "@opencode/plugin/promise/tool"
import { z } from "zod"
import { registerV1Tools } from "./tool-bridge-register"
import { location } from "./v1-client-fixture.test"

const {
  SessionMessage,
}: { readonly SessionMessage: { readonly ID: { readonly make: (value: string) => ToolContext["messageID"] } } } =
  await import(
    Bun.resolveSync("@opencode/schema/session-message", dirname(fileURLToPath(import.meta.resolve("@opencode/plugin"))))
  )

function unused(): never {
  throw new Error("Unexpected fixture domain access")
}

async function registeredTool(definition: Parameters<typeof registerV1Tools>[1][string], sessionLocation = location) {
  const tools: Parameters<ToolEditor["add"]>[0][] = []
  await registerV1Tools(
    {
      location: sessionLocation,
      permission: { assert: async () => {}, list: unused, get: unused, reply: unused, hook: unused },
      tool: {
        list: unused,
        reload: unused,
        hook: unused,
        transform: async (callback) => {
          callback({
            add: (tool) => {
              tools.push(tool)
            },
            get: unused,
            list: unused,
            namespace: unused,
            update: unused,
            remove: unused,
          })
          return { dispose: async () => {} }
        },
      },
    },
    { fixture: definition },
  )
  const tool = tools[0]
  if (!tool) throw new Error("Fixture tool was not registered")
  return tool
}

const context: Omit<ToolContext, "progress"> = {
  sessionID: AssertInput.fields.sessionID.make("ses_fixture"),
  messageID: SessionMessage.ID.make("msg_fixture"),
  agent: Agent.ID.make("fixture"),
  id: CallID.make("fixture-call"),
  signal: new AbortController().signal,
}

describe("v1 tool metadata at the native JSON boundary", () => {
  test("executes tools in the linked session checkout instead of the engine or canonical checkout", async () => {
    // given
    const root = mkdtempSync(join(tmpdir(), "omo-tool-bridge-location-"))
    const linked = join(root, "linked")
    const main = join(root, "main")
    const directory = join(linked, "sub")
    mkdirSync(directory, { recursive: true })
    mkdirSync(main)
    writeFileSync(join(linked, "marker"), "linked-marker")
    writeFileSync(join(main, "marker"), "main-marker")
    const sessionLocation = new Location.Info({
      directory: Location.Info.fields.directory.make(directory),
      project: {
        id: location.project.id,
        directory: Location.Info.fields.project.fields.directory.make(linked),
        canonical: Location.Info.fields.project.fields.canonical.make(main),
      },
    })
    expect(directory).not.toBe(process.cwd())
    try {
      const tool = await registeredTool({
        description: "Location fixture", args: {},
        execute: async (_input, legacy) => JSON.stringify({
          directory: legacy.directory,
          marker: readFileSync(join(legacy.worktree, "marker"), "utf8"),
        }),
      }, sessionLocation)

      // when
      const result = await tool.execute({}, { ...context, progress: async () => {} })

      // then
      expect(result).toEqual({ content: JSON.stringify({ directory, marker: "linked-marker" }) })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  test("preserves JSON metadata and omits undefined object members in progress and terminal results", async () => {
    // given
    const metadata = {
      command: undefined,
      nested: { absent: undefined, keep: "child" },
      list: [null, false, 0],
      sessionId: "ses_child",
    }
    const tool = await registeredTool({
      description: "Fixture",
      args: {},
      execute: async (_input, ctx) => {
        ctx.metadata({ title: "Working", metadata })
        return { output: "Finished", title: "Complete", metadata }
      },
    })
    const progress: unknown[] = []
    // when
    const result = await tool.execute(
      {},
      {
        ...context,
        progress: async (update) => {
          progress.push(update)
        },
      },
    )
    // then
    const expected = { nested: { keep: "child" }, list: [null, false, 0], sessionId: "ses_child" }
    expect(z.json().safeParse({ progress, result }).success).toBe(true)
    expect(progress).toEqual([{ title: "Working", metadata: expected }])
    expect(result).toEqual({
      content: [{ type: "text", text: "Finished" }],
      metadata: { ...expected, title: "Complete" },
    })
    expect(Object.hasOwn(metadata, "command")).toBe(true)
    expect(Object.hasOwn(metadata.nested, "absent")).toBe(true)
  })

  test.each(["progress", "result"] as const)(
    "rejects nonserializable %s metadata before it reaches native state",
    async (phase) => {
      // given
      const cyclic: Record<string, unknown> = {}
      cyclic.self = cyclic
      const invalid: readonly unknown[] = [
        () => "lost",
        Symbol("lost"),
        1n,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        new Map([["lost", true]]),
        cyclic,
      ]
      for (const value of invalid) {
        const tool = await registeredTool({
          description: "Fixture",
          args: {},
          execute: async (_input, ctx) => {
            if (phase === "progress") ctx.metadata({ metadata: { value } })
            return { output: "Finished", metadata: phase === "result" ? { value } : {} }
          },
        })
        const progress: unknown[] = []
        // when
        const result = tool.execute(
          {},
          {
            ...context,
            progress: async (update) => {
              progress.push(update)
            },
          },
        )
        // then
        await expect(result).rejects.toMatchObject({ name: "ToolMetadataBridgeError", toolName: "fixture" })
        expect(progress).toEqual([])
      }
    },
  )
})
