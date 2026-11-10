import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { CommandInfo, On, PromptEditInput } from 'claude-code'
import { VERSION } from '../hooks/register'

const PANE = {
  plugin: 'skill-picker',
  component: 'Pane',
  requestId: 'skill-picker',
  props: {
    title: 'Skills',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'skill-picker',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 3,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 3 },
    view: {},
  },
} as const

const COMMANDS: CommandInfo[] = [
  { name: 'clear', description: 'Clear the conversation', source: 'builtin' },
  { name: 'grill-me', description: 'A relentless interview to sharpen a plan or design.', source: 'user' },
  { name: 'review', description: "Use when you review this PR's diff. (gstack)", source: 'user' },
  { name: 'learn', description: 'Manage project learnings.', source: 'user' },
  { name: 'engineering:debug', description: 'Structured debugging session. Reproduce, isolate.', source: 'plugin', plugin: 'engineering' },
  { name: 'engineering:code-review', description: 'Review code changes.', source: 'plugin', plugin: 'engineering' },
  { name: 'sp-global:tear-sheet', description: 'Company tear sheets.', source: 'plugin', plugin: 'sp-global' },
]

// The engine beneath the plugin: commands, gstack's folder, and a prompt
// box that records what is filled in.
function engine(on: On, draft = '', canFill = true) {
  const box = { text: draft }
  on('command.register', () => ({ value: { command: 'skill-picker' } }))
  on('command.list', () => ({ value: COMMANDS }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('fs.list', (_, e) => {
    const isGstack = e.path === '/home/bobby/.claude/skills/gstack'
    const dirs = isGstack ? ['review', 'learn', 'ship'] : []

    return { value: dirs.map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('prompt.read', () => ({ value: { text: box.text, cursor: box.text.length } }))
  on('prompt.fill', (_, e) => {
    if (!canFill) return { isFilled: false, refusal: 'no_composer' as const, text: '' }
    box.text = e.text

    return { isFilled: true }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('prompt.edit', (_, e) => {
    box.text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)

    return { text: box.text, cursor: e.start + e.inputText.length }
  })

  return box
}

// A store of the test's own, so it can read what the mod saved.
function store(on: On, saved: Record<string, unknown>) {
  on('store.get', (_, e) => ({ value: saved[e.key] }))
  on('store.set', (_, e) => {
    saved[e.key] = e.value

    return { value: undefined }
  })

  return saved
}

// Jev's reply with these probabilities; the panel's version check gets a 404.
function jev(on: On, probabilities: Record<string, number>) {
  const seen = { calls: 0 }
  on('http.fetch', (_, e) => {
    if (e.url.includes('raw.githubusercontent.com')) return { value: { status: 404, ok: false, headers: {}, text: '' } }
    seen.calls += 1
    const reply = { answers: { q0: { type: 'choice', probabilities } }, usage: { input_tokens: 100 } }

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(reply) } }
  })

  return seen
}

// The person replaces the whole draft with `draft`, as one burst of keys.
// The test engine raises prompt.edit, though its typing leaves it out.
function typeInto($: Engine, draft: string) {
  const prompt = $.prompt as unknown as { edit: (e: PromptEditInput) => Promise<unknown> }

  return prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: draft })
}

test('sections: your skills first, gstack next, all closed, S&P Global hidden', async ($, on) => {
  engine(on)
  mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const heads = await Promise.all(
    ['your-skills', 'gstack', 'engineering'].map(async g => (await ui.find({ key: `toggle:${g}` }))?.text),
  )
  expect(heads).toEqual(['Your skills ▸', 'gstack · Garry Tan ▸', 'Engineering ▸'])
  expect(await ui.find({ key: 'toggle:sp-global' })).toBeUndefined()
  expect((await ui.find({ key: 'toggle-hidden' }))?.text).toBe('▸ Hidden · 1')
  // The pixel strip leads the panel on desktop, and says what is going on.
  expect((await ui.findAll({ type: 'Svg' })).map(s => s.props.alt)).toContain('Skill picker')
  expect(await ui.find({ type: 'Text', text: 'suggestions are off' })).toBeDefined()

  // A section opens on a click; gstack holds "learn" though its description lacks the tag.
  expect(await ui.find({ key: 'skill:grill-me' })).toBeUndefined()
  await ui.press({ key: 'toggle:your-skills' })
  expect(await ui.find({ key: 'skill:grill-me' })).toBeDefined()
  await ui.press({ key: 'toggle:gstack' })
  expect(await ui.find({ key: 'skill:learn' })).toBeDefined()
  expect(await ui.find({ key: 'skill:review' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: "Use when you review this PR's diff." })).toBeDefined()
  expect(await ui.find({ key: 'skill:sp-global:tear-sheet' })).toBeUndefined()
  await ui.unmount()
})

test('a row inserts the full command, and search spans sections', async ($, on) => {
  const box = engine(on, 'my login page 500s')
  mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'toggle:engineering' })
  expect((await ui.find({ key: 'skill:engineering:debug' }))?.text).toBe('/debug')
  await ui.press({ key: 'skill:engineering:debug' })
  expect(box.text).toBe('/engineering:debug my login page 500s')
  expect(await ui.find({ key: 'top:skill:engineering:debug' })).toBeDefined()

  await ui.input({ key: 'search', text: 'review', kind: 'change' })
  expect(await ui.find({ key: 'skill:review' })).toBeDefined()
  expect(await ui.find({ key: 'skill:engineering:code-review' })).toBeDefined()
  expect(await ui.find({ key: 'skill:grill-me' })).toBeUndefined()
  await ui.unmount()
})

