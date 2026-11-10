// Purple pixel art for the Skills panel, drawn as SVG markup. Motion is CSS
// keyframes inside each SVG, so it runs without script, and it stops for
// people who ask their system for reduced motion.

export const PALETTE = ['#4C1D95', '#5B21B6', '#6D28D9', '#7C3AED', '#8B5CF6', '#A78BFA', '#C4B5FD']
export const ACCENT = '#8B5CF6'

export type Theme = 'purple' | 'amber' | 'green' | 'mono'
export const THEMES: Theme[] = ['purple', 'amber', 'green', 'mono']

// Seven shades each, dark to light. The mid shades read on a white panel and
// on a dark one; the two darkest are kept for small details.
const PALETTES: Record<Theme, string[]> = {
  purple: PALETTE,
  amber: ['#78350F', '#92400E', '#B45309', '#D97706', '#F59E0B', '#FBBF24', '#FCD34D'],
  green: ['#064E3B', '#065F46', '#047857', '#059669', '#10B981', '#34D399', '#6EE7B7'],
  mono: ['#3F3F46', '#52525B', '#63636B', '#7C7C85', '#9A9AA3', '#B4B4BC', '#CFCFD6'],
}

export function paletteOf(theme: Theme): string[] {
  return PALETTES[theme] ?? PALETTE
}

function shade(i: number, pal: string[] = PALETTE): string {
  return pal[Math.max(0, Math.min(pal.length - 1, i))] ?? ACCENT
}

const STILL = '@media (prefers-reduced-motion: reduce){svg *{animation:none!important}}'

// A small deterministic hash, so the art is the same on every redraw.
function hash(...parts: number[]): number {
  let h = 2166136261
  for (const p of parts) {
    h = Math.imul(h ^ p, 16777619)
    h ^= h >>> 13
  }

  return (Math.imul(h, 1274126177) ^ (h >>> 16)) >>> 0
}

function hashText(text: string): number {
  return hash(...[...text].map(c => c.charCodeAt(0)))
}

function rect(x: number, y: number, size: number, fill: string, cls = ''): string {
  const c = cls ? ` class="${cls}"` : ''

  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${fill}"${c}/>`
}

// One pixel as a path: shorter than a rect when there are many.
function dot(x: number, y: number, size: number, attrs = ''): string {
  return `<path d="M${x} ${y}h${size}v${size}H${x}z"${attrs}/>`
}

function secs(n: number): string {
  return `${Number(n.toFixed(2))}s`
}

const STRIP_COLS = 60
const STRIP_ROWS = 13
const STRIP_PX = 5
const STRIP_SIZE = 4.2
const STRIP_SCALE = 8
// The strip is a small lit sign: a near-black plate, so it looks the same on a
// light panel and a dark one, with the pixels glowing on it.
const STRIP_PLATE = '#141318'

// Bold pixel letters, two pixels thick and nine tall: the word is the header,
// the field of pixels its backdrop.
const GLYPHS: Record<string, string[]> = {
  S: ['.#####', '######', '##....', '#####.', '.#####', '....##', '....##', '######', '#####.'],
  K: ['##..##', '##..##', '##.##.', '####..', '###...', '####..', '##.##.', '##..##', '##..##'],
  I: ['##', '##', '##', '##', '##', '##', '##', '##', '##'],
  L: ['##....', '##....', '##....', '##....', '##....', '##....', '##....', '######', '######'],
}
const WORD_TALL = 9
const WORD_GAP = 2
const WORD_WIDE = [...'SKILLS'].reduce((w, ch) => w + (GLYPHS[ch]?.[0]?.length ?? 0) + WORD_GAP, -WORD_GAP)
const WORD_X = Math.floor((STRIP_COLS - WORD_WIDE) / 2)
const WORD_Y = Math.floor((STRIP_ROWS - WORD_TALL) / 2)

// The strip pixels that spell SKILLS, centred: "x,y" to the letter's row.
const WORD: Map<string, number> = (() => {
  const cells = new Map<string, number>()
  let left = WORD_X
  for (const ch of 'SKILLS') {
    const glyph = GLYPHS[ch] ?? []
    glyph.forEach((line, y) =>
      [...line].forEach((bit, x) => {
        if (bit === '#') cells.set(`${left + x},${WORD_Y + y}`, y)
      }),
    )
    left += (glyph[0]?.length ?? 0) + WORD_GAP
  }

  return cells
})()

function inWord(x: number, y: number): boolean {
  return WORD.has(`${x},${y}`)
}

