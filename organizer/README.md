# Organizer: a Standard Notes plugin

Notes shaped for what they hold. The first time you open a note with Organizer, you choose what it's for:

- **Todos**: available now
- **People**: coming next

Everything is stored as plain Markdown, so your notes still read well in the plain editor, in exports and on any device. Text Organizer doesn't recognise is kept, never dropped.

## Todos

One note holds all your todos. Group them with `#tags` and use the filter buttons at the top.

- **Add** with the box at the top. Add `#tag` to group a todo, pick an optional due date, or paste a list to add one todo per line.
- **Order:** overdue first, then by due date, then newest first.
- **Stale todos get parked, never lost.** A todo you haven't touched for 14 days moves to **Parked**. Adding, editing or bringing back a todo resets its clock, and todos with a due date are never parked automatically. You can also park a todo yourself from its **⋯** menu.
- **Weekly review:** when there are parked todos, a banner offers a quick review: *Bring back*, *Keep parked*, *Done* or *Delete* for each one. *Not now* asks again in a week.
- **Done** todos are kept, with the date you finished them.
- **Settings (⚙︎):** change the 14 days. The setting syncs through your Standard Notes account and applies to every Todos note.

In the plain editor a Todos note looks like this:

```markdown
<!-- organizer: todos · reviewed 2026-10-20 -->

- [ ] Renew passport (2026-10-01, due 2026-11-15) #admin
- [ ] Call the plumber (2026-10-22) #home

## Parked
- [ ] Learn Spanish (2026-08-01) #personal

## Done
- [x] Buy milk (2026-10-20, done 2026-10-21) #home
```

The first date is when the todo was last touched. Only the text is required, so a quick `- [ ] buy bread` typed anywhere is a valid todo; Organizer dates it the next time it opens the note.

## Install it

In Standard Notes on desktop, web or phone, open **Preferences → Plugins → Install Custom Plugin** and enter:

```
https://ahmedakanow.github.io/standard-notes-plugins/organizer/ext.json
```

Then create a note, open the editor menu and pick **Organizer**. The first time, Standard Notes asks to let it access the note: choose **Continue**.

## Work on it locally

From the repository root, `npm install` once, then `npm start`.

- <http://localhost:8001/organizer/> runs it in **preview mode** outside Standard Notes. Add `?demo` for a filled-in list or `?reset` to start over.
- To try local changes inside Standard Notes, install `http://localhost:8001/organizer/ext.local.json`. It shows up as **Organizer (local)**.

`npm test` runs the unit tests. Bump `version` in `ext.json` when you release changes, and never change `identifier`.

## Files

| File | What it does |
| --- | --- |
| `src/app.js` | Loads the note, shows the template picker or the template, and saves. |
| `src/templates.js` | The list of templates and how each one parses, saves and draws its note. |
| `src/note.js` | The `<!-- organizer: … -->` marker line. |
| `src/todos.js` | Todos rules and plain-text format. No DOM. |
| `src/todos-view.js` | The Todos screen. |
| `src/dates.js`, `src/dom.js` | Small date and DOM helpers. |
