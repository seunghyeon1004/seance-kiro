// Séance UI. Vanilla JS, no build step. All untrusted text (commit messages, ghost claims) is inserted with textContent.
'use strict';

const $ = (id) => document.getElementById(id);
const root = document.documentElement;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const dateFmt = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

// ward-hardening: the same limits as src/ghost/schema.ts (HUNK_UI_CHARS, QUOTE_MIN_CHARS, QUOTE_MAX_CHARS)
const HUNK_UI_CHARS = 4000;
const QUOTE_MIN_CHARS = 8;
const QUOTE_MAX_CHARS = 500;

/** Where the ward found a quote (R2.2). */
const FIELD_LABEL = {
  subject: 'in the commit subject',
  body: 'in the commit message',
  hunk: 'in the diff',
};

/** Default file and lines of each bundled sample (R8.4). */
const SAMPLE_DEFAULTS = {
  crypt: { file: 'legacy/tax.js', start: 7, end: 7 },
  possessed: { file: 'auth/throttle.js', start: 4, end: 4 },
};

const state = {
  sessionId: null,
  items: new Map(),
  lastCited: null,
  busy: false,
  lastReport: null,
  totalVerified: 0,
  totalClaims: 0,
  totalSilent: 0,
};

function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (
      k.startsWith('data-') ||
      k.startsWith('aria-') ||
      k === 'role' ||
      k === 'tabindex' ||
      k === 'id' ||
      k === 'type' ||
      k === 'open'
    )
      n.setAttribute(k, v);
    else n[k] = v;
  }
  for (const c of [].concat(children)) if (c) n.append(c);
  return n;
}

async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const msg =
      (data && (data.message || data.error)) || `The request failed (${res.status}).`;
    const err = new Error(msg);
    if (data && data.code) err.code = data.code;
    throw err;
  }
  return data;
}

function setConfidence(v) {
  const c = Math.max(0, Math.min(1, Number(v) || 0));
  $('candle').style.setProperty('--confidence', String(c)); // .candle declares its own --confidence, so it must be set on the element
}
function setHaunting(score) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  root.style.setProperty('--haunting-score', String(s));
}

// ---- Summon ------------------------------------------------------------------------------

function fieldError(id, msg) {
  const p = $(id);
  p.textContent = msg || '';
  p.hidden = !msg;
}

function validate() {
  let ok = true;
  const repoUrl = $('repo').value.trim();
  const file = $('file').value.trim();
  const start = parseInt($('start').value, 10);
  const end = parseInt($('end').value, 10);
  fieldError('repo-err', repoUrl ? '' : 'Enter a repository URL or "crypt".');
  fieldError('file-err', file ? '' : 'Enter the file path inside the repository.');
  fieldError(
    'start-err',
    Number.isInteger(start) && start >= 1 ? '' : 'Start at line 1 or later.',
  );
  fieldError(
    'end-err',
    Number.isInteger(end) && end >= start
      ? ''
      : 'End line must not come before the start.',
  );
  if (!repoUrl || !file || !(start >= 1) || !(end >= start)) ok = false;
  return ok
    ? {
        repoUrl,
        file,
        startLine: start,
        endLine: end,
        githubToken: $('token').value.trim() || undefined,
      }
    : null;
}

/**
 * The chosen sample's defaults, when the fields still hold another sample's defaults;
 * otherwise null, so a path the user typed is never overwritten (R8.4).
 */
function sampleSwap(repo, fields) {
  if (!Object.prototype.hasOwnProperty.call(SAMPLE_DEFAULTS, repo)) return null;
  for (const [name, d] of Object.entries(SAMPLE_DEFAULTS)) {
    if (name === repo) continue;
    if (
      fields.file === d.file &&
      fields.start === String(d.start) &&
      fields.end === String(d.end)
    )
      return SAMPLE_DEFAULTS[repo];
  }
  return null;
}

$('repo').addEventListener('change', () => {
  const next = sampleSwap($('repo').value.trim(), {
    file: $('file').value,
    start: $('start').value,
    end: $('end').value,
  });
  if (!next) return;
  $('file').value = next.file;
  $('start').value = String(next.start);
  $('end').value = String(next.end);
});

