# Organizer: a Standard Notes plugin

Notes shaped for what they hold. The first time you open a note with Organizer, you choose what it's for:

- **Todos**: available now
- **People**: coming next

Everything is stored as plain Markdown, so your notes still read well in the plain editor, in exports and on any device. Text Organizer doesn't recognise is kept, never dropped.

## Todos

One note holds all your todos. Put them in **groups** (Home, Work, Trip to Paris…), and label across groups with `#tags` for the filter buttons at the top.

- **Add** with the box at the top, or straight into a group with its **+**. Add `#tag` to label a todo, pick an optional due date, or paste a list to add one todo per line. New todos go to the top.
- **Groups:** **+ New group** at the bottom. A group's **⋯** menu renames, moves or deletes it; deleting a group keeps its todos, ungrouped. Groups start collapsed, showing how many todos they hold and how many are overdue. Tap a group's name to open it. Filtering by a tag or rating opens every group with a match.
- **Your order:** drag a todo by its **⠿** handle, within a group or into another, or use the arrow keys on the handle. A todo's **⋯** menu also has **Group** and **To top / To bottom**. Nothing reorders itself until you tap **Sort** (one group) or **Sort all**, which tidies by: overdue, then high priority, then by due date, then the rest, then low priority, with high value first within each.
- **Priority and value:** from a todo's **⋯** menu, rate its priority (how soon) and value (how much it matters) as High or Low. Both are optional. Once something is rated high, **High priority** and **High value** filter buttons appear next to your tags. Adding a todo while one of them is on rates it high.
- **Stale todos get parked, never lost.** A todo you haven't touched for 14 days moves to **Parked**. Adding, editing or bringing back a todo resets its clock, and todos with a due date are never parked automatically. You can also park a todo yourself from its **⋯** menu.
- **Weekly review:** when there are parked todos, a banner offers a quick review: *Bring back*, *Keep parked*, *Done* or *Delete* for each one. *Not now* asks again in a week.
- **Done** todos are kept, with the date you finished them.
- **Routine:** make a todo repeat from its **⋯** menu, either **every day** or on **chosen days** (say Mon, Wed, Fri). Repeating todos sit in a Routine group at the top and show up only on their days. Ticking one crosses it out for the rest of the day and it comes back the next scheduled day. Each one keeps a 🔥 streak of scheduled days done in a row, which resets if you miss one. They're never parked and don't fill up Done.
- **Settings (⚙︎):** change the 14 days, and whether groups start **Collapsed** or **Expanded**. Settings sync through your Standard Notes account and apply to every Todos note.

In the plain editor a Todos note looks like this:

```markdown
<!-- organizer: todos · reviewed 2026-10-20 -->

- [ ] Work out (2026-10-01, every day, done 2026-10-21, streak 4) #health
- [ ] Stretch (2026-10-01, every mon wed fri)
- [ ] Renew passport (2026-10-01, due 2026-11-15, priority high, value high) #admin

## Home
- [ ] Call the plumber (2026-10-22)
- [ ] Fix the tap (2026-10-20) #weekend

## Parked
- [ ] Learn Spanish (2026-08-01, group Personal)

## Done
- [x] Buy milk (2026-10-20, done 2026-10-21, group Home)
```

Any `## Heading` other than Parked and Done is a group, so typing one on your phone makes a group. Todos are written in your order. Parked and done todos remember their group with a `group Name` detail, and return to it when brought back. The first date is when the todo was last touched. Only the text is required, so a quick `- [ ] buy bread` typed anywhere is a valid todo; Organizer dates it the next time it opens the note. For repeating todos, `every` takes `day`, `weekday` or day names, and the checkbox just shows whether it's done today: tick them in Organizer so the streak counts.

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