test('hiding a skill or a section sticks, and Show brings it back', async ($, on) => {
  engine(on)
  mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  const saved = store(on, { hidden: [] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'toggle:your-skills' })
  await ui.press({ key: 'hide:grill-me' })
  await ui.press({ key: 'hide-group:engineering' })
  expect(await ui.find({ key: 'skill:grill-me' })).toBeUndefined()
  expect(await ui.find({ key: 'toggle:engineering' })).toBeUndefined()
  expect(saved.hidden).toEqual(['skill:grill-me', 'group:engineering'])

  await ui.press({ key: 'toggle-hidden' })
  expect(await ui.find({ type: 'Text', text: 'Engineering · 2' })).toBeDefined()
  await ui.press({ key: 'show:skill:grill-me' })
  expect(await ui.find({ key: 'skill:grill-me' })).toBeDefined()
  expect(saved.hidden).toEqual(['group:engineering'])
  await ui.unmount()
})

test('Jev picks a skill for a message; hidden skills are not offered', async ($, on) => {
  const box = engine(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/bobby', TYPESAFE_API_KEY: 'test-key' })
  mock.store(on)
  let sent: { url: string; init?: { headers?: Record<string, string>; body?: string } } | undefined
  on('http.fetch', (_, e) => {
    sent = e
    const reply = {
      model: 'jev-1.14.0',
      answers: {
        q0: {
          type: 'choice',
          choice: 'engineering_debug',
          confidence: 0.8,
          probabilities: { engineering_debug: 0.8, none: 0.15, review: 0.05 },
        },
      },
      usage: { input_tokens: 5000, output_tokens: 3 },
    }

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(reply) } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await typeInto($, 'my login page throws a 500 after the deploy')
  await clock.advance(1000)

  expect(sent?.url).toBe('https://api.typesafe.ai/v1/systemone')
  expect(sent?.init?.headers?.Authorization).toBe('Bearer test-key')
  const body = JSON.parse(sent?.init?.body ?? '{}')
  expect(body.model).toBe('jev-1.14.0')
  const criteria = Object.keys(body.questions.q0.criteria)
  expect(criteria).toContain('none')
  expect(criteria).toContain('engineering_debug')
  expect(criteria).not.toContain('sp_global_tear_sheet')
  expect(criteria).toHaveLength(6)

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /engineering:debug/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: '80%' })).toBeDefined()
  await band.press({ key: 'use' })
  expect(box.text).toBe('/engineering:debug my login page throws a 500 after the deploy')
  await band.unmount()

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ type: 'Text', text: /5000 tokens · \$0\.00021/ })).toBeDefined()
  await pane.unmount()
})

test('a weak pick and short replies show nothing', async ($, on) => {
  engine(on)
  // Stands for the engine's own (empty) band beneath the plugin.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/bobby', TYPESAFE_API_KEY: 'test-key' })
  mock.store(on)
  let calls = 0
  on('http.fetch', (_, e) => {
    // The panel's version check is not a Jev call.
    if (e.url.includes('raw.githubusercontent.com')) return { value: { status: 404, ok: false, headers: {}, text: '' } }
    calls += 1
    const reply = {
      answers: { q0: { type: 'choice', choice: 'review', probabilities: { review: 0.2, none: 0.7 } } },
      usage: { input_tokens: 5000 },
    }

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(reply) } }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await typeInto($, 'ok do it')
  await clock.advance(1000)
  expect(calls).toBe(0)

  await typeInto($, 'what do you think about the weather today')
  await clock.advance(1000)
  expect(calls).toBe(1)

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ key: 'use' })).toBeUndefined()
  await band.unmount()
})

