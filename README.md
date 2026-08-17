# Ledger — a minimal personal finance tracker

Plain HTML / CSS / JavaScript. No frameworks, no build step, no dependencies.

## Features
- **Add income & expenses** with categories (plus one-tap "new category")
- **Monthly budget summary**: income, expenses, net, savings rate, and per-category budgets with progress bars — click a budget number to set/change it
- **Charts by category**: donut of spending for the month + 6-month income vs expense trend (hand-drawn canvas, no chart library)
- **Search & filters**: full-text search over note/category/amount (`/` focuses it), type / category / date-scope filters, sorting, pagination. Clicking any category chip or donut legend entry filters the list.
- **Validation**: positive amounts, required date (no future dates), required category, inline error messages
- Edit and delete any row (with undo via toast); keyboard shortcuts: `n` new transaction, `/` search

## Storage — one JSON file
The whole ledger lives in a single `data.json`:

    { "version": 1, "transactions": [ {id,type,category,amount,date,note,createdAt} ], "budgets": {...}, "categories": {...} }

How the app decides where that file lives (in this order):

| Situation | What happens |
|---|---|
| Run via `python server.py` | **server mode** — every save is a PUT that atomically rewrites `data.json` next to the app. Badge shows `saved in this folder`. |
| Opened directly, first visit | You can hit **Export**; modern Chromium browsers link a real `data.json` via the File System Access API and keep saving to it (badge: *saving to data.json*). Firefox/Safari fall back below. |
| Fallback (any browser) | Data stays in the browser's localStorage; **Export / Import** move the same `data.json` format around manually. |

Switching between modes merges by transaction id, so nothing is lost.

## Run it
```bash
python server.py          # then open http://127.0.0.1:8321
```
or just open `index.html` in a browser (fallback storage).

An empty ledger offers **Load sample data** — good for trying the charts and budgets before entering real numbers.

## Files
- `index.html` · `styles.css` · `app.js` — the entire app
- `server.py` — optional stdlib-only server that writes `data.json`
- `data.json` — your ledger (created on first save)
