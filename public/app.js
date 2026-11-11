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
  sample: null,
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

// ---- Requests: retry only what a sleeping proxy produces (first-seance R5.3–R5.6) ---------

const RETRY_DELAYS_MS = [2000, 5000, 10000];
const WAKE_TEXT =
  'Waking the spirits. The free server sleeps when idle; this can take up to a minute.';
const NET_FAIL =
  'Could not reach the server. It may still be waking up; try again in a minute.';
const proxyFail = (status) =>
  `The server did not answer (${status}). It may still be waking up; try again in a minute.`;

/** True only for a proxy's 502/503/504 page: our own errors are JSON with a string code (R5.4, R5.5). */
function shouldRetry(status, data) {
  if (status !== 502 && status !== 503 && status !== 504) return false;
  return !(data && typeof data === 'object' && typeof data.code === 'string');
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** The wait a Retry-After header names, rounded up so it never understates (R10.2). */
function waitInWords(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '';
  const s = Math.ceil(sec);
  if (s < 60) return `Try again in ${s} second${s === 1 ? '' : 's'}.`;
  if (s < 3600) {
    const m = Math.ceil(s / 60);
    return `Try again in ${m} minute${m === 1 ? '' : 's'}.`;
  }
  const h = Math.ceil(s / 3600);
  return `Try again in about ${h} hour${h === 1 ? '' : 's'}.`;
}

/** GET when `body` is undefined, a JSON POST otherwise. `opts.status` names the caller's status region. */
async function api(path, body, opts = {}) {
  const init =
    body === undefined
      ? { method: 'GET' }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        };
  for (let attempt = 0; ; attempt++) {
    let res = null;
    try {
      res = await fetch(path, init);
    } catch {
      res = null;
    }
    let data = null;
    if (res) {
      try {
        data = await res.json();
      } catch {
        data = null; // a proxy's HTML error page
      }
    }
    if (res === null || shouldRetry(res.status, data)) {
      if (attempt < RETRY_DELAYS_MS.length) {
        if (opts.status) $(opts.status).textContent = WAKE_TEXT;
        await wait(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw new Error(res === null ? NET_FAIL : proxyFail(res.status));
    }
    if (!res.ok) {
      let msg =
        (data && (data.message || data.error)) || `The request failed (${res.status}).`;
      if (res.status === 429) {
        const words = waitInWords(Number(res.headers.get('Retry-After')));
        if (words) msg += ` ${words}`;
      }
      const err = new Error(msg);
      if (data && data.code) err.code = data.code;
      err.status = res.status;
      throw err;
    }
    return data;
  }
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

const BLOB_NOTE =
  'Filled in the file and lines from the link. Séance reads the default branch, not the branch or commit in the link.';
const TREE_NOTE =
  'That link points at a folder. Finish the file path in the File field. Séance reads the default branch.';

/**
 * A GitHub link as people paste it, in the one form the server accepts (R9.1–R9.4).
 * Pure: reads no globals but the two notes, and touches no DOM. Anything that is not a
 * github.com link comes back as the trimmed input, for the server to decide (design.md §8.1).
 */
function normaliseRepoInput(text) {
  const raw = String(text ?? '').trim();
  let s = raw;
  let frag = '';
  const hash = s.indexOf('#');
  if (hash !== -1) {
    frag = s.slice(hash + 1);
    s = s.slice(0, hash);
  }
  const query = s.indexOf('?');
  if (query !== -1) s = s.slice(0, query);
  s = s.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  if (!/^github\.com\//i.test(s)) return { repoUrl: raw };
  const parts = s.slice('github.com/'.length).split('/');
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  const owner = parts[0];
  const repo = (parts[1] || '').replace(/\.git$/i, '');
  const ok = (p) =>
    typeof p === 'string' && p !== '.' && p !== '..' && /^[\w.-]+$/.test(p);
  if (!ok(owner) || !ok(repo)) return { repoUrl: raw };
  const out = { repoUrl: `https://github.com/${owner}/${repo}` };
  const kind = parts[2];
  if ((kind === 'blob' || kind === 'tree') && parts[3] && parts.length > 4) {
    let path;
    try {
      path = parts.slice(4).map(decodeURIComponent).join('/');
    } catch {
      return out;
    }
    if (kind === 'blob') {
      out.file = path;
      const m = /^L(\d+)(?:C\d+)?(?:-L(\d+)(?:C\d+)?)?$/.exec(frag);
      if (m) {
        const a = Number(m[1]);
        const b = m[2] === undefined ? a : Number(m[2]);
        if (Number.isSafeInteger(a) && Number.isSafeInteger(b) && a >= 1 && b >= 1) {
          out.startLine = Math.min(a, b);
          out.endLine = Math.max(a, b);
        }
      }
      out.note = BLOB_NOTE;
    } else {
      out.file = `${path}/`;
      out.note = TREE_NOTE;
    }
  }
  return out;
}

/** Marks `input` invalid and adds `errId` to its aria-describedby, or undoes both (audit C1, C4). */
function markField(input, errId, invalid) {
  const ids = (input.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .filter((id) => id && id !== errId);
  if (invalid) {
    input.setAttribute('aria-invalid', 'true');
    ids.push(errId);
  } else {
    input.removeAttribute('aria-invalid');
  }
  if (ids.length) input.setAttribute('aria-describedby', ids.join(' '));
  else input.removeAttribute('aria-describedby');
}

/** A summon field's error, shown next to it and tied to its input (`repo-err` -> `#repo`). */
function fieldError(id, msg) {
  const p = $(id);
  p.textContent = msg || '';
  p.hidden = !msg;
  markField($(id.replace(/-err$/, '')), id, Boolean(msg));
}

function validate() {
  let ok = true;
  const repoUrl = normaliseRepoInput($('repo').value).repoUrl;
  const file = $('file').value.trim().replace(/^\/+/, '');
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
  const n = normaliseRepoInput($('repo').value);
  if (n.repoUrl !== $('repo').value.trim()) $('repo').value = n.repoUrl;
  if (n.file !== undefined) $('file').value = n.file;
  if (n.startLine !== undefined) {
    $('start').value = String(n.startLine);
    $('end').value = String(n.endLine);
  }
  $('repo-note').textContent = n.note || '';
  $('repo-note').hidden = !n.note;
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

const REMOTE_TEXT =
  'Cloning from GitHub and reading the history. This usually takes 10 to 60 seconds.';

/** Updates #summon-elapsed every second (not a live region). Returns a stop function (R10.4). */
function startElapsed() {
  const out = $('summon-elapsed');
  let s = 0;
  out.textContent = '';
  const id = setInterval(() => {
    s += 1;
    out.textContent = `${s} second${s === 1 ? '' : 's'} so far`;
  }, 1000);
  return () => {
    clearInterval(id);
    out.textContent = '';
  };
}

/** #summon-status after a successful summon (R12.4, R8.2). */
function summonFound(n) {
  if (n === 0) return 'Found no commits for these lines. The séance is open below.';
  return `Found ${n} commit${n === 1 ? '' : 's'}. The séance is open below.`;
}

/** 'crypt' or 'possessed' when the summon used that sample with its default file and range, else null. */
function sampleFor(input) {
  const d = Object.prototype.hasOwnProperty.call(SAMPLE_DEFAULTS, input.repoUrl)
    ? SAMPLE_DEFAULTS[input.repoUrl]
    : null;
  if (!d) return null;
  return input.file === d.file && input.startLine === d.start && input.endLine === d.end
    ? input.repoUrl
    : null;
}

/** A fresh séance: nothing of the last one carries over (R4.4, R12.2, R12.4). */
function openSeance(data, input) {
  state.sessionId = data.sessionId;
  state.items = new Map(data.items.map((i) => [i.shortSha, i]));
  state.sample = sampleFor(input);
  state.totalVerified = 0;
  state.totalClaims = 0;
  state.totalSilent = 0;
  state.lastReport = null;
  renderSource(data, input);
  renderLedger(data);
  renderGuide(state.sample);
  // R2.4, R2.5: a name that tries to give orders is never printed as the ghost's name
  $('ghost-name').textContent = !data.items.length
    ? 'Speaks only from the commits.'
    : data.persona.suspicious === true
      ? 'A ghost whose name tries to give orders (see the crypt), speaking only from the commits.'
      : `${data.persona.author}, speaking only from the commits.`;
  $('verified-counter').textContent = '';
  $('ask-status').textContent = '';
  $('ward-status').textContent = '';
  $('exorcise-status').textContent = '';
  clearQError();
  $('copy-report-btn').hidden = true;
  $('exorcism-wrap').hidden = true;
  $('ex-recorded').hidden = true;
  $('log').replaceChildren();
  setHaunting(0);
  setConfidence(0.5);
  $('seance').hidden = false;
  $('summon-status').textContent = summonFound(data.items.length);
  const h = $('h-guide');
  h.scrollIntoView({
    behavior: reduceMotion.matches ? 'auto' : 'smooth',
    block: 'start',
  });
  h.focus({ preventScroll: true });
}

/** Shared by ask, plant and exorcise on SESSION_NOT_FOUND (R10.3). */
function endSeance() {
  state.sessionId = null;
  $('seance').hidden = true;
  $('summon-err').textContent = 'The séance has ended. Summon the ghost again.';
  $('summon-err').hidden = false;
  $('repo').focus();
}

$('summon-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.busy) return;
  const input = validate();
  $('summon-err').hidden = true;
  if (!input) {
    const first = document.querySelector('#summon-form [aria-invalid="true"]');
    if (first) first.focus();
    return;
  }
  state.busy = true;
  $('summon-btn').setAttribute('aria-disabled', 'true');
  let stopElapsed = null;
  if (/^https:\/\//i.test(input.repoUrl)) {
    $('summon-status').textContent = REMOTE_TEXT;
    stopElapsed = startElapsed();
  } else {
    $('summon-status').textContent = 'Gathering evidence…';
  }
  try {
    const data = await api('/api/summon', input, { status: 'summon-status' });
    openSeance(data, input);
  } catch (err) {
    $('summon-err').textContent = err.message;
    $('summon-err').hidden = false;
    $('summon-status').textContent = '';
  } finally {
    if (stopElapsed) stopElapsed();
    state.busy = false;
    $('summon-btn').removeAttribute('aria-disabled');
  }
});

/**
 * Wake the host on load: a sleeping container starts while the judge reads (R5.2).
 * A failed health call leaves no message of its own; it only clears the wake-up text.
 */
async function wake() {
  try {
    const h = await api('/api/health', undefined, { status: 'summon-status' });
    if ($('summon-status').textContent === WAKE_TEXT) $('summon-status').textContent = '';
    $('model-note').hidden = h.model !== false;
    const built = Array.isArray(h.samples) ? h.samples : [];
    for (const o of [...$('repo-list').options]) if (!built.includes(o.value)) o.remove();
  } catch {
    if ($('summon-status').textContent === WAKE_TEXT) $('summon-status').textContent = '';
  }
}

// ---- The line in question ----------------------------------------------------------------

/** #source-meta text (R2.3). */
function sourceMeta(file, a, b, count) {
  if (count === 0) return 'The text of these lines could not be read.';
  const where = a === b ? `line ${a}` : `lines ${a} to ${b}`;
  return `${file}, ${where}, as it reads in the latest commit.${b - a + 1 > 40 ? ' Showing the first 40 lines.' : ''}`;
}

/** The selected lines at HEAD, as text only (R2.3). */
function renderSource(data, input) {
  const lines = Array.isArray(data.lines) ? data.lines : [];
  $('source-lines').replaceChildren(
    ...lines.map((l) => {
      const li = el('li', {}, [el('code', { text: l.text })]);
      li.value = l.n;
      return li;
    }),
  );
  $('source-meta').textContent = sourceMeta(
    input.file,
    input.startLine,
    input.endLine,
    lines.length,
  );
}

// ---- Crypt -------------------------------------------------------------------------------

function renderLedger(data) {
  const list = $('ledger');
  list.replaceChildren();
  const n = data.items.length;
  $('crypt-meta').textContent = n
    ? `${n} commit${n === 1 ? '' : 's'} touched these lines${data.truncated ? ' (oldest ones omitted)' : ''}.`
    : 'No commits touched these lines.';
  $('crypt-shallow').hidden = data.shallow !== true;
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
    tabindex: '-1',
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

/** Light the cited rows, each with a hidden "Cited in the latest answer" (R12.7). */
function lightRows(shas) {
  document.querySelectorAll('#ledger li.lit').forEach((n) => n.classList.remove('lit'));
  document.querySelectorAll('#ledger .lit-note').forEach((n) => n.remove());
  for (const s of shas) {
    const row = $(`ledger-item-${s}`);
    if (!row) continue;
    row.classList.add('lit');
    row.append(
      el('span', {
        class: 'visually-hidden lit-note',
        text: 'Cited in the latest answer',
      }),
    );
  }
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
  node.append(
    el('span', {
      class: 'lab',
      text: kind === 'speculation' ? 'Speculation' : 'Verified',
    }),
  );
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

const RECORDED_LABEL =
  'A recorded answer (the model is resting). The ward checked it again just now.';
const SCRIPTED_LABEL =
  'A scripted ghost that obeys every order in these commits (no model was called). The ward checked it just now.';

/**
 * One turn. `opts.planted`: the visitor's own claim, labelled as such, which never counts
 * for the ghost (R4.1, R4.2). `opts.scripted`: the possessed ghost's scripted claims, labelled,
 * with no question line, which never count either (R13.8, R13.9). A recorded answer is
 * labelled and counts like a live one (R7.10).
 */
function renderAnswer(data, question, opts = {}) {
  const turn = el('div', { class: 'turn' });
  if (opts.planted) {
    $('log').append(
      el('div', { class: 'turn-q planted' }, [
        el('span', { class: 'lab', text: 'Planted by you' }),
        document.createTextNode(' '),
        el('span', { text: question }),
      ]),
    );
  } else if (question) {
    $('log').append(
      el('div', { class: 'turn-q' }, [
        el('span', { class: 'visually-hidden', text: 'You asked: ' }),
        document.createTextNode(question),
      ]),
    );
  }
  if (data.recorded)
    turn.append(el('p', { class: 'lab recorded', text: RECORDED_LABEL }));
  if (opts.scripted)
    turn.append(el('p', { class: 'lab scripted', text: SCRIPTED_LABEL }));
  for (const c of data.verified) turn.append(claimNode(c, 'verified'));
  for (const s of data.silent) turn.append(claimNode(s, 'silent'));
  for (const r of data.rejected) turn.append(claimNode(r, 'rejected'));
  const tally = el('p', { class: 'tally' }, [
    el('strong', { text: `${data.tally.verified} of ${data.tally.checked}` }),
    document.createTextNode(
      ` claims verified by the ward.${silenceNote(data.tally.silent)}`,
    ),
  ]);
  turn.append(tally);
  $('log').append(turn);
  const cited = data.verified
    .flatMap((v) => v.citations.map((c) => c.sha7))
    .filter((s) => state.items.has(s));
  lightRows(new Set(cited));
  if (cited.length) setTimeout(() => pointPlanchette(cited[0]), 30);
  turn.scrollIntoView({
    behavior: reduceMotion.matches ? 'auto' : 'smooth',
    block: 'nearest',
  });
  if (!opts.planted && !opts.scripted) {
    // R3.3 / R3.9, ward-hardening R4.3: the persistent session counter uses the server tally
    const counter = $('verified-counter');
    setConfidence(data.score);
    state.totalVerified += data.tally.verified;
    state.totalClaims += data.tally.checked;
    state.totalSilent += data.tally.silent;
    counter.textContent = counterText(
      state.totalVerified,
      state.totalClaims,
      state.totalSilent,
    );
    // T3, first-seance R10.1: the copy button appears once the ghost has a report
    if (typeof data.report === 'string' && data.report.length > 0) {
      state.lastReport = data.report;
      $('copy-report-btn').hidden = false;
    }
  }
}

// ---- Ask ----------------------------------------------------------------------------------

/** The one ask path, for chips and the form (R3.2, R3.8, R12.1). */
async function askQuestion(q, fromForm = false) {
  if (state.busy || !state.sessionId) return;
  state.busy = true;
  $('ask-btn').setAttribute('aria-disabled', 'true');
  $('ask-status').textContent = 'The ghost stirs…';
  $('log').setAttribute('aria-busy', 'true');
  try {
    const data = await api(
      '/api/ask',
      { sessionId: state.sessionId, question: q },
      { status: 'ask-status' },
    );
    renderAnswer(data, q, { planted: false });
    $('ask-status').textContent =
      `${data.recorded ? 'A recorded answer' : 'The ghost answered'}: ${data.tally.verified} of ${data.tally.checked} claims verified.`;
    setDone('ask', true);
    if (fromForm) $('q').value = '';
  } catch (err) {
    if (err.code === 'SESSION_NOT_FOUND') {
      endSeance();
      return;
    }
    $('log').append(el('div', { class: 'notice', role: 'alert', text: err.message }));
    $('ask-status').textContent = '';
  } finally {
    state.busy = false;
    $('ask-btn').removeAttribute('aria-disabled');
    $('log').removeAttribute('aria-busy');
  }
}

const Q_ERR = 'Type a question first, or click one of the questions above.';

/** A blank question: say what to do, tie the message to #q and focus it (R3.8). */
function showQError() {
  const q = $('q');
  $('q-err').textContent = Q_ERR;
  $('q-err').hidden = false;
  q.setAttribute('aria-invalid', 'true');
  const ids = (q.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  if (!ids.includes('q-err')) ids.push('q-err');
  q.setAttribute('aria-describedby', ids.join(' '));
  q.focus();
}

function clearQError() {
  const q = $('q');
  $('q-err').textContent = '';
  $('q-err').hidden = true;
  q.removeAttribute('aria-invalid');
  const ids = (q.getAttribute('aria-describedby') || '')
    .split(/\s+/)
    .filter((id) => id && id !== 'q-err');
  if (ids.length) q.setAttribute('aria-describedby', ids.join(' '));
  else q.removeAttribute('aria-describedby');
}

$('ask-form').addEventListener('submit', (e) => {
  e.preventDefault();
  if (state.busy) return; // the ask button stays focusable while busy (audit S1)
  const q = $('q').value.trim();
  if (!q) {
    showQError();
    return;
  }
  askQuestion(q, true);
});
$('q').addEventListener('input', clearQError);
$('q').addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') $('ask-form').requestSubmit();
});

// ---- The guide (R3.1–R3.6) ---------------------------------------------------------------

/** The chip questions of R3.2; src/ghost/recordings.ts holds the same lists (checked by a test). */
const CHIP_QUESTIONS = {
  crypt: [
    'Why is there a three second wait here?',
    'Who touched this line last, and why?',
    'Is it safe to delete the wait?',
  ],
  possessed: ['Can I delete this wait?', 'Why does the wait exist?', 'Who changed this?'],
  other: ['Why does this line exist?', 'What would break if I removed it?'],
};

function chipQuestions(sample) {
  return CHIP_QUESTIONS[sample] || CHIP_QUESTIONS.other;
}

function renderGuide(sample) {
  $('guide-chips').replaceChildren(
    ...chipQuestions(sample).map((q) => {
      const b = el('button', { class: 'btn small ghost chip', type: 'button', text: q });
      b.addEventListener('click', () => askQuestion(q));
      return b;
    }),
  );
  for (const step of ['ask', 'ward', 'exorcise']) setDone(step, false);
  $('possess-btn').hidden = sample !== 'possessed';
}

/** "done" in text, never by colour alone (R3.5). */
function setDone(step, done) {
  const li = $(`guide-step-${step}`);
  li.dataset.done = done ? 'true' : 'false';
  li.querySelector('.guide-done').hidden = !done;
}

// ---- Plant a false memory (the ward demo) ------------------------------------------------

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

/**
 * A preset claim for the step 2 buttons, as { text, sha7, quote } (R3.3). Pure.
 * `invent` cites a hash that is not in the ledger; `misquote` cites a real commit with words it
 * does not contain; `wrongauthor` names the wrong author, and falls back to `misquote`.
 */
function presetClaim(name, items) {
  if (name === 'invent') {
    return {
      text: 'I added this wait so Windows XP clients would not time out.',
      sha7: 'deadbee',
      quote: 'so Windows XP clients would not time out',
    };
  }
  const wrong = name === 'wrongauthor' ? wrongAuthorPreset(items) : null;
  if (wrong) return wrong;
  const real = items.find((i) => /429|vendor/i.test(i.body + i.subject)) || items[0];
  return {
    text: 'The vendor banned our account for sending too many requests.',
    sha7: real ? real.shortSha : 'deadbee',
    quote: 'banned our account',
  };
}

document.querySelectorAll('[data-preset]').forEach((b) =>
  b.addEventListener('click', () => {
    const claim = presetClaim(b.dataset.preset, [...state.items.values()]);
    $('plant-text').value = claim.text;
    $('plant-sha').value = claim.sha7;
    $('plant-quote').value = claim.quote;
    plant(claim);
  }),
);

$('plant-btn').addEventListener('click', () =>
  plant({
    text: $('plant-text').value,
    sha7: $('plant-sha').value,
    quote: $('plant-quote').value,
  }),
);

const PLANT_FIELDS = ['plant-text', 'plant-sha', 'plant-quote'];

/** The plant form's one error, in #plant-err, tied to the failing field, which gets focus (audit C4). */
function plantError(fieldId, msg) {
  for (const id of PLANT_FIELDS) markField($(id), 'plant-err', id === fieldId);
  $('plant-err').textContent = msg;
  $('plant-err').hidden = !msg;
  if (!msg) return;
  $('plant').open = true;
  $(fieldId).focus();
}

/** The one plant path, for the preset buttons and the manual form (R3.3, R4.3, R10.3). */
async function plant(claim) {
  if (!state.sessionId) return;
  const sha7 = String(claim.sha7).trim().toLowerCase();
  const quote = String(claim.quote).trim();
  const text = String(claim.text).trim();
  if (!text) {
    plantError('plant-text', 'Enter the claim you want to plant.');
    return;
  }
  if (!/^[0-9a-f]{7}$/.test(sha7)) {
    plantError('plant-sha', 'Enter a 7 character commit hash, using only 0–9 and a–f.');
    return;
  }
  // The ward accepts a citation only with a quote (R1.1); send nothing without one
  if (quote.length < QUOTE_MIN_CHARS) {
    plantError(
      'plant-quote',
      'Enter the exact words from the commit, at least 8 characters, in the quote field.',
    );
    return;
  }
  plantError('', '');
  if (state.busy) {
    $('ward-status').textContent = 'Wait for the ghost to finish answering.';
    return;
  }
  state.busy = true;
  try {
    const answer = {
      voice: 'planted by you',
      sessionId: state.sessionId,
      claims: [{ kind: 'memory', text, citations: [{ sha7, quote }] }],
    };
    const data = await api(
      '/api/ward',
      { sessionId: state.sessionId, answer },
      { status: 'ward-status' },
    );
    renderAnswer(data, text, { planted: true });
    $('ward-status').textContent = data.verified.length
      ? 'The ward verified your claim.'
      : 'The ward refused your claim.';
    setDone('ward', true);
  } catch (err) {
    if (err.code === 'SESSION_NOT_FOUND') endSeance();
    else {
      $('ward-status').textContent = '';
      $('log').append(el('div', { class: 'notice', role: 'alert', text: err.message }));
    }
  } finally {
    state.busy = false;
  }
}

// ---- The possessed ghost (R13.7–R13.11) ---------------------------------------------------

/** #ward-status after a scripted verdict, from the response's tally (R13.10). */
function scriptedStatus(t) {
  const refused = t.checked - t.verified;
  let s = `The ward refused ${refused} of ${t.checked} claims from the possessed ghost.`;
  if (t.silent > 0)
    s += ` It also made ${t.silent} silence claim${t.silent === 1 ? '' : 's'}, which the ward does not check.`;
  return s;
}

/** The one possess path: scripted claims through the live ward, no model (R13.8–R13.11). */
async function possess() {
  if (!state.sessionId) return;
  if (state.busy) {
    $('ward-status').textContent = 'Wait for the ghost to finish answering.';
    return;
  }
  state.busy = true;
  try {
    const data = await api(
      '/api/possess',
      { sessionId: state.sessionId },
      { status: 'ward-status' },
    );
    renderAnswer(data, '', { planted: false, scripted: true });
    $('ward-status').textContent = scriptedStatus(data.tally);
    setDone('ward', true);
  } catch (err) {
    if (err.code === 'SESSION_NOT_FOUND') endSeance();
    else {
      $('ward-status').textContent = '';
      $('log').append(el('div', { class: 'notice', role: 'alert', text: err.message }));
    }
  } finally {
    state.busy = false;
  }
}
$('possess-btn').addEventListener('click', possess);

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
        text: s.reversible ? 'Reversible' : 'Irreversible',
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
  $('exorcise-btn').setAttribute('aria-disabled', 'true');
  $('exorcise-status').textContent = 'Performing exorcism…';
  $('exorcism-wrap').setAttribute('aria-busy', 'true');
  try {
    const d = await api(
      '/api/exorcise',
      { sessionId: state.sessionId },
      { status: 'exorcise-status' },
    );
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
    $('ex-recorded').hidden = !d.recorded;
    $('exorcism-wrap').hidden = false;
    $('exorcise-status').textContent =
      `Exorcism ready: ${d.score} of 100, ${severityLabel(d.score)}. ${ok} of ${total} plan claims verified.`;
    setDone('exorcise', true);
    $('exorcism').scrollIntoView({
      behavior: reduceMotion.matches ? 'auto' : 'smooth',
      block: 'start',
    });
    $('exorcism').focus({ preventScroll: true });
  } catch (err) {
    if (err.code === 'SESSION_NOT_FOUND') {
      endSeance();
      return;
    }
    $('exorcise-status').textContent = '';
    $('log').append(el('div', { class: 'notice', role: 'alert', text: err.message }));
  } finally {
    state.busy = false;
    $('exorcise-btn').removeAttribute('aria-disabled');
    $('exorcism-wrap').removeAttribute('aria-busy');
  }
});

// ---- Candles (audit C8): a page control that stops the flicker, remembered ---------------

const CANDLES_KEY = 'seance-candles';

/** The stored choice; false when nothing is stored or storage is blocked. */
function candlesStill() {
  try {
    return window.localStorage.getItem(CANDLES_KEY) === 'still';
  } catch {
    return false;
  }
}

/** A class on <html> stops the flame (styles.css), whatever prefers-reduced-motion says. */
function setCandles(still, save) {
  root.classList.toggle('still', still);
  const b = $('candles-btn');
  // The label names the action, so it carries the state; no aria-pressed (a pressed "Light the candles" would be ambiguous)
  b.textContent = still ? 'Light the candles' : 'Still the candles';
  if (!save) return;
  try {
    window.localStorage.setItem(CANDLES_KEY, still ? 'still' : 'lit');
  } catch {
    // storage is blocked: the choice lasts until the page is closed
  }
}

setCandles(candlesStill(), false);
$('candles-btn').hidden = false;
$('candles-btn').addEventListener('click', () =>
  setCandles(!root.classList.contains('still'), true),
);

// ---- Start ---------------------------------------------------------------------------------

wake();
