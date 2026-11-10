import { atom, read, update } from 'claude-code'
import type { CommandInfo, EngineInterface, Register, Timer } from 'claude-code'

import type { Check, SkillRow, Suggestion, Usage } from '../types'

import { THEMES, emptyFace, meter, spark, strip, swatch, tile, weekChart } from './pixels'
import type { Theme } from './pixels'

const PANE = 'skill-picker'

// Jev, TypeSafe AI's decision model: https://docs.typesafe.ai/api
const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
const JEV_MODEL = 'jev-1.14.0'
const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1_000_000 // output tokens are free
const JEV_MAX_CHOICES = 255 // per question; one of them is "none"
// Below this, Jev's pick is shown nowhere: most messages need no skill.
const MIN_PROBABILITY = 0.3
// Or this far ahead when "none" is unlikely: the vote is split among twins.
const SPLIT_MIN_PROBABILITY = 0.15
const SPLIT_MAX_NONE = 0.4
// Up to three picks come from the one reply; the others need this much.
const PICKS_MAX = 3
const RUNNER_UP_MIN_PROBABILITY = 0.15

// Hidden until the person shows it again (they never use S&P Global).
const DEFAULT_HIDDEN = ['group:sp-global']
const HIDDEN_STORE_KEY = 'hidden'
// The old Recent list; read once to start the use counts, never written.
const RECENT_STORE_KEY = 'recent'
const FAVORITES_STORE_KEY = 'favorites'
// Clicks per skill and per day, kept on this computer. Never any prompt text.
const USAGE_STORE_KEY = 'usage'
const THEME_STORE_KEY = 'theme'
const MOST_USED_MAX = 5
const USAGE_DAYS_KEPT = 14
// How long a clicked row says "added".
const ADDED_MS = 1200

const skills = atom({ plugin: 'skill-picker', key: 'skills' } as const, [], { shape: 'skills-3' })
const query = atom({ plugin: 'skill-picker', key: 'query' } as const, '')
const openGroups = atom({ plugin: 'skill-picker', key: 'openGroups' } as const, [], { shape: 'groups-3' })
const hidden = atom({ plugin: 'skill-picker', key: 'hidden' } as const, DEFAULT_HIDDEN, { shape: 'hidden-1' })
const showHidden = atom({ plugin: 'skill-picker', key: 'showHidden' } as const, false)
const hasKey = atom({ plugin: 'skill-picker', key: 'hasKey' } as const, false)
const checking = atom({ plugin: 'skill-picker', key: 'checking' } as const, false)
const favorites = atom({ plugin: 'skill-picker', key: 'favorites' } as const, [], { shape: 'favorites-1' })
const usage = atom({ plugin: 'skill-picker', key: 'usage' } as const, { counts: {}, days: {} }, { shape: 'usage-1' })
const theme = atom({ plugin: 'skill-picker', key: 'theme' } as const, 'purple')
// The skill just clicked ('' when none): its row says "added" for a moment.
const added = atom({ plugin: 'skill-picker', key: 'added' } as const, '')
let addedSeq = 0
const picks = atom({ plugin: 'skill-picker', key: 'picks' } as const, [], { shape: 'picks-1' })
const lastCheck = atom({ plugin: 'skill-picker', key: 'lastCheck' } as const, null, { shape: 'check-2' })
// Each check takes a number; only the newest one may change what is shown.
let checkSeq = 0
const JEV_TIMEOUT_MS = 8000

// Jev checks the draft once typing pauses this long, so ideas show before
// the message is sent.
const PAUSE_MS = 600
let typingTimer: Timer | null = null
let lastChecked = ''

// This build's version; keep it equal to .claude-plugin/plugin.json.
export const VERSION = '0.4.1'
// Like gstack: check GitHub for a newer version at most twice a day, and say
// so in the panel. Nothing about the person is sent; it is a plain download.
const LATEST_URL = 'https://raw.githubusercontent.com/bobbyt04/skill-picker/main/.claude-plugin/plugin.json'
const UPDATE_CHECK_MS = 12 * 60 * 60 * 1000
const UPDATE_STORE_KEY = 'update-check'
// Kept in $.store, so they hold across chats.
const SUGGESTIONS_STORE_KEY = 'suggestions-on'
const TIP_STORE_KEY = 'click-tip-seen'
const suggestionsOn = atom({ plugin: 'skill-picker', key: 'suggestionsOn' } as const, true)
const tipSeen = atom({ plugin: 'skill-picker', key: 'tipSeen' } as const, false)
const newerVersion = atom({ plugin: 'skill-picker', key: 'newerVersion' } as const, null, { shape: 'newer-1' })

const totals = atom(
  { plugin: 'skill-picker', key: 'totals' } as const,
  { checks: 0, inputTokens: 0, costUsd: 0 },
  { shape: 'totals-2' },
)

// Prompts typed by a person. Background notices, scheduled runs and other
// agents' messages are not worth a check.
const PERSON_ORIGINS = new Set(['composer', 'bridge', 'sdk', 'unclassified'])

const INSTRUCTIONS =
  'Which Claude Code skill would help most with the task this message asks for? ' +
  'Pick the closest fitting skill. Pick none only for chit-chat, quick factual questions or short follow-ups.'
const NONE = 'No listed skill clearly fits this message'

type JevAnswer = { choice?: string; probabilities?: Record<string, number> }
type JevResponse = { answers?: Record<string, JevAnswer>; usage?: { input_tokens?: number } }

// Sections: the person's own skills first, gstack next, plugins A to Z,
// then Claude Code's built-ins and connector prompts.
const FIRST = ['your-skills', 'mattpocock-skills', 'gstack']
const LAST = ['built-in', 'connectors']
const TITLES: Record<string, string> = {
  'your-skills': 'Your skills',
  gstack: 'gstack · Garry Tan',
  'mattpocock-skills': 'Matt Pocock · AI Hero',
  'built-in': 'Built-in',
  connectors: 'Connectors',
  'sp-global': 'S&P Global',
}

