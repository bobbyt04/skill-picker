import { atom, read, update } from 'claude-code'
import type { CommandInfo, EngineInterface, Register, Timer } from 'claude-code'

import type { Check, SkillRow, Suggestion } from '../types'

import { ACCENT, banner, meter, spark, spinner, tile } from './pixels'

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

// Hidden until the person shows it again (they never use S&P Global).
const DEFAULT_HIDDEN = ['group:sp-global']
const HIDDEN_STORE_KEY = 'hidden'
const RECENT_STORE_KEY = 'recent'
const RECENT_MAX = 5

const skills = atom({ plugin: 'skill-picker', key: 'skills' } as const, [], { shape: 'skills-3' })
const query = atom({ plugin: 'skill-picker', key: 'query' } as const, '')
const openGroups = atom({ plugin: 'skill-picker', key: 'openGroups' } as const, ['your-skills'], {
  shape: 'groups-2',
})
const hidden = atom({ plugin: 'skill-picker', key: 'hidden' } as const, DEFAULT_HIDDEN, { shape: 'hidden-1' })
const showHidden = atom({ plugin: 'skill-picker', key: 'showHidden' } as const, false)
const hasKey = atom({ plugin: 'skill-picker', key: 'hasKey' } as const, false)
const checking = atom({ plugin: 'skill-picker', key: 'checking' } as const, false)
const recent = atom({ plugin: 'skill-picker', key: 'recent' } as const, [], { shape: 'recent-1' })
const suggestion = atom({ plugin: 'skill-picker', key: 'suggestion' } as const, null, { shape: 'suggestion-2' })
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
const VERSION = '0.2.1'
// Like gstack: check GitHub for a newer version at most twice a day, and say
// so in the panel. Nothing about the person is sent; it is a plain download.
const LATEST_URL = 'https://raw.githubusercontent.com/bobbyt04/skill-picker/main/.claude-plugin/plugin.json'
const UPDATE_CHECK_MS = 12 * 60 * 60 * 1000
const UPDATE_STORE_KEY = 'update-check'
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

// The hidden list lives in $.store so it outlasts the session.
async function setHidden($: EngineInterface, change: (list: string[]) => string[]): Promise<void> {
  const next = change([...(await read($, hidden))])
  await update($, hidden, () => next)
  await $.store.set(HIDDEN_STORE_KEY, next)
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
  const next = [name, ...(await read($, recent)).filter(n => n !== name)].slice(0, RECENT_MAX)
  await update($, recent, () => next)
  await $.store.set(RECENT_STORE_KEY, next)
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

async function recordCheck($: EngineInterface, seq: number, check: Check, pick: Suggestion | null): Promise<void> {
  if (seq !== checkSeq) {
    await debug($, `result dropped as stale (check ${seq}, newest ${checkSeq})`)
    return
  }
  await debug($, `result stored: idea=${pick ? `/${pick.skill} ${pick.probability.toFixed(2)}` : 'none'}`)
  await update($, lastCheck, () => check)
  await update($, totals, t => ({
    checks: t.checks + (check.inputTokens > 0 ? 1 : 0),
    inputTokens: t.inputTokens + check.inputTokens,
    costUsd: t.costUsd + check.costUsd,
  }))
  await update($, suggestion, () => pick)
}

async function recommend($: EngineInterface, text: string): Promise<void> {
  const key = await $.env.get('TYPESAFE_API_KEY')
  await update($, hasKey, () => Boolean(key))
  if (!key) return

  let all = await read($, skills)
  if (all.length === 0) all = await refreshSkills($)
  const hiddenList = await read($, hidden)
  // Hidden skills are never offered, nor Claude Code's own commands and
  // connector prompts: fewer choices make each check cheaper and sharper.
  const rows = all.filter(r => !isHidden(r, hiddenList) && r.group !== 'built-in' && r.group !== 'connectors')
  if (rows.length === 0) return

  const seq = ++checkSeq
  await update($, checking, () => true)
  try {
    await ask($, seq, key, text, rows)
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
      await recordCheck($, seq, failed('timed out'), null)
      return
    }
  } catch {
    await recordCheck($, seq, failed('network error'), null)
    return
  }
  if (!res.ok) {
    await recordCheck($, seq, failed(`HTTP ${res.status}`), null)
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
    await recordCheck($, seq, failed('unreadable reply'), null)
    return
  }

  // The best non-"none" choice across the questions.
  let best: Suggestion | null = null
  // Across questions, each question's likeliest skill (not "none"), so a
  // strong fit in one half of the list is not lost to "none" in the other.
  let noneOfBest = 1
  for (const answer of Object.values(body.answers ?? {})) {
    for (const [id, probability] of Object.entries(answer.probabilities ?? {})) {
      if (id === 'none') continue
      const name = nameOf.get(id)
      if (name && (!best || probability > best.probability)) {
        best = { skill: name, probability }
        noneOfBest = answer.probabilities?.none ?? 0
      }
    }
  }

  const inputTokens = body.usage?.input_tokens ?? 0
  const check: Check = {
    picked: best?.skill ?? null,
    probability: best?.probability ?? 0,
    inputTokens,
    costUsd: inputTokens * JEV_USD_PER_INPUT_TOKEN,
  }
  // Shown when Jev is sure of it, or when it is sure SOME skill fits and
  // this one leads, its vote split with near-twins (three brainstorm skills).
  const isSure = best !== null && best.probability >= MIN_PROBABILITY
  const isSplit = best !== null && best.probability >= SPLIT_MIN_PROBABILITY && noneOfBest <= SPLIT_MAX_NONE
  const shown = isSure || isSplit ? best : null
  await recordCheck($, seq, check, shown)
}

