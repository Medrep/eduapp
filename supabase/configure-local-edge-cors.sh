#!/usr/bin/env bash
set -euo pipefail

# Apply only to the dedicated CLI stack. The vendor template otherwise handles
# Functions preflight for every origin before our two exact allowlists can run.
change=$(docker exec -u 0 -i supabase_kong_moja-nauka-local sh -s <<'KONG'
set -eu
config=/home/kong/kong.yml
test "${KONG_DECLARATIVE_CONFIG:-}" = "$config"
folder=$(mktemp -d /home/kong/mojanauka-cors.XXXXXX)
temp="$folder/kong.yml"
trap 'rm -f "$temp"; rmdir "$folder"' EXIT
awk '
  /^  - name: / {
    functions = ($0 == "  - name: functions-v1");
    if (functions) found += 1;
  }
  functions && /^      - name: cors$/ { removed += 1; next; }
  { print; }
  END { if (found != 1 || removed > 1) exit 2; }
' "$config" > "$temp"
if ! cmp -s "$config" "$temp"; then
  if ! kong config parse "$temp" >/dev/null 2>&1; then
    printf '%s\n' 'Local gateway configuration did not validate.' >&2
    exit 1
  fi
  chown "$(stat -c '%u:%g' "$config")" "$temp"
  chmod "$(stat -c '%a' "$config")" "$temp"
  mv "$temp" "$config"
  printf '%s\n' changed
fi
KONG
)
if [[ "$change" == changed ]]; then
  docker restart supabase_kong_moja-nauka-local >/dev/null
fi
printf '%s\n' 'Dedicated local Functions preflight and responses now use the application CORS policy.'
