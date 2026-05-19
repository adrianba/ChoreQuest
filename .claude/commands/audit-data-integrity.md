# Data Integrity Audit

Scan for bugs that silently corrupt or lose data — things that don't error
but produce wrong results over time.

## Patterns to find

### Race conditions / double-spend
- XP awarded multiple times for the same action (verify called twice before
  the first commit lands)
- Spin credits consumed but points not awarded (or vice versa) — is there a
  transaction wrapping both operations?
- Streak incremented on every verify call for the same assignment?

### Silent overwrites
- Any `.replace_all=True` style updates that clobber fields the caller didn't
  intend to change (like the `assign_chore` current_index reset bug)
- Upsert patterns that reset state on re-save

### Missing cascade / orphan cleanup
- Deleting a chore — are its assignments, rules, rotations, exclusions all
  cleaned up? Or do orphan rows accumulate?
- Deleting a user — are their assignments, point transactions, achievements,
  pet state, notifications all handled?

### Off-by-one in date/streak math
- Any `>` vs `>=` in streak gap checks
- Grace period cutoff: `< cutoff` vs `<= cutoff`
- Rotation advancement: `>= 1` vs `> 1` day gap

### Float/int precision in XP
- Seasonal event multiplier applied as float then truncated — could kids lose
  1 XP on every quest during an event due to floor vs round?
- Multi-completion XP scaling — is partial credit calculated correctly?

### Soft-delete consistency
- `is_active=False` chores: do all list endpoints filter them out?
  Any place where inactive chores can still receive assignments or be completed?

## Report format

File, line, description of the integrity risk, and recommended fix.
Low-severity style issues are out of scope — focus on anything that could
cause silent data loss or incorrect XP/streak values.
