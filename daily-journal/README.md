# Daily Journal: a Standard Notes plugin

A guided journal editor for Standard Notes. Each note is one day:

- the date, editable if you're writing about another day
- a mood picker (Awful → Great)
- **Grateful for**, **Today's focus** and **Journal** sections
- a **prompt of the day** that rotates by date ("Another prompt" swaps it until you answer)
- a word count with an adjustable daily goal, synced through your Standard Notes account

Entries are saved as plain Markdown, so they still read well in any other editor, in exports and on devices without the plugin:

```markdown
# Thursday, October 22, 2026
Mood: 🙂 Good

## Grateful for
Morning coffee

## Journal
Slow start, but the afternoon was good.

## 💭 What made you smile today?
The dog.
```

Text the plugin doesn't recognise, such as a note you switch over to this editor or a `## Heading` of your own, is kept and shown as an extra section, never dropped.

## Install it

In Standard Notes on desktop, web or phone, open **Preferences → Plugins → Install Custom Plugin** and enter:

```
https://ahmedakanow.github.io/standard-notes-plugins/daily-journal/ext.json
```

Then create a note, open the editor menu and pick **Daily Journal**.

## Work on it locally

```sh
npm install
npm start          # serves this folder at http://localhost:8001 with CORS on
```

- Open <http://localhost:8001> to try it in **preview mode**, which runs outside Standard Notes and keeps one entry in this browser. Add `?demo` for a filled-in example or `?reset` to clear it.
- To try local changes inside Standard Notes, install `http://localhost:8001/ext.local.json`. It shows up as **Daily Journal (local)** next to the published one. If the web app won't load a `localhost` plugin, use the desktop app.

`npm test` runs the unit tests for `src/journal.js`.

## Publish a change

Push to `main` and GitHub Pages republishes within a minute or two. Bump `version` in both `ext.json` and `package.json` when you release changes. Never change `identifier` in `ext.json`, because Standard Notes uses it to link notes to this editor.

## Files

| File | What it does |
| --- | --- |
| `src/journal.js` | Pure logic: Markdown parse/serialize, dates, prompts, word count, preview. No DOM. |
| `src/app.js` | The UI and save flow. |
| `src/hosts.js` | Talks to Standard Notes through ComponentRelay, or to localStorage in preview mode. |
| `src/styles.css` | Styles built on Standard Notes theme variables, so themes apply automatically. |
| `vendor/component-relay.js` | `@standardnotes/component-relay`, copied in by `npm run vendor`. |
