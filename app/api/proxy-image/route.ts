import { NextRequest, NextResponse } from 'next/server'

// Simple image proxy to circumvent browser CORS taint when we need to read pixels.
// Restricts to doctorticket.com hosts for safety.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const target = searchParams.get('url')
  if (!target) {
    return NextResponse.json({ error: 'Missing url param' }, { status: 400 })
  }
  let parsed: URL
  try {
    parsed = new URL(target)
  } catch {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 })
  }
  if (!parsed.hostname.includes('doctorticket.com')) {
    return NextResponse.json({ error: 'Forbidden host' }, { status: 403 })
  }
  try {
    const upstream = await fetch(parsed.toString(), {
      // Add headers if needed (UA, etc.)
      headers: { 'User-Agent': 'MYT-Backoffice-ImageProxy/1.0' },
      cache: 'no-store',
    })
    if (!upstream.ok) {
      return NextResponse.json({ error: 'Upstream error' }, { status: upstream.status })
    }
    const contentType = upstream.headers.get('content-type') || 'image/png'
    const body = await upstream.arrayBuffer()
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (e) {
    console.error('Proxy error', e)
    return NextResponse.json({ error: 'Proxy failure' }, { status: 500 })
  }
}
