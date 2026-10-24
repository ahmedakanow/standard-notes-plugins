# Standard Notes plugins

Personal plugins for [Standard Notes](https://standardnotes.com). Your notes stay in Standard Notes; these pages only contain the editors' code.

| Plugin | What it does | Install URL |
| --- | --- | --- |
| [Organizer](organizer/) | Notes shaped for what they hold. Todos: a routine with streaks, groups, stale todos parked instead of lost. Notebook: one topic in one note, organized into sections. People coming next | `https://ahmedakanow.github.io/standard-notes-plugins/organizer/ext.json` |

## Installing a plugin

In Standard Notes on desktop, web or phone, open **Preferences → Plugins → Install Custom Plugin**, paste the plugin's install URL, then pick the plugin from a note's editor menu.

## Development

There's no build step. Each plugin is a folder of plain HTML, CSS and JavaScript, and GitHub Pages serves this repository's `main` branch, so pushing a change publishes it.

```sh
npm install           # once
npm start             # serves the repo at http://localhost:8001
npm test              # unit tests for every plugin
npm run test:browser  # browser checks inside a fake Standard Notes (needs Chrome or Edge)
npm run test:hosted   # checks the published plugins load from GitHub Pages
```

The browser checks in `tests/e2e/` drive each plugin in a real browser inside `tests/e2e/harness/`, a stand-in for Standard Notes that speaks the same messaging protocol, including an Android mode that replays how the mobile app talks to plugins. Set `CHROME_PATH` if your browser isn't found.

`shared/` holds what every plugin needs: `host.js` talks to Standard Notes (including the fix that makes plugins work in the mobile apps) and `vendor/component-relay.js` is Standard Notes' relay library, copied in by `npm run vendor`. Each plugin's README covers trying it locally.
