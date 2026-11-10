#!/bin/sh
# Minimale vervanger van pnpm in het runtime-image.
#
# De commando's van de owntube-containers staan in Cosmos, niet in dit image:
#   owntube:              pnpm exec tsx scripts/migrate.ts && pnpm run start
#   owntube-cache-warmer: pnpm warm:cache
# Het echte pnpm (met zijn eigen CVE's) hoort niet in het image dat draait;
# deze shim voert alleen die vormen uit en weigert de rest.
#
#   pnpm exec <bin> [args]    -> node_modules/.bin/<bin> [args]
#   pnpm run <script> [args]  -> het script uit package.json
#   pnpm <script> [args]      -> idem
set -eu

PATH="$PWD/node_modules/.bin:$PATH"
export PATH

[ $# -ge 1 ] || { echo "pnpm-shim: geen commando" >&2; exit 2; }

case "$1" in
  exec)
    shift
    [ $# -ge 1 ] || { echo "pnpm-shim: exec zonder programma" >&2; exit 2; }
    exec "$@"
    ;;
  run)
    shift
    ;;
  install|add|remove|update|i|dlx)
    echo "pnpm-shim: '$1' kan niet in het runtime-image" >&2
    exit 2
    ;;
esac

[ $# -ge 1 ] || { echo "pnpm-shim: geen script" >&2; exit 2; }
name="$1"
shift

cmd=$(node -e '
  const s = require(process.cwd() + "/package.json").scripts || {};
  const c = s[process.argv[1]];
  if (!c) { console.error("pnpm-shim: onbekend script: " + process.argv[1]); process.exit(2); }
  process.stdout.write(c);
' "$name")

exec sh -c "$cmd \"\$@\"" pnpm-shim "$@"