test('a shorter draft clears the idea, and a late reply cannot bring it back', async ($, on) => {
  engine(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/bobby', TYPESAFE_API_KEY: 'test-key' })
  mock.store(on)
  const replies: Array<(text: string) => void> = []
  on('http.fetch', () => new Promise(resolve => {
    replies.push(text => resolve({ value: { status: 200, ok: true, headers: {}, text } }))
  }))
  const pickDebug = JSON.stringify({
    answers: { q0: { type: 'choice', choice: 'engineering_debug', probabilities: { engineering_debug: 0.9 } } },
    usage: { input_tokens: 100 },
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await typeInto($, 'my login page throws a 500 after the deploy')
  await clock.advance(1000)
  // The draft is cut back to a few words before Jev answers.
  await typeInto($, 'ok thanks')
  await clock.settle()
  replies[0]?.(pickDebug)
  await clock.settle()

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ key: 'use' })).toBeUndefined()
  await band.unmount()
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ type: 'Text', text: /scanning|checking your message/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: 'waiting for you to type' })).toBeDefined()
  await pane.unmount()
})

test('the terminal gets text in place of pixel art, and Hide is always shown', async ($, on) => {
  engine(on)
  mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.findAll({ type: 'Svg' })).toEqual([])
  expect(await ui.find({ type: 'Text', text: '▚▞▚▞▚▞' })).toBeDefined()
  await ui.press({ key: 'toggle:your-skills' })
  await ui.press({ key: 'hide:grill-me' })
  expect(await ui.find({ key: 'skill:grill-me' })).toBeUndefined()
  await ui.unmount()
})

test('ideas come from a pause in typing, before sending; sending clears them', async ($, on) => {
  engine(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/bobby', TYPESAFE_API_KEY: 'test-key' })
  mock.store(on)
  let calls = 0
  on('http.fetch', (_, e) => {
    // The panel's version check is not a Jev call.
    if (e.url.includes('raw.githubusercontent.com')) return { value: { status: 404, ok: false, headers: {}, text: '' } }
    calls += 1
    const reply = {
      answers: { q0: { type: 'choice', choice: 'engineering_debug', probabilities: { engineering_debug: 0.9 } } },
      usage: { input_tokens: 100 },
    }

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(reply) } }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  // Still typing: each burst restarts the wait, so nothing is checked.
  await typeInto($, 'my login page throws')
  await clock.advance(500)
  await typeInto($, 'my login page throws a 500 after deploy')
  await clock.advance(500)
  expect(calls).toBe(0)
  // A pause: one check, and the idea is up before anything is sent.
  await clock.advance(500)
  expect(calls).toBe(1)
  let band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ key: 'use' })).toBeDefined()
  await band.unmount()
  // The same draft again is not checked twice.
  await typeInto($, 'my login page throws a 500 after deploy')
  await clock.advance(1000)
  expect(calls).toBe(1)

  await $.prompt.submit({ text: 'my login page throws a 500 after deploy', wait: false, origin: { kind: 'composer' } })
  await clock.settle()
  band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ key: 'use' })).toBeUndefined()
  await band.unmount()
  expect(calls).toBe(1)
})

test('where the chat box will not take it, a click copies the command and says so', async ($, on) => {
  engine(on, '', false)
  mock.clock(on)
  let copied = ''
  const toasts: string[] = []
  on('ui.copy', (_, e) => {
    copied = e.text

    return { value: { isCopied: true } }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  mock.env(on, { HOME: '/home/bobby' })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'toggle:your-skills' })
  await ui.press({ key: 'skill:grill-me' })
  expect(copied).toBe('/grill-me ')
  expect(toasts.join(' ')).toContain('Copied /grill-me')
  await ui.unmount()
})