// Whether the backdrop has a pixel here: everywhere but the plate's rounded
// corners and a clear window around the word, so the letters read cleanly.
function inField(x: number, y: number): boolean {
  if (inWord(x, y)) return false
  if ((x === 0 || x === STRIP_COLS - 1) && (y === 0 || y === STRIP_ROWS - 1)) return false

  return !(x >= WORD_X - 1 && x <= WORD_X + WORD_WIDE && y >= WORD_Y - 1 && y <= WORD_Y + WORD_TALL)
}

// The letters: a dark shadow down and right, a pale-to-bright fill, and a
// white copy on top (class "s") that each state fades in as its light passes.
function wordCells(pal: string[], delayOf: (x: number, y: number) => string): { under: string; over: string } {
  const rows = [6, 6, 6, 5, 5, 5, 4, 4, 4]
  const shadow: string[] = []
  const fill: string[] = []
  const shine: string[] = []
  for (const [key, row] of WORD) {
    const [x, y] = key.split(',').map(Number) as [number, number]
    if (!inWord(x + 1, y + 1)) shadow.push(dot((x + 1) * STRIP_PX, (y + 1) * STRIP_PX, STRIP_SIZE, ' class="d"'))
    fill.push(dot(x * STRIP_PX, y * STRIP_PX, STRIP_SIZE, ` class="l" fill="${shade(rows[row] ?? 5, pal)}"`))
    shine.push(dot(x * STRIP_PX, y * STRIP_PX, STRIP_SIZE, ` class="s" style="animation-delay:${delayOf(x, y)}"`))
  }

  return { under: shadow.join('') + fill.join(''), over: shine.join('') }
}

function stripFrame(cls: string, style: string, body: string): string {
  const w = STRIP_COLS * STRIP_PX
  const h = STRIP_ROWS * STRIP_PX
  // Its own size is wider than any panel: the panel draws it as wide as it
  // has room for, so the strip always spans the full width.
  const k = STRIP_SCALE
  const word = `.${cls} .d{fill:${STRIP_PLATE};opacity:.8;animation:none}.${cls} .l{opacity:1;animation:none}.${cls} .s{fill:#fff;opacity:0}`

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" viewBox="-0.4 -0.4 ${w} ${h}" width="${w * k}" height="${h * k}" shape-rendering="crispEdges">` +
    `<style>${style}${word}${STILL}</style><rect x="-0.4" y="-0.4" width="${w}" height="${h}" rx="4" fill="${STRIP_PLATE}"/>${body}</svg>`
  )
}

// Waiting: a soft band of light drifts across, slanted and ragged because
// every pixel runs a little early or late, and a few pixels breathe on their own.
// The crest is a full-strength mid shade, not a pale one: over the faint
// resting pixels that reads on a white panel as well as on a dark one.
// As the band crosses the word, the letters gleam white.
function stripIdle(pal: string[]): string {
  const loop = 7
  const cells: string[] = []
  const at = (x: number, y: number, jitter = 0) => ((x / STRIP_COLS) * loop + y * 0.25 + jitter) % loop
  for (let y = 0; y < STRIP_ROWS; y++) {
    for (let x = 0; x < STRIP_COLS; x++) {
      if (!inField(x, y)) continue
      const h = hash(x, y, 7)
      let attrs = ` fill="${shade(2 + (h % 3), pal)}"`
      if ((h >>> 5) % 6 === 0) {
        attrs += ` class="t${(h >>> 9) % 3}" style="animation-delay:-${secs(((h >>> 12) % 37) / 10)}"`
      } else {
        attrs += ` style="animation-delay:-${secs(loop - at(x, y, (((h >>> 12) % 100) / 100) * 0.9))}"`
      }
      cells.push(dot(x * STRIP_PX, y * STRIP_PX, STRIP_SIZE, attrs))
    }
  }
  const word = wordCells(pal, (x, y) => `-${secs(loop - at(x, y))}`)
  const style =
    `.pxi path{opacity:.4;animation:pxi-b ${loop}s ease-in-out infinite}` +
    `@keyframes pxi-b{0%,34%,72%,100%{opacity:.34}46%{opacity:.85}52%{opacity:1;fill:${shade(4, pal)}}60%{opacity:.7}}` +
    `.pxi .t0{animation:pxi-t 2.3s ease-in-out infinite}.pxi .t1{animation:pxi-t 3.1s ease-in-out infinite}.pxi .t2{animation:pxi-t 3.7s ease-in-out infinite}` +
    `@keyframes pxi-t{0%,60%,100%{opacity:.34}80%{opacity:1;fill:${shade(4, pal)}}}` +
    `.pxi .s{animation:pxi-s ${loop}s ease-in-out infinite}@keyframes pxi-s{0%,45%,59%,100%{opacity:0}52%{opacity:.9}}`

  return stripFrame('pxi', style, cells.join('') + word.under + word.over)
}

