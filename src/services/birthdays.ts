import { listAddressBooks, listContactItems } from './etebase'
import { getContactMemory } from './contactstore'

// A birthday surfaced on the calendar: a contact's vCard BDAY value
// projected to a specific occurrence. The raw BDAY accepts vCard 3.0
// `YYYY-MM-DD`, vCard 4.0 `YYYYMMDD`, and the year-omitted partial
// `--MM-DD` / `--MMDD` form (vCard 4.0 RFC 6350). Free-form values like
// "circa 1990" are skipped — they can't be projected onto the grid.
//
// `month` and `day` are 1-based to match the human reading; `year` is
// the BDAY year (or null for the year-omitted form).
export interface CalBirthday {
  bookUid: string
  contactItemUid: string
  contactName: string
  // Lower-cased categories — match comparisons stay case-insensitive.
  categories: string[]
  month: number
  day: number
  year: number | null
}

// Sentinel used in `hiddenBdayCategories` for contacts with no
// CATEGORIES at all. Lets the user hide "uncategorised" birthdays
// without inventing a real category name.
export const BDAY_UNCATEGORISED = '__uncategorised__'

interface ParsedBday {
  month: number
  day: number
  year: number | null
}

// Strip a vCard BDAY value down to the {month, day, year?} it
// represents, or null if we can't make sense of it. Mirrors the
// regex in ContactCard.formatBirthday but returns structured values.
function parseBday(raw: string): ParsedBday | null {
  const s = raw.trim()
  if (!s) return null
  // YYYY-MM-DD or YYYYMMDD (vCard 3.0 / 4.0 full form).
  let m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})$/)
  if (m) {
    const year = Number(m[1])
    const month = Number(m[2])
    const day = Number(m[3])
    if (!validMonthDay(month, day)) return null
    return { year, month, day }
  }
  // --MM-DD or --MMDD (year-omitted partial form, vCard 4.0).
  m = s.match(/^--(\d{2})-?(\d{2})$/)
  if (m) {
    const month = Number(m[1])
    const day = Number(m[2])
    if (!validMonthDay(month, day)) return null
    return { year: null, month, day }
  }
  return null
}

function validMonthDay(month: number, day: number): boolean {
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  return true
}

// Try the warm contacts cache first (zero network if the user has
// opened contacts this session); fall back to listing from etebase
// otherwise. Categories come straight from the parsed vCard. Failures
// per book are swallowed — birthdays are an enhancement, not a hard
// dependency on the contacts data layer.
export async function loadCalBirthdays(
  signal?: AbortSignal,
): Promise<CalBirthday[]> {
  const mem = getContactMemory()
  const out: CalBirthday[] = []

  // Prefer in-memory cache when populated — the contacts module has
  // already done the work, no need to re-fetch.
  if (mem.addressBooks && mem.contactsByBook.size > 0) {
    for (const book of mem.addressBooks) {
      if (signal?.aborted) return out
      const items = mem.contactsByBook.get(book.uid) ?? []
      for (const it of items) {
        const parsed = parseBday(it.card.birthday)
        if (!parsed) continue
        out.push({
          bookUid: book.uid,
          contactItemUid: it.itemUid,
          contactName: it.card.fn || '(unnamed)',
          categories: it.card.categories.map((c) => c.toLowerCase()),
          month: parsed.month,
          day: parsed.day,
          year: parsed.year,
        })
      }
    }
    return out
  }

  // Cold path — contacts module has never been opened this session.
  // Hit etebase directly.
  const books = await listAddressBooks()
  for (const book of books) {
    if (signal?.aborted) return out
    try {
      const res = await listContactItems(book.uid, { signal })
      for (const it of res.items) {
        const parsed = parseBday(it.card.birthday)
        if (!parsed) continue
        out.push({
          bookUid: book.uid,
          contactItemUid: it.itemUid,
          contactName: it.card.fn || '(unnamed)',
          categories: it.card.categories.map((c) => c.toLowerCase()),
          month: parsed.month,
          day: parsed.day,
          year: parsed.year,
        })
      }
    } catch {
      // Per-book failure (decryption, network, …) — keep going for
      // the rest. Surface elsewhere if needed; the calendar still
      // works without this book's birthdays.
    }
  }
  return out
}

// Distinct categories across all loaded birthdays, sorted A→Z. Used
// to populate the per-category visibility checklist in the calendar
// settings popover. The sentinel BDAY_UNCATEGORISED is appended when
// any birthday has no categories.
export function bdayCategoriesIndex(
  birthdays: readonly CalBirthday[],
): string[] {
  const set = new Set<string>()
  let anyUncategorised = false
  for (const b of birthdays) {
    if (b.categories.length === 0) anyUncategorised = true
    else for (const c of b.categories) set.add(c)
  }
  const out = [...set].sort((a, b) => a.localeCompare(b))
  if (anyUncategorised) out.push(BDAY_UNCATEGORISED)
  return out
}

// Whether a birthday is visible given the user's hidden-categories
// choice. A categorised contact is hidden when EVERY one of its
// categories is in the hidden set; the sentinel hides only the
// uncategorised contacts. This mirrors how the user thinks about
// CATEGORIES — multi-category contacts ("Family", "Close friend")
// should still show as long as at least one tag is on.
export function isBdayVisible(
  b: CalBirthday,
  hidden: ReadonlySet<string>,
): boolean {
  if (b.categories.length === 0) return !hidden.has(BDAY_UNCATEGORISED)
  return b.categories.some((c) => !hidden.has(c))
}
