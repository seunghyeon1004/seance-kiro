#!/usr/bin/env node
/**
 * scripts/contrast.mjs
 * WCAG contrast check of the colour tokens in public/tokens.css (audit C18).
 *
 * 1. Reads the real values of the `--color-*: oklch(...)` tokens from the `:root` block.
 * 2. Reads the contrast table in the leading comment (kept as documentation) and fails if a row
 *    names a token that :root does not declare, or gives it a different value.
 * 3. Checks every table row, then the pairs styles.css actually uses (USAGE below), including the
 *    color-mix() backgrounds, the fog and the focus ring, all computed from the :root values.
 *    Text pairs need 4.5:1; non-text pairs (borders, focus rings, bars; WCAG 1.4.11) need 3:1.
 *
 * Exits 1 on any failure. No npm dependencies — Node 20 built-ins only.
 *
 * Usage:
 *   node scripts/contrast.mjs [path/to/tokens.css]
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokensPath = resolve(process.argv[2] ?? resolve(__dirname, '../public/tokens.css'));
const css = readFileSync(tokensPath, 'utf8');

const THRESHOLD = { text: 4.5, 'non-text': 3 };

// ---------------------------------------------------------------------------
// Colour math: oklch → oklab → linear-light sRGB → gamma sRGB → relative luminance
// ---------------------------------------------------------------------------

const rad = (d) => (d * Math.PI) / 180;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** oklch {L, C, H} (L as a fraction) → oklab [L, a, b]. */
function oklchToOklab({ L, C, H }) {
  return [L, C * Math.cos(rad(H)), C * Math.sin(rad(H))];
}

/** oklab → linear-light sRGB (CSS Color 4), unclamped. */
function oklabToLinear([L, a, b]) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const encode = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const decode = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** oklab → gamma-encoded sRGB in [0, 1] (what the browser composites in). */
function oklabToRgb(lab) {
  return oklabToLinear(lab).map((v) => encode(clamp01(v)));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map(decode);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function parseOklch(str) {
  const parts = str.trim().split(/\s+/);
  if (parts.length < 3) throw new Error(`Cannot parse oklch values: "${str}"`);
  return {
    L: parseFloat(parts[0]) / 100,
    C: parseFloat(parts[1]),
    H: parseFloat(parts[2]),
  };
}
const sameOklch = (x, y) =>
  Math.abs(x.L - y.L) < 1e-9 && Math.abs(x.C - y.C) < 1e-9 && Math.abs(x.H - y.H) < 1e-9;
const showOklch = ({ L, C, H }) => `oklch(${+(L * 100).toFixed(4)}% ${C} ${H})`;

// ---------------------------------------------------------------------------
// The real tokens: the first :root block after the leading comment
// ---------------------------------------------------------------------------

const errors = [];

const rootAt = css.search(/(^|\n)\s*:root\s*\{/);
if (rootAt < 0) {
  console.error(`ERROR: no :root block in ${tokensPath}.`);
  process.exit(1);
}
const rootBody = css.slice(css.indexOf('{', rootAt) + 1, css.indexOf('}', rootAt));
const tokens = new Map();
for (const m of rootBody.matchAll(/(--color-[\w-]+)\s*:\s*oklch\(([^)]+)\)\s*;/g)) {
  tokens.set(m[1], parseOklch(m[2]));
}

/** A colour for the report: a name and its gamma sRGB. */
function tok(name) {
  const v = tokens.get(name);
  if (!v) {
    errors.push(`${name} is used by a contrast pair but not declared in :root.`);
    return { name, rgb: [0, 0, 0] };
  }
  return { name, rgb: oklabToRgb(oklchToOklab(v)) };
}

/** color-mix(in oklab, a p, b) of two opaque tokens. */
function mix(a, p, b, name) {
  const x = tokens.get(a);
  const y = tokens.get(b);
  if (!x || !y) return { ...tok(x ? b : a), name };
  const la = oklchToOklab(x);
  const lb = oklchToOklab(y);
  return { name, rgb: oklabToRgb(la.map((v, i) => p * v + (1 - p) * lb[i])) };
}

/** A token at alpha p (color-mix with transparent, or opacity) composited over `under`. */
function veil(a, p, under, name) {
  const top = tok(a).rgb;
  return { name, rgb: top.map((v, i) => p * v + (1 - p) * under.rgb[i]) };
}

// ---------------------------------------------------------------------------
// The comment table: documentation, which must agree with :root
// ---------------------------------------------------------------------------

const ROW_RE =
  /^\s*\*\s+(text|non-text):\s+(--[\w-]+)\s+\(oklch\(([^)]+)\)\)\s*\|\s*bg:\s+(--[\w-]+)\s+\(oklch\(([^)]+)\)\)/;

const comment = css.slice(0, rootAt);
const table = [];
for (const line of comment.split('\n')) {
  const m = line.match(ROW_RE);
  if (!m) continue;
  const [, kind, fgName, fgVal, bgName, bgVal] = m;
  for (const [name, val] of [
    [fgName, fgVal],
    [bgName, bgVal],
  ]) {
    const real = tokens.get(name);
    const listed = parseOklch(val);
    if (!real) errors.push(`The table names ${name}, which :root does not declare.`);
    else if (!sameOklch(real, listed))
      errors.push(
        `The table gives ${name} as ${showOklch(listed)}, but :root declares ${showOklch(real)}.`,
      );
  }
  table.push({ kind, fg: tok(fgName), bg: tok(bgName), where: 'table' });
}
if (table.length === 0)
  errors.push('No contrast pairs found in the tokens.css comment table.');

