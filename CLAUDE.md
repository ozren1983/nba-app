# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

"Liam's NBA Cards" — a kid-friendly web app for learning NBA teams (flip through team cards, then take a quiz). It is a single self-contained `index.html`: inline CSS, inline vanilla JS (ES5-style IIFE), and embedded audio. There is no build step, package manager, linter or test suite.

**Live site:** https://ozren1983.github.io/nba-app/ — served by GitHub Pages straight from the root of `main` (legacy build), so every push to `main` deploys.

## Running locally

Serve the folder with `python3 -m http.server 8000` and visit http://localhost:8000 (opening `index.html` directly also works). Nothing is fetched at runtime except Google Fonts, and there is no live reload, so refresh after each edit. To try it on a phone or tablet (touch swipe, safe areas, audio), run `python3 -m http.server 8000 --bind 0.0.0.0` and open `http://<mac-LAN-IP>:8000` from a device on the same Wi-Fi.

Because `main` is the live site, do work on a branch and merge to `main` only after checking it locally.

## Working with index.html

The file is ~1.5 MB because **line 390 is a single ~1.47 MB line**: `<script type="application/json" id="voiceData">`, a JSON map of phrase → `data:audio/mpeg;base64,...`. Never read or print that line whole; read the file in ranges that skip it (CSS ≈ lines 14–257, markup ≈ 259–388, app script ≈ 391–end), and edit with targeted string replacements.

## Architecture

- **Team data**: the `TEAMS` array at the top of the app script is the single source of truth. Each entry carries names, city, country/flag, an emoji `sym` plus its spoken `symWord`, card colors (`bg`/`fg`/`edge`, applied as `--t-bg`/`--t-fg`/`--t-edge` CSS vars via `teamVars`), palette `colors`, and the kid-level `means` explanation. Shelf, cards, quiz and the pictures screen are all generated from it.
- **Modes**: `setMode()` toggles three `<section>`s — `learn` (cards), `quiz`, and `pics` (a grown-up screen for replacing team emojis with uploaded photos). One shared `state` object holds mode, card index, sound flag and the current quiz round.
- **Quiz**: `buildRound()` makes `ROUND_LEN` (8) questions: `ROUND_LEN - 1` distinct teams across the `cityToTeam` / `teamToCity` / `findTeam` types, plus one `makeCountryQ()` question about the first non-USA team (currently Raptors/Canada). It reshuffles so the same answer never appears twice in a row. A star is earned only when the first try is correct.
- **Sound**: `say(text)` looks up the exact string in the `voiceData` map and plays the pre-recorded clip; if there is no clip it falls back to the browser's `speechSynthesis`. `chime()` is a WebAudio tone for correct answers. The UI elements marked `.needs-speech` are hidden when neither audio path exists.
- **Persistence**: `localStorage`, keys prefixed `liamNba.` (`sound`, `idx`, `best`, `pic.<nick>`). Uploaded pictures are downscaled to ≤320px PNG data URLs before they are stored. All storage access is wrapped in try/catch.
- **`window.claude.hot`**: the app began as a Claude artifact, and boot hooks into `hot.snapshot`/`hot.ready` when that object exists. On GitHub Pages it doesn't exist, so `boot({})` runs. Keep the fallback working.

## Gotchas when changing content

- **Recorded audio is keyed by exact text.** Phrases are built at runtime (for example `"Yes! The " + t.nick + " play in " + t.city + "!"`, `"That's the " + t.nick + ". Try again!"`, and the end-of-round `"You got N stars! ..."` lines). Changing any team field, template string or `ROUND_LEN` means those phrases no longer match a clip, and they silently fall back to the robotic browser voice. New teams or edited wording need new clips added to `voiceData` under the exact resulting strings. Each team currently has 12 phrases plus its color names; global phrases include `"Which team is from Canada?"`, the 0–8 star results, and `"Sound on!"`.
- The footer text assumes 30 NBA teams in total (`TEAMS.length + " of the 30 NBA teams so far"`).
- Dark mode tokens are defined twice (under `prefers-color-scheme` and under `[data-theme="dark"]`), so update both together.
