/* global Document, Element, HTMLElement, HTMLInputElement, Window -- DOM types only; the nodes come from jsdom */
/**
 * The shared DOM harness (first-seance design.md §10.1, R11.1, R11.2).
 *
 * public/index.html is loaded into jsdom with `runScripts: 'outside-only'`, and public/app.js is
 * evaluated unmodified in that window. Every request the page makes goes to the real
 * createApp() from src/server.ts in process (real git, ledger, ward and plan verification). Only
 * the model is scripted, by the client a test passes in. No browser is launched and no port is
 * opened.
 *
 * Stubbed in the window, because jsdom 25 lacks them or because they would leave the process:
 * - `fetch`: handed to the optional `proxy` (a sleeping host), then to `app.request()` in process;
 * - `matchMedia`: jsdom has none; app.js reads `prefers-reduced-motion` at load;
 * - `Element.prototype.scrollIntoView`: jsdom has none;
 * - with `nodeTimers`, the window's timers call Node's, looked up at call time, so
 *   vi.useFakeTimers() drives app.js.
 * `pretendToBeVisual: true` is a jsdom option (it provides requestAnimationFrame), not a stub.
 *
 * No network: ANTHROPIC_FIXTURE is unset, the key is a dummy, and Node's global fetch is a
 * vi.fn that throws, so a test can assert that it was never called.
 */

import { vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { JSDOM } from 'jsdom';
import type {
  AnthropicClient,
  AnthropicCreateParams,
  AnthropicMessage,
} from '../../src/ghost/llm.js';

export { CryptClient } from '../ghost/scripted-clients.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
const appJs = fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8');

const DUMMY_KEY = 'test-dummy-key-not-a-secret';

// ---------------------------------------------------------------------------
// Samples
// ---------------------------------------------------------------------------

export interface Samples {
  readonly root: string;
  readonly crypt: string;
  readonly possessed: string;
}

/** Builds both samples with the real scripts into one mkdtemp dir. The caller removes `root`. */
export function buildSamples(): Samples {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-e2e-'));
  const crypt = path.join(root, 'crypt');
  const possessed = path.join(root, 'possessed');
  execFileSync('bash', [path.join(ROOT, 'scripts/make-crypt.sh'), crypt], { cwd: ROOT });
  execFileSync('bash', [path.join(ROOT, 'scripts/make-possessed.sh'), possessed], {
    cwd: ROOT,
  });
  return { root, crypt, possessed };
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/** The summon item fields the scripted clients and the tests read. */
export interface SummonItem {
  shortSha: string;
  author: string;
  subject: string;
  body: string;
  hunk: string;
  suspiciousMessage: boolean;
}

export interface ProxyRequest {
  readonly path: string;
  readonly method: string;
  /** 1 for the first request with this method and path, 2 for the second, … */
  readonly attempt: number;
}

export interface OpenOptions {
  readonly samples: Samples;
  readonly client?: AnthropicClient;
  /** Answer instead of the server (a sleeping proxy), or undefined to pass the request on. */
  readonly proxy?: (req: ProxyRequest) => Response | Promise<Response> | undefined;
  /** Route the window's setTimeout/clearTimeout/setInterval/clearInterval to Node's, looked up at call time, so vi.useFakeTimers() drives app.js. */
  readonly nodeTimers?: boolean;
  /** Called with each successful summon body before the page sees it (scripted clients read the ledger here). */
  readonly onSummon?: (data: { items: SummonItem[] }) => void;
  /** Open the page with ANTHROPIC_API_KEY unset, so the server has no model (flow 3 case a). */
  readonly noKey?: boolean;
}

type ServerModule = typeof import('../../src/server.js');

export interface Page {
  readonly window: Window & typeof globalThis;
  readonly doc: Document;
  readonly server: ServerModule;
  readonly requests: Array<{
    path: string;
    method: string;
    body: unknown;
    status: number;
    /** The response body parsed as JSON, or null when it is not JSON. */
    data: unknown;
  }>;
  $(id: string): HTMLElement;
  input(id: string): HTMLInputElement;
  click(el: Element): void;
  submit(formId: string): void;
  setRepo(value: string): void;
  turns(): Element[];
  /** Polls with setImmediate and a performance.now() deadline, so it works under fake timers. */
  until(cond: () => boolean, what: string, ms?: number): Promise<void>;
  close(): void;
}

export const norm = (s: string | null | undefined): string =>
  (s ?? '').replace(/\s+/g, ' ').trim();

/** Reason sentences of the ward (ward-hardening design.md §4.2), as the page shows them. */
export const REASONS = {
  F4: (sha: string): string => `Commit ${sha} is not in the ledger.`,
  F6: (sha: string): string =>
    `The citation of ${sha} has no quote. The ward accepts a citation only with the exact words from the commit.`,
  F9: (sha: string): string =>
    `The quote cited from ${sha} is not in that commit's subject, message or diff.`,
  F10: (year: string): string =>
    `The claim names the year ${year}, but no cited commit is dated ${year} or mentions it.`,
  F11: (name: string): string =>
    `The claim names ${name}, but no cited commit is by ${name} or mentions them.`,
} as const;

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

async function until(cond: () => boolean, what: string, ms = 10_000): Promise<void> {
  const end = performance.now() + ms;
  while (!cond()) {
    if (performance.now() > end) throw new Error(`timed out waiting for ${what}`);
    await tick();
  }
  // let the handler's finally block run
  for (let i = 0; i < 5; i++) await tick();
}

const ENV_KEYS = [
  'CRYPT_DIR',
  'POSSESSED_DIR',
  'ANTHROPIC_FIXTURE',
  'ANTHROPIC_API_KEY',
] as const;

export async function openPage(opts: OpenOptions): Promise<Page> {
  // 1. Environment and no network
  const savedEnv = new Map(ENV_KEYS.map((k) => [k, process.env[k]] as const));
  process.env['CRYPT_DIR'] = opts.samples.crypt; // read when src/server.ts loads
  process.env['POSSESSED_DIR'] = opts.samples.possessed;
  delete process.env['ANTHROPIC_FIXTURE'];
  if (opts.noKey) delete process.env['ANTHROPIC_API_KEY'];
  else process.env['ANTHROPIC_API_KEY'] = DUMMY_KEY;
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('network access is not allowed in the DOM tests');
    }),
  );

  // 2–3. The server, cached per test file, with fresh limiters
  const server: ServerModule = await import('../../src/server.js');
  server.modelLimiter.reset();
  server.summonLimiter.reset();
  server.wardLimiter.reset();
  server.clonePool.reset();
  const app = server.createApp(
    opts.client === undefined ? {} : { anthropicClient: opts.client },
  );

  // 4. The window
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  const w = dom.window as unknown as Window &
    typeof globalThis & { eval: (s: string) => void };
  const doc = w.document;

  // 5. Stubs
  w.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof w.matchMedia;
  w.Element.prototype.scrollIntoView = () => undefined;
  if (opts.nodeTimers) {
    const timers = w as unknown as Record<string, unknown>;
    timers['setTimeout'] = (fn: () => void, ms?: number) => globalThis.setTimeout(fn, ms);
    timers['clearTimeout'] = (id: ReturnType<typeof setTimeout>) =>
      globalThis.clearTimeout(id);
    timers['setInterval'] = (fn: () => void, ms?: number) =>
      globalThis.setInterval(fn, ms);
    timers['clearInterval'] = (id: ReturnType<typeof setInterval>) =>
      globalThis.clearInterval(id);
  }

  const requests: Page['requests'] = [];
  const attempts = new Map<string, number>();
  let pendingHealth = 0;
  w.fetch = (async (p: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    let body: unknown = null;
    if (typeof init?.body === 'string') {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const k = `${method} ${p}`;
    const attempt = (attempts.get(k) ?? 0) + 1;
    attempts.set(k, attempt);
    const isHealth = method === 'GET' && p === '/api/health';
    if (isHealth) pendingHealth++;
    try {
      const proxied = opts.proxy
        ? await opts.proxy({ path: p, method, attempt })
        : undefined;
      const res = proxied ?? (await app.request(p, init));
      const data: unknown = await res
        .clone()
        .json()
        .catch(() => null);
      requests.push({ path: p, method, body, status: res.status, data });
      if (proxied === undefined && p === '/api/summon' && res.ok) {
        opts.onSummon?.(data as { items: SummonItem[] });
      }
      return res;
    } finally {
      if (isHealth) pendingHealth--;
    }
  }) as typeof w.fetch;

  // 6. The page script, unmodified
  w.eval(appJs);

  // 7. A health call made while loading is answered before the test starts
  if (pendingHealth > 0) {
    await until(() => pendingHealth === 0, 'the health call');
  }

  const $ = (id: string): HTMLElement => {
    const n = doc.getElementById(id);
    if (!n) throw new Error(`#${id} missing`);
    return n;
  };
  const input = (id: string): HTMLInputElement => $(id) as HTMLInputElement;

  return {
    window: w,
    doc,
    server,
    requests,
    $,
    input,
    click(el) {
      el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    },
    submit(formId) {
      $(formId).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    },
    setRepo(value) {
      input('repo').value = value;
      input('repo').dispatchEvent(new w.Event('input', { bubbles: true }));
      input('repo').dispatchEvent(new w.Event('change', { bubbles: true }));
    },
    turns: () => [...doc.querySelectorAll('#log .turn')],
    until,
    close() {
      dom.window.close();
      vi.unstubAllGlobals();
      for (const [k, v] of savedEnv) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Scripted clients (design.md §10.2); CryptClient is re-exported above
// ---------------------------------------------------------------------------

/** A model that is down: every call rejects with an Anthropic 529 (overloaded). */
export class DownClient implements AnthropicClient {
  readonly calls: AnthropicCreateParams[] = [];

  readonly messages = {
    create: async (params: AnthropicCreateParams): Promise<AnthropicMessage> => {
      this.calls.push(params);
      throw new Anthropic.APIError(
        529,
        { type: 'error', error: { type: 'overloaded_error' } },
        'Overloaded',
        new Headers(),
      );
    },
  };
}
