# Morph-layout-herdr

A Herdr layout: the Prompts layout with the Answered tree. Every question your agents ask in a space
shows in one panel, and "Answered" lists the last prompts you sent with the questions and answers
that followed.

## Install

Copy `layouts/Morph-layout-herdr.json` to `~/.config/herdr-app/layouts/`, every folder in `mods/` to
`~/.config/herdr-app/mods/`, and merge `keys.json` into yours. Switch with `ctrl-shift-l`.

## Settings

`~/.config/herdr-app/asks.json`: `prompts` sets how many recent prompts the Answered tree shows (default 10).
