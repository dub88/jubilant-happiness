#!/usr/bin/env bash
# Run the plumbline checker, building it on first use.
#
#   check.sh <url> [options]      same arguments as `plumbline check`
#   check.sh rules                list the rules
#
# When this skill sits inside the plumbline repository (as it does when
# installed as a plugin) the checker beside it is used. When the skill folder
# was copied on its own, the repository is cloned once into a cache directory;
# delete that directory to fetch a newer version.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../../.." && pwd)"
if [ ! -f "$repo/packages/check/package.json" ]; then
  repo="${PLUMBLINE_HOME:-${XDG_CACHE_HOME:-$HOME/.cache}/plumbline}"
  if [ ! -f "$repo/packages/check/package.json" ]; then
    echo "plumbline: fetching the checker into $repo (first run only)" >&2
    git clone --quiet --depth 1 https://github.com/dub88/jubilant-happiness "$repo" >&2
  fi
fi

if [ ! -f "$repo/packages/check/dist/cli.js" ]; then
  echo "plumbline: building the checker (first run only)" >&2
  (cd "$repo" && npm ci --no-audit --no-fund --silent && npm run build --silent) >&2
fi

case "${1:-}" in
  rules | help | --help | -h | "") exec node "$repo/packages/check/dist/cli.js" "$@" ;;
  check) shift ;;
esac
exec node "$repo/packages/check/dist/cli.js" check "$@"
