/**
 * One skill as the panel lists it. `name` is what the slash command runs
 * (`engineering:debug`), `label` what the row shows (`debug`), `blurb` the
 * first sentence of its description, `about` up to 300 characters of it (what Jev reads),
 * `group` the section id.
 */
export type SkillRow = { name: string; label: string; blurb: string; about: string; group: string }

/** Jev's pick for the last message: the skill and how sure it was (0 to 1). */
export type Suggestion = { skill: string; probability: number }

/** One Jev check, as its response reported it. */
export type Check = {
  picked: string | null
  probability: number
  inputTokens: number
  costUsd: number
  error?: string
}

export type Totals = { checks: number; inputTokens: number; costUsd: number }

declare module 'claude-code' {
  interface PluginState {
    'skill-picker': {
      skills: Shaped<SkillRow[]>
      query: string
      openGroups: Shaped<string[]>
      /** `group:<id>` and `skill:<name>` entries; kept in $.store too. */
      hidden: Shaped<string[]>
      showHidden: boolean
      hasKey: boolean
      /** A Jev check is in flight. */
      checking: boolean
      /** Skills used from the panel, newest first; kept in $.store too. */
      recent: Shaped<string[]>
      suggestion: Shaped<Suggestion | null>
      lastCheck: Shaped<Check | null>
      totals: Shaped<Totals>
      /** A newer version on GitHub than this build, if any. */
      newerVersion: Shaped<string | null>
    }
  }
}
