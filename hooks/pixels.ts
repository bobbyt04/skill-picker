// Purple pixel art for the Skills panel, drawn as SVG markup. Motion is CSS
// keyframes inside each SVG, so it runs without script, and it stops for
// people who ask their system for reduced motion.

export const PALETTE = ['#4C1D95', '#5B21B6', '#6D28D9', '#7C3AED', '#8B5CF6', '#A78BFA', '#C4B5FD']
export const ACCENT = '#8B5CF6'

function shade(i: number): string {
  return PALETTE[Math.max(0, Math.min(PALETTE.length - 1, i))] ?? ACCENT
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

// 3x5 pixel letters for the banner word.
const GLYPHS: Record<string, string[]> = {
  S: ['111', '100', '111', '001', '111'],
  K: ['101', '101', '110', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  L: ['100', '100', '100', '100', '111'],
}

type Cell = { x: number; y: number }

// Each letter pixel is drawn `scale` cells square, so the word reads bold.
function wordCells(word: string, scale: number): { cells: Cell[]; width: number; height: number } {
  const cells: Cell[] = []
  let x = 0
  for (const ch of word) {
    const g = GLYPHS[ch]
    if (!g) continue
    g.forEach((line, y) =>
      [...line].forEach((bit, dx) => {
        if (bit !== '1') return
        for (let i = 0; i < scale; i++)
          for (let j = 0; j < scale; j++) cells.push({ x: x + dx * scale + i, y: y * scale + j })
      }),
    )
    x += 4 * scale
  }

  return { cells, width: Math.max(0, x - scale), height: 5 * scale }
}

function rect(x: number, y: number, size: number, fill: string, cls = ''): string {
  const c = cls ? ` class="${cls}"` : ''

  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${fill}"${c}/>`
}

// One <path> of squares: far smaller than a rect per pixel.
function squares(cells: Cell[], px: number, size: number): string {
  return cells.map(c => `M${c.x * px} ${c.y * px}h${size}v${size}h-${size}z`).join('')
}

/**
 * The panel's header, a dark pixel screen with five layers of motion:
 * a breathing purple glow, a field of pixels that each flicker at their own
 * pace, diagonal waves of light rolling through that field, the word SKILLS
 * lighting letter by letter under a moving sheen, and sparks drifting up.
 */
export function banner(): string {
  const cols = 64
  const rows = 18
  const px = 4
  const size = px - 0.6
  const word = wordCells('SKILLS', 2)
  const x0 = Math.floor((cols - word.width) / 2)
  const y0 = Math.floor((rows - word.height) / 2)
  const w = cols * px
  const hgt = rows * px

  // The field: pixels twinkle at one of four speeds, from one of two
  // starting points, inside a diagonal band that pulses in turn. Pixels
  // sharing all three share one <path>, which keeps the drawing small.
  const bands = 6
  const groups = new Map<string, { band: number; speed: number; start: number; fill: string; cells: Cell[] }>()
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const h = hash(x, y)
      if (h % 100 >= 46) continue
      const band = Math.min(bands - 1, Math.floor(((x + y * 1.6) / (cols + rows * 1.6)) * bands))
      const speed = (h >>> 4) % 4
      const start = (h >>> 8) % 2
      const tone = h % 3
      const id = `${band}.${speed}.${start}.${tone}`
      const g = groups.get(id) ?? { band, speed, start, fill: shade(tone), cells: [] }
      g.cells.push({ x, y })
      groups.set(id, g)
    }
  }
  const byBand: string[][] = Array.from({ length: bands }, () => [])
  for (const g of groups.values()) {
    byBand[g.band]?.push(
      `<path fill="${g.fill}" class="t${g.speed}" style="animation-delay:-${g.start}s" d="${squares(g.cells, px, size)}"/>`,
    )
  }
  const field = byBand.map((paths, i) => `<g class="d" style="animation-delay:${(i * 0.3).toFixed(2)}s">${paths.join('')}</g>`)

  // The word, one path per letter so each can light in turn.
  const letters: Cell[][] = []
  for (const c of word.cells) {
    const i = Math.floor(c.x / 8)
    ;(letters[i] ??= []).push({ x: c.x + x0, y: c.y + y0 })
  }
  const allText = squares(word.cells.map(c => ({ x: c.x + x0, y: c.y + y0 })), px, size)
  const letterPaths = letters
    .map((cells, i) => `<path class="l" style="animation-delay:${(i * 0.14).toFixed(2)}s" d="${squares(cells, px, size)}"/>`)
    .join('')

  // Sparks: light pixels rising from the bottom edge and fading out.
  const sparks = Array.from({ length: 12 }, (_, i) => {
    const h = hash(i, 99)
    const x = (h % (cols - 2)) * px + 1
    const dur = 2.2 + ((h >>> 6) % 18) / 10
    const delay = ((h >>> 12) % 40) / 10

    return `<rect class="s" x="${x}" y="${hgt - 4}" width="2.4" height="2.4" fill="#DDD6FE" style="animation-duration:${dur.toFixed(1)}s;animation-delay:-${delay.toFixed(1)}s"/>`
  }).join('')

  const twinkles = [1.3, 1.7, 2.1, 2.5, 2.9, 3.4, 1.9, 2.7]
    .map((d, i) => `.pb .t${i}{animation:tw ${d}s steps(3) infinite}`)
    .join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="pb" viewBox="-4 -4 ${w + 8} ${hgt + 8}" width="${w + 8}" height="${hgt + 8}" shape-rendering="crispEdges">` +
    `<style>` +
    `${twinkles}@keyframes tw{0%,100%{opacity:.18}45%{opacity:.18}55%{opacity:1;fill:#C4B5FD}70%{opacity:.5}}` +
    `.pb .d{animation:roll 3.2s ease-in-out infinite}@keyframes roll{0%,100%{opacity:.55}12%{opacity:1}30%{opacity:.55}}` +
    `.pb .l{fill:#EDE9FE;animation:lit 3.2s steps(4) infinite}@keyframes lit{0%,100%{fill:#EDE9FE}6%{fill:#FFFFFF}14%{fill:#C4B5FD}24%{fill:#EDE9FE}}` +
    `.pb .gl{animation:breathe 3.2s ease-in-out infinite}@keyframes breathe{0%,100%{opacity:.35}50%{opacity:.85}}` +
    `.pb .sh{animation:sheen 3.2s ease-in-out infinite}@keyframes sheen{0%{transform:translateX(-80px)}55%,100%{transform:translateX(${w + 80}px)}}` +
    `.pb .s{opacity:0;animation:rise 3s linear infinite}@keyframes rise{0%{opacity:0;transform:translateY(0)}15%{opacity:1}100%{opacity:0;transform:translateY(-${hgt - 8}px)}}` +
    `.pb .halo{animation:halo 4.8s ease-in-out infinite}@keyframes halo{0%,100%{opacity:.35}50%{opacity:.7}}` +
    `${STILL}</style>` +
    `<defs>` +
    `<filter id="pbg" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="2.4"/></filter>` +
    `<radialGradient id="pbr"><stop offset="0" stop-color="#7C3AED" stop-opacity=".55"/><stop offset="1" stop-color="#7C3AED" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="pbs" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<clipPath id="pbc"><path d="${allText}"/></clipPath>` +
    `</defs>` +
    `<rect x="-4" y="-4" width="${w + 8}" height="${hgt + 8}" rx="6" fill="#140A2E"/>` +
    `<ellipse class="halo" cx="${w / 2}" cy="${hgt / 2}" rx="${w * 0.42}" ry="${hgt * 0.62}" fill="url(#pbr)"/>` +
    field.join('') +
    sparks +
    `<path class="gl" d="${allText}" fill="#A78BFA" filter="url(#pbg)"/>` +
    letterPaths +
    `<g clip-path="url(#pbc)"><rect class="sh" x="0" y="0" width="44" height="${hgt}" fill="url(#pbs)" opacity=".75"/></g>` +
    `</svg>`
  )
}

/** Eight purple pixels chasing round a square: Jev is reading. */
export function spinner(): string {
  const ring: Cell[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 1 },
    { x: 2, y: 2 },
    { x: 1, y: 2 },
    { x: 0, y: 2 },
    { x: 0, y: 1 },
  ]
  const cells = ring.map((c, i) => rect(c.x * 4, c.y * 4, 3.4, shade(3 + (i % 3)), `s${i}`)).join('')
  // Negative delays start the chase mid-cycle, so the first frame already moves.
  const delays = ring.map((_, i) => `.ps .s${i}{animation-delay:-${((7 - i) * 0.1).toFixed(1)}s}`).join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="ps" viewBox="0 0 12 12" width="12" height="12" shape-rendering="crispEdges">` +
    `<style>.ps rect{opacity:.2;animation:chase .8s linear infinite}@keyframes chase{0%{opacity:1}12.5%{opacity:.55}25%,100%{opacity:.2}}${delays}` +
    `@media (prefers-reduced-motion: reduce){.ps rect{animation:none;opacity:.6}}</style>` +
    `${cells}</svg>`
  )
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

/** The suggestion's mark: a purple pixel spark that pops in, then twinkles. */
export function spark(size = 18): string {
  const cells: string[] = []
  SPARK.forEach((line, y) =>
    [...line].forEach((ch, x) => {
      if (ch !== '#') return
      const ring = Math.max(Math.abs(x - 4), Math.abs(y - 4))
      const fill = ring === 0 ? '#7C3AED' : shade(Math.min(5, 1 + ring))
      cells.push(rect(x * 2, y * 2, 1.8, fill, `r${ring}`))
    }),
  )

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="pk" viewBox="0 0 18 18" width="${size}" height="${size}" shape-rendering="crispEdges">` +
    `<style>.pk g{transform-origin:9px 9px;animation:pop .45s steps(5) both}` +
    `@keyframes pop{0%{transform:scale(.2);opacity:0}70%{transform:scale(1.15);opacity:1}100%{transform:scale(1)}}` +
    `.pk .r1,.pk .r2,.pk .r3,.pk .r4{animation:tw 1.6s steps(3) infinite}.pk .r2{animation-delay:.15s}.pk .r3{animation-delay:.3s}.pk .r4{animation-delay:.45s}` +
    `@keyframes tw{0%,100%{opacity:1}50%{opacity:.55}}${STILL}</style>` +
    `<g>${cells.join('')}</g></svg>`
  )
}