test('once the person picks a skill themselves, no idea shows and the last one goes', async ($, on) => {
  engine(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/bobby', TYPESAFE_API_KEY: 'test-key' })
  mock.store(on)
  let calls = 0
  on('http.fetch', (_, e) => {
    // The panel's version check is not a Jev call.
    if (e.url.includes('raw.githubusercontent.com')) return { value: { status: 404, ok: false, headers: {}, text: '' } }
    calls += 1
    const reply = {
      answers: { q0: { type: 'choice', choice: 'engineering_debug', probabilities: { engineering_debug: 0.9 } } },
      usage: { input_tokens: 100 },
    }

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(reply) } }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await typeInto($, 'my login page throws a 500 after deploy')
  await clock.advance(1000)
  expect(calls).toBe(1)
  // The person types a skill of their own at the front of the message.
  await typeInto($, '/grill-me my login page throws a 500 after deploy')
  await clock.advance(1000)
  expect(calls).toBe(1)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ key: 'use' })).toBeUndefined()
  await band.unmount()
  // And sending it starts no check either.
  await $.prompt.submit({ text: '/grill-me my login page throws a 500 after deploy', wait: false, origin: { kind: 'composer' } })
  await clock.advance(1000)
  expect(calls).toBe(1)
})

test('a pick still shows when its vote is split with near-twins and none is unlikely', async ($, on) => {
  engine(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/bobby', TYPESAFE_API_KEY: 'test-key' })
  mock.store(on)
  on('http.fetch', () => {
    const reply = {
      answers: { q0: { type: 'choice', choice: 'review', probabilities: { review: 0.23, learn: 0.19, grill_me: 0.17, none: 0.08 } } },
      usage: { input_tokens: 100 },
    }

    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify(reply) } }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await typeInto($, 'i have an idea that i want to design a home app')
  await clock.advance(1000)
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: '/review' })).toBeDefined()
  await band.unmount()
})

test('a newer version on GitHub shows an update notice', async ($, on) => {
  engine(on)
  mock.env(on, { HOME: '/home/bobby' })
  const clock = mock.clock(on)
  mock.store(on)
  on('http.fetch', (_, e) => {
    const isVersion = e.url.includes('raw.githubusercontent.com')

    return { value: { status: 200, ok: true, headers: {}, text: isVersion ? JSON.stringify({ version: '9.0.0' }) : '{}' } }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'Update ready: v9.0.0' })).toBeDefined()
  await ui.unmount()
})

test('no notice when GitHub has the same version as this build', async ($, on) => {
  engine(on)
  mock.env(on, { HOME: '/home/bobby' })
  const clock = mock.clock(on)
  mock.store(on)
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ version: VERSION }) } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Update ready/ })).toBeUndefined()
  await ui.unmount()
})


test('the tip shows until a skill is clicked, and stays gone in later chats', async ($, on) => {
  engine(on)
  mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  const saved = store(on, {})
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Tip: click any skill/ })).toBeDefined()
  await ui.press({ key: 'toggle:your-skills' })
  await ui.press({ key: 'skill:grill-me' })
  expect(await ui.find({ type: 'Text', text: /Tip: click any skill/ })).toBeUndefined()
  expect(saved['click-tip-seen']).toBe(true)
  await ui.unmount()
})

test('turning suggestions off stops Jev checks and is remembered', async ($, on) => {
  engine(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/bobby', TYPESAFE_API_KEY: 'test-key' })
  const saved = store(on, {})
  const seen = jev(on, { engineering_debug: 0.9 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'suggestions-switch' }))?.text).toBe('Suggest: on')
  expect(await ui.find({ type: 'Text', text: 'waiting for you to type' })).toBeDefined()
  await ui.press({ key: 'suggestions-switch' })
  expect((await ui.find({ key: 'suggestions-switch' }))?.text).toBe('Suggest: off')
  expect(await ui.find({ type: 'Text', text: 'suggestions are off' })).toBeDefined()
  expect(saved['suggestions-on']).toBe(false)
  await ui.unmount()

  await typeInto($, 'my login page throws a 500 after deploy')
  await clock.advance(1000)
  expect(seen.calls).toBe(0)
})

