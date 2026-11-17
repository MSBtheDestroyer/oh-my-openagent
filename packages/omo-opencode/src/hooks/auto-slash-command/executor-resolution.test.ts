/// <reference types="bun-types" />

import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { LoadedSkill } from "../../features/opencode-skill-loader"
import * as shared from "../../shared"
import * as slashcommand from "../../tools/slashcommand/command-discovery"

let resolveCommandsInTextSpy: { mockRestore: () => void } | undefined
let resolveFileReferencesInTextSpy: { mockRestore: () => void } | undefined
let discoverCommandsSyncSpy: { mockRestore: () => void } | undefined

function setupExecutorSpies(): void {
  resolveCommandsInTextSpy = spyOn(shared, "resolveCommandsInText").mockImplementation(
    async (content: string) => content,
  )
  resolveFileReferencesInTextSpy = spyOn(shared, "resolveFileReferencesInText").mockImplementation(
    async (content: string) => content,
  )
  discoverCommandsSyncSpy = spyOn(slashcommand, "discoverCommandsSync").mockReturnValue([
    {
      name: "shadowed",
      metadata: { name: "shadowed", description: "builtin" },
      content: "builtin template",
      scope: "builtin",
    },
    {
      name: "shadowed",
      metadata: { name: "shadowed", description: "project" },
      content: "project template",
      scope: "project",
    },
  ])
}

function restoreExecutorSpies(): void {
  resolveCommandsInTextSpy?.mockRestore()
  resolveFileReferencesInTextSpy?.mockRestore()
  discoverCommandsSyncSpy?.mockRestore()
  resolveCommandsInTextSpy = undefined
  resolveFileReferencesInTextSpy = undefined
  discoverCommandsSyncSpy = undefined
}

async function executeSlashCommand(
  ...args: Parameters<typeof import("./executor").executeSlashCommand>
): ReturnType<typeof import("./executor").executeSlashCommand> {
  const module = await import(`./executor?test=${Date.now()}-${Math.random()}`)
  return module.executeSlashCommand(...args)
}

afterEach(restoreExecutorSpies)

function createRestrictedSkill(): LoadedSkill {
  return {
    name: "restricted-skill",
    definition: {
      name: "restricted-skill",
      description: "restricted",
      template: "restricted template",
      agent: "hephaestus",
    },
    scope: "user",
  }
}

describe("executeSlashCommand resolution semantics", () => {
  it("discovers project skills from the session directory when no skill list is supplied", async () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "omo-slash-discovery-session-"))
    const skillDirectory = join(directory, ".claude", "skills", "session-only-skill")
    mkdirSync(skillDirectory, { recursive: true })
    const body = crypto.randomUUID()
    writeFileSync(join(skillDirectory, "SKILL.md"), `---\nname: session-only-skill\ndescription: location\n---\n${body}`)
    expect(directory).not.toBe(process.cwd())
    try {
      // when
      const result = await executeSlashCommand(
        { command: "session-only-skill", args: "", raw: "/session-only-skill" },
        { directory, pluginsEnabled: false },
      )

      // then
      expect(result.success).toBe(true)
      expect(result.replacementText).toContain(body)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("expands a pathless skill template from the session directory", async () => {
    // given
    const directory = mkdtempSync(join(tmpdir(), "omo-slash-session-"))
    writeFileSync(join(directory, "marker.txt"), "SESSION_FILE_REFERENCE")
    writeFileSync(join(directory, "probe.mjs"), 'import { readFileSync } from "node:fs"; process.stdout.write("shell:" + readFileSync("marker.txt", "utf8"))')
    const skill: LoadedSkill = {
      name: "location", scope: "user",
      definition: { name: "location", description: "location", template: `@marker.txt\n!\`${JSON.stringify(process.execPath)} probe.mjs\`` },
    }
    expect(directory).not.toBe(process.cwd())
    try {
      // when
      const result = await executeSlashCommand({ command: "location", args: "", raw: "/location" }, { directory, skills: [skill], pluginsEnabled: false })

      // then
      expect(result.success).toBe(true)
      expect(result.replacementText).toContain("SESSION_FILE_REFERENCE")
      expect(result.replacementText).toContain("shell:SESSION_FILE_REFERENCE")
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it("returns project command when project and builtin names collide", async () => {
    //#given
    setupExecutorSpies()
    const parsed = {
      command: "shadowed",
      args: "",
      raw: "/shadowed",
    }

    //#when
    const result = await executeSlashCommand(parsed, { skills: [] })

    //#then
    expect(result.success).toBe(true)
    expect(result.replacementText).toContain("**Scope**: project")
    expect(result.replacementText).toContain("project template")
    expect(result.replacementText).not.toContain("builtin template")
  })

  it("blocks slash skill invocation when invoking agent is missing", async () => {
    //#given
    setupExecutorSpies()
    const parsed = {
      command: "restricted-skill",
      args: "",
      raw: "/restricted-skill",
    }

    //#when
    const result = await executeSlashCommand(parsed, { skills: [createRestrictedSkill()] })

    //#then
    expect(result.success).toBe(false)
    expect(result.error).toBe('Skill "restricted-skill" is restricted to agent "hephaestus"')
  })

  it("allows slash skill invocation when invoking agent matches restriction", async () => {
    //#given
    setupExecutorSpies()
    const parsed = {
      command: "restricted-skill",
      args: "",
      raw: "/restricted-skill",
    }

    //#when
    const result = await executeSlashCommand(parsed, {
      skills: [createRestrictedSkill()],
      agent: "hephaestus",
    })

    //#then
    expect(result.success).toBe(true)
    expect(result.replacementText).toContain("restricted template")
  })
})
