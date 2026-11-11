/**
 * Scripted model clients shared by the recording, server and DOM tests (first-seance design.md §10.2).
 *
 * CryptClient answers from the first <evidence> element of the user turn, so it only uses what
 * a real model would see. For ghost_answer it returns a memory claim that cites that item and
 * quotes its subject, then a silence claim. For refactor_plan it returns one step and one
 * do-not-touch entry, each backed by that memory claim. Every call is counted.
 *
 * No network: these clients never leave the process.
 */

import type {
  AnthropicClient,
  AnthropicCreateParams,
  AnthropicMessage,
} from '../../src/ghost/llm.js';

/** Undo escapeLedgerText (&quot; &gt; &lt; first, &amp; last). */
function unescapeLedgerText(s: string): string {
  return s
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

/** sha7 and subject of the first real <evidence> element of the user turn. */
function firstEvidence(user: string): { sha7: string; subject: string } {
  const m =
    /^<evidence id="[^"]*" sha7="([0-9a-f]{7})"[^\n]*>\n<subject>([^\n]*)<\/subject>$/m.exec(
      user,
    );
  if (!m || m[1] === undefined || m[2] === undefined) {
    throw new Error('CryptClient: the user turn has no evidence element');
  }
  return { sha7: m[1], subject: unescapeLedgerText(m[2]) };
}

export const CRYPT_CLIENT_SILENCE = {
  kind: 'silence',
  text: 'The record is silent on who chose three seconds.',
  citations: [],
  silenceReason: 'Who chose a three second wait?',
} as const;

export class CryptClient implements AnthropicClient {
  readonly calls: AnthropicCreateParams[] = [];

  readonly messages = {
    create: async (params: AnthropicCreateParams): Promise<AnthropicMessage> => {
      this.calls.push(params);
      const user = params.messages[0]?.content ?? '';
      const { sha7, subject } = firstEvidence(user);
      const memory = {
        kind: 'memory',
        text: `The commit says: ${subject}`,
        citations: [{ sha7, quote: subject }],
      };
      if (params.tools[0]?.name === 'ghost_answer') {
        const sessionId = /sessionId "([^"]+)"/.exec(params.system)?.[1] ?? 'unknown';
        return {
          content: [
            {
              type: 'tool_use',
              name: 'ghost_answer',
              input: {
                voice: 'scripted crypt ghost',
                sessionId,
                claims: [memory, { ...CRYPT_CLIENT_SILENCE }],
              },
            },
          ],
        };
      }
      return {
        content: [
          {
            type: 'tool_use',
            name: 'refactor_plan',
            input: {
              characterizationTests: ['The call still waits before it returns.'],
              steps: [
                {
                  description: 'Name the wait',
                  rationale: 'The commit explains it.',
                  reversible: true,
                  claims: [memory],
                },
              ],
              doNotTouchList: [
                {
                  lineRange: { start: 1, end: 1 },
                  reason: 'The commit explains it.',
                  claims: [memory],
                },
              ],
              summary: 'Keep the wait; name it.',
            },
          },
        ],
      };
    },
  };
}