test('one Jev reply gives up to three picks: the top one with buttons, the others as rows', async ($, on) => {
  const box = engine(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/bobby', TYPESAFE_API_KEY: 'test-key' })
  mock.store(on)
  const seen = jev(on, { engineering_debug: 0.4, review: 0.2, grill_me: 0.17, learn: 0.16, none: 0.07 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await typeInto($, 'my login page throws a 500 after the deploy')
  await clock.advance(1000)
  expect(seen.calls).toBe(1)

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ type: 'Text', text: 'found one · /engineering:debug' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '/engineering:debug' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Structured debugging session.' })).toBeDefined()
  expect(await pane.find({ key: 'card-use' })).toBeDefined()
  expect((await pane.find({ key: 'pick:review' }))?.text).toBe('/review')
  expect(await pane.find({ key: 'pick:grill-me' })).toBeDefined()
  // A fourth is never shown, however likely.
  expect(await pane.find({ key: 'pick:learn' })).toBeUndefined()
  for (const pct of ['40%', '20%', '17%']) expect(await pane.find({ type: 'Text', text: pct })).toBeDefined()

  // A click on another pick uses that skill, and the card goes.
  await pane.press({ key: 'pick:review' })
  expect(box.text).toBe('/review my login page throws a 500 after the deploy')
  expect(await pane.find({ key: 'card-use' })).toBeUndefined()
  expect(seen.calls).toBe(1)
  await pane.unmount()
})

test('a runner-up below 15% is left out', async ($, on) => {
  engine(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/bobby', TYPESAFE_API_KEY: 'test-key' })
  mock.store(on)
  jev(on, { engineering_debug: 0.7, review: 0.15, grill_me: 0.14, none: 0.01 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await typeInto($, 'my login page throws a 500 after the deploy')
  await clock.advance(1000)

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ key: 'card-use' })).toBeDefined()
  expect(await pane.find({ key: 'pick:review' })).toBeDefined()
  expect(await pane.find({ key: 'pick:grill-me' })).toBeUndefined()
  await pane.unmount()
})

test('no runners-up when the top pick itself is too weak to show', async ($, on) => {
  engine(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/bobby', TYPESAFE_API_KEY: 'test-key' })
  mock.store(on)
  jev(on, { review: 0.2, learn: 0.16, none: 0.6 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await typeInto($, 'what do you think about the weather today')
  await clock.advance(1000)

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ key: 'idea' })).toBeUndefined()
  expect(await pane.find({ key: 'pick:learn' })).toBeUndefined()
  await pane.unmount()
})

test('pinning a skill puts it under Favorites and is remembered; Unpin takes it back', async ($, on) => {
  engine(on)
  mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  const saved = store(on, { favorites: ['learn'] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Pinned in an earlier chat, shown though its section is closed.
  expect(await ui.find({ key: 'fav:skill:learn' })).toBeDefined()
  await ui.press({ key: 'toggle:your-skills' })
  expect((await ui.find({ key: 'pin:grill-me' }))?.text).toBe('Pin')
  await ui.press({ key: 'pin:grill-me' })
  expect(saved.favorites).toEqual(['learn', 'grill-me'])
  expect(await ui.find({ key: 'fav:skill:grill-me' })).toBeDefined()
  expect((await ui.find({ key: 'fav:pin:grill-me' }))?.text).toBe('Unpin')

  await ui.press({ key: 'fav:pin:grill-me' })
  expect(saved.favorites).toEqual(['learn'])
  expect(await ui.find({ key: 'fav:skill:grill-me' })).toBeUndefined()
  await ui.unmount()
})

test('each use is counted, feeds Most used and the week, and saves no message text', async ($, on) => {
  engine(on, 'a secret draft about payroll')
  mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  // The old Recent list starts the counts.
  const saved = store(on, { recent: ['learn'] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'top:skill:learn' })).toBeDefined()
  expect(await ui.find({ key: 'top:skill:grill-me' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '0 skills used this week' })).toBeDefined()

  await ui.press({ key: 'toggle:your-skills' })
  await ui.press({ key: 'skill:grill-me' })
  await ui.press({ key: 'skill:grill-me' })
  expect(await ui.find({ key: 'top:skill:grill-me' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '2 skills used this week' })).toBeDefined()

  const usage = saved.usage as { counts: Record<string, number>; days: Record<string, number> }
  expect(usage.counts).toEqual({ learn: 1, 'grill-me': 2 })
  expect(Object.values(usage.days)).toEqual([2])
  expect(Object.keys(usage.days)[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(JSON.stringify(saved)).not.toContain('payroll')
  await ui.unmount()
})

test('a clicked row says "added" for a moment', async ($, on) => {
  engine(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'toggle:your-skills' })
  await ui.press({ key: 'skill:grill-me' })
  expect(await ui.find({ type: 'Text', text: 'added' })).toBeDefined()
  await clock.advance(1300)
  expect(await ui.find({ type: 'Text', text: 'added' })).toBeUndefined()
  await ui.unmount()
})

test('sections start closed, yet search finds the rows inside them', async ($, on) => {
  engine(on)
  mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'skill:engineering:debug' })).toBeUndefined()
  expect(await ui.find({ key: 'skill:grill-me' })).toBeUndefined()
  await ui.input({ key: 'search', text: 'debug', kind: 'change' })
  expect(await ui.find({ key: 'skill:engineering:debug' })).toBeDefined()
  expect(await ui.find({ key: 'skill:grill-me' })).toBeUndefined()
  await ui.unmount()
})

test('search also reads the longer description, past the first sentence', async ($, on) => {
  engine(on)
  mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // "isolate" is in the second sentence, which the row does not show.
  await ui.input({ key: 'search', text: 'isolate', kind: 'change' })
  expect(await ui.find({ key: 'skill:engineering:debug' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /isolate/ })).toBeUndefined()
  await ui.unmount()
})

test('a search with no match shows the pixel face and a plain line', async ($, on) => {
  engine(on)
  mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'search', text: 'zzzz', kind: 'change' })
  expect(await ui.find({ type: 'Text', text: 'No skill matches that. Try another word.' })).toBeDefined()
  expect((await ui.findAll({ type: 'Svg' })).map(s => s.props.alt)).toContain('No results')
  await ui.unmount()
})

