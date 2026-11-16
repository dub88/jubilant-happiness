#!/usr/bin/env bash
# Copy the plumbline form guard into a site, as plain JavaScript with type
# declarations. Use this until plumbline-forms is published to npm.
#
#   vendor-forms.sh <destination-directory>     e.g. src/lib/plumbline-forms
#
# The guard has no dependencies. Import it from the destination:
#   import { createFormGuard } from '@/lib/plumbline-forms/index.js'
#   import { startFormTimer } from '@/lib/plumbline-forms/client.js'
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: vendor-forms.sh <destination-directory>" >&2
  exit 2
fi
destination="$1"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
if [ ! -f "$repo/packages/forms/package.json" ]; then
  repo="${PLUMBLINE_HOME:-${XDG_CACHE_HOME:-$HOME/.cache}/plumbline}"
  if [ ! -f "$repo/packages/forms/package.json" ]; then
    echo "plumbline: fetching the form guard into $repo (first run only)" >&2
    git clone --quiet --depth 1 https://github.com/dub88/jubilant-happiness "$repo" >&2
  fi
fi
if [ ! -f "$repo/packages/forms/dist/index.js" ]; then
  echo "plumbline: building the form guard (first run only)" >&2
  (cd "$repo" && npm ci --no-audit --no-fund --silent && npm run build --silent) >&2
fi

mkdir -p "$destination"
for name in index content client; do
  cp "$repo/packages/forms/dist/$name.js" "$repo/packages/forms/dist/$name.d.ts" "$destination/"
done
cat > "$destination/README.md" <<'NOTE'
Vendored from https://github.com/dub88/jubilant-happiness (packages/forms), MIT licence.
Do not edit these files; re-run the plumbline skill's vendor-forms.sh to update them.
NOTE
echo "Copied the form guard to $destination"
