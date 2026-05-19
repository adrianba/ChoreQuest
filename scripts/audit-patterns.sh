#!/usr/bin/env bash
# audit-patterns.sh — grep for known dangerous code patterns
# Run manually or in CI to catch regressions before they ship.
# Exit code 0 = clean. Exit code 1 = hits found (review required).

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

HITS=0
RED='\033[0;31m'
YEL='\033[0;33m'
GRN='\033[0;32m'
NC='\033[0m'

check() {
    local label="$1"; local severity="$2"; local pattern="$3"; shift 3
    local results
    results=$(grep -rn --include="*.py" "$pattern" "$@" 2>/dev/null || true)
    if [[ -n "$results" ]]; then
        if [[ "$severity" == "ERROR" ]]; then
            echo -e "${RED}[ERROR] $label${NC}"
            HITS=$((HITS+1))
        else
            echo -e "${YEL}[WARN]  $label${NC}"
        fi
        while IFS= read -r line; do echo "        $line"; done <<< "$results"
        echo
    fi
}

echo "=== ChoreQuest pattern audit ==="
echo

# ── Timezone / day-boundary ──────────────────────────────────────────────────
echo "── Timezone / day-boundary ──"

check \
    "UTC midnight used as day boundary (.replace(hour=0) on UTC now)" \
    "ERROR" \
    'datetime\.now(timezone\.utc)\.replace(hour=' \
    backend/

check \
    "should_advance_rotation called with 'now' — verify now is local time, NOT datetime.now(timezone.utc)" \
    "WARN" \
    'should_advance_rotation(.*\bnow\b' \
    backend/

check \
    "Hardcoded timezone string (ZoneInfo literal)" \
    "ERROR" \
    "ZoneInfo('[A-Za-z]" \
    backend/

check \
    "datetime.utcnow() — deprecated, always UTC" \
    "WARN" \
    'datetime\.utcnow()' \
    backend/

# ── Security ─────────────────────────────────────────────────────────────────
echo "── Security ──"

check \
    "password_hash included in a schema/response model" \
    "ERROR" \
    'password_hash.*:.*str\|password_hash.*Field' \
    backend/schemas.py backend/routers/

check \
    "Raw SQL string interpolation (f-string in execute)" \
    "ERROR" \
    'execute(f"' \
    backend/

check \
    "User-supplied filename stored directly (not uuid)" \
    "WARN" \
    'filename.*request\|request.*filename' \
    backend/routers/

# ── Data integrity ────────────────────────────────────────────────────────────
echo "── Data integrity ──"

# Note: rotations.py line ~88 is a legitimate bounds-guard (reset if index >= len after
# kid list shrinks). The only problematic case is in chores.py assign_chore where it
# was unconditional — fixed in PR #121 with a kids_changed guard.
check \
    "current_index = 0 unconditional (should be guarded by kids_changed in chores.py)" \
    "WARN" \
    'current_index = 0' \
    backend/routers/

check \
    "last_rotated = datetime.now unconditional in assign endpoint" \
    "WARN" \
    'last_rotated = datetime' \
    backend/routers/chores.py

# ── Summary ──────────────────────────────────────────────────────────────────
echo "────────────────────────────────"
if [[ $HITS -eq 0 ]]; then
    echo -e "${GRN}✓ No ERROR-level patterns found.${NC}"
else
    echo -e "${RED}✗ $HITS ERROR-level pattern(s) found — review before merging.${NC}"
    exit 1
fi
