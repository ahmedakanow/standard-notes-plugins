// Pure journal logic: no DOM and no Standard Notes APIs, so it can be tested in Node.
// The note text is the source of truth. It is kept as plain Markdown so an entry
// still reads well in any other editor, on mobile, or in an export:
//
//   # Thursday, October 22, 2026
//   Mood: 🙂 Good
//
//   ## Grateful for
//   ...
//
//   ## 💭 What made you smile today?
//   ...

export const MOODS = [
  { id: 'awful', emoji: '😞', label: 'Awful' },
  { id: 'bad', emoji: '😕', label: 'Bad' },
  { id: 'okay', emoji: '😐', label: 'Okay' },
  { id: 'good', emoji: '🙂', label: 'Good' },
  { id: 'great', emoji: '😄', label: 'Great' },
]

export const SECTIONS = [
  { id: 'gratitude', heading: 'Grateful for', placeholder: 'Three things, big or small…', rows: 3 },
  { id: 'focus', heading: "Today's focus", placeholder: 'What would make today a good day?', rows: 2 },
  { id: 'journal', heading: 'Journal', placeholder: 'What happened? How did it feel?', rows: 8 },
]

export const PROMPTS = [
  'What made you smile today?',
  "What's one thing you learned today?",
  'What drained your energy today, and what restored it?',
  'Who are you grateful to have in your life right now, and why?',
  'What would you tell yourself from a year ago?',
  "What's something you're looking forward to?",
  'What challenged you today, and how did you respond?',
  "What's a small win worth celebrating?",
  "What's on your mind that you haven't said out loud?",
  'If today had a title, what would it be?',
  'What did you do today that your future self will thank you for?',
  'What are you avoiding, and why?',
  'When did you feel most like yourself today?',
  "What's something you'd like to let go of?",
  'What surprised you recently?',
  'What does a great tomorrow look like?',
  "What's a decision you're glad you made?",
  'How did you take care of yourself today?',
  'What conversation stuck with you today?',
  'What are you curious about right now?',
  "What's one thing you could simplify in your life?",
  'What would you try if you knew you couldn\'t fail?',
  "What's a habit you're proud of building?",
  'What made today different from yesterday?',
  'Where did you notice something beautiful today?',
  "What's a worry you can put down for tonight?",
  'Who did you help today, or who helped you?',
  'What are you proud of this week?',
  'What do you want to remember about this season of your life?',
  'What would make tomorrow 1% better?',
  "What's been taking up most of your attention lately?",
]

const PROMPT_MARKER = '💭'

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_MS = 24 * 60 * 60 * 1000

const LONG_DATE = new RegExp(`^(?:[a-z]+,\\s*)?(${MONTHS.join('|')})\\s+(\\d{1,2}),\\s*(\\d{4})$`, 'i')
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

const pad = (n) => String(n).padStart(2, '0')

export function createEntry(date = null) {
  return {
    date, // 'YYYY-MM-DD' or null
    mood: null, // a MOODS id or null
    preamble: '', // text before the first section that isn't the date or mood, kept verbatim
    sections: Object.fromEntries(SECTIONS.map((section) => [section.id, ''])),
    prompt: { question: null, answer: '' },
    extras: [], // sections this plugin doesn't know about: { heading, body }
  }
}

