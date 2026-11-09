#!/usr/bin/env node
/**
 * scripts/contrast.mjs
 * Reads public/tokens.css, extracts the contrast table from the comment at the
 * top, parses each pair, converts oklch colours to relative luminance, and
 * verifies every pair meets the WCAG 2.1 AA threshold of 4.5:1.
 *
 * Exits 1 if any pair is below 4.5:1.
 * No npm dependencies — pure Node 20 built-ins only.
 *
 * Usage:
 *   node scripts/contrast.mjs
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tokensPath = resolve(__dirname, '../public/tokens.css');
const css = readFileSync(tokensPath, 'utf8');

// ---------------------------------------------------------------------------
// Colour math: oklch → linear-light sRGB → relative luminance
// ---------------------------------------------------------------------------

/** Degrees → radians */
const rad = (d) => (d * Math.PI) / 180;

/**
 * oklch(L C H) → [r, g, b] in [0, 1] linear-light sRGB.
 * Follows CSS Color Level 4 conversion pipeline:
 *   oklch → oklab → linear-light XYZ-D65 → linear-light sRGB
 */
function oklchToLinearSrgb(L, C, H) {
  // oklch → oklab
  const a = C * Math.cos(rad(H));
  const b = C * Math.sin(rad(H));

  // oklab → linear-light LMS (via inverse M2 matrix)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  // LMS → linear-light sRGB (inverse M1)
  const r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bv = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  return [r, g, bv];
}

/**
 * Relative luminance of an oklch colour.
 * L is a fraction in [0, 1]; C is chroma; H is hue in degrees.
 */
function luminanceOklch(L, C, H) {
  const [r, g, b] = oklchToLinearSrgb(L, C, H);
  // Clamp and apply sRGB transfer function in reverse to get display-referred Y
  // For linearised values, luminance = 0.2126 R + 0.7152 G + 0.0722 B
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(b);
}

/**
 * WCAG contrast ratio between two relative luminances.
 * Returns a value in [1, 21].
 */
function contrastRatio(L1, L2) {
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------------------------------------------------------------------------
// Parse the contrast table from the tokens.css leading comment
// ---------------------------------------------------------------------------

/**
 * The table lives in a block comment at the top of tokens.css.
 * Each data row looks like:
 *   text: --color-ink (oklch(93% 0.02 85)) | bg: --color-paper (oklch(14% 0.012 60)) | ratio: ≥N
 *
 * We extract every line that contains "oklch(" twice (one text colour, one bg colour).
 */
const PAIR_RE =
  /^\s*\*\s+text:\s+\S+\s+\(oklch\(([^)]+)\)\)\s*\|\s*bg:\s+\S+\s+\(oklch\(([^)]+)\)\)/;

function parseOklch(str) {
  // "93% 0.02 85" or "93% 0.02 85" — L is a percentage, C is raw, H is degrees
  const parts = str.trim().split(/\s+/);
  if (parts.length < 3) throw new Error(`Cannot parse oklch values: "${str}"`);
  const L = parseFloat(parts[0]) / 100; // % → fraction
  const C = parseFloat(parts[1]);
  const H = parseFloat(parts[2]);
  return { L, C, H };
}

const pairs = [];
for (const line of css.split('\n')) {
  const m = line.match(PAIR_RE);
  if (!m) continue;
  try {
    const text = parseOklch(m[1]);
    const bg = parseOklch(m[2]);
    // Extract token names from the line for reporting
    const tokenMatch = line.match(
      /text:\s+(\S+)\s+\(oklch\([^)]+\)\)\s*\|\s*bg:\s+(\S+)/,
    );
    const textToken = tokenMatch ? tokenMatch[1] : 'text';
    const bgToken = tokenMatch ? tokenMatch[2] : 'bg';
    pairs.push({ textToken, bgToken, text, bg });
  } catch (e) {
    console.error(`  Skipping unparseable line: ${line.trim()}\n  Reason: ${e.message}`);
  }
}

if (pairs.length === 0) {
  console.error('ERROR: No contrast pairs found in tokens.css comment table.');
  console.error('Expected lines matching:');
  console.error(
    '  * text: --token-name (oklch(L% C H)) | bg: --token-name (oklch(L% C H))',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Evaluate each pair
// ---------------------------------------------------------------------------

let failed = 0;
const THRESHOLD = 4.5;

console.log('Contrast check — WCAG 2.1 AA (≥ 4.5:1 for normal text)\n');
console.log(`${'Text token'.padEnd(28)} ${'Bg token'.padEnd(28)} ${'Ratio'.padStart(7)}`);
console.log('─'.repeat(66));

for (const { textToken, bgToken, text, bg } of pairs) {
  const lText = luminanceOklch(text.L, text.C, text.H);
  const lBg = luminanceOklch(bg.L, bg.C, bg.H);
  const ratio = contrastRatio(lText, lBg);
  const pass = ratio >= THRESHOLD;
  const mark = pass ? '✓' : '✗ FAIL';
  const ratioStr = ratio.toFixed(2) + ':1';
  console.log(
    `${textToken.padEnd(28)} ${bgToken.padEnd(28)} ${ratioStr.padStart(7)}  ${mark}`,
  );
  if (!pass) failed++;
}

console.log('─'.repeat(66));

if (failed > 0) {
  console.error(`\n${failed} pair(s) failed the 4.5:1 threshold.`);
  process.exit(1);
} else {
  console.log(`\nAll ${pairs.length} pairs pass (≥ ${THRESHOLD}:1). ✓`);
}