// Checking: a bright head races left to right on a slant with a fading tail,
// each pixel flickers at its own pace under it, and the letters flash as it passes.
function stripChecking(pal: string[]): string {
  const loop = 0.9
  const slants: string[][] = []
  const span = STRIP_COLS + STRIP_ROWS - 1
  const delay = (x: number, y: number) => `-${secs(loop - ((x + (STRIP_ROWS - 1 - y)) / span) * loop)}`
  for (let y = 0; y < STRIP_ROWS; y++) {
    for (let x = 0; x < STRIP_COLS; x++) {
      if (!inField(x, y)) continue
      const k = hash(x, y, 23) % 5
      ;(slants[x + (STRIP_ROWS - 1 - y)] ??= []).push(dot(x * STRIP_PX, y * STRIP_PX, STRIP_SIZE, k < 4 ? ` class="k${k}"` : ''))
    }
  }
  const word = wordCells(pal, delay)
  const body =
    slants.map((cells, i) => `<g style="animation-delay:-${secs(loop - (i / span) * loop)}">${cells.join('')}</g>`).join('') +
    word.under +
    word.over
  const flicker = [0.23, 0.31, 0.37, 0.43]
    .map((d, i) => `.pxc .k${i}{animation:pxc-f ${d}s steps(2) infinite}`)
    .join('')
  const style =
    `.pxc g{opacity:.5;fill:${shade(3, pal)};animation:pxc-s ${loop}s linear infinite}` +
    `@keyframes pxc-s{0%{opacity:1;fill:${shade(6, pal)}}7%{opacity:1;fill:${shade(5, pal)}}22%{opacity:.75;fill:${shade(4, pal)}}50%{opacity:.34;fill:${shade(3, pal)}}100%{opacity:.16;fill:${shade(3, pal)}}}` +
    `${flicker}@keyframes pxc-f{0%{opacity:1}100%{opacity:.55}}` +
    `.pxc .s{animation:pxc-h ${loop}s linear infinite}@keyframes pxc-h{0%{opacity:.95}35%,100%{opacity:0}}`

  return stripFrame('pxc', style, body)
}

// Found one: the strip fills from the left in half a second, then stays lit
// while a crest of light rolls through, single pixels glint and the word glows white.
function stripMatch(pal: string[]): string {
  const wave = 1.5
  const cols: string[] = []
  const word = new Map<number, string[]>()
  for (const key of WORD.keys()) {
    const [x, y] = key.split(',').map(Number) as [number, number]
    const cells = word.get(x) ?? []
    cells.push(dot(x * STRIP_PX, y * STRIP_PX, STRIP_SIZE, ` class="l" fill="${shade(6, pal)}"`))
    word.set(x, cells)
  }
  for (let x = 0; x < STRIP_COLS; x++) {
    const cells: string[] = []
    for (let y = 0; y < STRIP_ROWS; y++) {
      const shadowed = inWord(x - 1, y - 1) && !inWord(x, y)
      if (!inField(x, y)) {
        if (shadowed) cells.push(dot(x * STRIP_PX, y * STRIP_PX, STRIP_SIZE, ' class="d"'))
        continue
      }
      const h = hash(x, y, 41)
      let attrs = ` fill="${shade(3 + (h % 3), pal)}"`
      if ((h >>> 5) % 4 === 0) attrs += ` class="q${(h >>> 9) % 5}"`
      cells.push(dot(x * STRIP_PX, y * STRIP_PX, STRIP_SIZE, attrs))
      if (shadowed) cells.push(dot(x * STRIP_PX, y * STRIP_PX, STRIP_SIZE, ' class="d"'))
    }
    const t = x / STRIP_COLS
    const lit = `<g class="pu" style="animation-delay:-${secs(wave - t * wave)}">${cells.join('')}</g>`
    const glow = `<g class="gl" style="animation-delay:-${secs(wave - t * wave)}">${(word.get(x) ?? []).join('')}</g>`
    cols.push(`<g class="in" style="animation-delay:${secs(t * 0.42)}">${lit}${glow}</g>`)
  }
  const glints = [1.1, 1.5, 1.9, 2.3, 2.9]
    .map((d, i) => `.pxm .q${i}{animation:pxm-t ${d}s steps(1) infinite;animation-delay:-${secs(i * 0.37)}}`)
    .join('')
  const style =
    `.pxm .in{animation:pxm-in .16s steps(3) both}@keyframes pxm-in{0%{opacity:0}100%{opacity:1}}` +
    `.pxm .pu{animation:pxm-p ${wave}s ease-in-out infinite}@keyframes pxm-p{0%,100%{opacity:1}50%{opacity:.6}}` +
    `.pxm .gl{animation:pxm-g ${wave}s ease-in-out infinite}@keyframes pxm-g{0%,100%{fill:#fff}50%{fill:${shade(5, pal)}}}` +
    `${glints}@keyframes pxm-t{82%{fill:${shade(6, pal)}}}`

  return stripFrame('pxm', style, cols.join(''))
}

