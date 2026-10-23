import { mountNotebook } from './notebook-view.js'
import { parseNotebook, previewNotebook, serializeNotebook } from './notebook.js'
import { mountTodos } from './todos-view.js'
import { normalizeTodos, parseTodos, previewTodos, serializeTodos } from './todos.js'

// What a note can be. Each template turns the note body into a model (`parse`), applies
// its rules (`refresh`, returning whether anything changed), turns the model back into
// Markdown (`serialize`), summarises it for the note list (`preview`) and draws it (`mount`).
export const TEMPLATES = [
  {
    id: 'todos',
    name: 'Todos',
    icon: '☑️',
    blurb: 'Things to do. Stale ones get parked, never lost.',
    parse: (body, meta) => parseTodos(body, meta),
    refresh: (model, ctx) => normalizeTodos(model, ctx),
    serialize: (model, ctx) => serializeTodos(model, ctx.today),
    preview: (model, ctx) => previewTodos(model, ctx.today),
    mount: mountTodos,
  },
  {
    id: 'notebook',
    name: 'Notebook',
    icon: '📓',
    blurb: 'One topic, organized into sections you can browse.',
    parse: (body) => parseNotebook(body),
    refresh: () => false,
    serialize: (model) => serializeNotebook(model),
    preview: (model, ctx) => previewNotebook(model, ctx.today),
    mount: mountNotebook,
  },
  {
    id: 'people',
    name: 'People',
    icon: '👥',
    blurb: 'Coming next.',
    available: false,
  },
]