function groupTitle(id: string): string {
  return TITLES[id] ?? id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function groupRank(id: string): number {
  if (FIRST.includes(id)) return FIRST.indexOf(id)
  if (LAST.includes(id)) return 100 + LAST.indexOf(id)
  return 10
}

function short(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// The first sentence of a description, without gstack's "(gstack)" tag.
function blurbOf(description: string): string {
  const text = description.replace(/\s*\(gstack\)\s*$/, '').replace(/\s+/g, ' ').trim()
  const end = text.search(/[.!?](\s|$)/)

  return short(end > 0 ? text.slice(0, end + 1) : text, 110)
}

function groupOf(c: CommandInfo, gstack: Set<string>): string {
  if (gstack.has(c.name) || /\(gstack\)\s*$/.test(c.description)) return 'gstack'
  if (c.plugin) return c.plugin
  const colon = c.name.indexOf(':')
  if (colon > 0) return c.name.slice(0, colon)
  if (c.source === 'user') return 'your-skills'
  if (c.source === 'mcp') return 'connectors'
  return 'built-in'
}

// The skill folders gstack keeps, so its skills group together even where a
// description does not end in "(gstack)".
async function gstackNames($: EngineInterface): Promise<Set<string>> {
  try {
    const home = await $.env.get('HOME')
    if (!home) return new Set()
    const entries = await $.fs.list(`${home}/.claude/skills/gstack`)

    return new Set(entries.filter(e => e.kind === 'dir').map(e => e.name))
  } catch {
    return new Set()
  }
}

// Every skill and slash command the person can run, except Claude Code's own
// built-in commands that are not skills (/clear, /config, ...).
// The trigger phrases a skill file lists in its frontmatter (`triggers:`),
// which gstack keeps there instead of in its one-line description.
function triggersOf(file: string): string[] {
  const head = file.split(/^---\s*$/m)[1] ?? ''
  const block = head.match(/^triggers:\s*\n((?:[ \t]+- .*\n?)+)/m)?.[1] ?? ''

  return block
    .split('\n')
    .map(line => line.replace(/^[ \t]+- /, '').replace(/^["']|["']$/g, '').trim())
    .filter(Boolean)
}

// What Jev reads about a skill: its description, plus its trigger phrases
// from ~/.claude/skills/<name>/SKILL.md where it has any.
async function aboutOf($: EngineInterface, home: string | undefined, c: CommandInfo): Promise<string> {
  let triggers: string[] = []
  if (home && !c.name.includes(':')) {
    try {
      triggers = triggersOf(await $.fs.read(`${home}/.claude/skills/${c.name}/SKILL.md`))
    } catch {
      triggers = []
    }
  }
  const text = c.description.replace(/\s*\(gstack\)\s*$/, '')

  return short(triggers.length > 0 ? `${text} Use for: ${triggers.join('; ')}.` : text, 300)
}

async function loadSkills($: EngineInterface): Promise<SkillRow[]> {
  const commands = await $.command.list()
  let listed = new Set<string>()
  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    listed = new Set(usage.context.breakdown?.skills?.skillFrontmatter.map(s => s.name) ?? [])
  } catch {
    listed = new Set()
  }
  const gstack = await gstackNames($)
  const home = await $.env.get('HOME')
  const kept = commands.filter(c => c.source !== 'builtin' || listed.has(c.name))
  const abouts = await Promise.all(kept.map(c => aboutOf($, home, c)))

  return kept
    .map((c, i) => {
      const group = groupOf(c, gstack)
      const label = c.name.startsWith(`${group}:`) ? c.name.slice(group.length + 1) : c.name

      return { name: c.name, label, blurb: blurbOf(c.description), about: abouts[i] ?? '', group }
    })
    .sort((a, b) => groupRank(a.group) - groupRank(b.group) || a.group.localeCompare(b.group) || a.label.localeCompare(b.label))
}

async function refreshSkills($: EngineInterface): Promise<SkillRow[]> {
  const rows = await loadSkills($)
  await update($, skills, () => rows)

  return rows
}

function isHidden(row: SkillRow, list: readonly string[]): boolean {
  return list.includes(`group:${row.group}`) || list.includes(`skill:${row.name}`)
}

// What Jev chooses among. Hidden skills are never offered, nor Claude Code's
// own commands and connector prompts: fewer choices make each check cheaper
// and sharper.
function offered(all: readonly SkillRow[], hiddenList: readonly string[]): SkillRow[] {
  return all.filter(r => !isHidden(r, hiddenList) && r.group !== 'built-in' && r.group !== 'connectors')
}

// The hidden list lives in $.store so it outlasts the session.
async function setHidden($: EngineInterface, change: (list: string[]) => string[]): Promise<void> {
  const next = await update($, hidden, was => change([...was]))
  await $.store.set(HIDDEN_STORE_KEY, next)
}

// Adds an entry to the hidden list once, however fast Hide is clicked.
function hide($: EngineInterface, entry: string): Promise<void> {
  return setHidden($, list => (list.includes(entry) ? list : [...list, entry]))
}

// Puts `/name ` at the start of the prompt box, keeping what is typed there
// (and swapping out a slash command already at the start).
// A debug log in ~/.claude/skill-picker-logs/ (one file per chat): what the panel saw and
// did, for checking it on a real surface. Newest 200 lines.
const logLines: string[] = []
const LOG_ID = Math.random().toString(36).slice(2, 8)
async function debug($: EngineInterface, line: string): Promise<void> {
  try {
    const home = await $.env.get('HOME')
    if (!home) return
    logLines.push(`${new Date().toISOString()} ${line}`)
    if (logLines.length > 200) logLines.splice(0, logLines.length - 200)
    await $.fs.write(`${home}/.claude/skill-picker-logs/${LOG_ID}.log`, `${logLines.join('\n')}\n`)
  } catch {
    // The log is a convenience; never let it break the panel.
  }
}

async function debugFile($: EngineInterface, name: string, text: string): Promise<void> {
  try {
    const home = await $.env.get('HOME')
    if (home) await $.fs.write(`${home}/.claude/skill-picker-logs/${name}`, text)
  } catch {
    // As above: never break the panel.
  }
}

// Where the box can't take it, the command goes on the clipboard instead,
// with a toast saying so.
async function useSkill($: EngineInterface, name: string, surface?: string): Promise<void> {
  await debug($, `click /${name} surface=${surface ?? '-'}`)
  await hideTip($)
  let rest = ''
  try {
    rest = (await $.prompt.read()).text.replace(/^\/\S+\s*/, '')
  } catch (err) {
    await debug($, `prompt.read failed: ${String(err)}`)
    rest = ''
  }
  const text = `/${name} ${rest}`
  let filled = false
  try {
    const result = await $.prompt.fill({ text, mode: 'replace' })
    filled = result.isFilled
    await debug($, `prompt.fill -> ${JSON.stringify(result)}`)
  } catch (err) {
    await debug($, `prompt.fill threw: ${String(err)}`)
    filled = false
  }
  if (!filled) {
    try {
      const copied = await $.ui.copy({ text: `/${name} `, ...(surface ? { surface } : {}) } as Parameters<typeof $.ui.copy>[0])
      await debug($, `ui.copy -> ${JSON.stringify(copied)}`)
      $.ui.toast(`Copied /${name}: paste it into your message (⌘V)`)
    } catch (err) {
      await debug($, `ui.copy threw: ${String(err)}`)
      $.ui.toast(`Type /${name} in your message to use it`)
    }
  }
  await countUse($, name)
  // The row says "added" for a moment; a newer click takes over the timer.
  const seq = ++addedSeq
  await update($, added, () => name)
  $.clock.after(ADDED_MS, () => {
    if (seq === addedSeq) void update($, added, () => '')
  })
}

function dayKey(ms: number): string {
  const d = new Date(ms)
  const two = (n: number) => String(n).padStart(2, '0')

  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

// The local day `ago` days before the one `ms` falls on. Counted on the
// calendar from noon, so a 23 or 25 hour day (a clock change) is still one day.
function dayKeyAgo(ms: number, ago: number): string {
  const d = new Date(ms)
  d.setHours(12, 0, 0, 0)
  d.setDate(d.getDate() - ago)

  return dayKey(d.getTime())
}

// One more use of a skill, for it and for today. Days past two weeks go.
function bumped(was: Usage, name: string, today: string, oldest: string): Usage {
  const days: Record<string, number> = {}
  for (const [day, n] of Object.entries(was.days)) {
    if (day >= oldest) days[day] = n
  }
  days[today] = (days[today] ?? 0) + 1

  return { counts: { ...was.counts, [name]: (was.counts[name] ?? 0) + 1 }, days }
}

async function countUse($: EngineInterface, name: string): Promise<void> {
  const now = await $.clock.now()
  const today = dayKey(now)
  const oldest = dayKeyAgo(now, USAGE_DAYS_KEPT - 1)
  // Counted from what is there at the write, so two fast clicks both land.
  const next = await update($, usage, was => bumped(was, name, today, oldest))
  await $.store.set(USAGE_STORE_KEY, next)
}

async function toggleFavorite($: EngineInterface, name: string): Promise<void> {
  const next = await update($, favorites, was => (was.includes(name) ? was.filter(n => n !== name) : [...was, name]))
  await $.store.set(FAVORITES_STORE_KEY, next)
}

async function setTheme($: EngineInterface, next: Theme): Promise<void> {
  await update($, theme, () => next)
  await $.store.set(THEME_STORE_KEY, next)
}

// "0.10.0" > "0.9.1": compare each number in turn.
function isNewer(latest: string, current: string): boolean {
  const a = latest.split('.').map(n => Number.parseInt(n, 10) || 0)
  const b = current.split('.').map(n => Number.parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }

  return false
}

async function checkForUpdate($: EngineInterface): Promise<void> {
  try {
    const saved = (await $.store.get(UPDATE_STORE_KEY)) as { at?: number; latest?: string } | undefined
    let latest = typeof saved?.latest === 'string' ? saved.latest : null
    const now = Date.now()
    if (!latest || typeof saved?.at !== 'number' || now - saved.at > UPDATE_CHECK_MS) {
      const res = await $.http.fetch(LATEST_URL, { method: 'GET' })
      if (!res.ok) return
      const version = (JSON.parse(res.text) as { version?: unknown }).version
      if (typeof version !== 'string') return
      latest = version
      await $.store.set(UPDATE_STORE_KEY, { at: now, latest })
    }
    await update($, newerVersion, () => (latest && isNewer(latest, VERSION) ? latest : null))
  } catch {
    // Offline or GitHub unreachable: no notice, try again next session.
  }
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : null
}

function isWorthChecking(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed.startsWith('/')) return false

  return trimmed.split(/\s+/).length >= 4
}

// One Jev choice question per 254 skills (plus "none"), keyed by a plain
// snake_case id that maps back to the skill's name.
function buildQuestions(rows: SkillRow[]) {
  const nameOf = new Map<string, string>()
  const questions: Record<string, { type: 'choice'; instructions: string; criteria: Record<string, string> }> = {}
  const perQuestion = JEV_MAX_CHOICES - 1
  for (let start = 0; start < rows.length; start += perQuestion) {
    const criteria: Record<string, string> = {}
    for (const r of rows.slice(start, start + perQuestion)) {
      let id = r.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
      if (id === 'none' || nameOf.has(id)) id = `${id}_${nameOf.size}`
      nameOf.set(id, r.name)
      criteria[id] = `/${r.name}: ${r.about || r.blurb}`
    }
    criteria.none = NONE
    questions[`q${start / perQuestion}`] = { type: 'choice', instructions: INSTRUCTIONS, criteria }
  }

  return { questions, nameOf }
}

async function recordCheck($: EngineInterface, seq: number, check: Check, shown: Suggestion[]): Promise<void> {
  if (seq !== checkSeq) {
    await debug($, `result dropped as stale (check ${seq}, newest ${checkSeq})`)
    return
  }
  // The picks go up first, straight after the check above: the log and the
  // totals take time, and the draft can be sent or cleared meanwhile.
  await update($, picks, () => shown)
  if (seq !== checkSeq) {
    // Cleared while the picks were being written: they do not stay.
    await update($, picks, () => [])
    await debug($, `result dropped as stale (check ${seq}, newest ${checkSeq})`)
    return
  }
  await debug($, `result stored: ideas=${shown.map(p => `/${p.skill} ${p.probability.toFixed(2)}`).join(', ') || 'none'}`)
  await update($, lastCheck, () => check)
  await update($, totals, t => ({
    checks: t.checks + (check.inputTokens > 0 ? 1 : 0),
    inputTokens: t.inputTokens + check.inputTokens,
    costUsd: t.costUsd + check.costUsd,
  }))
}

async function recommend($: EngineInterface, text: string): Promise<void> {
  // Numbered before anything is awaited, so a switch-off or a cleared draft
  // during the steps below makes this check stale before it is sent.
  const seq = ++checkSeq
  // Off: no check is made, so nothing is sent and nothing is spent.
  if (!(await read($, suggestionsOn))) return
  const key = await $.env.get('TYPESAFE_API_KEY')
  await update($, hasKey, () => Boolean(key))
  if (!key) return

  let all = await read($, skills)
  if (all.length === 0) all = await refreshSkills($)
  const hiddenList = await read($, hidden)
  const rows = offered(all, hiddenList)
  if (rows.length === 0) return
  if (seq !== checkSeq || !(await read($, suggestionsOn))) return

  await update($, checking, () => true)
  try {
    // Nothing is sent for a check that went stale in the meantime.
    if (seq === checkSeq) await ask($, seq, key, text, rows)
  } finally {
    if (seq === checkSeq) await update($, checking, () => false)
  }
}

async function ask($: EngineInterface, seq: number, key: string, text: string, rows: SkillRow[]): Promise<void> {
  const { questions, nameOf } = buildQuestions(rows)
  const failed = (error: string): Check => ({ picked: null, probability: 0, inputTokens: 0, costUsd: 0, error })

  let res
  try {
    void debugFile($, 'last-jev-request.json', JSON.stringify({ model: JEV_MODEL, state: text.slice(0, 4000), questions }))
    const reply = $.http.fetch(JEV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: JEV_MODEL, state: text.slice(0, 4000), questions }),
    })
    res = await Promise.race([reply, $.clock.sleep(JEV_TIMEOUT_MS).then(() => null)])
    if (res === null) {
      await recordCheck($, seq, failed('timed out'), [])
      return
    }
  } catch {
    await recordCheck($, seq, failed('network error'), [])
    return
  }
  if (!res.ok) {
    await recordCheck($, seq, failed(`HTTP ${res.status}`), [])
    return
  }

  let body: JevResponse
  try {
    body = JSON.parse(res.text) as JevResponse
    const tops = Object.entries(body.answers ?? {}).map(([q, a]) => {
      const best = Object.entries(a.probabilities ?? {}).sort((x, y) => y[1] - x[1]).slice(0, 3)

      return `${q}:${best.map(([k, v]) => `${k}=${v.toFixed(2)}`).join(',')}`
    })
    await debug($, `jev ${rows.length} skills in ${Object.keys(questions).length} questions, ${body.usage?.input_tokens ?? 0} tokens | "${text.slice(0, 60)}" | ${tops.join(' | ')}`)
  } catch {
    await recordCheck($, seq, failed('unreadable reply'), [])
    return
  }

  // Every skill's probability across the questions, likeliest first, each
  // with its own question's "none" so a strong fit in one half of the list
  // is not lost to "none" in the other.
  const ranked: Array<Suggestion & { none: number }> = []
  for (const answer of Object.values(body.answers ?? {})) {
    const none = answer.probabilities?.none ?? 0
    for (const [id, probability] of Object.entries(answer.probabilities ?? {})) {
      const name = id === 'none' ? undefined : nameOf.get(id)
      if (name) ranked.push({ skill: name, probability, none })
    }
  }
  ranked.sort((x, y) => y.probability - x.probability)
  const best = ranked[0]

  const inputTokens = body.usage?.input_tokens ?? 0
  const check: Check = {
    picked: best?.skill ?? null,
    probability: best?.probability ?? 0,
    inputTokens,
    costUsd: inputTokens * JEV_USD_PER_INPUT_TOKEN,
  }
  // Shown when Jev is sure of it, or when it is sure SOME skill fits and
  // this one leads, its vote split with near-twins (three brainstorm skills).
  const isSure = best !== undefined && best.probability >= MIN_PROBABILITY
  const isSplit = best !== undefined && best.probability >= SPLIT_MIN_PROBABILITY && best.none <= SPLIT_MAX_NONE
  // The runners-up ride along with a shown top pick, from the same reply.
  const shown =
    isSure || isSplit
      ? ranked
          .slice(0, PICKS_MAX)
          .filter((p, i) => i === 0 || p.probability >= RUNNER_UP_MIN_PROBABILITY)
          .map(p => ({ skill: p.skill, probability: p.probability }))
      : []
  await recordCheck($, seq, check, shown)
}

function matches(row: SkillRow, words: string[]): boolean {
  const hay = `${row.name} ${row.blurb} ${row.about} ${groupTitle(row.group)}`.toLowerCase()

  return words.every(w => hay.includes(w))
}

// A few words on what a skill does: its blurb up to the first dash, comma
// or period.
function tagline(blurb: string): string {
  return short(blurb.split(/\s[—–-]\s|[,.;:]/)[0] ?? blurb, 48)
}

function usd(n: number): string {
  return n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(2)}`
}

// A neutral wash for hovered rows. The terminal takes a theme color; the
// other surfaces take a CSS color.
function hoverTint(surface: string): string {
  return surface === 'terminal' ? 'subtle' : 'rgba(127, 127, 127, 0.12)'
}

// Pin and Hide show on hover only where there is a pointer; elsewhere they
// stay put.
function reveal(surface: string) {
  return surface === 'desktop' || surface === 'vscode'
    ? ({ display: 'none', hover: { display: 'flex' } } as const)
    : ({ display: 'flex' } as const)
}

// The picks to show: only skills still listed and not hidden. If the top
// pick is gone, nothing shows: a runner-up never passed the top pick's bar.
function shownPicks(ideas: readonly Suggestion[], visible: readonly SkillRow[]): Suggestion[] {
  const known = ideas.filter(p => visible.some(r => r.name === p.skill))

  return known[0] === ideas[0] ? known : []
}

// Clears the ideas and any check still out, which is now stale.
async function dropIdea($: EngineInterface): Promise<void> {
  checkSeq += 1
  const had = (await read($, picks)).length > 0
  if (had) await debug($, 'idea cleared (draft too short, a slash command, or sent)')
  if (await read($, checking)) await update($, checking, () => false)
  if (had) await update($, picks, () => [])
}

function isCounts(value: unknown): value is Record<string, number> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(n => typeof n === 'number')
  )
}

function isTheme(value: unknown): value is Theme {
  return THEMES.some(t => t === value)
}

async function loadStored($: EngineInterface): Promise<void> {
  const stored = strings(await $.store.get(HIDDEN_STORE_KEY))
  await update($, hidden, () => stored ?? DEFAULT_HIDDEN)
  if (!stored) await $.store.set(HIDDEN_STORE_KEY, DEFAULT_HIDDEN)
  const pinned = strings(await $.store.get(FAVORITES_STORE_KEY))
  if (pinned) await update($, favorites, () => pinned)
  const kept = (await $.store.get(USAGE_STORE_KEY)) as { counts?: unknown; days?: unknown } | null | undefined
  if (kept && isCounts(kept.counts) && isCounts(kept.days)) {
    const next: Usage = { counts: kept.counts, days: kept.days }
    await update($, usage, () => next)
  } else {
    // Before use counts there was a Recent list: each of its skills starts at one.
    const old = strings(await $.store.get(RECENT_STORE_KEY))
    if (old) await update($, usage, () => ({ counts: Object.fromEntries(old.map(n => [n, 1])), days: {} }))
  }
  const look = await $.store.get(THEME_STORE_KEY)
  if (isTheme(look)) await update($, theme, () => look)
  const on = await $.store.get(SUGGESTIONS_STORE_KEY)
  await update($, suggestionsOn, () => on !== false)
  const seen = await $.store.get(TIP_STORE_KEY)
  await update($, tipSeen, () => seen === true)
}

async function setSuggestions($: EngineInterface, on: boolean): Promise<void> {
  await update($, suggestionsOn, () => on)
  await $.store.set(SUGGESTIONS_STORE_KEY, on)
  if (!on) await dropIdea($)
}

async function hideTip($: EngineInterface): Promise<void> {
  if (await read($, tipSeen)) return
  await update($, tipSeen, () => true)
  await $.store.set(TIP_STORE_KEY, true)
}

// Uses one of the ideas, which clears them all.
async function usePick($: EngineInterface, name: string, surface: string): Promise<void> {
  await useSkill($, name, surface)
  await update($, picks, () => [])
}

// Opens the panel for /skill-picker (and the plugin's own skill-picker:open).
async function openPanel($: EngineInterface): Promise<{ text: string }> {
  const rows = await refreshSkills($)
  await loadStored($)
  const opened = await $.ui.open({ id: PANE, title: 'Skills' })
  if (!opened.isPlaced) return { text: `Skills panel could not be shown: ${opened.reason ?? 'no reason given'}` }

  return { text: `Skills panel opened (${rows.length} skills).` }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'skill-picker',
      description: 'Open the Skills panel: every skill, searchable, click to use',
      // Works while Claude is mid-reply too.
      immediate: true,
    })
    const started = await next(e)
    await loadStored($)
    await update($, checking, () => false)
    // Its timer does not outlast a reload, so the "added" mark is cleared here.
    await update($, added, () => '')
    await refreshSkills($)
    const key = await $.env.get('TYPESAFE_API_KEY')
    await update($, hasKey, () => Boolean(key))
    void checkForUpdate($)
    if (e.surface === 'desktop') void $.ui.open({ id: PANE, title: 'Skills' })

    return started
  })

  // /skill-picker, both as this session registers it and as the plugin's
  // skills/open declares it as /skill-picker:open (so a fresh chat knows the name
  // before the panel runs). Answered here, so no model call is made.
  on('command.run', { command: 'skill-picker' }, async $ => await openPanel($))
  on('command.run', { command: 'skill-picker:open' }, async $ => await openPanel($))

  // As the person types: once they pause on a draft worth checking, ask Jev.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    typingTimer?.cancel()
    typingTimer = null
    const draft = box.text.trim()
    if (!isWorthChecking(draft)) {
      lastChecked = ''
      // Off the typing path: only writes when an idea or spinner is up.
      $.clock.after(0, () => void dropIdea($))
    } else if (draft !== lastChecked) {
      typingTimer = $.clock.after(PAUSE_MS, () => {
        typingTimer = null
        lastChecked = draft
        void recommend($, draft)
      })
    }

    return box
  })

  // Sent: the idea was for the draft, so it goes.
  on('prompt.submit', ($, e, next) => {
    if (PERSON_ORIGINS.has(e.origin.kind) && !e.isMeta) {
      typingTimer?.cancel()
      typingTimer = null
      lastChecked = ''
      $.clock.after(0, () => void dropIdea($))
    }

    return next(e)
  })

  // The top idea above the prompt, on one line: the pixel spark, the
  // command, a few words on what it does; then the percent, Use and close.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const hiddenList = await read($, hidden)
    const visible = (await read($, skills)).filter(r => !isHidden(r, hiddenList))
    const pick = shownPicks(await read($, picks), visible)[0]
    if (e.props.hasSurvey || pick === undefined) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const look = await read($, theme)
    const pct = Math.round(pick.probability * 100)
    const row = visible.find(r => r.name === pick.skill)
    let mark = <Text color="suggestion">✻</Text>
    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      mark = <Svg source={spark(16, look)} alt="Skill idea" />
    }

    return (
      <Box
        key="idea-band"
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        columnGap="sm"
        width="100%"
      >
        <Box flexDirection="row" alignItems="center" columnGap="sm" flexShrink={1} minWidth={0}>
          {mark}
          <Text mono weight="semibold">
            /{pick.skill}
          </Text>
          {row && (
            <Text size="footnote" dimColor wrap="truncate-end">
              {tagline(row.blurb)}
            </Text>
          )}
        </Box>
        <Box flexDirection="row" alignItems="center" columnGap="sm" flexShrink={0}>
          <Text size="caption" dimColor tabular>
            {pct}%
          </Text>
          <Button key="use" label="Use" variant="primary" onPress={press => usePick($, pick.skill, press.surface)} />
          <Button key="dismiss" label="Dismiss" role="dismiss" onPress={() => update($, picks, () => [])} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const Svg = e.surface === 'terminal' ? null : $.ui.resolve(e).Svg
    const Select = e.surface === 'mobile' ? null : $.ui.resolve(e).Select
    const hover = hoverTint(e.surface)
    const all = await read($, skills)
    const q = await read($, query)
    const opened = await read($, openGroups)
    const hiddenList = await read($, hidden)
    const isShowingHidden = await read($, showHidden)
    const keyed = await read($, hasKey)
    const isChecking = await read($, checking)
    const pinned = await read($, favorites)
    const use = await read($, usage)
    const look = await read($, theme)
    const justAdded = await read($, added)
    const ideas = await read($, picks)
    const check = await read($, lastCheck)
    const sum = await read($, totals)
    const newer = await read($, newerVersion)
    const isOn = await read($, suggestionsOn)
    const seen = await read($, tipSeen)
    const now = await $.clock.now()

    const visible = all.filter(r => !isHidden(r, hiddenList))
    const isSuggesting = isOn && keyed
    // An idea for a skill that has since gone or been hidden is not shown.
    const known = shownPicks(ideas, visible)
    const first = known[0]

    // A section label: small, quiet, with an optional count.
    const label = (text: string, count?: number) => (
      <Box flexDirection="row" alignItems="center" columnGap="xs" paddingX="sm">
        <Text size="footnote" weight="semibold">
          {text}
        </Text>
        {count !== undefined && (
          <Text size="caption" dimColor tabular>
            {count}
          </Text>
        )}
      </Box>
    )

    // One skill on one line: the command, then what it does in grey. The
    // row lights on hover, and Pin and Hide appear at the right. Just
    // clicked, it says "added" for a moment instead.
    const row = (r: SkillRow, prefix: string, name = r.name) => (
      <Box
        key={`${prefix}row:${r.name}`}
        flexDirection="row"
        alignItems="center"
        columnGap="sm"
        paddingX="sm"
        hover={{ backgroundColor: hover }}
      >
        <Box flexShrink={0}>
          <Button key={`${prefix}skill:${r.name}`} plain onPress={press => useSkill($, r.name, press.surface)}>
            <Text mono>{`/${name}`}</Text>
          </Button>
        </Box>
        {justAdded === r.name ? (
          <Box flexDirection="row" alignItems="center" columnGap="xs" flexGrow={1}>
            {Svg && <Svg source={spark(10, look)} alt=" " />}
            <Text size="footnote" weight="medium">
              added
            </Text>
          </Box>
        ) : (
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text size="footnote" dimColor wrap="truncate-end">
              {r.blurb}
            </Text>
          </Box>
        )}
        <Box {...reveal(e.surface)} flexDirection="row" columnGap="sm" flexShrink={0}>
          <Button key={`${prefix}pin:${r.name}`} plain dimColor onPress={() => toggleFavorite($, r.name)}>
            {pinned.includes(r.name) ? 'Unpin' : 'Pin'}
          </Button>
          <Button
            key={`${prefix}hide:${r.name}`}
            plain
            dimColor
            onPress={() => hide($, `skill:${r.name}`)}
          >
            Hide
          </Button>
        </Box>
      </Box>
    )

    // The strip at the top says what the picker is doing right now.
    let state: 'idle' | 'checking' | 'match' = 'idle'
    let doing = 'waiting for you to type'
    if (!isSuggesting) doing = 'suggestions are off'
    else if (isChecking) {
      state = 'checking'
      doing = 'checking your message…'
    } else if (first) {
      state = 'match'
      doing = `found one · /${first.skill}`
    }
    const banner = (
      <Box key="banner" flexDirection="column" rowGap="xs">
        {Svg ? <Svg source={strip(state, look)} alt="Skill picker" /> : <Text color="suggestion">▚▞▚▞▚▞</Text>}
        <Text key="doing" size="caption" mono dimColor>
          {doing}
        </Text>
      </Box>
    )

    // Search and the suggestions switch share one row. Without a key the
    // switch says so and does nothing.
    let switchLabel = isOn ? 'Suggest: on' : 'Suggest: off'
    if (!keyed) switchLabel = 'Suggest: needs a key'
    let field = null
    if (e.surface !== 'mobile') {
      const { Input } = $.ui.resolve(e)
      field = (
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Input
            key="search"
            placeholder={`Search ${visible.length} skills`}
            value={q}
            onInput={value => update($, query, () => value)}
            onSubmit={value => update($, query, () => value)}
          />
        </Box>
      )
    }
    const toolbar = (
      <Box key="toolbar" flexDirection="row" alignItems="center" justifyContent="space-between" columnGap="sm">
        {field}
        <Box flexShrink={0}>
          <Button
            key="suggestions-switch"
            label={switchLabel}
            plain
            dimColor={!isSuggesting}
            onPress={() => (keyed ? setSuggestions($, !isOn) : undefined)}
          />
        </Box>
      </Box>
    )

    const tip = !seen && (
      <Box
        key="tip"
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        borderStyle="round"
        borderDimColor
        paddingX="sm"
      >
        <Text size="caption">Tip: click any skill to add it to your message.</Text>
        <Button key="tip-close" label="Got it" plain dimColor onPress={() => hideTip($)} />
      </Box>
    )
    const updateNote = newer && (
      <Box key="update" flexDirection="row" alignItems="center" columnGap="xs" borderStyle="round" borderDimColor paddingX="sm">
        <Text size="caption" weight="semibold">
          Update ready: v{newer}
        </Text>
        <Text size="caption" dimColor>
          run /plugin update skill-picker, then restart
        </Text>
      </Box>
    )

    // The idea card: a plain frame, the commands in mono, the pixel spark
    // and meters as the only color. The top pick gets its reason and the
    // buttons; the others are one line each, and a click uses them.
    const match = (p: Suggestion) => {
      const pct = Math.round(p.probability * 100)

      return (
        <Box flexDirection="row" alignItems="center" columnGap="xs" flexShrink={0}>
          {Svg && <Svg source={meter(p.probability, look)} alt={`${pct}% match`} />}
          <Text size="caption" dimColor tabular>
            {pct}%
          </Text>
        </Box>
      )
    }
    let card = null
    if (isChecking) {
      card = (
        <Box key="idea" flexDirection="column" borderStyle="round" borderDimColor padding="sm">
          <Text size="caption" mono dimColor>
            scanning {offered(all, hiddenList).length} skills…
          </Text>
        </Box>
      )
    } else if (first) {
      card = (
        <Box key="idea" flexDirection="column" borderStyle="round" borderDimColor padding="sm" rowGap="xs">
          <Box flexDirection="row" alignItems="center" columnGap="xs">
            {Svg ? <Svg source={spark(12, look)} alt="Skill idea" /> : <Text color="suggestion">✻</Text>}
            <Text size="caption" weight="semibold" dimColor>
              SUGGESTED
            </Text>
          </Box>
          <Box flexDirection="row" alignItems="center" justifyContent="space-between" columnGap="sm">
            <Text mono weight="semibold" wrap="truncate-end">
              /{first.skill}
            </Text>
            {match(first)}
          </Box>
          <Text size="footnote" dimColor wrap="truncate-end">
            {all.find(r => r.name === first.skill)?.blurb ?? ''}
          </Text>
          <Box flexDirection="row" justifyContent="flex-end" columnGap="xs">
            <Button key="card-dismiss" label="Dismiss" plain dimColor onPress={() => update($, picks, () => [])} />
            <Button
              key="card-use"
              label="Use"
              variant="primary"
              onPress={press => usePick($, first.skill, press.surface)}
            />
          </Box>
          {known.slice(1).map(p => (
            <Box
              key={`pick-row:${p.skill}`}
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
              columnGap="sm"
              hover={{ backgroundColor: hover }}
            >
              <Button key={`pick:${p.skill}`} plain onPress={press => usePick($, p.skill, press.surface)}>
                <Text mono>{`/${p.skill}`}</Text>
              </Button>
              {match(p)}
            </Box>
          ))}
        </Box>
      )
    }

    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    let list
    if (words.length > 0) {
      // A search looks in every section, open or closed.
      const found = visible.filter(r => matches(r, words))
      list = (
        <Box flexDirection="column" rowGap="xs">
          {label('Results', found.length)}
          {found.length === 0 && (
            <Box key="no-results" flexDirection="column" alignItems="center" rowGap="sm" paddingY="md">
              {Svg ? <Svg source={emptyFace(look)} alt="No results" /> : <Text dimColor>x_x</Text>}
              <Text size="footnote" dimColor>
                No skill matches that. Try another word.
              </Text>
            </Box>
          )}
          {found.map(r => row(r, ''))}
        </Box>
      )
    } else {
      const pinnedRows = pinned.map(n => visible.find(r => r.name === n)).filter((r): r is SkillRow => r !== undefined)
      const mostUsed = visible
        .filter(r => (use.counts[r.name] ?? 0) > 0)
        .sort((a, b) => (use.counts[b.name] ?? 0) - (use.counts[a.name] ?? 0))
        .slice(0, MOST_USED_MAX)
      const groups = [...new Set(visible.map(r => r.group))]
      list = (
        <Box flexDirection="column" rowGap="md">
          {all.length === 0 && <Text dimColor>No skills found yet. Run /skill-picker to reload.</Text>}
          {pinnedRows.length > 0 && (
            <Box key="favorites" flexDirection="column" rowGap="xs">
              {label('Favorites')}
              {pinnedRows.map(r => row(r, 'fav:'))}
            </Box>
          )}
          {mostUsed.length > 0 && (
            <Box key="most-used" flexDirection="column" rowGap="xs">
              {label('Most used')}
              {mostUsed.map(r => row(r, 'top:'))}
            </Box>
          )}
          <Box flexDirection="column" rowGap="xs">
            {groups.map(g => {
              const inGroup = visible.filter(r => r.group === g)
              const isOpen = opened.includes(g)

              return (
                <Box key={`group:${g}`} flexDirection="column" rowGap="xs">
                  <Box key={`head:${g}`} flexDirection="row" alignItems="center" columnGap="sm" paddingX="sm">
                    {/* The tile sits outside the hover box: the desktop drops a drawing inside one. */}
                    {Svg && (
                      <Box flexShrink={0}>
                        <Svg source={tile(g, look)} alt={`${groupTitle(g)} section`} />
                      </Box>
                    )}
                  <Box
                    flexDirection="row"
                    alignItems="center"
                    justifyContent="space-between"
                    flexGrow={1}
                    flexShrink={1}
                    minWidth={0}
                    hover={{ backgroundColor: hover }}
                  >
                    <Box flexDirection="row" alignItems="center" columnGap="xs" flexShrink={1}>
                      <Button
                        key={`toggle:${g}`}
                        plain
                        onPress={() =>
                          update($, openGroups, was => (was.includes(g) ? was.filter(x => x !== g) : [...was, g]))
                        }
                      >
                        {`${groupTitle(g)} ${isOpen ? '▾' : '▸'}`}
                      </Button>
                    </Box>
                    <Box flexDirection="row" alignItems="center" columnGap="xs" flexShrink={0}>
                      <Box {...reveal(e.surface)}>
                        <Button
                          key={`hide-group:${g}`}
                          plain
                          dimColor
                          onPress={() => hide($, `group:${g}`)}
                        >
                          Hide
                        </Button>
                      </Box>
                      <Text size="caption" dimColor tabular>
                        {inGroup.length}
                      </Text>
                    </Box>
                  </Box>
                  </Box>
                  {isOpen && (
                    <Box flexDirection="column" marginBottom="sm">
                      {/* The heading already names the plugin, so the row drops it. */}
                      {inGroup.map(r => row(r, '', r.name.slice(r.name.indexOf(':') + 1)))}
                    </Box>
                  )}
                </Box>
              )
            })}
          </Box>
        </Box>
      )
    }

    // What is hidden, each with a way back.
    const hiddenRows = hiddenList.map(entry => {
      const isGroup = entry.startsWith('group:')
      const id = entry.slice(entry.indexOf(':') + 1)
      const count = isGroup ? all.filter(r => r.group === id).length : 0
      const shown = isGroup ? `${groupTitle(id)} · ${count}` : (all.find(r => r.name === id)?.label ?? id)

      return (
        <Box
          key={`hidden:${entry}`}
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          paddingX="sm"
          hover={{ backgroundColor: hover }}
        >
          <Text size="footnote" dimColor>
            {shown}
          </Text>
          <Button key={`show:${entry}`} plain onPress={() => setHidden($, was => was.filter(x => x !== entry))}>
            Show
          </Button>
        </Box>
      )
    })

    let status = 'Pause while typing (4+ words) and Jev suggests a fitting skill.'
    if (!keyed) status = 'Suggestions are off: set TYPESAFE_API_KEY, then start a new session.'
    else if (!isOn) status = 'Suggestions are off. Turn them on next to the search box.'
    else if (check?.error) status = `Last Jev check failed: ${check.error}`
    else if (check) {
      const best = check.picked ? `top pick /${check.picked} at ${Math.round(check.probability * 100)}%` : 'no skill fit'
      status = `Last check: ${best} · ${check.inputTokens} tokens · ${usd(check.costUsd)}`
    }

    // The last seven days, oldest first, today last.
    const week = [6, 5, 4, 3, 2, 1, 0].map(ago => use.days[dayKeyAgo(now, ago)] ?? 0)
    const usedThisWeek = week.reduce((a, b) => a + b, 0)
    const footer = (
      <Box key="footer" flexDirection="column" rowGap="xs" paddingX="sm">
        <Box flexDirection="row" alignItems="center" columnGap="sm">
          {Svg && <Svg source={weekChart(week, look)} alt="Skills used on each of the last 7 days" />}
          <Text key="week" size="caption" dimColor>
            {`${usedThisWeek} ${usedThisWeek === 1 ? 'skill' : 'skills'} used this week`}
          </Text>
        </Box>
        <Box flexDirection="row" alignItems="center" columnGap="sm" flexWrap="wrap">
          {Svg && Select ? (
            <Box key="theme-chips" flexDirection="row" alignItems="center" columnGap="xs">
              {/* A Button cannot hold a drawing, so the chips show the colors and the Select picks one. */}
              {THEMES.map(name => (
                <Svg key={`chip:${name}`} source={swatch(name, name === look)} alt={`${name} colors`} />
              ))}
              <Select
                key="theme"
                options={THEMES.map(name => ({ value: name, label: `${name.slice(0, 1).toUpperCase()}${name.slice(1)}` }))}
                value={look}
                onSelect={value => {
                  if (isTheme(value)) return setTheme($, value)
                }}
              />
            </Box>
          ) : (
            THEMES.map(name => (
              <Button
                key={`theme:${name}`}
                label={`${name.slice(0, 1).toUpperCase()}${name.slice(1)}`}
                plain
                dimColor={name !== look}
                onPress={() => setTheme($, name)}
              />
            ))
          )}
        </Box>
        <Text key="status" size="caption" dimColor>
          {status}
        </Text>
        {sum.checks > 0 && (
          <Text size="caption" dimColor>
            This session: {sum.checks} checks · {sum.inputTokens} tokens · {usd(sum.costUsd)}
          </Text>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column" paddingX="sm" paddingY="sm" rowGap="md">
        {banner}
        {toolbar}
        {tip}
        {updateNote}
        {card}
        {list}
        {hiddenList.length > 0 && (
          <Box flexDirection="column" rowGap="xs">
            <Box key="hidden-head" flexDirection="row" alignItems="center" paddingX="sm">
              <Button key="toggle-hidden" plain dimColor onPress={() => update($, showHidden, was => !was)}>
                {`${isShowingHidden ? '▾' : '▸'} Hidden · ${hiddenList.length}`}
              </Button>
            </Box>
            {isShowingHidden && (
              <Box flexDirection="column" rowGap="xs">
                {hiddenRows}
              </Box>
            )}
          </Box>
        )}
        {footer}
      </Box>
    )
  })
}