/**
 * How strong a match is, as ten pixel blocks: the filled ones step in one by
 * one, then a shimmer runs along them.
 */
export function meter(probability: number): string {
  const blocks = 10
  const filled = Math.max(0, Math.min(blocks, Math.round(probability * blocks)))
  const cells = Array.from({ length: blocks }, (_, i) => {
    if (i >= filled) return rect(i * 6, 0, 4.6, ACCENT, 'off')
    const fill = shade(2 + Math.floor((i / blocks) * 5))

    return rect(i * 6, 0, 4.6, fill, `f${i}`)
  }).join('')
  const delays = Array.from(
    { length: filled },
    (_, i) => `.pm rect.f${i}{animation-delay:${(i * 0.05).toFixed(2)}s,${(0.6 + i * 0.08).toFixed(2)}s}`,
  ).join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" class="pm" viewBox="0 0 59 5" width="59" height="5" shape-rendering="crispEdges">` +
    `<style>.pm .off{opacity:.3}.pm rect[class^=f]{animation:in .25s steps(2) both,shim 2.4s steps(3) infinite}` +
    `@keyframes in{0%{opacity:0}100%{opacity:1}}@keyframes shim{0%,100%{opacity:1}8%{opacity:.45}16%{opacity:1}}` +
    `${delays}${STILL}</style>${cells}</svg>`
  )
}

/**
 * A section's mark: a 5x5 mirrored pixel tile, the same every time for the
 * same section, in a color of its own.
 */
export function tile(group: string): string {
  const h = hashText(group)
  let color = `hsl(${250 + (h % 50)}, 70%, 58%)`
  if (group === 'your-skills') color = '#8B5CF6'
  else if (group === 'gstack') color = '#D97706'
  else if (group === 'mattpocock-skills') color = '#0EA5E9'
  const cells: string[] = []
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (((h >>> (y * 3 + x)) & 1) === 0 && !(x === 2 && y === 2)) continue
      cells.push(rect(x * 2, y * 2, 1.8, color))
      if (x < 2) cells.push(rect((4 - x) * 2, y * 2, 1.8, color))
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10" shape-rendering="crispEdges">${cells.join('')}</svg>`
}