/**
 * The panel's hero: one wide, short strip of pixels that shows what the
 * suggester is doing. It drifts while waiting, races while checking, and
 * lights up when it has found a skill.
 */
export function strip(state: 'idle' | 'checking' | 'match', theme: Theme = 'purple'): string {
  const pal = paletteOf(theme)
  if (state === 'checking') return stripChecking(pal)
  if (state === 'match') return stripMatch(pal)

  return stripIdle(pal)
}

// A pixel starburst: the centre holds steady while the arms twinkle outwards.
const SPARK = [
  '....#....',
  '.#..#..#.',
  '..#.#.#..',
  '...###...',
  '#########',
  '...###...',
  '..#.#.#..',
  '.#..#..#.',
  '....#....',
]

/** A pixel spark that pops in, then twinkles: a suggestion, or a click that landed. */
export function spark(size = 18, theme: Theme = 'purple'): string {
  const pal = paletteOf(theme)
  const cells: string[] = []
  SPARK.forEach((line, y) =>
    [...line].forEach((ch, x) => {
      if (ch !== '#') return
      const ring = Math.max(Math.abs(x - 4), Math.abs(y - 4))
      const fill = ring === 0 ? shade(3, pal) : shade(Math.min(5, 1 + ring), pal)
      cells.push(rect(x * 2, y * 2, 1.8, fill, `r${ring}`))
    }),
  )

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="pk" viewBox="0 0 18 18" width="${size}" height="${size}" shape-rendering="crispEdges">` +
    `<style>.pk g{transform-origin:9px 9px;animation:pk-pop .45s steps(5) both}` +
    `@keyframes pk-pop{0%{transform:scale(.2);opacity:0}70%{transform:scale(1.15);opacity:1}100%{transform:scale(1)}}` +
    `.pk .r1,.pk .r2,.pk .r3,.pk .r4{animation:pk-tw 1.6s steps(3) infinite}.pk .r2{animation-delay:.15s}.pk .r3{animation-delay:.3s}.pk .r4{animation-delay:.45s}` +
    `@keyframes pk-tw{0%,100%{opacity:1}50%{opacity:.55}}${STILL}</style>` +
    `<g>${cells.join('')}</g></svg>`
  )
}

/**
 * How strong a match is, as ten pixel blocks: the filled ones step in one by
 * one, then a shimmer runs along them.
 */
export function meter(probability: number, theme: Theme = 'purple'): string {
  const pal = paletteOf(theme)
  const blocks = 10
  const p = Number.isFinite(probability) ? probability : 0
  const filled = Math.max(0, Math.min(blocks, Math.round(p * blocks)))
  const cells = Array.from({ length: blocks }, (_, i) => {
    if (i >= filled) return rect(i * 6, 0, 4.6, shade(4, pal), 'off')
    // Up to shade 5: the palest shade is too close to an empty block on white.
    const fill = shade(2 + Math.floor((i / blocks) * 4), pal)

    return rect(i * 6, 0, 4.6, fill, `f${i}`)
  }).join('')
  const delays = Array.from(
    { length: filled },
    (_, i) => `.pm rect.f${i}{animation-delay:${(i * 0.07).toFixed(2)}s,${(0.9 + i * 0.08).toFixed(2)}s}`,
  ).join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="pm" viewBox="0 0 59 5" width="59" height="5" shape-rendering="crispEdges">` +
    `<style>.pm .off{opacity:.25}.pm rect[class^=f]{animation:pm-in .2s steps(2) both,pm-sh 2.4s steps(3) infinite}` +
    `@keyframes pm-in{0%{opacity:0}100%{opacity:1}}@keyframes pm-sh{0%,100%{opacity:1}8%{opacity:.45}16%{opacity:1}}` +
    `${delays}${STILL}</style>${cells}</svg>`
  )
}

/**
 * Skills used on each of the last seven days, oldest first, as columns of up
 * to five pixels. Today is the last column and a shade brighter; a day with
 * nothing shows one faint pixel.
 */
