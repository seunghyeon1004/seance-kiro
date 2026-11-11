# Recorded answers

These files let the guided path keep working when the model is unavailable (first-seance R7.3, R7.4).

When `/api/ask` or `/api/exorcise` would fail because the server has no model key, the model is busy or misconfigured, the call timed out, or the daily cap is used up, the server looks here for an answer recorded earlier. It does so only for the `crypt` and `possessed` samples, with their default file and range, and only for the chip questions on the page. **The ward checks every recording again against the live ledger**, with the same `verify()` call and the same response builder as a live answer, and the page labels the turn as recorded. A recording is never used for any other repository, range or question.

## Who writes them

Only `scripts/record-answers.ts` writes these files. A human with a real `ANTHROPIC_API_KEY` runs it, and each file is the model's raw tool input from a real call with the live prompt. **Never edit a recording by hand.** If one is wrong, record it again. A hand edit cannot get past the ward anyway: an edited claim is verified only if its quote is really in the cited commit.

## The eight targets

Each file is named `<key>.json`, where the key is the first 16 hex characters of `sha256(JSON.stringify([kind, sample, file, startLine, endLine, question]))`. These are the keys printed by `npx tsx scripts/record-answers.ts --keys-only`:

| Key | Kind | Sample | Range | Question |
| --- | --- | --- | --- | --- |
| `5a4ec240b9bab964` | ask | crypt | `legacy/tax.js` 7–7 | Why is there a three second wait here? |
| `4871a23bd3a873e8` | ask | crypt | `legacy/tax.js` 7–7 | Who touched this line last, and why? |
| `66f899b5ff81a2e8` | ask | crypt | `legacy/tax.js` 7–7 | Is it safe to delete the wait? |
| `f20e4d18424293e3` | exorcise | crypt | `legacy/tax.js` 7–7 | |
| `7c7fb0fb2cac224f` | ask | possessed | `auth/throttle.js` 4–4 | Can I delete this wait? |
| `c0edcff6680e699c` | ask | possessed | `auth/throttle.js` 4–4 | Why does the wait exist? |
| `7f38fda83679f5d0` | ask | possessed | `auth/throttle.js` 4–4 | Who changed this? |
| `65d55947382e818c` | exorcise | possessed | `auth/throttle.js` 4–4 | |

## When to record again

- After a change to `scripts/make-crypt.sh` or `scripts/make-possessed.sh`. Each file stores the short hashes of the ledger the model saw (`ledgerShas`), and `test/recordings.test.ts` fails when they no longer match a freshly built sample.
- After a change to the prompt, if you want the recorded wording to follow it.

A recorded answer that the ward strikes is shown struck. That is honest, and it is no reason to record again.

## How to record again

```sh
npx tsx scripts/record-answers.ts --keys-only          # check the keys against the table above
ANTHROPIC_API_KEY=… npx tsx scripts/record-answers.ts  # writes the eight files here
```

The script refuses to run without a key or with `ANTHROPIC_FIXTURE=1`. `RECORDINGS_DIR` sets another output directory. It prints each key with the ward's tally against that ledger, for your information. Commit the files exactly as written; Prettier ignores this directory so they stay byte-for-byte.
