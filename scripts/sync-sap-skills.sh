#!/usr/bin/env bash
#
# Refreshes the vendored SAP skills from an upstream checkout.
#
# They live in .claude/skills/ and ARE committed: they are GPL-3.0, and so is
# this repository, so including them is exactly what their licence is for.
# Each keeps its own `license:` and `maintainer:` front matter, and NOTICE
# records where the set came from.
#
# Run this to pick up upstream changes, then review the diff — these are
# reference material an agent reads, so a change to them changes advice.
#
# The three kspf-* skills are specific to the KONE lab and are not copied.
#
# Usage:  scripts/sync-sap-skills.sh [source-directory]
set -euo pipefail

SOURCE="${1:-$HOME/ERP-LAB-5/kone-SAP-PLF-lab-darkfactory/.agents/skills}"
TARGET="$(cd "$(dirname "$0")/.." && pwd)/.claude/skills"

if [ ! -d "$SOURCE" ]; then
  echo "no skills at $SOURCE" >&2
  echo "pass the directory as an argument if it lives elsewhere." >&2
  exit 1
fi

mkdir -p "$TARGET"

linked=0
for skill in "$SOURCE"/sap*; do
  [ -d "$skill" ] || continue
  name="$(basename "$skill")"
  rm -rf "${TARGET:?}/$name"
  cp -r "$skill" "$TARGET/$name"
  linked=$((linked + 1))
done

echo "synced $linked SAP skills into .claude/skills/"
echo "review the diff before committing: these are read as advice."
