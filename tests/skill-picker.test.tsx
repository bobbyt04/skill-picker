import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { CommandInfo, On, PromptEditInput } from 'claude-code'

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

// The person replaces the whole draft with `draft`, as one burst of keys.
// The test engine raises prompt.edit, though its typing leaves it out.
function typeInto($: Engine, draft: string) {
  const prompt = $.prompt as unknown as { edit: (e: PromptEditInput) => Promise<unknown> }

  return prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: draft })
}

test('sections: your skills first, gstack next, S&P Global hidden', async ($, on) => {
  engine(on)
  mock.env(on, { HOME: '/home/bobby' })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const heads = await Promise.all(
    ['your-skills', 'gstack', 'engineering'].map(async g => (await ui.find({ key: `toggle:${g}` }))?.text),
  )
  expect(heads).toEqual(['Your skills ▾', 'gstack · Garry Tan ▸', 'Engineering ▸'])
  expect(await ui.find({ key: 'toggle:sp-global' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '▸ Hidden · 1' })).toBeDefined()
  // The pixel banner leads the panel on desktop.
  expect((await ui.findAll({ type: 'Svg' })).map(s => s.props.alt)).toContain('Skills')

  // Your skills are open; gstack holds "learn" though its description lacks the tag.
  expect(await ui.find({ key: 'skill:grill-me' })).toBeDefined()
  await ui.press({ key: 'toggle:gstack' })
  expect(await ui.find({ key: 'skill:learn' })).toBeDefined()
  expect(await ui.find({ key: 'skill:review' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: "Use when you review this PR's diff." })).toBeDefined()
  expect(await ui.find({ key: 'skill:sp-global:tear-sheet' })).toBeUndefined()
  await ui.unmount()
})

test('a short name inserts the full command, and search spans sections', async ($, on) => {
  const box = engine(on, 'my login page 500s')
  mock.env(on, { HOME: '/home/bobby' })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'toggle:engineering' })
  expect((await ui.find({ key: 'skill:engineering:debug' }))?.text).toBe('debug')
  await ui.press({ key: 'skill:engineering:debug' })
  expect(box.text).toBe('/engineering:debug my login page 500s')
  expect(await ui.find({ key: 'recent:skill:engineering:debug' })).toBeDefined()

  await ui.input({ key: 'search', text: 'review', kind: 'change' })
  expect(await ui.find({ key: 'skill:review' })).toBeDefined()
  expect(await ui.find({ key: 'skill:engineering:code-review' })).toBeDefined()
  expect(await ui.find({ key: 'skill:grill-me' })).toBeUndefined()
  await ui.unmount()
})

test('hiding a skill or a section sticks, and Show brings it back', async ($, on) => {
  engine(on)
  mock.env(on, { HOME: '/home/bobby' })
  // A store of the test's own, so it can read what the mod saved.
  const saved: Record<string, unknown> = { hidden: [] }
  on('store.get', (_, e) => ({ value: saved[e.key] }))
  on('store.set', (_, e) => {
    saved[e.key] = e.value

    return { value: undefined }
  })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
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
  expect(await pane.find({ type: 'Text', text: /Jev is reading/ })).toBeUndefined()
  await pane.unmount()
})

test('the terminal gets text in place of pixel art, and Hide is always shown', async ($, on) => {
  engine(on)
  mock.env(on, { HOME: '/home/bobby' })
  mock.store(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.findAll({ type: 'Svg' })).toEqual([])
  expect(await ui.find({ type: 'Text', text: /SKILLS/ })).toBeDefined()
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
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ version: '0.2.0' }) } }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /Update ready/ })).toBeUndefined()
  await ui.unmount()
})