export function weekChart(counts: number[], theme: Theme = 'purple'): string {
  const pal = paletteOf(theme)
  const days = 7
  const tall = 5
  const clean = counts.slice(-days).map(n => (Number.isFinite(n) && n > 0 ? n : 0))
  while (clean.length < days) clean.unshift(0)
  const most = Math.max(...clean)
  const cells: string[] = []
  clean.forEach((n, i) => {
    const today = i === days - 1
    const x = i * 4
    if (n === 0) {
      cells.push(rect(x, (tall - 1) * 4, 3.2, shade(4, pal), 'z'))

      return
    }
    const high = Math.max(1, Math.round((n / most) * tall))
    for (let j = 0; j < high; j++) {
      const top = j === high - 1
      const fill = shade(today ? (top ? 5 : 4) : 3, pal)
      cells.push(rect(x, (tall - 1 - j) * 4, 3.2, fill, today ? (top ? 'n' : '') : 'o'))
    }
  })

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="pw" viewBox="0 0 27.2 19.2" width="40.8" height="28.8" shape-rendering="crispEdges">` +
    `<style>.pw .z{opacity:.25}.pw .o{opacity:.65}.pw .n{animation:pw-n 2.4s ease-in-out infinite}@keyframes pw-n{0%,100%{opacity:1}50%{opacity:.55}}${STILL}</style>` +
    `${cells.join('')}</svg>`
  )
}

// "x_x" in pixels. The corners of each eye are marked so they can blink.
const FACE = ['o.o.....o.o', '.#.......#.', 'o.o.###.o.o']

/** The mark for a search with no results: a small x_x face that blinks slowly. */
export function emptyFace(theme: Theme = 'purple'): string {
  const pal = paletteOf(theme)
  const cells: string[] = []
  FACE.forEach((line, y) =>
    [...line].forEach((ch, x) => {
      if (ch === '.') return
      cells.push(rect(x * 3, y * 3, 2.6, shade(4, pal), ch === 'o' ? 'e' : ''))
    }),
  )

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="pf" viewBox="0 0 32.6 8.6" width="32.6" height="8.6" shape-rendering="crispEdges">` +
    `<style>.pf .e{animation:pf-b 4.5s steps(1) infinite}@keyframes pf-b{0%,100%{opacity:1}92%{opacity:.15}96%{opacity:1}}${STILL}</style>` +
    `${cells.join('')}</svg>`
  )
}

// Collections with a color of their own; every other tile follows the theme.
const TILE_COLORS: Record<string, string> = {
  gstack: '#F59E0B',
  'mattpocock-skills': '#38BDF8',
}

/**
 * A section's mark: a soft 3x3 block tile, light at the top and deeper at the
 * bottom, with a slow glint. The same every time for the same section.
 */
export function tile(group: string, theme: Theme = 'purple'): string {
  const color = TILE_COLORS[group] ?? shade(4, paletteOf(theme))
  const h = hashText(group)
  const cells: string[] = []
  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      const g = hash(h, x, y)
      const opacity = Math.min(1, Math.max(0.16, [0.26, 0.55, 0.92][y]! + ((g % 5) - 2) * 0.07))
      const cls = (g >>> 4) % 3 === 0 ? ` class="g${(g >>> 7) % 3}"` : ''
      cells.push(`<rect x="${x * 3}" y="${y * 3}" width="2.8" height="2.8" fill="${color}" opacity="${Number(opacity.toFixed(2))}"${cls}/>`)
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="pt" viewBox="0 0 8.8 8.8" width="14" height="14" shape-rendering="crispEdges">` +
    `<style>.pt .g0{animation:pt-g 2.6s steps(3) infinite}.pt .g1{animation:pt-g 3.4s steps(3) -1.2s infinite}.pt .g2{animation:pt-g 4.1s steps(3) -2.3s infinite}` +
    `@keyframes pt-g{85%{opacity:1}}${STILL}</style>` +
    `${cells.join('')}</svg>`
  )
}

/**
 * A theme's color chip for the picker: four pixels of its palette, light to
 * deep. The chosen one wears a ring.
 */
export function swatch(theme: Theme, isChosen: boolean): string {
  const pal = paletteOf(theme)
  const cells = [5, 4, 3, 2]
    .map((s, i) => `<rect x="${3 + (i % 2) * 6.2}" y="${3 + Math.floor(i / 2) * 6.2}" width="5.8" height="5.8" fill="${shade(s, pal)}"/>`)
    .join('')
  const ring = isChosen
    ? `<rect x="0.6" y="0.6" width="16.8" height="16.8" rx="3" fill="none" stroke="${shade(5, pal)}" stroke-width="1.2"/>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="18" height="18">${cells}${ring}</svg>`
}