// ---------------------------------------------------------------------------
// The pairs styles.css uses (selectors noted). Backgrounds made with color-mix() or opacity are
// computed from the tokens the same way the browser does.
// ---------------------------------------------------------------------------

const paper = tok('--color-paper');
const paper2 = tok('--color-paper-2');
const paper3 = tok('--color-paper-3');
const lit = veil('--color-verified', 0.09, paper, 'lit ledger row');
const memory = veil('--color-verified', 0.07, paper, '.claim.memory');
const errBg = mix('--color-error', 0.28, '--color-paper', '.err background');
const noticeBg = mix('--color-error', 0.22, '--color-paper', '.notice background');
const ghostHover = veil('--color-accent', 0.1, paper, '.btn.ghost:hover');
const rev = mix('--color-verified', 0.12, '--color-paper-2', '.badge--rev');
const irrev = mix('--color-accent', 0.12, '--color-paper-2', '.badge--irrev');
// .fog at haunting score 100: --max-fog 0.6, the gradient at full fog colour
const fog = veil('--color-fog', 0.6, paper, 'full fog');

const t = (fg, bg, where) => ({ kind: 'text', fg: tok(fg), bg, where });
const ui = (fg, bg, where) => ({ kind: 'non-text', fg: tok(fg), bg, where });

const USAGE = [
  t('--color-ink-2', paper2, '.source-lines'),
  t('--color-muted', paper2, 'input::placeholder'),
  t('--color-ink', paper3, '.turn-q'),
  t('--color-muted', paper3, ".btn[disabled], .btn[aria-disabled='true']"),
  t('--color-accent-ink', tok('--color-flame'), '.btn:hover'),
  t('--color-ink', ghostHover, '.btn.ghost:hover'),
  t('--color-ink', errBg, '.err'),
  t('--color-ink', noticeBg, '.notice'),
  t('--color-ink', lit, '.ledger li.lit'),
  t('--color-ink-2', lit, '.ledger li.lit .who'),
  t('--color-muted', lit, '.ledger li.lit .when'),
  t('--color-accent', lit, '.ledger li.lit .sha'),
  t('--color-ink', memory, '.claim.memory'),
  t('--color-ink-2', memory, '.claim.memory .found-quote'),
  t('--color-muted', memory, '.claim.memory .lab'),
  t('--color-verified', rev, '.badge--rev'),
  t('--color-ink', irrev, '.badge--irrev'),
  t('--color-rejected', paper2, '.dnt li .claim.rejected'),
  t('--color-speculation', paper2, '.dnt li .claim.speculation'),
  t('--color-muted', fog, '.meta over the fog'),
  t('--color-rejected', fog, '.claim.rejected over the fog'),
  ui('--color-rule-strong', paper, 'input, textarea border'),
  ui('--color-rule-strong', paper2, 'input, textarea border'),
  ui('--color-focus', paper, ':focus-visible'),
  ui('--color-focus', paper2, ':focus-visible'),
  ui('--color-focus', paper3, ':focus-visible'),
  ui('--color-focus', lit, '.ledger li:focus-visible'),
  ui('--color-accent', paper3, '.bar-fill on .bar-track'),
];

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

let failed = 0;
const line = '─'.repeat(92);

function report(title, pairs) {
  console.log(`\n${title}\n`);
  console.log(
    `${'Foreground'.padEnd(26)} ${'Background'.padEnd(30)} ${'Ratio'.padStart(8)}  ${'Kind'.padEnd(12)} Where`,
  );
  console.log(line);
  for (const p of pairs) {
    const r = ratio(p.fg.rgb, p.bg.rgb);
    const need = THRESHOLD[p.kind];
    const pass = r >= need;
    if (!pass) failed++;
    const kind = `${p.kind} ${need}`;
    console.log(
      `${p.fg.name.padEnd(26)} ${p.bg.name.padEnd(30)} ${(r.toFixed(2) + ':1').padStart(8)}  ${kind.padEnd(12)} ${pass ? '✓' : '✗ FAIL'}  ${p.where === 'table' ? '' : p.where}`,
    );
  }
  console.log(line);
}

console.log(
  `Contrast check — WCAG 2.2 AA: text ≥ ${THRESHOLD.text}:1, non-text ≥ ${THRESHOLD['non-text']}:1`,
);
console.log(`Tokens read from :root in ${tokensPath} (${tokens.size} colour tokens)`);
report('The table in the tokens.css comment', table);
report('Pairs used in styles.css', USAGE);

for (const e of errors) console.error(`ERROR: ${e}`);
if (failed > 0) console.error(`\n${failed} pair(s) failed their threshold.`);
if (errors.length > 0 || failed > 0) process.exit(1);
console.log(
  `\nAll ${table.length} table pairs and ${USAGE.length} usage pairs pass; the table agrees with :root. ✓`,
);