$('summon-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.busy) return;
  const input = validate();
  $('summon-err').hidden = true;
  if (!input) {
    const first = document.querySelector('.err:not([hidden])');
    if (first) first.closest('.field')?.querySelector('input')?.focus();
    return;
  }
  state.busy = true;
  $('summon-btn').disabled = true;
  $('summon-status').textContent = 'Gathering evidence…';
  $('summon-form').setAttribute('aria-busy', 'true');
  try {
    const data = await api('/api/summon', input);
    state.sessionId = data.sessionId;
    state.items = new Map(data.items.map((i) => [i.shortSha, i]));
    state.totalVerified = 0;
    state.totalClaims = 0;
    state.totalSilent = 0;
    renderLedger(data);
    $('log').replaceChildren();
    $('exorcism-wrap').hidden = true;
    setHaunting(0);
    setConfidence(0.5);
    $('seance').hidden = false;
    $('summon-status').textContent = data.items.length
      ? ''
      : 'No history found for that range.';
    $('seance').scrollIntoView({
      behavior: reduceMotion.matches ? 'auto' : 'smooth',
      block: 'start',
    });
    $('q').focus({ preventScroll: true });
  } catch (err) {
    $('summon-err').textContent = err.message;
    $('summon-err').hidden = false;
    $('summon-status').textContent = '';
  } finally {
    state.busy = false;
    $('summon-btn').disabled = false;
    $('summon-form').removeAttribute('aria-busy');
  }
});

// ---- Crypt -------------------------------------------------------------------------------

function renderLedger(data) {
  const list = $('ledger');
  list.replaceChildren();
  $('crypt-meta').textContent =
    `${data.items.length} commit${data.items.length === 1 ? '' : 's'} touched these lines${data.truncated ? ' (oldest ones omitted)' : ''}.`;
  for (const i of data.items) list.append(ledgerRow(i));
}

/** One crypt row. A commit flagged as suspicious says so in text, not only with a border (R6.3). */
function ledgerRow(i) {
  const detailBits = [];
  if (i.body) detailBits.push(i.body);
  if (i.hunk) detailBits.push(i.hunk);
  const details = detailBits.length
    ? el('details', {}, [
        el('summary', { text: 'Message and diff' }),
        el('pre', { text: detailBits.join('\n\n') }),
      ])
    : null;
  const props = {
    id: `ledger-item-${i.shortSha}`,
    tabindex: '0',
    'data-sha': i.shortSha,
  };
  if (i.suspiciousMessage) props['data-suspicious'] = 'true';
  return el('li', props, [
    el('div', { class: 'row' }, [
      el('span', { class: 'sha', text: i.shortSha }),
      el('span', { class: 'who', text: i.author }),
      el('span', { class: 'when', text: dateFmt.format(new Date(i.date)) }),
    ]),
    el('div', { class: 'subject', text: i.subject }),
    i.suspiciousMessage
      ? el('p', { class: 'lab warn', text: 'This commit tries to give the ghost orders' })
      : null,
    details,
  ]);
}

function lightRows(shas) {
  document.querySelectorAll('#ledger li.lit').forEach((n) => n.classList.remove('lit'));
  for (const s of shas) $(`ledger-item-${s}`)?.classList.add('lit');
}

function pointPlanchette(sha) {
  const row = $(`ledger-item-${sha}`);
  const p = $('planchette');
  if (!row) return;
  const pr = p.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  const dx = rr.left + rr.width / 2 - (pr.left + pr.width / 2);
  const dy = rr.top + rr.height / 2 - (pr.top + pr.height / 2);
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI + 90; // the shape points up at 0 degrees
  p.style.transform = `rotate(${deg.toFixed(1)}deg)`;
}

function focusCommit(sha) {
  const row = $(`ledger-item-${sha}`);
  if (!row) return;
  row.scrollIntoView({
    behavior: reduceMotion.matches ? 'auto' : 'smooth',
    block: 'center',
  });
  row.focus({ preventScroll: true });
  state.lastCited = sha;
  requestAnimationFrame(() => pointPlanchette(sha));
  setTimeout(() => pointPlanchette(sha), reduceMotion.matches ? 0 : 450);
}

// ---- Claims -------------------------------------------------------------------------------

function citeButtons(citations) {
  if (!citations || !citations.length) return null;
  return el(
    'div',
    { class: 'cites' },
    citations.map((c) => {
      const known = state.items.has(c.sha7);
      const b = el('button', {
        class: 'cite',
        type: 'button',
        text: c.sha7,
        'aria-label': known
          ? `See commit ${c.sha7} in the crypt`
          : `Commit ${c.sha7} is not in the crypt`,
      });
      if (known)
        b.addEventListener('click', () => {
          lightRows([c.sha7]);
          focusCommit(c.sha7);
        });
      else b.disabled = true;
      return b;
    }),
  );
}

