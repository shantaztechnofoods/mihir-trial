#!/usr/bin/env bash
# SHANTAZ ERP — code map: where things live in the screen code (instant, always current).
# Since 2026-11-04 the former single src/App.jsx is split into src/app (shell), src/modules/<module>
# and src/shared — see docs/ARCHITECTURE.md. Output is file:line.
#   scripts/code-map.sh              pages + modals + components, by file
#   scripts/code-map.sh <word>       only lines containing <word> (case-insensitive): components, handlers, data-attributes, labels
#   scripts/code-map.sh --handlers   all handleXxx functions (they live in src/app/App.jsx)
#   scripts/code-map.sh --modules    module folders and their files
cd "$(dirname "$0")/.."
F="src/app src/modules src/shared"
G(){ grep -rn --include='*.js' --include='*.jsx' "$@" $F; }
case "${1:-}" in
  --handlers) G "const handle[A-Z][A-Za-z]* = " | sed -E 's/^([^:]+:[0-9]+):\s*const (handle[A-Za-z]*).*/\1  \2/' ;;
  --modules) for d in src/app src/modules/* src/shared; do echo "== $d"; find "$d" -name '*.js*' | sort | sed 's/^/   /'; done ;;
  "") echo "== nav page -> component =="; G -E "^export (default )?function [A-Z][A-Za-z]*Page\b" | sed -E 's/^([^:]+:[0-9]+):export (default )?function ([A-Za-z]+).*/\1  \3/'
      echo; echo "== modals / drawers =="; G -E "^export function [A-Z][A-Za-z]*(Modal|Drawer)\b" | sed -E 's/^([^:]+:[0-9]+):export function ([A-Za-z]+).*/\1  \2/'
      echo; echo "== other components =="; G -E "^export function [A-Z]" | grep -v -E "Page\b|Modal\b|Drawer\b" | sed -E 's/^([^:]+:[0-9]+):export function ([A-Za-z]+).*/\1  \2/'
      echo; echo "== shared helpers (const/arrow at top level) =="; G -E "^export const [a-z][A-Za-z]* = \(" | sed -E 's/^([^:]+:[0-9]+):export const ([A-Za-z]+).*/\1  \2/' | head -60
      echo; echo "tip: scripts/code-map.sh <word>   e.g. 'transfer', 'accept', 'pending', 'rack', 'delete'" ;;
  *) G -i -- "$1" | cut -c1-200 | head -80 ;;
esac
