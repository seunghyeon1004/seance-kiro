/**
 * seance-mcp T3 — no model and no GitHub call is reachable from the MCP server (R1.5, R2.3;
 * design.md §9.1).
 *
 * Walks every static and dynamic import specifier reachable from src/mcp/server.ts, reading
 * the files as text and following relative specifiers. Type-only imports are followed too,
 * which is stricter than what runs.
 */

import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summonTool, withDefaultDeps } from '../../src/mcp/tools.js';
import type { LedgerInput } from '../../src/evidence/ledger.input.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const rel = (p: string): string => path.relative(ROOT, p).split(path.sep).join('/');

const SPECIFIER_RE =
  /(?:\bimport\s*(?:type\s+)?(?:[^'"()]*?\sfrom\s*)?|\bexport\s+(?:type\s+)?[^'"()]*?\sfrom\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

function specifiers(source: string): string[] {
  return Array.from(source.matchAll(SPECIFIER_RE), (m) => m[1] as string);
}

function resolveRelative(from: string, spec: string): string {
  const target = path.resolve(path.dirname(from), spec);
  const ts = target.replace(/\.js$/, '.ts');
  if (fs.existsSync(ts)) return ts;
  if (fs.existsSync(target)) return target;
  throw new Error(`cannot resolve ${spec} from ${rel(from)}`);
}

interface Graph {
  readonly files: Set<string>; // repository-relative
  readonly packages: Set<string>;
  readonly edges: Array<[string, string]>; // [from, to], repository-relative
}

function walk(entry: string): Graph {
  const files = new Set<string>();
  const packages = new Set<string>();
  const edges: Array<[string, string]> = [];
  const queue = [path.join(ROOT, entry)];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(rel(file))) continue;
    files.add(rel(file));
    for (const spec of specifiers(fs.readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) {
        const target = resolveRelative(file, spec);
        edges.push([rel(file), rel(target)]);
        queue.push(target);
      } else {
        packages.add(spec);
      }
    }
  }
  return { files, packages, edges };
}

describe('imports reachable from src/mcp/server.ts (R1.5)', () => {
  const graph = walk('src/mcp/server.ts');

  it('the walker sees the server modules and the ward', () => {
    for (const f of [
      'src/mcp/app.ts',
      'src/mcp/tools.ts',
      'src/mcp/repo.ts',
      'src/mcp/store.ts',
      'src/mcp/console.ts',
      'src/mcp/messages.ts',
      'src/ghost/verifier.ts',
      'src/ghost/report.ts',
      'src/evidence/ledger.ts',
    ]) {
      expect(graph.files).toContain(f);
    }
    expect(graph.packages).toContain('@modelcontextprotocol/sdk/server/mcp.js');
  });

  it('reaches no model code, no web server and no Anthropic SDK', () => {
    for (const f of [
      'src/ghost/llm.ts',
      'src/ghost/persona.ts',
      'src/exorcism/plan.ts',
      'src/server.ts',
    ]) {
      expect(graph.files).not.toContain(f);
    }
    for (const p of graph.packages) expect(p.startsWith('@anthropic-ai/sdk')).toBe(false);
  });

  it('no module under src/mcp/ imports src/evidence/github.ts itself', () => {
    const direct = graph.edges.filter(
      ([from, to]) => from.startsWith('src/mcp/') && to === 'src/evidence/github.ts',
    );
    expect(direct).toEqual([]);
    // reachable only through ledger.ts (design.md §9.1 note)
    expect(graph.edges).toContainEqual([
      'src/evidence/ledger.ts',
      'src/evidence/github.ts',
    ]);
  });
});

describe('no GitHub token reaches buildLedger (R2.3)', () => {
  it('the input has no githubToken key', async () => {
    const buildLedger = vi.fn(async (_input: LedgerInput) => ({
      items: [],
      truncated: false,
      buildDurationMs: 0,
    }));
    const deps = withDefaultDeps({ resolveRepo: async () => '/repo/root', buildLedger });
    await summonTool({ file: 'a.js', startLine: 1, endLine: 2 }, deps);
    expect(buildLedger).toHaveBeenCalledTimes(1);
    expect(buildLedger.mock.calls[0]).toHaveLength(1);
    expect(Object.keys(buildLedger.mock.calls[0]?.[0] ?? {})).not.toContain(
      'githubToken',
    );
  });
});