/** "The words the ward found" under a verified claim: hash, field and quote, all as text (R2.2). */
function foundNode(quotes) {
  return el('div', { class: 'found' }, [
    el('p', { class: 'found-head', text: 'The words the ward found' }),
    el(
      'ul',
      { class: 'found-list' },
      quotes.map((q) =>
        el('li', {}, [
          el('span', { class: 'sha', text: q.sha7 }),
          document.createTextNode(` ${FIELD_LABEL[q.field]}: `),
          el('q', { class: 'found-quote', text: q.quote }),
        ]),
      ),
    ),
  ]);
}

/**
 * One claim. `bucket` is 'verified', 'rejected' or 'silent'. Each state has a text label;
 * a claim that cites a flagged commit says so (R2.2, R4.5, R6.4).
 */
function claimNode(c, bucket) {
  const warn = () =>
    el('span', {
      class: 'lab warn',
      text: 'Cites a commit that tries to give the ghost orders',
    });
  if (bucket === 'silent') {
    return el('article', { class: 'claim silence' }, [
      el('span', {
        class: 'lab',
        text: "The record is silent (the ghost's words, not checked)",
      }),
      el('span', { class: 'txt', text: c.text }),
      el('span', { class: 'why', text: `Unanswered question: ${c.silenceReason}` }),
    ]);
  }
  if (bucket === 'rejected') {
    const node = el('article', { class: 'claim rejected' });
    node.append(el('span', { class: 'lab', text: 'Unverified' }));
    node.append(el('span', { class: 'txt', text: c.text }));
    if (c.citesSuspicious) node.append(warn());
    if (c.reason)
      node.append(el('span', { class: 'why', text: `The ward refused it: ${c.reason}` }));
    return node;
  }
  const kind = c.kind === 'speculation' ? 'speculation' : 'memory';
  const node = el('article', { class: `claim ${kind}` });
  if (kind === 'speculation')
    node.append(el('span', { class: 'lab', text: 'Speculation' }));
  node.append(el('span', { class: 'txt', text: c.text }));
  if (c.citesSuspicious) node.append(warn());
  const cb = citeButtons(c.citations);
  if (cb) node.append(cb);
  node.append(foundNode(c.quotes || []));
  return node;
}

/** Sentence appended to an answer's tally when the ghost gave silence claims (R4.3). */
function silenceNote(s) {
  if (s === 1) return ' 1 silence claim was not checked.';
  return s > 0 ? ` ${s} silence claims were not checked.` : '';
}

/** #verified-counter text: verified of checked, plus the unchecked silence claims (R4.3). */
function counterText(tv, tc, ts) {
  if (tc + ts === 0) return '';
  const extra =
    ts > 0 ? `, plus ${ts} silence claim${ts === 1 ? '' : 's'} not checked` : '';
  return `${tv} of ${tc} claims verified this séance${extra}`;
}

function renderAnswer(data, question) {
  const turn = el('div', { class: 'turn' });
  if (question) $('log').append(el('div', { class: 'turn-q', text: question }));
  for (const c of data.verified) turn.append(claimNode(c, 'verified'));
  for (const s of data.silent) turn.append(claimNode(s, 'silent'));
  for (const r of data.rejected) turn.append(claimNode(r, 'rejected'));
  const tally = el(
    'p',
    {
      class: 'tally',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    },
    [
      el('strong', { text: `${data.tally.verified} of ${data.tally.checked}` }),
      document.createTextNode(
        ` claims verified by the ward.${silenceNote(data.tally.silent)}`,
      ),
    ],
  );
  turn.append(tally);
  $('log').append(turn);
  setConfidence(data.score);
  const cited = data.verified
    .flatMap((v) => v.citations.map((c) => c.sha7))
    .filter((s) => state.items.has(s));
  lightRows(new Set(cited));
  if (cited.length) setTimeout(() => pointPlanchette(cited[0]), 30);
  turn.scrollIntoView({
    behavior: reduceMotion.matches ? 'auto' : 'smooth',
    block: 'nearest',
  });
  // R3.3 / R3.9, ward-hardening R4.3: the persistent session counter uses the server tally
  state.totalVerified += data.tally.verified;
  state.totalClaims += data.tally.checked;
  state.totalSilent += data.tally.silent;
  const counter = $('verified-counter');
  if (counter) {
    counter.textContent = counterText(
      state.totalVerified,
      state.totalClaims,
      state.totalSilent,
    );
  }
  // T3: store latest report and enable copy button
  if (typeof data.report === 'string' && data.report.length > 0) {
    state.lastReport = data.report;
    const btn = $('copy-report-btn');
    btn.disabled = false;
    btn.removeAttribute('aria-disabled');
  }
}

