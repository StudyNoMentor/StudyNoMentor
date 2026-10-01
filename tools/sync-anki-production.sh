#!/usr/bin/env bash
# Publica a árvore da main preservando o histórico da branch ligada ao Railway.
set -euo pipefail

MAIN_REF="${1:-origin/main}"
DEPLOY_BRANCH="${2:-feat/anki-official-engine-20260923}"
MAIN_SHA="$(git rev-parse "$MAIN_REF^{commit}")"
DEPLOY_SHA="$(git rev-parse "origin/$DEPLOY_BRANCH^{commit}")"

git config user.name 'github-actions[bot]'
git config user.email '41898282+github-actions[bot]@users.noreply.github.com'

SYNC_INDEX="$(mktemp)"
trap 'rm -f "$SYNC_INDEX"' EXIT
rm "$SYNC_INDEX"
export GIT_INDEX_FILE="$SYNC_INDEX"
git read-tree "$MAIN_SHA"
REVISION_BLOB="$(printf 'source-main: %s\nreason: synchronized from validated main\n' "$MAIN_SHA" | git hash-object -w --stdin)"
git update-index --add --cacheinfo "100644,$REVISION_BLOB,anki_official_backend/DEPLOY_REVISION"
SYNC_TREE="$(git write-tree)"

if [ "$SYNC_TREE" = "$(git rev-parse "$DEPLOY_SHA^{tree}")" ]; then
  echo "Anki production source already synchronized to main@$MAIN_SHA."
  exit 0
fi

# Os dois pais tornam futuras sincronizações fast-forward, inclusive se houve
# commits exclusivos de produção. A árvore publicada vem integralmente da main.
SYNC_SHA="$(git commit-tree "$SYNC_TREE" -p "$DEPLOY_SHA" -p "$MAIN_SHA" -m "deploy(anki): synchronize validated main@$MAIN_SHA")"
git push origin "$SYNC_SHA:refs/heads/$DEPLOY_BRANCH"
echo "Anki production source synchronized to main@$MAIN_SHA (deploy $SYNC_SHA)."
