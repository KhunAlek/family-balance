#!/usr/bin/env bash
set -euo pipefail

if [ "${WRANGLER_COMMAND:-}" != "deploy" ]; then
  echo "staging UI migration hook: skipped outside deploy"
  exit 0
fi

if ! grep -Fq '"name": "family-cash-flow-staging-bridge"' wrangler.jsonc || \
   ! grep -Fq '"database_name": "family-cash-flow-staging-v1"' wrangler.jsonc || \
   grep -Fq 'family-cash-flow-production' wrangler.jsonc; then
  echo "Refusing to run: config is not staging-only"
  exit 1
fi

DB=family-cash-flow-staging-v1
CFG=wrangler.jsonc
WR='npx --yes wrangler@4.123.0'

query() {
  $WR d1 execute "$DB" --remote --config "$CFG" --json --command "$1"
}
apply() {
  echo "Applying $1"
  $WR d1 execute "$DB" --remote --config "$CFG" --file "$1"
}
has() {
  query "$1" | grep -Fq "$2"
}

# 0005
c1=0; c2=0; c3=0
has "PRAGMA table_info(salary_cycle_state);" variables_target_satang && c1=1 || true
has "PRAGMA table_info(salary_cycle_state);" ef_cycle_commitment_satang && c2=1 || true
has "PRAGMA table_info(goals);" cycle_commitment_satang && c3=1 || true
sum=$((c1+c2+c3))
if [ "$sum" -eq 0 ]; then apply cloudflare/slice-d/migrations/0005_v3_minimal_planning.sql
elif [ "$sum" -eq 3 ]; then echo "0005 already present"
else echo "0005 partially present; refusing to guess"; exit 1
fi

# 0006
c1=0; c2=0
has "SELECT name FROM sqlite_master WHERE type='table' AND name='one_off_categories';" one_off_categories && c1=1 || true
has "SELECT name FROM sqlite_master WHERE type='table' AND name='new_function_request_receipts';" new_function_request_receipts && c2=1 || true
sum=$((c1+c2))
if [ "$sum" -eq 0 ]; then apply cloudflare/slice-d/migrations/0006_new_functionality.sql
elif [ "$sum" -eq 2 ]; then echo "0006 already present"
else echo "0006 partially present; refusing to guess"; exit 1
fi

# 0007
c1=0; c2=0; c3=0
has "SELECT name FROM sqlite_master WHERE type='table' AND name='reporting_salary_cycles';" reporting_salary_cycles && c1=1 || true
has "SELECT name FROM sqlite_master WHERE type='table' AND name='one_off_payments';" one_off_payments && c2=1 || true
has "SELECT name FROM sqlite_master WHERE type='table' AND name='one_off_payment_allocations';" one_off_payment_allocations && c3=1 || true
sum=$((c1+c2+c3))
if [ "$sum" -eq 0 ]; then apply cloudflare/slice-d/migrations/0007_reporting_cycles.sql
elif [ "$sum" -eq 3 ]; then echo "0007 already present"
else echo "0007 partially present; refusing to guess"; exit 1
fi

# 0008
c1=0; c2=0; c3=0
has "SELECT name FROM sqlite_master WHERE type='table' AND name='other_income_sources';" other_income_sources && c1=1 || true
has "SELECT name FROM sqlite_master WHERE type='table' AND name='other_income_source_versions';" other_income_source_versions && c2=1 || true
has "PRAGMA table_info(income_receipts);" other_income_source_id && c3=1 || true
sum=$((c1+c2+c3))
if [ "$sum" -eq 0 ]; then apply cloudflare/slice-d/migrations/0008_other_income.sql
elif [ "$sum" -eq 3 ]; then echo "0008 already present"
else echo "0008 partially present; refusing to guess"; exit 1
fi

# 0009
c1=0; c2=0; c3=0; c4=0; c5=0
has "PRAGMA table_info(balance_history);" one_off_payment_id && c1=1 || true
has "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_balance_one_off_payment';" idx_balance_one_off_payment && c2=1 || true
has "SELECT name FROM sqlite_master WHERE type='trigger' AND name='immutable_one_off_payment';" immutable_one_off_payment && c3=1 || true
has "SELECT name FROM sqlite_master WHERE type='trigger' AND name='immutable_one_off_allocation';" immutable_one_off_allocation && c4=1 || true
has "SELECT name FROM sqlite_master WHERE type='trigger' AND name='immutable_balance_payment_link';" immutable_balance_payment_link && c5=1 || true
sum=$((c1+c2+c3+c4+c5))
if [ "$sum" -eq 0 ]; then apply cloudflare/slice-d/migrations/0009_typed_payment_effect.sql
elif [ "$sum" -eq 5 ]; then echo "0009 already present"
else echo "0009 partially present; refusing to guess"; exit 1
fi

# 0010 is deliberately idempotent.
apply cloudflare/slice-d/migrations/0010_historical_one_offs.sql

# 0011
c1=0; c2=0; c3=0; c4=0; c5=0; c6=0; c7=0; c8=0; c9=0
has "PRAGMA table_info(obligations);" '"name":"active"' && c1=1 || true
has "PRAGMA table_info(obligations);" recurrence_type && c2=1 || true
has "PRAGMA table_info(obligations);" due_month && c3=1 || true
has "PRAGMA table_info(obligations);" start_date && c4=1 || true
has "PRAGMA table_info(obligation_occurrences);" cycle_start && c5=1 || true
has "PRAGMA table_info(obligation_occurrences);" category && c6=1 || true
has "PRAGMA table_info(obligation_payments);" occurrence_id && c7=1 || true
has "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_obligation_occurrence_cycle';" idx_obligation_occurrence_cycle && c8=1 || true
has "SELECT name FROM sqlite_master WHERE type='trigger' AND name='fixed_expense_management_enabled';" fixed_expense_management_enabled && c9=1 || true
sum=$((c1+c2+c3+c4+c5+c6+c7+c8+c9))
if [ "$sum" -eq 0 ]; then apply cloudflare/slice-d/migrations/0011_fixed_expenses.sql
elif [ "$sum" -eq 9 ]; then echo "0011 already present"
else echo "0011 partially present; refusing to guess"; exit 1
fi

query "PRAGMA foreign_key_check;" > /tmp/fcf-staging-fk.json
if grep -Eq '"results"[[:space:]]*:[[:space:]]*\[[^]]+\]' /tmp/fcf-staging-fk.json; then
  cat /tmp/fcf-staging-fk.json
  echo "Foreign-key violations found"
  exit 1
fi

echo "staging migrations through 0011 PASS"
