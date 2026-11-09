/**
 * One skill as the panel lists it. `name` is what the slash command runs
 * (`engineering:debug`), `label` what the row shows (`debug`), `blurb` the
 * first sentence of its description, `about` up to 300 characters of it (what Jev reads),
 * `group` the section id.
 */
export type SkillRow = { name: string; label: string; blurb: string; about: string; group: string }

/** One of Jev's picks for the last message: the skill and how sure it was (0 to 1). */
export type Suggestion = { skill: string; probability: number }

/** One Jev check, as its response reported it. */
export type Check = {
  picked: string | null
  probability: number
  inputTokens: number
  costUsd: number
  error?: string
}

/**
 * Clicks kept on this computer: per skill, and per local day ('YYYY-MM-DD',
 * the last 14 days). Never any prompt text.
 */
export type Usage = { counts: Record<string, number>; days: Record<string, number> }

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
      /** Pinned skill names, in the order pinned; kept in $.store too. */
      favorites: Shaped<string[]>
      /** Kept in $.store too. */
      usage: Shaped<Usage>
      /** The pixel art's colors; kept in $.store too. */
      theme: 'purple' | 'amber' | 'green' | 'mono'
      /** The skill just clicked, whose row says "added" for a moment; '' when none. */
      added: string
      /** Up to three picks from the last check, likeliest first; empty when none. */
      picks: Shaped<Suggestion[]>
      lastCheck: Shaped<Check | null>
      totals: Shaped<Totals>
      /** A newer version on GitHub than this build, if any. */
      newerVersion: Shaped<string | null>
      /** The person's switch for suggestions as they type; kept in $.store. */
      suggestionsOn: boolean
      /** Whether the "click a skill" tip was dismissed or used; kept in $.store. */
      tipSeen: boolean
    }
  }
}
