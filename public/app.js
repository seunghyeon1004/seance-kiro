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

const state = {
  sessionId: null,
  items: new Map(),
  lastCited: null,
  busy: false,
  lastReport: null,
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
      k === 'type'
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
  for (const i of data.items) {
    const detailBits = [];
    if (i.body) detailBits.push(i.body);
    if (i.hunk) detailBits.push(i.hunk);
    const details = detailBits.length
      ? el('details', {}, [
          el('summary', { text: 'Message and diff' }),
          el('pre', { text: detailBits.join('\n\n') }),
        ])
      : null;
    const li = el(
      'li',
      { id: `ledger-item-${i.shortSha}`, tabindex: '0', 'data-sha': i.shortSha },
      [
        el('div', { class: 'row' }, [
          el('span', { class: 'sha', text: i.shortSha }),
          el('span', { class: 'who', text: i.author }),
          el('span', { class: 'when', text: dateFmt.format(new Date(i.date)) }),
        ]),
        el('div', { class: 'subject', text: i.subject }),
        details,
      ],
    );
    list.append(li);
  }
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

function claimNode(c, rejected) {
  const kind = rejected ? 'rejected' : c.kind;
  const label = rejected
    ? 'Unverified'
    : c.kind === 'speculation'
      ? 'Speculation'
      : c.kind === 'silence'
        ? 'The record is silent'
        : null;
  const node = el('article', { class: `claim ${kind}` });
  if (label) node.append(el('span', { class: 'lab', text: label }));
  node.append(el('span', { class: 'txt', text: c.text }));
  if (rejected && c.reason)
    node.append(el('span', { class: 'why', text: `The ward refused it: ${c.reason}` }));
  if (!rejected) {
    const cb = citeButtons(c.citations);
    if (cb) node.append(cb);
  }
  return node;
}

function renderAnswer(data, question) {
  const turn = el('div', { class: 'turn' });
  if (question) $('log').append(el('div', { class: 'turn-q', text: question }));
  const total = data.verified.length + data.rejected.length;
  for (const c of data.verified) turn.append(claimNode(c, false));
  for (const r of data.rejected) turn.append(claimNode(r, true));
  const tally = el(
    'p',
    {
      class: 'tally',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    },
    [
      el('strong', { text: `${data.verified.length} of ${total}` }),
      document.createTextNode(' claims verified by the ward.'),
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
document.querySelectorAll('[data-preset]').forEach((b) =>
  b.addEventListener('click', () => {
    if (b.dataset.preset === 'invent') {
      $('plant-text').value =
        'I added this wait so Windows XP clients would not time out.';
      $('plant-sha').value = 'deadbee';
      $('plant-quote').value = '';
    } else {
      const real =
        [...state.items.values()].find((i) => /429|vendor/i.test(i.body + i.subject)) ||
        [...state.items.values()][0];
      $('plant-text').value =
        'The vendor banned our account for sending too many requests.';
      $('plant-sha').value = real ? real.shortSha : firstSha();
      $('plant-quote').value = 'banned our account';
    }
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
  state.busy = true;
  try {
    const answer = {
      voice: 'planted by you',
      sessionId: state.sessionId,
      claims: [{ kind: 'memory', text, citations: [quote ? { sha7, quote } : { sha7 }] }],
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

function planClaims(parent, claims, rejected) {
  for (const c of claims) parent.append(claimNode(c, false));
  for (const c of rejected) parent.append(claimNode(c, true));
}

$('exorcise-btn').addEventListener('click', async () => {
  if (state.busy || !state.sessionId) return;
  state.busy = true;
  $('exorcise-btn').disabled = true;
  $('ask-status').textContent = 'Reading the haunting…';
  $('exorcism-wrap').setAttribute('aria-busy', 'true');
  try {
    const d = await api('/api/exorcise', { sessionId: state.sessionId });
    $('ex-score').textContent = String(d.score);
    setHaunting(d.score);
    $('ex-signals').replaceChildren(
      ...d.signalBreakdown.map((s) => {
        const pct = Math.round(Math.max(0, Math.min(1, s.rawValue)) * 100);
        return el('li', {}, [
          el('span', { text: SIGNAL_LABEL[s.signal] || s.signal }),
          el('span', { class: 'bar-track' }, [
            el('span', { class: 'bar-fill', style: `width:${pct}%` }),
          ]),
          el('span', { class: 'num', text: `${pct}%` }),
        ]);
      }),
    );
    $('ex-summary').textContent = d.plan.summary;
    $('ex-tests').replaceChildren(
      ...d.plan.characterizationTests.map((t) => el('li', { text: t })),
    );
    $('ex-steps').replaceChildren(
      ...d.plan.steps.map((s) => {
        const li = el('li', {}, [
          el('div', { text: s.description }),
          el('p', {
            class: 'meta',
            text: `${s.reversible ? 'Reversible. ' : ''}${s.rationale}`,
          }),
        ]);
        planClaims(li, s.claims, s.rejectedClaims);
        return li;
      }),
    );
    $('ex-dnt').replaceChildren(
      ...d.plan.doNotTouchList.map((x) => {
        const li = el('li', {}, [
          el('div', {
            class: 'range',
            text:
              x.lineRange.start === x.lineRange.end
                ? `Line ${x.lineRange.start}`
                : `Lines ${x.lineRange.start} to ${x.lineRange.end}`,
          }),
          el('div', { text: x.reason }),
        ]);
        planClaims(li, x.claims, x.rejectedClaims);
        return li;
      }),
    );
    const all = [...d.plan.steps, ...d.plan.doNotTouchList];
    const ok = all.reduce((n, s) => n + s.claims.length, 0);
    const bad = all.reduce((n, s) => n + s.rejectedClaims.length, 0);
    $('ex-verified').textContent =
      `${ok} of ${ok + bad} plan claims verified by the ward.`;
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
    $('ask-status').textContent = '';
    $('exorcism-wrap').removeAttribute('aria-busy');
  }
});
