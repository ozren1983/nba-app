# Liam's NBA Cards

A kid-friendly app for learning NBA teams: flip through team cards, then take a quiz.

**Play it:** https://ozren1983.github.io/nba-app/

## Install on iPad or iPhone

Open the link in Safari, tap the Share button, then **Add to Home Screen**. It gets a basketball icon named "NBA Cards" and opens full screen like an app.

## Run locally

The whole app is a single `index.html` with no build step.

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Deploy

GitHub Pages serves the root of `main`, so pushing to `main` updates the live site.
