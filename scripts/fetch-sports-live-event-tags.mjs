#!/usr/bin/env node
// Script: fetch-sports-live-event-tags.mjs
// Fetches all events of type 'sports_live_event_dynamic' and outputs their tags as JSON.

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
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--out' && i + 1 < process.argv.length) {
      outPath = process.argv[++i]
    }
  }

  // Fetch all sports_live_event_dynamic events
  const { data: events, error } = await supabase
    .from('events')
    .select('id,name,tags')
    .eq('type', 'sports_live_event_dynamic')
    .order('id', { ascending: true })

  if (error) {
    console.error('Error fetching events:', error.message)
    process.exit(1)
  }

  // Prepare output: id, name, tags
  const output = (events || []).map(e => ({
    id: e.id,
    name: e.name,
    tags: e.tags || []
  }))

  const json = JSON.stringify(output, null, 2)
  console.log(json)

  // Save to file if requested or default to reports/sports-live-event-tags-<timestamp>.json
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const defaultRel = `reports/sports-live-event-tags-${ts}.json`
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
