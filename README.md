# Standard Notes plugins

Personal plugins for [Standard Notes](https://standardnotes.com). Your notes stay in Standard Notes; these pages only contain the editors' code.

| Plugin | What it does | Install URL |
| --- | --- | --- |
| [Daily Journal](daily-journal/) | One guided journal entry per note: mood, gratitude, focus, free writing, prompt of the day | `https://ahmedakanow.github.io/standard-notes-plugins/daily-journal/ext.json` |
| [Organizer](organizer/) | Notes shaped for what they hold. Todos: stale todos get parked, never lost. People coming next | `https://ahmedakanow.github.io/standard-notes-plugins/organizer/ext.json` |

## Installing a plugin

In Standard Notes on desktop, web or phone, open **Preferences → Plugins → Install Custom Plugin**, paste the plugin's install URL, then pick the plugin from a note's editor menu.

## Development

There's no build step. Each plugin is a folder of plain HTML, CSS and JavaScript, and GitHub Pages serves this repository's `main` branch, so pushing a change publishes it.

```sh
npm install   # once
npm start     # serves the repo at http://localhost:8001
npm test      # unit tests for every plugin
```

`shared/` holds what every plugin needs: `host.js` talks to Standard Notes (including the fix that makes plugins work in the mobile apps) and `vendor/component-relay.js` is Standard Notes' relay library, copied in by `npm run vendor`. Each plugin's README covers trying it locally.
