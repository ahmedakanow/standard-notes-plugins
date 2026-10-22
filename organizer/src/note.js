// An Organizer note starts with a marker line naming its template, plus optional
// settings for that template:
//
//   <!-- organizer: todos · reviewed 2026-10-20 -->

const MARKER = /^<!--\s*organizer:(.*?)-->$/

export function splitNote(text) {
  const normalized = (text ?? '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const first = lines.findIndex((line) => line.trim() !== '')
  const match = first === -1 ? null : MARKER.exec(lines[first].trim())
  if (!match) return { template: null, meta: {}, body: normalized }

  const [template, ...pairs] = match[1].split('·').map((part) => part.trim())
  const meta = {}
  for (const pair of pairs.filter(Boolean)) {
    const [key, ...value] = pair.split(/\s+/)
    meta[key] = value.join(' ')
  }
  return { template: template || null, meta, body: lines.slice(first + 1).join('\n') }
}

export function joinNote({ template, meta = {}, body = '' }) {
  const pairs = Object.entries(meta)
    .filter(([, value]) => value != null && value !== '')
    .map(([key, value]) => `${key} ${value}`)
  const marker = `<!-- organizer: ${[template, ...pairs].join(' · ')} -->`
  const content = body.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '')
  return content ? `${marker}\n\n${content}` : marker
}