/** The local calendar date of a Date object as 'YYYY-MM-DD'. */
export function toIsoDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function isoToUtc(iso) {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

export function describeDate(iso) {
  const date = isoToUtc(iso)
  return {
    weekday: WEEKDAYS[date.getUTCDay()],
    long: `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`,
  }
}

export function formatDateHeading(iso) {
  const { weekday, long } = describeDate(iso)
  return `${weekday}, ${long}`
}

/** Reads 'Thursday, October 22, 2026', 'October 22, 2026' or '2026-10-22'. */
export function parseDateHeading(text) {
  const trimmed = text.trim()
  let year, month, day
  const long = LONG_DATE.exec(trimmed)
  const iso = ISO_DATE.exec(trimmed)
  if (long) {
    month = MONTHS.findIndex((name) => name.toLowerCase() === long[1].toLowerCase()) + 1
    day = Number(long[2])
    year = Number(long[3])
  } else if (iso) {
    ;[year, month, day] = iso.slice(1).map(Number)
  } else {
    return null
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  const isRealDate =
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return isRealDate ? `${year}-${pad(month)}-${pad(day)}` : null
}

/** The prompt for a date. `offset` steps through the list for "another prompt". */
export function promptForDate(iso, offset = 0) {
  const dayNumber = Math.floor(isoToUtc(iso).getTime() / DAY_MS)
  const index = (((dayNumber + offset) % PROMPTS.length) + PROMPTS.length) % PROMPTS.length
  return PROMPTS[index]
}

function findMood(value) {
  const text = value.trim().toLowerCase()
  return (
    MOODS.find((mood) => text.startsWith(mood.emoji)) ??
    MOODS.find((mood) => text === mood.label.toLowerCase())
  )
}

/** Drops leading blank lines and trailing whitespace, keeping indentation inside. */
function tidy(text) {
  return text.replace(/^(?:[ \t]*\n)+/, '').replace(/\s+$/, '')
}

export function parseEntry(text) {
  const entry = createEntry()
  const lines = (text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const preamble = []
  const blocks = []
  let block = null

  for (const line of lines) {
    const sectionHeading = /^##\s+(.*)$/.exec(line)
    if (sectionHeading) {
      block = { heading: sectionHeading[1].trim(), lines: [] }
      blocks.push(block)
      continue
    }
    if (block) {
      block.lines.push(line)
      continue
    }

    const isTopOfNote = preamble.every((previous) => previous.trim() === '')
    const titleHeading = /^#\s+(.*)$/.exec(line)
    if (titleHeading && entry.date === null && isTopOfNote) {
      const date = parseDateHeading(titleHeading[1])
      if (date) {
        entry.date = date
        continue
      }
    }
    const moodLine = /^Mood:\s*(.*)$/i.exec(line)
    const mood = moodLine && entry.mood === null && findMood(moodLine[1])
    if (mood) {
      entry.mood = mood.id
      continue
    }
    preamble.push(line)
  }

  entry.preamble = tidy(preamble.join('\n'))

  // Anything unrecognised, including a repeated heading, is kept as an extra
  // section so switching a note to this editor never drops text.
  const seen = new Set()
  for (const { heading, lines: bodyLines } of blocks) {
    const body = tidy(bodyLines.join('\n'))
    const section = SECTIONS.find((candidate) => candidate.heading.toLowerCase() === heading.toLowerCase())
    if (section && !seen.has(section.id)) {
      seen.add(section.id)
      entry.sections[section.id] = body
    } else if (heading.startsWith(PROMPT_MARKER) && !seen.has('prompt')) {
      seen.add('prompt')
      entry.prompt = { question: heading.slice(PROMPT_MARKER.length).trim() || null, answer: body }
    } else {
      entry.extras.push({ heading, body })
    }
  }

  return entry
}

export function serializeEntry(entry) {
  const header = []
  if (entry.date) header.push(`# ${formatDateHeading(entry.date)}`)
  const mood = MOODS.find((candidate) => candidate.id === entry.mood)
  if (mood) header.push(`Mood: ${mood.emoji} ${mood.label}`)

  const blocks = []
  if (header.length > 0) blocks.push(header.join('\n'))
  if (tidy(entry.preamble)) blocks.push(tidy(entry.preamble))

  for (const section of SECTIONS) {
    const body = tidy(entry.sections[section.id])
    if (body) blocks.push(`## ${section.heading}\n${body}`)
  }

  const answer = tidy(entry.prompt.answer)
  if (answer) {
    const question = entry.prompt.question || (entry.date ? promptForDate(entry.date) : 'Prompt')
    blocks.push(`## ${PROMPT_MARKER} ${question}\n${answer}`)
  }

  for (const extra of entry.extras) {
    const body = tidy(extra.body)
    blocks.push(body ? `## ${extra.heading}\n${body}` : `## ${extra.heading}`)
  }

  return blocks.join('\n\n')
}

export function countWords(text) {
  return text.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*/gu)?.length ?? 0
}

function entryBodies(entry) {
  return [
    entry.sections.journal,
    entry.sections.focus,
    entry.sections.gratitude,
    entry.prompt.answer,
    entry.preamble,
    ...entry.extras.map((extra) => extra.body),
  ]
}

export function countEntryWords(entry) {
  return entryBodies(entry).reduce((total, body) => total + countWords(body), 0)
}

/** Short plain-text summary for the Standard Notes note list. */
export function previewFor(entry, maxLength = 120) {
  const mood = MOODS.find((candidate) => candidate.id === entry.mood)
  const firstBody = entryBodies(entry).find((body) => body.trim()) ?? ''
  const text = [mood?.emoji, firstBody.replace(/\s+/g, ' ').trim()].filter(Boolean).join(' ')
  const characters = Array.from(text)
  return characters.length > maxLength
    ? `${characters.slice(0, maxLength - 1).join('').trimEnd()}…`
    : text
}
