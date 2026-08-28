#!/usr/bin/env bash
#
# Makes the SAP skills reachable from this repository WITHOUT copying them.
#
# They are GPL-3.0 (maintained by Eduard Jiglau, sap-ai-skills.com) and this
# repository is MIT and public. Copying them in would be a licence violation:
# GPL-3.0 is copyleft and MIT is not compatible in that direction. Using
# software triggers no obligation; distributing it triggers all of them — so
# these are symlinks, and .claude/skills/ is gitignored.
#
# The three kspf-* skills are KONE-specific and deliberately not linked.
#
# Usage:  scripts/link-sap-skills.sh [source-directory]
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
  ln -sfn "$skill" "$TARGET/$name"
  linked=$((linked + 1))
done

echo "linked $linked SAP skills into .claude/skills/"
echo "they are symlinks, and .claude/skills/ is gitignored — nothing GPL-3.0"
echo "is committed by this."
