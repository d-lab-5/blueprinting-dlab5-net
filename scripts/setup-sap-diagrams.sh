#!/usr/bin/env bash
#
# Fetches the SAP draw.io skill at a pinned commit.
#
# Not vendored into the repository: the bundle is 20 MB, 16 MB of which is 71
# SAP reference templates. Committing that into a public repo is bloat, and a
# copy of an actively maintained upstream goes stale in a way a pinned fetch
# does not. vendor/ is gitignored; vendor/NOTICE records what this is and
# under what terms, and is committed.
#
# Licences, both compatible with this repository's MIT:
#   plugin code (scripts, markdown)  MIT       (c) Marian Zeis
#   assets (icons, templates)        Apache-2.0 (c) SAP SE or an SAP affiliate
#
# The scripts need only the Python standard library.
#
# Usage:  scripts/setup-sap-diagrams.sh
set -euo pipefail

# Pinned. Bump deliberately, and re-read the upstream's own notes when you do —
# the workflow and its quality gates are theirs, not ours.
COMMIT="2484140fb29f2083a8209dd9c22ce099ffcbe418"
REPO="https://github.com/marianfoo/btp-drawio-skill.git"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/btp-drawio-skill"

if [ -d "$DEST/.git" ]; then
  CURRENT="$(git -C "$DEST" rev-parse HEAD)"
  if [ "$CURRENT" = "$COMMIT" ]; then
    echo "already at the pinned commit ${COMMIT:0:12}"
    exit 0
  fi
  echo "at ${CURRENT:0:12}, wanted ${COMMIT:0:12} — refetching"
  rm -rf "$DEST"
fi

mkdir -p "$(dirname "$DEST")"
git clone --quiet "$REPO" "$DEST"
git -C "$DEST" checkout --quiet "$COMMIT"

SKILL="$DEST/plugins/sap-architecture/skills/sap-architecture"
if [ ! -f "$SKILL/scripts/scaffold_diagram.py" ]; then
  echo "the upstream layout has changed; scaffold_diagram.py is not where expected" >&2
  exit 1
fi

echo "fetched btp-drawio-skill at ${COMMIT:0:12}"
echo "  scripts:   $SKILL/scripts"
echo "  templates: $(find "$SKILL/assets/reference-examples" -name '*.drawio' | wc -l) reference diagrams"
echo
echo "This scaffolds, validates and scores. It does not finish a diagram —"
echo "the upstream is explicit that most need 10-20 minutes in draw.io desktop."
