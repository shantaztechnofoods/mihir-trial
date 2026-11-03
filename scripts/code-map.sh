#!/usr/bin/env bash
# SHANTAZ ERP — code map: where things live in the one big src/App.jsx (instant, always current).
#   scripts/code-map.sh              pages + modals + components with line numbers
#   scripts/code-map.sh <word>       only lines containing <word> (case-insensitive): components, handlers, data-attributes, labels
#   scripts/code-map.sh --handlers   all handleXxx functions
cd "$(dirname "$0")/.."
F=src/App.jsx
case "${1:-}" in
  --handlers) grep -n "const handle[A-Z][A-Za-z]* = " $F | sed -E 's/^([0-9]+):\s*const (handle[A-Za-z]*).*/\1  \2/' ;;
  "") echo "== nav page -> component =="; grep -n "^function [A-Z][A-Za-z]*Page\b" $F | sed -E 's/^([0-9]+):function ([A-Za-z]+).*/\1  \2/'
      echo; echo "== modals / drawers =="; grep -n "^function [A-Z][A-Za-z]*\(Modal\|Drawer\)\b" $F | sed -E 's/^([0-9]+):function ([A-Za-z]+).*/\1  \2/'
      echo; echo "== other components =="; grep -n "^function [A-Z]" $F | grep -v "Page\b\|Modal\b\|Drawer\b" | sed -E 's/^([0-9]+):function ([A-Za-z]+).*/\1  \2/'
      echo; echo "== shared helpers (const/arrow at top level) =="; grep -n "^const [a-z][A-Za-z]* = (" $F | sed -E 's/^([0-9]+):const ([A-Za-z]+).*/\1  \2/' | head -60
      echo; echo "tip: scripts/code-map.sh <word>   e.g. 'transfer', 'accept', 'pending', 'rack', 'delete'" ;;
  *) grep -n -i -- "$1" $F | cut -c1-170 | head -80 ;;
esac
