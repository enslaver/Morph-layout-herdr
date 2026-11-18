#!/bin/bash
# Claude Code status-line wrapper for the agent-bar mod.
# Saves the JSON Claude Code sends on stdin to ~/.cache/herdr-agent-bar/<terminal>.json
# (keyed by herdr's HC_TERMINAL_ID), then hands the same JSON to the real status line
# command given as arguments (default: ccstatusline), so the terminal looks the same.
in="$(cat)"
if [ -n "${HC_TERMINAL_ID:-}" ]; then
  d="$HOME/.cache/herdr-agent-bar"
  mkdir -p "$d"
  printf '%s' "$in" > "$d/.$HC_TERMINAL_ID.tmp" && mv -f "$d/.$HC_TERMINAL_ID.tmp" "$d/$HC_TERMINAL_ID.json"
fi
[ $# -eq 0 ] && set -- ccstatusline
printf '%s' "$in" | exec "$@"