test('the color theme recolors the pixel art and is remembered', async ($, on) => {
  engine(on)
  mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  const saved = store(on, {})
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const art = async () => (await ui.findAll({ type: 'Svg' })).find(s => s.props.alt === 'Skill picker')?.props.source
  const purple = await art()
  await ui.select({ key: 'theme', value: 'amber' })
  expect(saved.theme).toBe('amber')
  expect(await art()).not.toBe(purple)
  await ui.unmount()
})

test('a saved theme is used in the next chat', async ($, on) => {
  engine(on)
  mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  const saved = store(on, { theme: 'mono' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const art = async () => (await ui.findAll({ type: 'Svg' })).find(s => s.props.alt === 'Skill picker')?.props.source
  const mono = await art()
  await ui.select({ key: 'theme', value: 'purple' })
  expect(saved.theme).toBe('purple')
  expect(await art()).not.toBe(mono)
  await ui.unmount()
})

// A typed message, a pause, and Jev's reply with these probabilities.
async function picked($: Engine, on: On, probabilities: Record<string, number>, saved: Record<string, unknown> = {}) {
  const box = engine(on)
  // What the engine draws where the band has nothing to show.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/bobby', TYPESAFE_API_KEY: 'test-key' })
  store(on, saved)
  jev(on, probabilities)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await typeInto($, 'my login page throws a 500 after the deploy')
  await clock.advance(1000)

  return { box, clock }
}

// Waits in real time, a little, for a held call to arrive.
async function until(isThere: () => boolean) {
  const { setTimeout: later } = globalThis as unknown as { setTimeout: (run: () => void, ms: number) => void }
  for (let i = 0; i < 100 && !isThere(); i += 1) await new Promise<void>(resolve => later(resolve, 5))
}

test('use days older than two weeks are dropped at the next use', async ($, on) => {
  engine(on)
  const now = new Date(2026, 5, 15, 9).getTime()
  mock.clock(on, { now })
  mock.env(on, { HOME: '/home/bobby' })
  const days = { '2026-05-20': 3, '2026-06-01': 4, '2026-06-02': 1, '2026-06-10': 2 }
  const saved = store(on, { usage: { counts: { learn: 10 }, days } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'toggle:your-skills' })
  await ui.press({ key: 'skill:grill-me' })
  // Fourteen days are kept, today included: June 2 is the oldest.
  expect((saved.usage as { days: Record<string, number> }).days).toEqual({
    '2026-06-02': 1,
    '2026-06-10': 2,
    '2026-06-15': 1,
  })
  await ui.unmount()
})

test('saved values of the wrong shape are ignored', async ($, on) => {
  engine(on)
  mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  store(on, { usage: { counts: { learn: 'many' }, days: 7 }, favorites: { learn: true }, theme: 'neon', hidden: 'all' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ key: 'toggle:your-skills' })).toBeDefined()
  expect(await ui.find({ key: 'fav:skill:learn' })).toBeUndefined()
  expect(await ui.find({ key: 'top:skill:learn' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '0 skills used this week' })).toBeDefined()
  await ui.unmount()
})

test('a pinned or counted skill that is hidden or gone is left out of Favorites and Most used', async ($, on) => {
  engine(on)
  mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  store(on, {
    favorites: ['learn', 'grill-me', 'gone-skill'],
    hidden: ['skill:grill-me'],
    usage: { counts: { 'gone-skill': 9, 'grill-me': 5, learn: 1 }, days: {} },
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (const list of ['fav', 'top']) {
    expect(await ui.find({ key: `${list}:skill:learn` })).toBeDefined()
    expect(await ui.find({ key: `${list}:skill:grill-me` })).toBeUndefined()
    expect(await ui.find({ key: `${list}:skill:gone-skill` })).toBeUndefined()
  }
  await ui.unmount()
})

test('Most used shows the five most used skills and no more', async ($, on) => {
  engine(on)
  mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  const counts = { 'sp-global:tear-sheet': 1, 'grill-me': 6, review: 5, learn: 4, 'engineering:debug': 3, 'engineering:code-review': 2 }
  store(on, { hidden: [], usage: { counts, days: {} } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (const name of ['grill-me', 'review', 'learn', 'engineering:debug', 'engineering:code-review']) {
    expect(await ui.find({ key: `top:skill:${name}` })).toBeDefined()
  }
  expect(await ui.find({ key: 'top:skill:sp-global:tear-sheet' })).toBeUndefined()
  await ui.unmount()
})

test('Dismiss in the card clears every pick', async ($, on) => {
  await picked($, on, { engineering_debug: 0.4, review: 0.2, grill_me: 0.17, none: 0.23 })

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ key: 'pick:review' })).toBeDefined()
  await pane.press({ key: 'card-dismiss' })
  expect(await pane.find({ key: 'card-use' })).toBeUndefined()
  expect(await pane.find({ key: 'pick:review' })).toBeUndefined()
  expect(await pane.find({ key: 'pick:grill-me' })).toBeUndefined()
  await pane.unmount()
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ key: 'use' })).toBeUndefined()
  await band.unmount()
})

