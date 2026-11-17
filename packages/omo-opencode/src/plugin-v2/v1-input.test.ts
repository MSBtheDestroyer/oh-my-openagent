import { describe, expect, test } from "bun:test"
import { Location } from "@opencode/plugin"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createV1ClientAdapter } from "./v1-client"
import { createClientFixture } from "./v1-client-fixture.test"
import { projectV1Input } from "./v1-input"

describe("v1 input projection", () => {
  test("keeps a linked checkout root separate from the canonical project root", () => {
    // given
    const { ctx } = createClientFixture()
    const location = new Location.Info({
      directory: Location.Info.fields.directory.make("/scratch/linked/sub"),
      project: {
        id: ctx.location.project.id,
        directory: Location.Info.fields.project.fields.directory.make("/scratch/linked"),
        canonical: Location.Info.fields.project.fields.canonical.make("/scratch/main"),
      },
    })

    // when
    const input = projectV1Input({ location }, createV1ClientAdapter(ctx))

    // then
    expect(input.directory).toBe("/scratch/linked/sub")
    expect(input.worktree).toBe("/scratch/linked")
    expect(input.project.worktree).toBe("/scratch/main")
  })

  test("projects the session checkout when the engine cwd is elsewhere", () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "omo-v2-location-"))
    const { ctx } = createClientFixture()
    const location = new Location.Info({
      directory: Location.Info.fields.directory.make(join(directory, "sub")),
      project: {
        id: ctx.location.project.id,
        directory: Location.Info.fields.project.fields.directory.make(directory),
        canonical: Location.Info.fields.project.fields.canonical.make(join(directory, "main")),
      },
    })
    try {
      expect(directory).not.toBe(process.cwd())

      // when
      const input = projectV1Input({ location }, createV1ClientAdapter(ctx))

      // then
      expect(input.directory).toBe(join(directory, "sub"))
      expect(input.worktree).toBe(directory)
      expect(input.project.worktree).toBe(join(directory, "main"))
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("uses the native project root and worktree directory without fabricating host fields", () => {
    const { ctx } = createClientFixture()
    const client = createV1ClientAdapter(ctx)

    const input = projectV1Input(ctx, client)

    expect(input.directory).toBe("/scratch/project/worktree")
    expect(input.worktree).toBe("/scratch/project")
    expect(String(input.project.id)).toBe("project-1")
    expect(input.serverUrl).toBeUndefined()
    expect(Object.keys(input.project)).not.toContain("time")
    expect(input.$).toBe(Bun.$)
  })

  test("throws when legacy factory code attempts workspace registration", () => {
    const { ctx } = createClientFixture()
    const input = projectV1Input(ctx, createV1ClientAdapter(ctx))

    expect(() => input.experimental_workspace.register()).toThrow("experimental_workspace.register")
  })
})