function matches(row: SkillRow, words: string[]): boolean {
  const hay = `${row.name} ${row.blurb} ${groupTitle(row.group)}`.toLowerCase()

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


// Soft purple washes for hovered rows and the suggestion card. The terminal
// takes theme colors; the other surfaces take CSS colors.
function tints(surface: string) {
  const isTerminal = surface === 'terminal'

  return {
    hover: isTerminal ? 'subtle' : 'rgba(139, 92, 246, 0.10)',
    card: isTerminal ? undefined : 'rgba(139, 92, 246, 0.08)',
    accent: isTerminal ? 'suggestion' : ACCENT,
  }
}

// Hide shows on hover only where there is a pointer; elsewhere it stays put.
function reveal(surface: string) {
  return surface === 'desktop' || surface === 'vscode'
    ? ({ display: 'none', hover: { display: 'flex' } } as const)
    : ({ display: 'flex' } as const)
}

// Clears the idea and any check still out, which is now stale.
async function dropIdea($: EngineInterface): Promise<void> {
  checkSeq += 1
  if ((await read($, suggestion)) !== null) await debug($, 'idea cleared (draft too short, a slash command, or sent)')
  if (await read($, checking)) await update($, checking, () => false)
  if ((await read($, suggestion)) !== null) await update($, suggestion, () => null)
}

async function loadStored($: EngineInterface): Promise<void> {
  const stored = strings(await $.store.get(HIDDEN_STORE_KEY))
  await update($, hidden, () => stored ?? DEFAULT_HIDDEN)
  if (!stored) await $.store.set(HIDDEN_STORE_KEY, DEFAULT_HIDDEN)
  const used = strings(await $.store.get(RECENT_STORE_KEY))
  if (used) await update($, recent, () => used.slice(0, RECENT_MAX))
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

  // The idea above the prompt, on one line: the pixel spark, the command,
  // a few words on what it does; then the meter, Use and close.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const pick = await read($, suggestion)
    if (e.props.hasSurvey || pick === null) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const t = tints(e.surface)
    const pct = Math.round(pick.probability * 100)
    const row = (await read($, skills)).find(r => r.name === pick.skill)
    let mark = <Text color={t.accent}>✻</Text>
    if (e.surface !== 'terminal') {
      const { Svg } = $.ui.resolve(e)
      mark = <Svg source={spark(16)} alt="Skill idea" />
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
          <Button
            key="use"
            label="Use"
            variant="primary"
            onPress={async press => {
              await useSkill($, pick.skill, press.surface)
              await update($, suggestion, () => null)
            }}
          />
          <Button key="dismiss" label="Dismiss" role="dismiss" onPress={() => update($, suggestion, () => null)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const Svg = e.surface === 'terminal' ? null : $.ui.resolve(e).Svg
    const t = tints(e.surface)
    const all = await read($, skills)
    const q = await read($, query)
    const opened = await read($, openGroups)
    const hiddenList = await read($, hidden)
    const isShowingHidden = await read($, showHidden)
    const keyed = await read($, hasKey)
    const isChecking = await read($, checking)
    const used = await read($, recent)
    const pick = await read($, suggestion)
    const check = await read($, lastCheck)
    const sum = await read($, totals)
    const newer = await read($, newerVersion)

    const visible = all.filter(r => !isHidden(r, hiddenList))

    const icon = (g: string) => (Svg ? <Svg source={tile(g)} alt=" " width={10} height={10} /> : null)

    // A section label: small, quiet, with an optional count.
    const label = (text: string, count?: number) => (
      <Box flexDirection="row" alignItems="center" columnGap="xs">
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

    // One skill: its short name over a one-line description. The row lights
    // on hover and Hide appears at the right.
    const row = (r: SkillRow, prefix: string, withGroup = false) => (
      <Box key={`${prefix}row:${r.name}`} flexDirection="column" hover={{ backgroundColor: t.hover }}>
        <Box flexDirection="row" alignItems="center" justifyContent="space-between" paddingX={1} paddingY="xs">
          <Box flexDirection="column" flexShrink={1}>
            <Button key={`${prefix}skill:${r.name}`} label={`/${r.name}`} plain onPress={press => useSkill($, r.name, press.surface)}>
              {r.label}
            </Button>
            <Text size="footnote" dimColor wrap="truncate-end">
              {withGroup ? `${groupTitle(r.group)} · ${r.blurb}` : r.blurb}
            </Text>
          </Box>
          <Box {...reveal(e.surface)} flexShrink={0}>
            <Button
              key={`${prefix}hide:${r.name}`}
              plain
              dimColor
              onPress={() => setHidden($, list => [...list, `skill:${r.name}`])}
            >
              <Text size="caption">Hide</Text>
            </Button>
          </Box>
        </Box>
      </Box>
    )

    // Header: the pixel banner, then a one-line summary.
    const summary = `${visible.length} skills · ${keyed ? 'Jev suggestions on' : 'suggestions off'}`
    const header = (
      <Box flexDirection="column" rowGap="xs">
        {Svg ? (
          <Svg source={banner()} alt="Skills" />
        ) : (
          <Text weight="bold" color={t.accent}>
            ▚▞ SKILLS ▚▞
          </Text>
        )}
        <Text size="caption" dimColor>
          {summary}
        </Text>
        {newer && (
          <Box flexDirection="row" alignItems="center" columnGap="xs" borderStyle="round" borderColor={t.accent} paddingX={1}>
            <Text size="caption" weight="semibold" color={t.accent}>
              Update ready: v{newer}
            </Text>
            <Text size="caption" dimColor>
              run /plugin update skill-picker, then restart
            </Text>
          </Box>
        )}
      </Box>
    )

    let field = null
    if (e.surface !== 'mobile') {
      const { Input } = $.ui.resolve(e)
      field = (
        <Input
          key="search"
          placeholder="Search skills…"
          value={q}
          onInput={value => update($, query, () => value)}
          onSubmit={value => update($, query, () => value)}
        />
      )
    }

    // The idea card: quiet until it matters. Neutral frame (purple only on
    // hover), the command in mono, the pixel spark and meter as the color.
    const suggested = pick && all.find(r => r.name === pick.skill)
    let card = null
    if (pick && suggested) {
      const pct = Math.round(pick.probability * 100)
      card = (
        <Box
          key="idea"
          flexDirection="column"
          borderStyle="round"
          borderDimColor
          padding="sm"
          rowGap="xs"
          hover={{ borderColor: t.accent }}
        >
          <Box flexDirection="row" alignItems="center" justifyContent="space-between">
            <Box flexDirection="row" alignItems="center" columnGap="xs">
              {Svg ? <Svg source={spark(12)} alt="Skill idea" /> : <Text color={t.accent}>✻</Text>}
              <Text size="caption" weight="semibold" dimColor>
                SUGGESTED
              </Text>
            </Box>
            <Box flexDirection="row" alignItems="center" columnGap="xs">
              {Svg && <Svg source={meter(pick.probability)} alt={`${pct}% match`} />}
              <Text size="caption" dimColor tabular>
                {pct}%
              </Text>
            </Box>
          </Box>
          <Text mono weight="semibold">
            /{suggested.name}
          </Text>
          <Text size="footnote" dimColor wrap="truncate-end">
            {suggested.blurb}
          </Text>
          <Box flexDirection="row" justifyContent="flex-end" columnGap="xs">
            <Button key="card-dismiss" label="Dismiss" plain dimColor onPress={() => update($, suggestion, () => null)} />
            <Button
              key="card-use"
              label="Use"
              variant="primary"
              onPress={async press => {
                await useSkill($, suggested.name, press.surface)
                await update($, suggestion, () => null)
              }}
            />
          </Box>
        </Box>
      )
    }

    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    let list
    if (words.length > 0) {
      const found = visible.filter(r => matches(r, words))
      list = (
        <Box flexDirection="column" rowGap="xs">
          {label('Results', found.length)}
          {found.length === 0 && <Text dimColor>No skill matches “{q}”.</Text>}
          {found.map(r => row(r, '', true))}
        </Box>
      )
    } else {
      const recentRows = used
        .map(n => visible.find(r => r.name === n))
        .filter((r): r is SkillRow => r !== undefined)
      const groups = [...new Set(visible.map(r => r.group))]
      list = (
        <Box flexDirection="column" rowGap="md">
          {all.length === 0 && <Text dimColor>No skills found yet. Run /skill-picker to reload.</Text>}
          {recentRows.length > 0 && (
            <Box flexDirection="column" rowGap="xs" marginBottom="sm">
              <Box paddingX={1}>{label('Recent')}</Box>
              {recentRows.map(r => row(r, 'recent:'))}
            </Box>
          )}
          {groups.map(g => {
            const inGroup = visible.filter(r => r.group === g)
            const isOpen = opened.includes(g)
            const toggle = () =>
              update($, openGroups, now => (now.includes(g) ? now.filter(x => x !== g) : [...now, g]))

            return (
              <Box key={`group:${g}`} flexDirection="column" rowGap="xs">
                <Box
                  key={`head:${g}`}
                  flexDirection="row"
                  alignItems="center"
                  justifyContent="space-between"
                  paddingX={1}
                  hover={{ backgroundColor: t.hover }}
                >
                  <Box flexDirection="row" alignItems="center" columnGap="xs" flexShrink={1}>
                    {icon(g)}
                    <Button key={`toggle:${g}`} plain onPress={toggle}>
                      <Text size="footnote" weight="semibold">
                        {groupTitle(g)}
                      </Text>
                      <Text size="caption" dimColor>
                        {isOpen ? ' ▾' : ' ▸'}
                      </Text>
                    </Button>
                  </Box>
                  <Box flexDirection="row" alignItems="center" columnGap="xs" flexShrink={0}>
                    <Box {...reveal(e.surface)}>
                      <Button
                        key={`hide-group:${g}`}
                        plain
                        dimColor
                        onPress={() => setHidden($, now => [...now, `group:${g}`])}
                      >
                        <Text size="caption">Hide</Text>
                      </Button>
                    </Box>
                    <Text size="caption" dimColor tabular>
                      {inGroup.length}
                    </Text>
                  </Box>
                </Box>
                {isOpen && (
                  <Box flexDirection="column" rowGap="xs" marginBottom="sm">
                    {inGroup.map(r => row(r, ''))}
                  </Box>
                )}
              </Box>
            )
          })}
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
          paddingX={1}
          hover={{ backgroundColor: t.hover }}
        >
          <Text size="footnote" dimColor>
            {shown}
          </Text>
          <Button key={`show:${entry}`} plain onPress={() => setHidden($, now => now.filter(x => x !== entry))}>
            <Text size="caption" weight="medium">
              Show
            </Text>
          </Button>
        </Box>
      )
    })

    let status = 'Pause while typing (4+ words) and Jev suggests a fitting skill.'
    if (!keyed) status = 'Suggestions are off: set TYPESAFE_API_KEY, then start a new session.'
    else if (check?.error) status = `Last Jev check failed: ${check.error}`
    else if (check) {
      const top = check.picked ? `top pick /${check.picked} at ${Math.round(check.probability * 100)}%` : 'no skill fit'
      status = `Last check: ${top} · ${check.inputTokens} tokens · ${usd(check.costUsd)}`
    }

    const footer = (
      <Box flexDirection="column" paddingX={1}>
        {isChecking ? (
          <Box flexDirection="row" alignItems="center" columnGap="xs">
            {Svg ? <Svg source={spinner()} alt="Checking" /> : <Text color={t.accent}>◐</Text>}
            <Text size="caption" weight="medium">
              Jev is reading your message…
            </Text>
          </Box>
        ) : (
          <Text size="caption" dimColor>
            {status}
          </Text>
        )}
        {sum.checks > 0 && (
          <Text size="caption" dimColor>
            This session: {sum.checks} checks · {sum.inputTokens} tokens · {usd(sum.costUsd)}
          </Text>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column" paddingX={1} paddingY={1} rowGap="lg">
        {header}
        {field}
        {card}
        {list}
        {hiddenList.length > 0 && (
          <Box flexDirection="column" rowGap="xs">
            <Box key="hidden-head" flexDirection="row" alignItems="center" paddingX={1}>
              <Button key="toggle-hidden" plain dimColor onPress={() => update($, showHidden, now => !now)}>
                <Text size="footnote" weight="semibold">
                  {isShowingHidden ? '▾' : '▸'} Hidden · {hiddenList.length}
                </Text>
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