test('with several picks the band shows the top one, and its Dismiss clears them all', async ($, on) => {
  await picked($, on, { engineering_debug: 0.4, review: 0.2, grill_me: 0.17, none: 0.23 })

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ type: 'Text', text: /engineering:debug/ })).toBeDefined()
  expect(await band.find({ type: 'Text', text: /review|grill-me/ })).toBeUndefined()
  await band.press({ key: 'dismiss' })
  expect(await band.find({ key: 'use' })).toBeUndefined()
  await band.unmount()
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ key: 'card-use' })).toBeUndefined()
  expect(await pane.find({ key: 'pick:review' })).toBeUndefined()
  await pane.unmount()
})

test('hiding a picked skill takes it out of the card and the band; a runner-up is not moved up', async ($, on) => {
  await picked($, on, { engineering_debug: 0.4, review: 0.2, grill_me: 0.17, none: 0.23 }, { hidden: [] })

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'toggle:your-skills' })
  await pane.press({ key: 'toggle:engineering' })
  // A hidden runner-up goes; the top pick stays.
  await pane.press({ key: 'hide:grill-me' })
  expect(await pane.find({ key: 'pick:grill-me' })).toBeUndefined()
  expect(await pane.find({ key: 'pick:review' })).toBeDefined()
  expect(await pane.find({ key: 'card-use' })).toBeDefined()
  // The top pick hidden: the card goes, runners-up and all.
  await pane.press({ key: 'hide:engineering:debug' })
  expect(await pane.find({ key: 'card-use' })).toBeUndefined()
  expect(await pane.find({ key: 'pick:review' })).toBeUndefined()
  await pane.unmount()
  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ key: 'use' })).toBeUndefined()
  await band.unmount()
})

test('a second click soon after the first keeps "added" up for its own full moment', async ($, on) => {
  engine(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'toggle:engineering' })
  await ui.press({ key: 'skill:engineering:debug' })
  await clock.advance(800)
  await ui.press({ key: 'skill:engineering:code-review' })
  // The first click's timer ends here and must not clear the newer mark.
  await clock.advance(600)
  expect(await ui.find({ type: 'Text', text: 'added' })).toBeDefined()
  await clock.advance(700)
  expect(await ui.find({ type: 'Text', text: 'added' })).toBeUndefined()
  await ui.unmount()
})

test('a new chat starts with no row marked "added"', async ($, on) => {
  engine(on)
  mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'toggle:engineering' })
  await ui.press({ key: 'skill:engineering:debug' })
  expect(await ui.find({ type: 'Text', text: 'added' })).toBeDefined()
  await ui.unmount()

  // The timer that would clear the mark has not run.
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: 'added' })).toBeUndefined()
  await ui.unmount()
})

test('two clicks at once are both counted, and a double Hide is saved once', async ($, on) => {
  engine(on)
  mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  const saved = store(on, { hidden: [] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'toggle:your-skills' })
  await Promise.all([ui.press({ key: 'skill:grill-me' }), ui.press({ key: 'skill:grill-me' })])
  expect((saved.usage as { counts: Record<string, number> }).counts['grill-me']).toBe(2)
  await Promise.all([ui.press({ key: 'hide:grill-me' }), ui.press({ key: 'hide:grill-me' }).catch(() => undefined)])
  expect(saved.hidden).toEqual(['skill:grill-me'])
  await ui.unmount()
})

