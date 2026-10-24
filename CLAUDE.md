# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

"Liam's NBA Cards" — a kid-friendly web app for learning NBA teams (flip through team cards, then take a quiz). Almost everything is in `index.html`: inline CSS, inline vanilla JS (ES5-style IIFE), and embedded audio. Alongside it are `logos/` (official team logo SVGs, from `https://cdn.nba.com/logos/nba/<NBA team id>/primary/L/logo.svg`) and `apple-touch-icon.png` (the iPad/iPhone home-screen icon, also used as the favicon). There is no build step, package manager, linter or test suite.

**Live site:** https://ozren1983.github.io/nba-app/ — served by GitHub Pages straight from the root of `main` (legacy build), so every push to `main` deploys.

## Running locally

Serve the folder with `python3 -m http.server 8000` and visit http://localhost:8000 (opening `index.html` directly also works). Nothing is fetched at runtime except Google Fonts, and there is no live reload, so refresh after each edit. To try it on a phone or tablet (touch swipe, safe areas, audio), run `python3 -m http.server 8000 --bind 0.0.0.0` and open `http://<mac-LAN-IP>:8000` from a device on the same Wi-Fi.

Because `main` is the live site, do work on a branch and merge to `main` only after checking it locally.

## Working with index.html

The file is ~1.5 MB because **one line is ~1.47 MB**: `<script type="application/json" id="voiceData">`, a JSON map of phrase → `data:audio/mpeg;base64,...`, sitting just before the app `<script>` (line 394 at the time of writing; find it with `grep -n voiceData index.html`). Never read or print that line whole; read the file in ranges that skip it (CSS, then markup, then the app script after it), and edit with targeted string replacements.

## Architecture

- **Team data**: the `TEAMS` array at the top of the app script is the single source of truth. Each entry carries names, city, country/flag, a `logo` path, an emoji `sym` that shows what the name means (with its spoken `symWord`), card colors (`bg`/`fg`/`edge`, applied as `--t-bg`/`--t-fg`/`--t-edge` CSS vars via `teamVars`), palette `colors`, and the kid-level `means` explanation with its Croatian translation `meansHr`. Shelf, cards and quiz are all generated from it.
- **Language (EN/HR)**: the header switch sets `state.lang`. Only the "Why <team>?" story is translated (`meaning(t)` picks `means` or `meansHr`); the heading and the rest of the UI, quiz and audio stay English. `renderLang()` syncs the switch and hides the story's read-aloud button in HR mode when the device has no Croatian voice. The story element gets `lang="hr"`, which switches it to Baloo 2, because Fredoka lacks č, ć and đ. Any other Croatian text needs the same font treatment.
- **Team pictures**: `fillSym()` draws a team's logo on the card, the "Why <team>?" panel, the shelf and the quiz; the emoji `sym` appears only if the logo file fails to load. `picWord()` picks what to say or label for a picture: the full team name for a logo, `symWord` for an emoji. Tapping the card or "Why" logo calls `openZoom()`, which shows the `#zoom` overlay with a big logo; any tap or Escape closes it. Its backdrop is opaque on purpose (see iOS home-screen mode below).
- **Modes**: `setMode()` toggles two `<section>`s, `learn` (cards) and `quiz`. One shared `state` object holds mode, card index, sound flag, language and the current quiz round.
- **Quiz**: `buildRound()` makes `ROUND_LEN` (8) questions: `ROUND_LEN - 1` distinct teams across the `cityToTeam` / `teamToCity` / `findTeam` types, plus one `makeCountryQ()` question about the first non-USA team (currently Raptors/Canada). It reshuffles so the same answer never appears twice in a row. A star is earned only when the first try is correct.
- **Sound**: `say(text, lang)` looks up the exact string in the `voiceData` map and plays the pre-recorded clip; if there is no clip it falls back to the browser's `speechSynthesis` (an en-US voice, or a hr voice for `lang` `"hr"`). There are no Croatian recordings, so Croatian stories are always read by the browser's voice. `chime()` is a WebAudio tone for correct answers. The UI elements marked `.needs-speech` are hidden when neither audio path exists.
- **Persistence**: `localStorage`, keys prefixed `liamNba.` (`sound`, `lang`, `idx`, `best`). A home-screen web app on iOS gets storage separate from Safari's, so these values don't carry over between the two. All storage access is wrapped in try/catch.
- **iOS home-screen mode**: don't add `apple-mobile-web-app-status-bar-style`. Apple has deprecated `black-translucent`, and on iOS/iPadOS 26.1+ it makes the system draw a blur over the top of the page. Without it, iOS colours the status bar from the page. The fixed `.safe-top` strip (solid `--floor`, full width, at least 8px tall) gives iOS a solid colour to sample. Without the strip it samples the transparent fixed `.court` layer and shows a smeared band. `theme-color` matches the floor colour. iOS reads these tags when the app is added to the Home Screen, so verifying a change means removing and re-adding the app.
- **`window.claude.hot`**: the app began as a Claude artifact, and boot hooks into `hot.snapshot`/`hot.ready` when that object exists. On GitHub Pages it doesn't exist, so `boot({})` runs. Keep the fallback working.

## Gotchas when changing content

- **Recorded audio is keyed by exact text.** Phrases are built at runtime (for example `"Yes! The " + t.nick + " play in " + t.city + "!"`, `"That's the " + t.nick + ". Try again!"`, and the end-of-round `"You got N stars! ..."` lines). Changing any team field, template string or `ROUND_LEN` means those phrases no longer match a clip, and they silently fall back to the robotic browser voice. New teams or edited wording need new clips added to `voiceData` under the exact resulting strings. Each team currently has 12 phrases plus its color names; global phrases include `"Which team is from Canada?"`, the 0–8 star results, and `"Sound on!"`.
- The footer text assumes 30 NBA teams in total (`TEAMS.length + " of the 30 NBA teams so far"`).
- Dark mode tokens are defined twice (under `prefers-color-scheme` and under `[data-theme="dark"]`), so update both together.
