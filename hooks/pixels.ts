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

const STRIP_COLS = 44
const STRIP_ROWS = 7
const STRIP_PX = 5
const STRIP_SIZE = 4.2
const STRIP_SCALE = 8

// 3x5 pixel letters for the word in the strip.
const GLYPHS: Record<string, string[]> = {
  S: ['111', '100', '111', '001', '111'],
  K: ['101', '101', '110', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  L: ['100', '100', '100', '100', '111'],
}

// The strip pixels that spell SKILLS, centred, as "x,y" keys.
const WORD: Set<string> = (() => {
  const word = 'SKILLS'
  const x0 = Math.floor((STRIP_COLS - (word.length * 4 - 1)) / 2)
  const y0 = Math.floor((STRIP_ROWS - 5) / 2)
  const cells = new Set<string>()
  ;[...word].forEach((ch, i) =>
    (GLYPHS[ch] ?? []).forEach((line, y) =>
      [...line].forEach((bit, x) => {
        if (bit === '1') cells.add(`${x0 + i * 4 + x},${y0 + y}`)
      }),
    ),
  )

  return cells
})()

function inWord(x: number, y: number): boolean {
  return WORD.has(`${x},${y}`)
}

// The quiet plate behind the word: the field stays out of it so the letters read.
const PLATE_FROM = Math.floor((STRIP_COLS - 23) / 2) - 1
const PLATE_TO = PLATE_FROM + 24

function inPlate(x: number): boolean {
  return x >= PLATE_FROM && x <= PLATE_TO
}

function stripFrame(cls: string, style: string, body: string): string {
  const w = STRIP_COLS * STRIP_PX
  const h = STRIP_ROWS * STRIP_PX
  // Its own size is wider than any panel: the panel draws it as wide as it
  // has room for, so the strip always spans the full width.
  const k = STRIP_SCALE

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="${cls}" viewBox="-0.4 -0.4 ${w} ${h}" width="${w * k}" height="${h * k}" shape-rendering="crispEdges">` +
    `<style>${style}${STILL}</style>${body}</svg>`
  )
}

// Waiting: a soft band of light drifts across, slanted and ragged because
// every pixel runs a little early or late, and a few pixels breathe on their own.
// The crest is a full-strength mid shade, not a pale one: over the faint
// resting pixels that reads on a white panel as well as on a dark one.
function stripIdle(pal: string[]): string {
  const loop = 7
  const cells: string[] = []
  for (let y = 0; y < STRIP_ROWS; y++) {
    for (let x = 0; x < STRIP_COLS; x++) {
      const h = hash(x, y, 7)
      const fill = shade(2 + (h % 3), pal)
      const own = (h >>> 5) % 6 === 0
      let attrs = ` fill="${fill}"`
      if (inWord(x, y)) {
        // The word stays solid; the drifting light brightens it as it passes.
        const at = ((x / STRIP_COLS) * loop + y * 0.25) % loop
        attrs = ` class="w" style="animation-delay:-${secs(loop - at)}"`
      } else if (inPlate(x)) {
        attrs += ' class="p"'
      } else if (own) {
        const k = (h >>> 9) % 3
        attrs += ` class="t${k}" style="animation-delay:-${secs(((h >>> 12) % 37) / 10)}"`
      } else {
        const jitter = ((h >>> 12) % 100) / 100
        const at = ((x / STRIP_COLS) * loop + y * 0.25 + jitter * 0.9) % loop
        attrs += ` style="animation-delay:-${secs(loop - at)}"`
      }
      cells.push(dot(x * STRIP_PX, y * STRIP_PX, STRIP_SIZE, attrs))
    }
  }
  const style =
    `.pxi path{opacity:.4;animation:pxi-b ${loop}s ease-in-out infinite}` +
    `@keyframes pxi-b{0%,34%,72%,100%{opacity:.34}46%{opacity:.85}52%{opacity:1;fill:${shade(4, pal)}}60%{opacity:.7}}` +
    `.pxi .t0{animation:pxi-t 2.3s ease-in-out infinite}.pxi .t1{animation:pxi-t 3.1s ease-in-out infinite}.pxi .t2{animation:pxi-t 3.7s ease-in-out infinite}` +
    `@keyframes pxi-t{0%,60%,100%{opacity:.34}80%{opacity:1;fill:${shade(4, pal)}}}` +
    `.pxi .p{opacity:.12;animation:none}` +
    `.pxi .w{opacity:1;fill:${shade(3, pal)};animation:pxi-w ${loop}s ease-in-out infinite}` +
    `@keyframes pxi-w{0%,40%,64%,100%{fill:${shade(3, pal)}}52%{fill:${shade(5, pal)}}}`

  return stripFrame('pxi', style, cells.join(''))
}

// Checking: a bright head races left to right on a slant with a fading tail,
// and each pixel flickers at its own pace under it.
function stripChecking(pal: string[]): string {
  const loop = 0.9
  const slants: string[][] = []
  // The word stays solid and flashes as the head passes over it.
  const word: string[] = []
  const span = STRIP_COLS + STRIP_ROWS - 1
  for (let y = 0; y < STRIP_ROWS; y++) {
    for (let x = 0; x < STRIP_COLS; x++) {
      const h = hash(x, y, 23)
      const k = h % 5
      const attrs = k < 4 ? ` class="k${k}"` : ''
      const slant = x + (STRIP_ROWS - 1 - y)
      if (inWord(x, y)) {
        word.push(dot(x * STRIP_PX, y * STRIP_PX, STRIP_SIZE, ` class="w" style="animation-delay:-${secs(loop - (slant / span) * loop)}"`))
        continue
      }
      if (inPlate(x)) {
        word.push(dot(x * STRIP_PX, y * STRIP_PX, STRIP_SIZE, ' class="p"'))
        continue
      }
      ;(slants[slant] ??= []).push(dot(x * STRIP_PX, y * STRIP_PX, STRIP_SIZE, attrs))
    }
  }
  const body =
    slants.map((cells, i) => `<g style="animation-delay:-${secs(loop - (i / span) * loop)}">${cells.join('')}</g>`).join('') +
    word.join('')
  const flicker = [0.23, 0.31, 0.37, 0.43]
    .map((d, i) => `.pxc .k${i}{animation:pxc-f ${d}s steps(2) infinite}`)
    .join('')
  const style =
    `.pxc g{opacity:.5;fill:${shade(3, pal)};animation:pxc-s ${loop}s linear infinite}` +
    `@keyframes pxc-s{0%{opacity:1;fill:${shade(6, pal)}}7%{opacity:1;fill:${shade(5, pal)}}22%{opacity:.75;fill:${shade(4, pal)}}50%{opacity:.34;fill:${shade(3, pal)}}100%{opacity:.16;fill:${shade(3, pal)}}}` +
    `${flicker}@keyframes pxc-f{0%{opacity:1}100%{opacity:.55}}` +
    `.pxc .p{fill:${shade(3, pal)};opacity:.12}` +
    `.pxc .w{fill:${shade(3, pal)};animation:pxc-w ${loop}s linear infinite}` +
    `@keyframes pxc-w{0%{fill:${shade(5, pal)}}30%,100%{fill:${shade(3, pal)}}}`

  return stripFrame('pxc', style, body)
}

// Found one: the strip fills from the left in half a second, then stays lit
// while a crest of light rolls through and single pixels glint.
function stripMatch(pal: string[]): string {
  const wave = 1.5
  const cols: string[] = []
  for (let x = 0; x < STRIP_COLS; x++) {
    const cells: string[] = []
    for (let y = 0; y < STRIP_ROWS; y++) {
      const h = hash(x, y, 41)
      let attrs = ` fill="${shade(3 + (h % 3), pal)}"`
      // The word glows pale on a dark plate inside the lit strip.
      if (inWord(x, y)) attrs = ` fill="${shade(6, pal)}"`
      else if (inPlate(x)) attrs = ` fill="${shade(1, pal)}"`
      else if ((h >>> 5) % 4 === 0) attrs += ` class="q${(h >>> 9) % 5}"`
      cells.push(dot(x * STRIP_PX, y * STRIP_PX, STRIP_SIZE, attrs))
    }
    const t = x / STRIP_COLS
    cols.push(
      `<g class="in" style="animation-delay:${secs(t * 0.42)}"><g class="pu" style="animation-delay:-${secs(wave - t * wave)}">${cells.join('')}</g></g>`,
    )
  }
  const glints = [1.1, 1.5, 1.9, 2.3, 2.9]
    .map((d, i) => `.pxm .q${i}{animation:pxm-t ${d}s steps(1) infinite;animation-delay:-${secs(i * 0.37)}}`)
    .join('')
  const style =
    `.pxm .in{animation:pxm-in .16s steps(3) both}@keyframes pxm-in{0%{opacity:0}100%{opacity:1}}` +
    `.pxm .pu{animation:pxm-p ${wave}s ease-in-out infinite}@keyframes pxm-p{0%,100%{opacity:1}50%{opacity:.6}}` +
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
    `<svg xmlns="http://www.w3.org/2000/svg" class="pw" viewBox="0 0 27.2 19.2" width="27.2" height="19.2" shape-rendering="crispEdges">` +
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
    `<svg xmlns="http://www.w3.org/2000/svg" class="pt" viewBox="0 0 8.8 8.8" width="12" height="12" shape-rendering="crispEdges">` +
    `<style>.pt .g0{animation:pt-g 2.6s steps(3) infinite}.pt .g1{animation:pt-g 3.4s steps(3) -1.2s infinite}.pt .g2{animation:pt-g 4.1s steps(3) -2.3s infinite}` +
    `@keyframes pt-g{85%{opacity:1}}${STILL}</style>` +
    `${cells.join('')}</svg>`
  )
}