function ghostName(voice) {
  if (!voice) return;
  const name = String(voice).split(':')[0].trim();
  if (name && name.length <= 40)
    $('ghost-name').textContent = `${name}, speaking only from the commits.`;
}

// ---- Ask ----------------------------------------------------------------------------------

$('ask-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = $('q').value.trim();
  if (!q || state.busy || !state.sessionId) return;
  state.busy = true;
  $('ask-btn').disabled = true;
  $('ask-status').textContent = 'The ghost stirs…';
  $('log').setAttribute('aria-busy', 'true');
  try {
    const data = await api('/api/ask', { sessionId: state.sessionId, question: q });
    ghostName(data.voice);
    renderAnswer(data, q);
    $('q').value = '';
  } catch (err) {
    if (err.code === 'SESSION_NOT_FOUND') {
      $('seance').hidden = true;
      $('summon-err').textContent = 'The séance has ended. Summon the ghost again.';
      $('summon-err').hidden = false;
      $('repo').focus();
      return;
    }
    $('log').append(el('div', { class: 'notice', role: 'alert', text: err.message }));
  } finally {
    state.busy = false;
    $('ask-btn').disabled = false;
    $('ask-status').textContent = '';
    $('log').removeAttribute('aria-busy');
  }
});
$('q').addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') $('ask-form').requestSubmit();
});

// ---- Plant a false memory (the ward demo) ------------------------------------------------

const firstSha = () =>
  state.items.size ? [...state.items.keys()][state.items.size - 1] : 'deadbee';

/** Same rule as the verifier: a letter, digit or underscore (src/ghost/verifier.ts). */
function isWordChar(ch) {
  return ch !== undefined && /[\p{L}\p{N}_]/u.test(ch);
}

/** True when `name` occurs in `s` as a whole word (the ward's R3.2 rule). */
function namesAsWord(s, name) {
  if (!name) return false;
  for (let p = s.indexOf(name); p !== -1; p = s.indexOf(name, p + 1)) {
    if (!isWordChar(s[p - 1]) && !isWordChar(s[p + name.length])) return true;
  }
  return false;
}

/**
 * The "Blame the wrong author" claim: a ledger author, and a commit by someone else whose
 * subject, message and diff do not name that author, quoted from its subject. The hash and
 * quote pass, so only the ward's author check can refuse it. The first such pair in ledger
 * order, or null (design.md §11.2).
 */
function wrongAuthorPreset(items) {
  const shared = new Map();
  for (const i of items) shared.set(i.shortSha, (shared.get(i.shortSha) || 0) + 1);
  const authors = [...new Set(items.map((i) => i.author))];
  for (const other of authors) {
    if (!other) continue;
    for (const i of items) {
      if (i.author === other || shared.get(i.shortSha) !== 1) continue;
      const quote = i.subject.slice(0, QUOTE_MAX_CHARS);
      if (quote.trim().length < QUOTE_MIN_CHARS) continue;
      const hunk = (i.hunk || '').slice(0, HUNK_UI_CHARS);
      if (
        namesAsWord(i.subject, other) ||
        namesAsWord(i.body || '', other) ||
        namesAsWord(hunk, other)
      )
        continue;
      return { text: `${other} wrote this line.`, sha7: i.shortSha, quote };
    }
  }
  return null;
}

document.querySelectorAll('[data-preset]').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.preset === 'invent') {
      $('plant-text').value =
        'I added this wait so Windows XP clients would not time out.';
      $('plant-sha').value = 'deadbee';
      $('plant-quote').value = 'so Windows XP clients would not time out';
      return;
    }
    const wrong =
      b.dataset.preset === 'wrongauthor'
        ? wrongAuthorPreset([...state.items.values()])
        : null;
    if (wrong) {
      $('plant-text').value = wrong.text;
      $('plant-sha').value = wrong.sha7;
      $('plant-quote').value = wrong.quote;
      return;
    }
    // misquote, and the wrongauthor fallback for a single-author ledger
    const real =
      [...state.items.values()].find((i) => /429|vendor/i.test(i.body + i.subject)) ||
      [...state.items.values()][0];
    $('plant-text').value =
      'The vendor banned our account for sending too many requests.';
    $('plant-sha').value = real ? real.shortSha : firstSha();
    $('plant-quote').value = 'banned our account';
  }),
);

