#!/usr/bin/env bash
# Builds the sample "crypt": a small repo with a realistic, purpose-written history (fictional people and company).
# Usage: scripts/make-crypt.sh [target-dir]    (default: data/crypt)
set -euo pipefail
T="${1:-data/crypt}"
rm -rf "$T"; mkdir -p "$T"; cd "$T"
git init -q -b main
git config user.email "crypt@example.invalid"; git config user.name "crypt"
c() { # date author email message...
  local d="$1" a="$2" e="$3"; shift 3
  GIT_AUTHOR_NAME="$a" GIT_AUTHOR_EMAIL="$e" GIT_AUTHOR_DATE="$d" GIT_COMMITTER_NAME="$a" GIT_COMMITTER_EMAIL="$e" GIT_COMMITTER_DATE="$d" \
    git commit -q -am "$@"
}
mkdir -p legacy tests
cat > legacy/invoice.js <<'JS'
// Invoice totals for the billing service.
function total(lines) {
  let sum = 0;
  for (const l of lines) sum += l.qty * l.price;
  return sum;
}
module.exports = { total };
JS
git add -A
GIT_AUTHOR_DATE="2019-03-04T10:12:00Z" GIT_COMMITTER_DATE="2019-03-04T10:12:00Z" GIT_AUTHOR_NAME="Marguerite Okafor" GIT_AUTHOR_EMAIL="marguerite@acme-billing.example" GIT_COMMITTER_NAME="Marguerite Okafor" GIT_COMMITTER_EMAIL="marguerite@acme-billing.example" git commit -q -m "feat: invoice totals" -m "First cut of the billing service. Totals only, no tax yet."

cat > legacy/invoice.js <<'JS'
// Invoice totals for the billing service.
function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}
function total(lines) {
  let sum = 0;
  for (const l of lines) sum += l.qty * l.price;
  return roundHalfEven(sum * 100) / 100;
}
module.exports = { total };
JS
c "2019-06-18T14:40:00Z" "Dmitri Volkov" "dmitri@acme-billing.example" "fix: round half-even for EU VAT" -m "Regulators require banker's rounding on EU invoices (ticket INV-212). Plain Math.round drifted by one cent on 0.5 boundaries and the auditors flagged it."

cat > legacy/tax.js <<'JS'
const { total } = require("./invoice");
const vendor = require("./vendor");
async function taxFor(account, lines) {
  const base = total(lines);
  await new Promise((r) => setTimeout(r, 3000));
  return vendor.quote(account, base);
}
module.exports = { taxFor };
JS
cat > legacy/vendor.js <<'JS'
// Thin wrapper around the TaxJar-like vendor API (fictional).
async function quote(account, amount) {
  return { account, amount, tax: Math.round(amount * 0.2 * 100) / 100 };
}
module.exports = { quote };
JS
git add -A
GIT_AUTHOR_DATE="2020-02-11T09:05:00Z" GIT_COMMITTER_DATE="2020-02-11T09:05:00Z" GIT_AUTHOR_NAME="Dmitri Volkov" GIT_AUTHOR_EMAIL="dmitri@acme-billing.example" GIT_COMMITTER_NAME="Dmitri Volkov" GIT_COMMITTER_EMAIL="dmitri@acme-billing.example" \
  git commit -q -m "hack: wait 3s before calling the tax vendor" -m "The vendor returns 429 if two requests from the same account land within 3 seconds, and their support confirmed there is no burst allowance. Without the delay the nightly batch loses about 8% of quotes. Proper fix is a queue. Fixes #7"

cat > legacy/schedule.js <<'JS'
// Billing window helpers.
const MAX_SECONDS_IN_DAY = 86399;
function secondsIntoBillingDay(d) {
  const s = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  return Math.min(s, MAX_SECONDS_IN_DAY);
}
module.exports = { secondsIntoBillingDay };
JS
git add -A
GIT_AUTHOR_DATE="2021-09-30T16:20:00Z" GIT_COMMITTER_DATE="2021-09-30T16:20:00Z" GIT_AUTHOR_NAME="Priya Ramanathan" GIT_AUTHOR_EMAIL="priya@acme-billing.example" GIT_COMMITTER_NAME="Priya Ramanathan" GIT_COMMITTER_EMAIL="priya@acme-billing.example" \
  git commit -q -m "fix: cap billing day at 86399 seconds" -m "On the daylight-saving rollover the scheduler produced 86400 and the job ran twice, double-billing 41 customers (incident of 2021-09-26). Cap the value instead of trusting the clock. Refs #31"

cat > legacy/vendor.js <<'JS'
// Thin wrapper around the TaxJar-like vendor API (fictional).
let token = null, tokenAt = 0;
async function getToken() {
  if (token && Date.now() - tokenAt < 55 * 60 * 1000) return token;
  token = "tok_" + Math.random().toString(36).slice(2);
  tokenAt = Date.now();
  return token;
}
async function quote(account, amount) {
  await getToken();
  return { account, amount, tax: Math.round(amount * 0.2 * 100) / 100 };
}
module.exports = { quote };
JS
c "2022-05-02T11:30:00Z" "Priya Ramanathan" "priya@acme-billing.example" "perf: cache the vendor token for 55 minutes" -m "Tokens live 60 minutes; we refresh 5 minutes early to survive clock skew between our hosts and the vendor. Cuts auth calls from ~40k/day to ~26."

cat > legacy/tax.js <<'JS'
const { total } = require("./invoice");
const vendor = require("./vendor");
// TODO: remove this delay after migrating to the new tax vendor
async function taxFor(account, lines) {
  const base = total(lines);
  await new Promise((r) => setTimeout(r, 3000));
  return vendor.quote(account, base);
}
module.exports = { taxFor };
JS
c "2023-01-17T08:55:00Z" "Tom Haskell" "tom@acme-billing.example" "chore: add TODO about the tax delay"

cat > legacy/tax.js <<'JS'
const { total } = require("./invoice");
const vendor = require("./vendor");
// TODO: remove this delay after migrating to the new tax vendor
const PAUSE_MS = 3000;
async function taxFor(acct, items) {
  const amt = total(items);
  await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  return vendor.quote(acct, amt);
}
module.exports = { taxFor };
JS
c "2024-08-08T13:10:00Z" "Tom Haskell" "tom@acme-billing.example" "refactor: rename variables in tax.js"

cat > tests/invoice.test.js <<'JS'
const { total } = require("../legacy/invoice");
console.log(total([{ qty: 2, price: 1.005 }]));
JS
git add -A
GIT_AUTHOR_DATE="2024-10-21T10:00:00Z" GIT_COMMITTER_DATE="2024-10-21T10:00:00Z" GIT_AUTHOR_NAME="Tom Haskell" GIT_AUTHOR_EMAIL="tom@acme-billing.example" GIT_COMMITTER_NAME="Tom Haskell" GIT_COMMITTER_EMAIL="tom@acme-billing.example" git commit -q -m "test: smoke test for invoice totals"
echo "crypt ready at $(pwd) ($(git rev-list --count HEAD) commits)"
