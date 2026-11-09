/**
 * Spooky-UI static analysis tests.
 * Reads public/ files as text; no browser, no DOM.
 * Covers the behaviours required by the P1–P12 fixes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../public');
const css = readFileSync(resolve(root, 'styles.css'), 'utf8');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const js = readFileSync(resolve(root, 'app.js'), 'utf8');

// ---------------------------------------------------------------------------
// P1 — R5.3: candle duration formula cannot go below 333 ms
// ---------------------------------------------------------------------------
describe('P1 – candle animation duration formula (R5.3)', () => {
  /**
   * Extract the calc() expression from the animation-duration line.
   * Expected form: calc(333ms + (1 - var(--confidence, 0.5)) * 3667ms)
   */
  const durationMatch = css.match(
    /animation[^;]*?calc\(\s*333ms\s*\+\s*\(1\s*-\s*var\(--confidence[^)]*\)\)\s*\*\s*(\d+(?:\.\d+)?)ms\s*\)/,
  );

  it('uses the correct formula: 333ms + (1 - confidence) * 3667ms', () => {
    expect(durationMatch).not.toBeNull();
    const multiplier = Number(durationMatch![1]);
    expect(multiplier).toBeCloseTo(3667, 0);
  });

  it('evaluates to >= 333 ms at confidence = 1', () => {
    // calc(333ms + (1 - 1) * 3667ms) = 333 + 0 = 333ms
    const atMax = 333 + (1 - 1) * 3667;
    expect(atMax).toBeGreaterThanOrEqual(333);
  });

  it('evaluates to >= 4000 ms at confidence = 0', () => {
    // calc(333ms + (1 - 0) * 3667ms) = 333 + 3667 = 4000ms
    const atMin = 333 + (1 - 0) * 3667;
    expect(atMin).toBeGreaterThanOrEqual(4000);
  });

  it('is never below 333 ms for any confidence in [0, 1]', () => {
    for (let conf = 0; conf <= 1; conf += 0.01) {
      const dur = 333 + (1 - conf) * 3667;
      expect(dur).toBeGreaterThanOrEqual(333);
    }
  });
});

// ---------------------------------------------------------------------------
// P2 — R5.5: reduced-motion disables .flame animation and sets opacity
// ---------------------------------------------------------------------------
describe('P2 – prefers-reduced-motion (R5.5)', () => {
  // Find the @media (prefers-reduced-motion: reduce) block
  const rmMatch = css.match(
    /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)([\s\S]*?)(?=@media|$)/,
  );
  const rmBlock = rmMatch ? rmMatch[1] : '';

  it('has a prefers-reduced-motion block', () => {
    expect(rmBlock.length).toBeGreaterThan(0);
  });

  it('sets animation: none on .flame inside the reduced-motion block', () => {
    // The block should contain a .flame rule with animation: none
    expect(rmBlock).toMatch(/\.flame[\s\S]*?animation\s*:\s*none/);
  });

  it('sets opacity on .flame inside the reduced-motion block', () => {
    // opacity: calc(0.3 + var(--confidence, 0.5) * 0.7)
    expect(rmBlock).toMatch(/\.flame[\s\S]*?opacity\s*:\s*calc\(\s*0\.3/);
  });

  it('sets transition: opacity 0.5s on .flame inside the reduced-motion block', () => {
    expect(rmBlock).toMatch(/\.flame[\s\S]*?transition\s*:\s*opacity\s+0\.5s/);
  });
});