$('plant-btn').addEventListener('click', async () => {
  if (state.busy || !state.sessionId) return;
  const sha7 = $('plant-sha').value.trim().toLowerCase();
  const quote = $('plant-quote').value.trim();
  const text = $('plant-text').value.trim();
  if (!text || !/^[0-9a-f]{7}$/.test(sha7)) {
    $('log').append(
      el('div', {
        class: 'notice',
        role: 'alert',
        text: 'Enter a claim and a 7 character commit hash (0-9, a-f).',
      }),
    );
    return;
  }
  // The ward accepts a citation only with a quote (R1.1); send nothing without one
  if (quote.trim().length < QUOTE_MIN_CHARS) {
    $('log').append(
      el('div', {
        class: 'notice',
        role: 'alert',
        text: 'Enter the exact words from the commit, at least 8 characters, in the quote field.',
      }),
    );
    return;
  }
  state.busy = true;
  try {
    const answer = {
      voice: 'planted by you',
      sessionId: state.sessionId,
      claims: [{ kind: 'memory', text, citations: [{ sha7, quote }] }],
    };
    const data = await api('/api/ward', { sessionId: state.sessionId, answer });
    renderAnswer(data, `Planted: ${text}`);
  } catch (err) {
    $('log').append(el('div', { class: 'notice', role: 'alert', text: err.message }));
  } finally {
    state.busy = false;
  }
});

// ---- Copy ward report ---------------------------------------------------------------------

$('copy-report-btn').addEventListener('click', async () => {
  if (!state.lastReport) return;
  try {
    await navigator.clipboard.writeText(state.lastReport);
    $('ask-status').textContent = 'Ward report copied.';
  } catch {
    $('ask-status').textContent = 'Copy failed — your browser blocked clipboard access.';
  }
  // Clear the status message after 3 seconds
  setTimeout(() => {
    if (
      $('ask-status').textContent === 'Ward report copied.' ||
      $('ask-status').textContent ===
        'Copy failed — your browser blocked clipboard access.'
    ) {
      $('ask-status').textContent = '';
    }
  }, 3000);
});

// ---- Exorcism -----------------------------------------------------------------------------

const SIGNAL_LABEL = {
  age: 'Age',
  churn: 'Churn',
  gone: 'Authors gone',
  marker: 'TODO and HACK',
  test: 'No tests',
  nesting: 'Nesting',
};

/**
 * severityLabel — pure function mapping a haunting score (0–100) to a text label.
 * R7.3 / R8.5: text label so severity is never conveyed by colour alone.
 * @param {number} score integer in [0, 100]
 * @returns {'Restless'|'Troubled'|'Haunted'|'Possessed'}
 */
function severityLabel(score) {
  if (score <= 25) return 'Restless';
  if (score <= 50) return 'Troubled';
  if (score <= 75) return 'Haunted';
  return 'Possessed';
}

function planClaims(parent, claims, rejected) {
  for (const c of claims) parent.append(claimNode(c, 'verified'));
  for (const c of rejected) parent.append(claimNode(c, 'rejected'));
}

/** Plan steps; the step text is the model's, and says so (R7.4, R7.5). */
function stepNodes(steps) {
  if (!steps.length)
    return [el('li', { class: 'notice', text: 'The ward kept no step of this plan.' })];
  return steps.map((s, i) => {
    // R7.9: each step is a <details open> with summary = step description
    const inner = el('div', { class: 'step-body' });
    inner.append(
      el('p', {
        class: 'lab unchecked',
        text: "The step and its rationale are the model's words, not checked.",
      }),
    );
    // R7.8: reversibility badge as its own element (not text inside rationale)
    inner.append(
      el('span', {
        class: `badge badge--${s.reversible ? 'rev' : 'irrev'}`,
        text: s.reversible ? 'Reversible ✓' : 'Irreversible ⚠',
      }),
    );
    inner.append(el('p', { class: 'meta', text: s.rationale }));
    planClaims(inner, s.claims, s.rejectedClaims);
    const details = el('details', { open: '' }, [
      el('summary', { text: `${i + 1}. ${s.description}` }),
      inner,
    ]);
    return el('li', {}, [details]);
  });
}

