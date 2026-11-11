/**
 * Spooky-UI static analysis tests.
 * Reads public/ files as text; no browser, no DOM.
 * Covers the behaviours required by the P1–P14 fixes.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';

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

// ---------------------------------------------------------------------------
// P6 — R7.3 / R8.5: severityLabel pure function and rendering
// ---------------------------------------------------------------------------
describe('P6 – severityLabel (R7.3, R8.5)', () => {
  /**
   * Extract and evaluate the severityLabel function from app.js.
   * We do this by extracting the function source and wrapping it.
   */
  const fnMatch = js.match(/function severityLabel\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);

  it('severityLabel function is defined in app.js', () => {
    expect(fnMatch).not.toBeNull();
  });

  it('severityLabel(0) returns "Restless"', () => {
    const body = fnMatch![1];
    const fn = new Function('score', body) as (s: number) => string;
    expect(fn(0)).toBe('Restless');
  });

  it('severityLabel(25) returns "Restless"', () => {
    const body = fnMatch![1];
    const fn = new Function('score', body) as (s: number) => string;
    expect(fn(25)).toBe('Restless');
  });

  it('severityLabel(26) returns "Troubled"', () => {
    const body = fnMatch![1];
    const fn = new Function('score', body) as (s: number) => string;
    expect(fn(26)).toBe('Troubled');
  });

  it('severityLabel(50) returns "Troubled"', () => {
    const body = fnMatch![1];
    const fn = new Function('score', body) as (s: number) => string;
    expect(fn(50)).toBe('Troubled');
  });

  it('severityLabel(51) returns "Haunted"', () => {
    const body = fnMatch![1];
    const fn = new Function('score', body) as (s: number) => string;
    expect(fn(51)).toBe('Haunted');
  });

  it('severityLabel(75) returns "Haunted"', () => {
    const body = fnMatch![1];
    const fn = new Function('score', body) as (s: number) => string;
    expect(fn(75)).toBe('Haunted');
  });

  it('severityLabel(76) returns "Possessed"', () => {
    const body = fnMatch![1];
    const fn = new Function('score', body) as (s: number) => string;
    expect(fn(76)).toBe('Possessed');
  });

  it('severityLabel(100) returns "Possessed"', () => {
    const body = fnMatch![1];
    const fn = new Function('score', body) as (s: number) => string;
    expect(fn(100)).toBe('Possessed');
  });

  it('#ex-severity element exists in index.html', () => {
    expect(html).toMatch(/id=['"]ex-severity['"]/);
  });

  it('severityLabel is called in the exorcise handler', () => {
    expect(js).toMatch(/severityLabel\s*\(\s*d\.score\s*\)/);
  });

  it('result of severityLabel is placed into ex-severity element', () => {
    // ex-severity is fetched via $(), then .textContent = severityLabel(...)
    expect(js).toMatch(/ex-severity/);
    expect(js).toMatch(/sevEl\.textContent\s*=\s*severityLabel/);
  });
});

