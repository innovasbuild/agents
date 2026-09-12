#!/bin/sh
if test -d ~/.claude/skills/gstack/bin; then
  echo GSTACK_OK
  exit 0
else
  echo GSTACK_MISSING
  echo "gstack no esta instalado. Instala gstack antes de continuar."
  exit 1
fi
