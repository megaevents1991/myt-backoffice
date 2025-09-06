#!/usr/bin/env node
// Standalone script: exact phrase match of events.name → live_events.event_name_heb
// Outputs a JSON report with matches, unmatched, and ambiguous items.

import { createClient } from '@supabase/supabase-js'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

function getClient() {
  const url = 'https://fandqafngybfdyslofmr.supabase.co'
  const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZhbmRxYWZuZ3liZmR5c2xvZm1yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczNjUzODk4NCwiZXhwIjoyMDUyMTE0OTg0fQ.tR5Ajp4HrqiRhFbg8SXXmCC1H0FtI9_X9uV0_zHWYao'

  if (!url || !key) {
    console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL and/or NEXT_SECRET_SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }
  return createClient(url, key, { auth: { persistSession: false } })
}

async function main() {
  const supabase = getClient()
  // Parse args
  let outPath = null
  let apply = false // when true, will update events.tickets_and_rates
  let mode = 'fill' // 'fill' (only missing) | 'force' (overwrite all)
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--out' && i + 1 < process.argv.length) {
      outPath = process.argv[++i]
    } else if (process.argv[i] === '--apply') {
      apply = true
    } else if (process.argv[i] === '--mode' && i + 1 < process.argv.length) {
      const val = String(process.argv[++i]).toLowerCase()
      if (val === 'fill' || val === 'force') mode = val
    }
  }

  // 1) Fetch dynamic live events from events table
  const { data: events, error: eventsErr } = await supabase
    .from('events')
    .select('id,name,type,tickets_and_rates')
    .in('type', ['sports_live_event_dynamic', 'music_live_event_dynamic'])
    .order('id', { ascending: true })

  if (eventsErr) {
    console.error('Error fetching events:', eventsErr.message)
    process.exit(1)
  }

  // Keep only events that have at least one ticket missing eid
  const filteredEvents = (events || []).filter(e => Array.isArray(e.tickets_and_rates) && e.tickets_and_rates.some(t => !t?.eid || String(t.eid).trim() === ''))

  const matches = []
  const unmatched = []
  const ambiguous = []
  const errors = []

  for (const e of filteredEvents) {
    const name = (e?.name || '').trim()
    if (!name) {
      unmatched.push({ event_id: e.id, reason: 'missing_name' })
      continue
    }

    // 2) Exact phrase match only on event_name_heb
    const { data: rows, error } = await supabase
      .from('live_events')
      .select('event_id,event_name_heb')
      .eq('event_name_heb', name)

    if (error) {
      errors.push({ event_id: e.id, name, error: error.message })
      continue
    }

    const count = (rows || []).length
    if (count === 1) {
      matches.push({
        event_id: e.id,
        name,
        live_event_id: rows[0].event_id,
      })
    } else if (count === 0) {
      unmatched.push({ event_id: e.id, name, reason: 'no_match' })
    } else {
      ambiguous.push({ event_id: e.id, name, reason: 'multiple_matches', hits: rows.map(r => r.event_id) })
    }
  }

  // 3) Optionally patch tickets_and_rates for each match
  const patch = { applied: apply, mode, updatedEvents: 0, updates: [], patchErrors: [] }
  if (apply) {
    for (const m of matches) {
      try {
        const { data: row, error: selErr } = await supabase
          .from('events')
          .select('tickets_and_rates')
          .eq('id', m.event_id)
          .single()
        if (selErr) {
          patch.patchErrors.push({ event_id: m.event_id, error: selErr.message })
          continue
        }

        const tickets = Array.isArray(row?.tickets_and_rates) ? row.tickets_and_rates : []
        const eidStr = String(m.live_event_id)
        let changedCount = 0
        const updated = tickets.map(t => {
          const current = (t?.eid ?? '').toString().trim()
          if (mode === 'force') {
            if (current !== eidStr) changedCount++
            return { ...t, eid: eidStr }
          }
          // mode === 'fill'
          if (current === '') {
            changedCount++
            return { ...t, eid: eidStr }
          }
          return t
        })

        if (changedCount === 0) {
          patch.updates.push({ event_id: m.event_id, changed: 0, total: tickets.length, note: 'no changes needed' })
          continue
        }

        const { error: updErr } = await supabase
          .from('events')
          .update({ tickets_and_rates: updated })
          .eq('id', m.event_id)
        if (updErr) {
          patch.patchErrors.push({ event_id: m.event_id, error: updErr.message })
          continue
        }

        patch.updates.push({ event_id: m.event_id, changed: changedCount, total: tickets.length })
      } catch (e) {
        patch.patchErrors.push({ event_id: m.event_id, error: e?.message || String(e) })
      }
    }
    patch.updatedEvents = patch.updates.length
  }

  // 4) Print report
  const report = {
    status: 'ok',
    totals: {
  events: filteredEvents.length,
      matches: matches.length,
      unmatched: unmatched.length,
      ambiguous: ambiguous.length,
      errors: errors.length,
    },
    matches,
    unmatched,
    ambiguous,
    errors,
    patch,
  }

  const json = JSON.stringify(report, null, 2)
  console.log(json)

  // Save to file if requested or default to reports/find-live-eids-<timestamp>.json
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const defaultRel = `reports/find-live-eids-${ts}.json`
  const targetPath = resolve(process.cwd(), outPath || defaultRel)
  const dir = dirname(targetPath)
  await mkdir(dir, { recursive: true })
  await writeFile(targetPath, json, 'utf8')
  console.error(`Report written to: ${targetPath}`)
}

main().catch(err => {
  console.error('Unexpected error:', err?.message || err)
  process.exit(1)
})