test('the panel says it is checking while Jev has not answered', async ($, on) => {
  engine(on)
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/bobby', TYPESAFE_API_KEY: 'test-key' })
  mock.store(on)
  let reply: (() => void) | undefined
  on('http.fetch', (_, e) => {
    if (e.url.includes('raw.githubusercontent.com')) return { value: { status: 404, ok: false, headers: {}, text: '' } }

    return new Promise(resolve => {
      const text = JSON.stringify({ answers: { q0: { type: 'choice', probabilities: { none: 1 } } }, usage: { input_tokens: 1 } })
      reply = () => resolve({ value: { status: 200, ok: true, headers: {}, text } })
    })
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await typeInto($, 'my login page throws a 500 after the deploy')
  await clock.advance(1000)

  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await pane.find({ type: 'Text', text: 'checking your message…' })).toBeDefined()
  // S&P Global is hidden from the start, so six of the seven are scanned.
  expect(await pane.find({ type: 'Text', text: 'scanning 5 skills…' })).toBeDefined()
  reply?.()
  await clock.settle()
  expect(await pane.find({ type: 'Text', text: 'checking your message…' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /scanning/ })).toBeUndefined()
  await pane.unmount()
})

test('without a key the switch says so and a click on it changes nothing', async ($, on) => {
  engine(on)
  mock.clock(on)
  mock.env(on, { HOME: '/home/bobby' })
  const saved = store(on, {})
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'suggestions-switch' }))?.text).toBe('Suggest: needs a key')
  await ui.press({ key: 'suggestions-switch' })
  expect((await ui.find({ key: 'suggestions-switch' }))?.text).toBe('Suggest: needs a key')
  expect(saved['suggestions-on']).toBeUndefined()
  await ui.unmount()
})

test('a reply that lands as the message is sent leaves no pick behind', async ($, on) => {
  engine(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/home/bobby', TYPESAFE_API_KEY: 'test-key' })
  mock.store(on)
  jev(on, { engineering_debug: 0.9 })
  // The log write for the stored result is held, as a slow disk would.
  let release: (() => void) | undefined
  on('fs.write', (_, e) => {
    if (release || !/result stored[^\n]*\n$/.test(e.text)) return { value: undefined }

    return new Promise<{ value: undefined }>(resolve => {
      release = () => resolve({ value: undefined })
    })
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await typeInto($, 'my login page throws a 500 after the deploy')
  const check = clock.advance(1000)
  await until(() => release !== undefined)
  expect(release).toBeDefined()
  // Sent while the reply is still being recorded.
  await $.prompt.submit({ text: 'my login page throws a 500 after the deploy', wait: false, origin: { kind: 'composer' } })
  await clock.advance(1)
  release?.()
  await check
  await clock.settle()

  const band = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await band.find({ key: 'use' })).toBeUndefined()
  await band.unmount()
})

test('suggestions turned off as a check starts send nothing to Jev', async ($, on) => {
  engine(on)
  const clock = mock.clock(on)
  // The key lookup is held, so the switch can be turned off mid-check.
  let held = false
  let release: (() => void) | undefined
  on('env.get', (_, e) => {
    const value = e.name === 'HOME' ? '/home/bobby' : e.name === 'TYPESAFE_API_KEY' ? 'test-key' : undefined
    if (!held || release || e.name !== 'TYPESAFE_API_KEY') return { value }

    return new Promise<{ value: string | undefined }>(resolve => {
      release = () => resolve({ value })
    })
  })
  mock.store(on)
  const seen = jev(on, { engineering_debug: 0.9 })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  held = true
  await typeInto($, 'my login page throws a 500 after the deploy')
  const check = clock.advance(1000)
  await until(() => release !== undefined)
  expect(release).toBeDefined()
  await ui.press({ key: 'suggestions-switch' })
  expect((await ui.find({ key: 'suggestions-switch' }))?.text).toBe('Suggest: off')
  release?.()
  await check
  await clock.settle()
  expect(seen.calls).toBe(0)
  expect(await ui.find({ type: 'Text', text: /scanning|checking your message/ })).toBeUndefined()
  await ui.unmount()
})

test('the build says the same version as plugin.json', () => {
  // A test may not load a .json file, so the number in .claude-plugin/plugin.json is repeated here.
  expect(VERSION).toBe('0.4.1')
})