// ---------------------------------------------------------------------------
// P7 — R7.8: reversibility badge as its own element
// ---------------------------------------------------------------------------
describe('P7 – reversibility badge (R7.8)', () => {
  it('badge class exists in styles.css', () => {
    expect(css).toMatch(/\.badge\s*\{/);
  });

  it('badge--rev class exists in styles.css', () => {
    expect(css).toMatch(/\.badge--rev\s*\{/);
  });

  it('badge--irrev class exists in styles.css', () => {
    expect(css).toMatch(/\.badge--irrev\s*\{/);
  });

  it('app.js renders "Reversible ✓" badge text', () => {
    expect(js).toMatch(/Reversible ✓/);
  });

  it('app.js renders "Irreversible ⚠" badge text', () => {
    expect(js).toMatch(/Irreversible ⚠/);
  });

  it('badge is created with el() as a separate element (not inside rationale text)', () => {
    // The badge is el('span', { class: 'badge ...' })
    expect(js).toMatch(/el\(['"]span['"],\s*\{\s*class\s*:\s*`badge/);
  });

  it('"Reversible. " text prefix in rationale is removed', () => {
    // The old pattern combined reversible with rationale text
    expect(js).not.toMatch(/Reversible\.\s+.*rationale/);
    expect(js).not.toMatch(/\$\{s\.reversible \? 'Reversible\. ' : ''\}/);
  });
});

// ---------------------------------------------------------------------------
// P9 — R7.9: steps and do-not-touch entries use <details open>
// ---------------------------------------------------------------------------
describe('P9 – details disclosure in steps and dnt (R7.9)', () => {
  it('steps are wrapped in <details open>', () => {
    // el('details', { open: '' }) is in the steps rendering
    expect(js).toMatch(/el\(['"]details['"],\s*\{\s*open\s*:/);
  });

  it('step summary uses step description', () => {
    // The summary text includes the step description from s.description
    expect(js).toMatch(/el\(['"]summary['"],\s*\{\s*text\s*:.*description/);
  });

  it('do-not-touch entries use <details open>', () => {
    // The dnt rendering also uses el('details', { open: '' })
    // Both steps and dnt use it, and the dnt section contains lineRange
    expect(js).toMatch(/lineRange/);
    // Two details elements are created — one for steps, one for dnt
    const detailsCount = (js.match(/el\(['"]details['"],\s*\{\s*open\s*:/g) || []).length;
    expect(detailsCount).toBeGreaterThanOrEqual(2);
  });

  it('dnt summary shows line range text', () => {
    // rangeText is used as the summary text
    expect(js).toMatch(/el\(['"]summary['"],\s*\{[^}]*class[^}]*range/);
  });

  it('.steps details CSS rule exists', () => {
    expect(css).toMatch(/\.steps\s+details/);
  });

  it('.dnt details CSS rule exists', () => {
    expect(css).toMatch(/\.dnt\s+details/);
  });

  it('.step-body CSS class exists', () => {
    expect(css).toMatch(/\.step-body\s*\{/);
  });

  it('.dnt-body CSS class exists', () => {
    expect(css).toMatch(/\.dnt-body\s*\{/);
  });
});

// ---------------------------------------------------------------------------
// P10 — R3.3 / R3.9: persistent verified-counter element
// ---------------------------------------------------------------------------
describe('P10 – persistent verified-counter (R3.3, R3.9)', () => {
  it('#verified-counter element exists in index.html', () => {
    expect(html).toMatch(/id=['"]verified-counter['"]/);
  });

  it('#verified-counter has aria-live="polite"', () => {
    expect(html).toMatch(/id=['"]verified-counter['"][^>]*aria-live=['"]polite['"]/);
  });

  it('#verified-counter has aria-atomic="true"', () => {
    expect(html).toMatch(/id=['"]verified-counter['"][^>]*aria-atomic=['"]true['"]/);
  });

  it('app.js updates #verified-counter after each answer', () => {
    // verified-counter is fetched via $(), then counter.textContent = ...
    expect(js).toMatch(/verified-counter/);
    expect(js).toMatch(/counter\.textContent/);
  });

  it('session counters (totalVerified, totalClaims) are in state', () => {
    expect(js).toMatch(/totalVerified\s*:/);
    expect(js).toMatch(/totalClaims\s*:/);
  });

  it('counters are reset on new summon', () => {
    expect(js).toMatch(/state\.totalVerified\s*=\s*0/);
    expect(js).toMatch(/state\.totalClaims\s*=\s*0/);
  });

  it('counter text contains "this séance"', () => {
    expect(js).toMatch(/this s[eé]ance/);
  });
});

// ---------------------------------------------------------------------------
// P11 — R7.2: exorcise loading indicator placement and text
// ---------------------------------------------------------------------------
describe('P11 – exorcise loading indicator (R7.2)', () => {
  it('#exorcise-status element exists in index.html', () => {
    expect(html).toMatch(/id=['"]exorcise-status['"]/);
  });

  it('#exorcise-status has role="status"', () => {
    expect(html).toMatch(/id=['"]exorcise-status['"][^>]*role=['"]status['"]/);
  });

  it('#exorcise-status has aria-live="polite"', () => {
    expect(html).toMatch(/id=['"]exorcise-status['"][^>]*aria-live=['"]polite['"]/);
  });

  it('#exorcise-status is adjacent to #exorcise-btn in the HTML', () => {
    // Both should appear in the same .ask-actions block
    const actionsMatch = html.match(/class=['"]ask-actions['"][^]*?<\/div>/);
    expect(actionsMatch).not.toBeNull();
    const actionsBlock = actionsMatch![0];
    expect(actionsBlock).toMatch(/exorcise-btn/);
    expect(actionsBlock).toMatch(/exorcise-status/);
  });

  it('exorcise handler sets loading text to "Performing exorcism…"', () => {
    expect(js).toMatch(/exorcise-status.*Performing exorcism…/);
  });

  it('exorcise handler clears #exorcise-status in finally block', () => {
    // In the finally block, exorcise-status.textContent is set to ''
    expect(js).toMatch(
      /exorcise-status.*textContent\s*=\s*['"]['"]|exorcise-status.*=\s*''/,
    );
  });

  it('exorcise handler no longer uses #ask-status for its loading text', () => {
    // The ask-status should not be set to the exorcise loading message
    expect(js).not.toMatch(/ask-status.*Reading the haunting/);
    expect(js).not.toMatch(/ask-status.*Performing exorcism/);
  });
});

// ---------------------------------------------------------------------------
// P14 — R8.1: contrast table comment in tokens.css; contrast.mjs script exists
// ---------------------------------------------------------------------------
describe('P14 – contrast table and script (R8.1)', () => {
  const tokensPath = resolve(root, 'tokens.css');
  const tokensCss = readFileSync(tokensPath, 'utf8');
  const contrastScriptPath = resolve(root, '../scripts/contrast.mjs');

  it('tokens.css has a WCAG contrast table comment', () => {
    expect(tokensCss).toMatch(/WCAG.*contrast.*table/i);
  });

  it('tokens.css lists at least 6 text/bg token pairs', () => {
    const pairCount = (tokensCss.match(/text:.*oklch.*\|.*bg:.*oklch/g) || []).length;
    expect(pairCount).toBeGreaterThanOrEqual(6);
  });

  it('each listed pair uses the oklch() format', () => {
    const pairs = tokensCss.match(/text:.*oklch.*\|.*bg:.*oklch/g) || [];
    for (const pair of pairs) {
      expect(pair).toMatch(/oklch\(/);
    }
  });

  it('scripts/contrast.mjs exists', () => {
    expect(existsSync(contrastScriptPath)).toBe(true);
  });

  it('package.json has a "contrast" npm script', () => {
    const pkgPath = resolve(root, '../package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts).toHaveProperty('contrast');
    expect(pkg.scripts.contrast).toMatch(/contrast\.mjs/);
  });

  it('all contrast pairs in tokens.css pass 4.5:1 (inline contrast check)', () => {
    const PAIR_RE =
      /\*\s+text:\s+\S+\s+\(oklch\(([^)]+)\)\)\s*\|\s*bg:\s+\S+\s+\(oklch\(([^)]+)\)\)/g;

    function parseOklch(str: string): [number, number, number] {
      const parts = str.trim().split(/\s+/);
      return [parseFloat(parts[0]) / 100, parseFloat(parts[1]), parseFloat(parts[2])];
    }

    function luminance(L: number, C: number, H: number): number {
      const a = C * Math.cos((H * Math.PI) / 180);
      const b = C * Math.sin((H * Math.PI) / 180);
      const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
      const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
      const s_ = L - 0.0894841775 * a - 1.291485548 * b;
      const lv = l_ ** 3;
      const mv = m_ ** 3;
      const sv = s_ ** 3;
      const r = 4.0767416621 * lv - 3.3077115913 * mv + 0.2309699292 * sv;
      const g = -1.2684380046 * lv + 2.6097574011 * mv - 0.3413193965 * sv;
      const bv = -0.0041960863 * lv - 0.7034186147 * mv + 1.707614701 * sv;
      const clamp = (v: number) => Math.max(0, Math.min(1, v));
      return 0.2126 * clamp(r) + 0.7152 * clamp(g) + 0.0722 * clamp(bv);
    }

    function contrastRatio(l1: number, l2: number): number {
      const li = Math.max(l1, l2);
      const da = Math.min(l1, l2);
      return (li + 0.05) / (da + 0.05);
    }

    const failing: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = PAIR_RE.exec(tokensCss)) !== null) {
      const [tL, tC, tH] = parseOklch(m[1]);
      const [bL, bC, bH] = parseOklch(m[2]);
      const ratio = contrastRatio(luminance(tL, tC, tH), luminance(bL, bC, bH));
      if (ratio < 4.5)
        failing.push(`ratio ${ratio.toFixed(2)} for "${m[0].slice(0, 60)}"`);
    }
    expect(failing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ward-hardening T7 — static checks of the new markup, styles and tokens
// (R2.3, R7.4, R7.5, R8.4, N4; design.md §11.1, §11.3)
// ---------------------------------------------------------------------------

describe('ward-hardening T7 – index.html (design.md §11.1)', () => {
  // Parsed only; no scripts run (the DOM behaviour is tested in test/ui/dom.test.ts)
  const doc = new JSDOM(html).window.document;
  const byId = (id: string) => {
    const n = doc.getElementById(id);
    if (!n) throw new Error(`#${id} missing`);
    return n;
  };
  const text = (id: string) => (byId(id).textContent ?? '').replace(/\s+/g, ' ').trim();

  it('#repo-list offers crypt and possessed (R8.4)', () => {
    const values = [...byId('repo-list').querySelectorAll('option')].map((o) =>
      o.getAttribute('value'),
    );
    expect(values).toEqual(['crypt', 'possessed']);
  });

  it('#repo-help names both samples (R8.4)', () => {
    expect(text('repo-help')).toBe(
      'crypt is the sample repo. possessed is a hostile sample whose commits try to give the ghost orders. Or paste a public https://github.com/owner/repo.',
    );
  });

  it('#ward-limit follows #verified-counter with the R2.3 sentence (R2.3)', () => {
    const limit = byId('verified-counter').nextElementSibling;
    expect(limit?.id).toBe('ward-limit');
    expect(limit?.tagName).toBe('P');
    expect(limit?.className).toBe('meta');
    expect(text('ward-limit')).toBe(
      "The ward checks that each quote is really in the cited commit. It cannot check that the ghost's sentence says the same thing as the quote, so read both.",
    );
  });

  it('the plant quote field is required in words, with an 8-character placeholder (R1.1)', () => {
    const label = doc.querySelector('label[for="plant-quote"]');
    expect((label?.textContent ?? '').trim()).toBe('Quote from it');
    expect(byId('plant-quote').getAttribute('placeholder')).toBe(
      'Exact words from the commit, at least 8 characters',
    );
  });

  it('the wrongauthor preset follows the misquote preset', () => {
    const b = doc.querySelector('[data-preset="wrongauthor"]');
    expect(b?.tagName).toBe('BUTTON');
    expect((b?.textContent ?? '').trim()).toBe('Blame the wrong author');
    expect(b?.getAttribute('class')).toBe('btn small ghost');
    expect(b?.getAttribute('type')).toBe('button');
    expect(b?.previousElementSibling?.getAttribute('data-preset')).toBe('misquote');
  });

  it('#ex-summary-lab and #ex-tests-lab label the model text as unchecked (R7.4)', () => {
    expect(byId('ex-summary-lab').nextElementSibling?.id).toBe('ex-summary');
    expect(byId('ex-summary-lab').className).toBe('lab unchecked');
    expect(text('ex-summary-lab')).toBe("The model's words, not checked");
    expect(byId('ex-tests-lab').nextElementSibling?.id).toBe('ex-tests');
    expect(byId('ex-tests-lab').className).toBe('lab unchecked');
    expect(text('ex-tests-lab')).toBe(
      "The model's words, not checked. Read each test before you run it.",
    );
  });

  it('#ex-dropped-wrap follows #ex-dnt, starts hidden and holds the struck list (R7.5)', () => {
    const wrap = byId('ex-dropped-wrap');
    expect(wrap.tagName).toBe('SECTION');
    expect(wrap.hasAttribute('hidden')).toBe(true);
    expect(wrap.getAttribute('aria-labelledby')).toBe('h-dropped');
    expect(wrap.previousElementSibling?.id).toBe('ex-dnt');
    expect(byId('h-dropped').tagName).toBe('H3');
    expect(text('h-dropped')).toBe('Struck from the plan');
    expect(byId('ex-dropped-help').className).toBe('meta');
    expect(text('ex-dropped-help')).toBe(
      'The ward found no verified claim behind these, so they are not part of the plan.',
    );
    expect(byId('ex-dropped').tagName).toBe('UL');
    expect(byId('ex-dropped').className).toBe('dropped');
    expect(wrap.contains(byId('ex-dropped'))).toBe(true);
  });

  it('has no inline styles, inline scripts or inline event handlers (CSP)', () => {
    expect(doc.querySelectorAll('[style]')).toHaveLength(0);
    for (const s of doc.querySelectorAll('script')) {
      expect(s.getAttribute('src')).toBeTruthy();
      expect((s.textContent ?? '').trim()).toBe('');
    }
    for (const n of doc.querySelectorAll('*')) {
      for (const a of n.getAttributeNames()) expect(a.startsWith('on'), a).toBe(false);
    }
  });
});

describe('ward-hardening T7 – app.js inserts untrusted text only as text (N4)', () => {
  it('uses no HTML-parsing sink', () => {
    expect(js).not.toMatch(
      /\binnerHTML\b|\bouterHTML\b|insertAdjacentHTML|document\.write/,
    );
  });
});

describe('ward-hardening T7 – styles and tokens (design.md §11.3, N4)', () => {
  const tokensCss = readFileSync(resolve(root, 'tokens.css'), 'utf8');
  const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  /** selector list -> declarations, for top-level and media-nested plain rules */
  const rules = [...cssNoComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
    selectors: (m[1] ?? '').split(',').map((s) => s.trim().replace(/\s+/g, ' ')),
    body: m[2] ?? '',
  }));
  const ruleFor = (sel: string) => rules.filter((r) => r.selectors.includes(sel));

  it('has the new rules from §11.3, using tokens only', () => {
    const want: Array<[string, RegExp]> = [
      ['.lab.warn', /color:\s*var\(--color-accent\)/],
      ['.lab.warn', /border:\s*1px dashed var\(--color-accent\)/],
      ['.lab.unchecked', /color:\s*var\(--color-muted\)/],
      ['.found', /border-inline-start:\s*1px solid var\(--color-rule\)/],
      ['.found-head', /color:\s*var\(--color-muted\)/],
      ['.found-quote', /font-family:\s*var\(--font-outlier\)/],
      ['.found-quote', /color:\s*var\(--color-ink-2\)/],
      [
        "#ledger li[data-suspicious='true']",
        /border-inline-start:\s*2px dashed var\(--color-accent\)/,
      ],
    ];
    for (const [sel, decl] of want) {
      expect(
        ruleFor(sel).some((r) => decl.test(r.body)),
        `${sel} ${decl}`,
      ).toBe(true);
    }
  });

  it('has no literal colour or font below the header comment, and no transition: all', () => {
    expect(cssNoComments).not.toMatch(
      /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/,
    );
    for (const m of cssNoComments.matchAll(/font-family:\s*([^;]+);/g)) {
      expect(m[1]?.trim()).toMatch(/^var\(--font-[a-z-]+\)$/);
    }
    expect(cssNoComments).not.toMatch(/transition:\s*all\b/);
    expect(cssNoComments).not.toMatch(/transition-property:\s*all\b/);
  });

  it('long quotes, hashes, names and paths wrap anywhere (320 px)', () => {
    // overflow-wrap is inherited, so the containers of untrusted text are enough
    const containers = [
      '.claim',
      '.ledger li',
      '.dropped li',
      '.tests li',
      '.summary',
      '.step-body',
      '.dnt-body',
      '.steps details summary',
      '.turn-q',
      '.notice',
      '.err',
      '.crypt-head',
      '.talk-head',
    ];
    for (const sel of containers) {
      expect(
        ruleFor(sel).some((r) => /overflow-wrap:\s*anywhere/.test(r.body)),
        sel,
      ).toBe(true);
    }
  });

  it('sets no fixed or minimum width wider than a 320 px screen', () => {
    const toPx = (v: string, unit: string) =>
      unit === 'px' ? Number(v) : unit === 'rem' || unit === 'em' ? Number(v) * 16 : 0;
    for (const m of cssNoComments.matchAll(
      /(?:^|[;{\s])(width|min-width|flex-basis):\s*([\d.]+)(px|rem|em)\b/g,
    )) {
      expect(toPx(m[2] ?? '0', m[3] ?? ''), m[0]).toBeLessThanOrEqual(288);
    }
  });

  it('the contrast table lists accent text on paper (N4)', () => {
    expect(tokensCss).toMatch(
      /text: --color-accent \(oklch\(76% 0\.15 65\)\) \| bg: --color-paper \(oklch\(14% 0\.012 60\)\)/,
    );
  });
});
