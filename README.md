# Morph-layout-herdr

A Herdr layout: the Prompts layout with the Prompts tree. Every question your agents ask in a space
shows in one panel, and "Prompts" lists the last prompts you sent with the questions and answers
that followed.

## Install

Copy `layouts/Morph-layout-herdr.json` to `~/.config/herdr-app/layouts/`, every folder in `mods/` to
`~/.config/herdr-app/mods/`, and merge `keys.json` into yours. Switch with `ctrl-shift-l`.

The bottom of the sidebar shows Claude Code usage today (tokens and API-equivalent cost), from `mods/claude-usage`; it reads `~/.claude/projects` and the plan limits every five minutes.

## Settings

`~/.config/herdr-app/settings.json`: `morph` holds this mod's keys, so herdr's own keys in the same file stay as they are. `morph.prompts` sets how many recent prompts the Prompts tree shows (default 10). `morph.usage_minutes` sets how often the Claude usage checks run (default 5, minimum 1). Other keys: `morph.debug`, `morph.classifier`, `morph.group_spaces_by_machine`.