/** Do-not-touch entries; the reason is the model's, and says so (R7.4). */
function dntNodes(entries) {
  return entries.map((x) => {
    // R7.9: each do-not-touch entry is a <details open> with summary = line range
    const rangeText =
      x.lineRange.start === x.lineRange.end
        ? `Line ${x.lineRange.start}`
        : `Lines ${x.lineRange.start}–${x.lineRange.end}`;
    const inner = el('div', { class: 'dnt-body' });
    inner.append(
      el('p', {
        class: 'lab unchecked',
        text: "The reason is the model's words, not checked.",
      }),
    );
    inner.append(el('div', { text: x.reason }));
    planClaims(inner, x.claims, x.rejectedClaims);
    const details = el('details', { open: '' }, [
      el('summary', { class: 'range', text: rangeText }),
      inner,
    ]);
    return el('li', {}, [details]);
  });
}

/** Steps and entries the ward struck, with why and the claims it refused (R7.5). */
function droppedNodes(dropped) {
  return dropped.map((x) => {
    const li = el('li', {}, [
      el('p', { class: 'dropped-title', text: x.title }),
      el('p', { class: 'lab unchecked', text: "The model's words, not checked" }),
      el('p', { text: x.modelText }),
      el('p', { class: 'why', text: x.dropReason }),
    ]);
    planClaims(li, [], x.rejectedClaims);
    return li;
  });
}

/** Verified and checked plan claims, across steps, entries and dropped entries (R7.6). */
function planTally(plan) {
  const shown = [...plan.steps, ...plan.doNotTouchList];
  const ok = shown.reduce((n, s) => n + s.claims.length, 0);
  const bad = [...shown, ...plan.dropped].reduce(
    (n, s) => n + s.rejectedClaims.length,
    0,
  );
  return { ok, total: ok + bad };
}

$('exorcise-btn').addEventListener('click', async () => {
  if (state.busy || !state.sessionId) return;
  state.busy = true;
  $('exorcise-btn').disabled = true;
  $('exorcise-status').textContent = 'Performing exorcism…';
  $('exorcism-wrap').setAttribute('aria-busy', 'true');
  try {
    const d = await api('/api/exorcise', { sessionId: state.sessionId });
    $('ex-score').textContent = String(d.score);
    // R7.3 / R8.5: severity text label next to score (never colour alone)
    const sevEl = $('ex-severity');
    sevEl.textContent = severityLabel(d.score);
    setHaunting(d.score);
    $('ex-signals').replaceChildren(
      ...d.signalBreakdown.map((s) => {
        const pct = Math.round(Math.max(0, Math.min(1, s.rawValue)) * 100);
        const fill = el('span', { class: 'bar-fill' });
        // R8.1 / CSP: set width via element.style (not inline HTML attribute)
        fill.style.width = `${pct}%`;
        return el('li', {}, [
          el('span', { text: SIGNAL_LABEL[s.signal] || s.signal }),
          el('span', { class: 'bar-track' }, [fill]),
          el('span', { class: 'num', text: `${pct}%` }),
        ]);
      }),
    );
    $('ex-summary').textContent = d.plan.summary;
    $('ex-tests').replaceChildren(
      ...d.plan.characterizationTests.map((t) => el('li', { text: t })),
    );
    $('ex-steps').replaceChildren(...stepNodes(d.plan.steps));
    $('ex-dnt').replaceChildren(...dntNodes(d.plan.doNotTouchList));
    $('ex-dropped').replaceChildren(...droppedNodes(d.plan.dropped));
    $('ex-dropped-wrap').hidden = d.plan.dropped.length === 0;
    const { ok, total } = planTally(d.plan);
    $('ex-verified').textContent = `${ok} of ${total} plan claims verified by the ward.`;
    $('exorcism-wrap').hidden = false;
    $('exorcism').scrollIntoView({
      behavior: reduceMotion.matches ? 'auto' : 'smooth',
      block: 'start',
    });
    $('exorcism').focus({ preventScroll: true });
  } catch (err) {
    if (err.code === 'SESSION_NOT_FOUND') {
      $('seance').hidden = true;
      $('summon-err').textContent = 'The séance has ended. Summon the ghost again.';
      $('summon-err').hidden = false;
      $('repo').focus();
      return;
    }
    $('log').append(el('div', { class: 'notice', role: 'alert', text: err.message }));
  } finally {
    state.busy = false;
    $('exorcise-btn').disabled = false;
    $('exorcise-status').textContent = '';
    $('exorcism-wrap').removeAttribute('aria-busy');
  }
});