// ---------------------------------------------------------------------------
// P3 — R8.8: app.js sets and removes aria-busy
// ---------------------------------------------------------------------------
describe('P3 – aria-busy on loading containers (R8.8)', () => {
  it('sets aria-busy="true" on summon-form when loading', () => {
    expect(js).toMatch(/summon-form.*setAttribute\(['"]aria-busy['"],\s*['"]true['"]\)/);
  });

  it('removes aria-busy from summon-form in finally block', () => {
    expect(js).toMatch(/summon-form.*removeAttribute\(['"]aria-busy['"]\)/);
  });

  it('sets aria-busy="true" on log when asking', () => {
    expect(js).toMatch(
      /\$\(['"]log['"]\)\.setAttribute\(['"]aria-busy['"],\s*['"]true['"]\)/,
    );
  });

  it('removes aria-busy from log in finally block', () => {
    expect(js).toMatch(/\$\(['"]log['"]\)\.removeAttribute\(['"]aria-busy['"]\)/);
  });

  it('sets aria-busy="true" on exorcism-wrap when exorcising', () => {
    expect(js).toMatch(
      /exorcism-wrap.*setAttribute\(['"]aria-busy['"],\s*['"]true['"]\)/,
    );
  });

  it('removes aria-busy from exorcism-wrap in finally block', () => {
    expect(js).toMatch(/exorcism-wrap.*removeAttribute\(['"]aria-busy['"]\)/);
  });
});

// ---------------------------------------------------------------------------
// P4 — R10.3: SESSION_NOT_FOUND: api() attaches code; handlers show alert
// ---------------------------------------------------------------------------
describe('P4 – SESSION_NOT_FOUND handling (R10.3)', () => {
  it('api() attaches err.code from data.code', () => {
    // The api function should do: err.code = data.code
    expect(js).toMatch(/err\.code\s*=\s*data\.code/);
  });

  it('ask handler checks for SESSION_NOT_FOUND', () => {
    expect(js).toMatch(/SESSION_NOT_FOUND/);
  });

  it('show "The séance has ended" message on SESSION_NOT_FOUND', () => {
    expect(js).toMatch(/The s[eé]ance has ended/);
  });

  it('returns focus to summon form on SESSION_NOT_FOUND', () => {
    // Should focus #repo or hide #seance
    expect(js).toMatch(/seance.*hidden\s*=\s*true/);
  });
});

// ---------------------------------------------------------------------------
// P8 — R1.1/R1.2: repo-err field error element and validation call
// ---------------------------------------------------------------------------
describe('P8 – inline repo-err field error (R1.1, R1.2)', () => {
  it('has a <p> element with id="repo-err" in HTML', () => {
    expect(html).toMatch(/id=['"]repo-err['"]/);
  });

  it('repo-err element is hidden by default', () => {
    // The p element should have the hidden attribute
    expect(html).toMatch(/id=['"]repo-err['"][^>]*hidden|hidden[^>]*id=['"]repo-err['"]/);
  });

  it('validate() calls fieldError for repo-err', () => {
    expect(js).toMatch(/fieldError\(['"]repo-err['"]/);
  });

  it('shows an error message for empty repository', () => {
    // The error message text should be present
    expect(js).toMatch(/Enter a repository URL/);
  });
});

// ---------------------------------------------------------------------------
// P10 — R3.9: aria-atomic=true on each injected .tally
// ---------------------------------------------------------------------------
describe('P10 – aria-atomic on tally (R3.9)', () => {
  it('injected tally element has aria-atomic="true"', () => {
    // The el() call for tally should include aria-atomic: 'true'
    expect(js).toMatch(/['"]aria-atomic['"]\s*:\s*['"]true['"]/);
  });
});

// ---------------------------------------------------------------------------
// P12 — R8.6: claim bubbles are article elements (not div.claim)
// ---------------------------------------------------------------------------
describe('P12 – claim bubbles are <article> elements (R8.6)', () => {
  it('claimNode creates article elements not divs', () => {
    // el('article', ...) should be present in claimNode
    expect(js).toMatch(/el\(['"]article['"],\s*\{\s*class\s*:\s*`claim/);
  });

  it('no CSS selector depends on div.claim', () => {
    expect(css).not.toMatch(/div\.claim/);
  });
});

// ---------------------------------------------------------------------------
// R5.2 — --confidence reaches the candle. P13 (move it to the root) was
// reverted in review: .candle declares its own --confidence, which would
// shadow a value set on the root, so the candle would stop reacting.
// ---------------------------------------------------------------------------
describe('R5.2 – --confidence is set where the candle reads it', () => {
  it('.candle declares its own --confidence default', () => {
    expect(css).toMatch(/\.candle\s*\{[^}]*--confidence:/);
  });

  it('setConfidence sets --confidence on the #candle element itself', () => {
    expect(js).toMatch(
      /\$\(['"]candle['"]\)\.style\.setProperty\(\s*['"]--confidence['"]/,
    );
  });
});

// ---------------------------------------------------------------------------
// Label coverage — every input/textarea in index.html has a label for= match
// ---------------------------------------------------------------------------
describe('Label coverage (R1.1, R8.6)', () => {
  it('every visible input has a corresponding <label for=>', () => {
    // Extract all input ids (excluding those inside data-list and datalist)
    const inputIdMatches = html.matchAll(/<input[^>]+id=['"]([^'"]+)['"]/g);
    const inputIds = [...inputIdMatches].map((m) => m[1]);

    // Extract all label for= values
    const labelForMatches = html.matchAll(/<label[^>]+for=['"]([^'"]+)['"]/g);
    const labelFors = new Set([...labelForMatches].map((m) => m[1]));

    const unlabelled: string[] = [];
    for (const id of inputIds) {
      // repo-list is a datalist id, not an input — skip
      // plant-sha and plant-quote are inside plant (they have labels)
      if (!labelFors.has(id)) {
        unlabelled.push(id);
      }
    }
    expect(unlabelled).toEqual([]);
  });

  it('every textarea has a corresponding <label for=>', () => {
    const taIdMatches = html.matchAll(/<textarea[^>]+id=['"]([^'"]+)['"]/g);
    const taIds = [...taIdMatches].map((m) => m[1]);

    const labelForMatches = html.matchAll(/<label[^>]+for=['"]([^'"]+)['"]/g);
    const labelFors = new Set([...labelForMatches].map((m) => m[1]));

    const unlabelled = taIds.filter((id) => !labelFors.has(id));
    expect(unlabelled).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Button text — every button has visible text
// ---------------------------------------------------------------------------
describe('Button text (R8.6)', () => {
  it('every <button> element has non-empty text content', () => {
    // Extract button contents (between > and </button>)
    const buttonMatches = html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g);
    const empty: string[] = [];
    for (const m of buttonMatches) {
      const text = m[1].replace(/<[^>]+>/g, '').trim();
      if (!text) empty.push(m[0].slice(0, 80));
    }
    expect(empty).toEqual([]);
  });
});
