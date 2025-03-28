"use server"

import { supabase } from "@/lib/supabase-server"

export async function getDashboardCounts() {
  try {
    // Fetch events count
    const { count: eventsCount, error: eventsError } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })

    if (eventsError) throw eventsError

    // Fetch partners count
    const { count: partnersCount, error: partnersError } = await supabase
      .from("partners")
      .select("*", { count: "exact", head: true })

    if (partnersError) throw partnersError

    // Fetch reservations count
    const { count: reservationsCount, error: reservationsError } = await supabase
      .from("reservations")
      .select("*", { count: "exact", head: true })

    if (reservationsError) throw reservationsError

    // Fetch upcoming events count
    const today = new Date().toISOString()
    const { count: upcomingEventsCount, error: upcomingError } = await supabase
      .from("events")
      .select("*", { count: "exact", head: true })
      .gte("date", today)

    if (upcomingError) throw upcomingError

    return {
      events: eventsCount || 0,
      partners: partnersCount || 0,
      reservations: reservationsCount || 0,
      upcomingEvents: upcomingEventsCount || 0,
    }
  } catch (error) {
    console.error("Error fetching dashboard counts:", error)
    throw error
  }
}

export async function getDashboardStats() {
  try {
    // Calculate total revenue from reservations
    const { data: reservations, error: reservationsError } = await supabase
      .from("reservations")
      .select("user_shown_price")

    if (reservationsError) throw reservationsError

    const totalRevenue = reservations.reduce((sum, reservation) => sum + (reservation.user_shown_price || 0), 0)

    // Get average ticket price from events
    const { data: events, error: eventsError } = await supabase.from("events").select("usual_price")

    if (eventsError) throw eventsError

    const avgTicketPrice =
      events.length > 0 ? events.reduce((sum, event) => sum + (event.usual_price || 0), 0) / events.length : 0

    // Get top partner commission
    const { data: partners, error: partnersError } = await supabase
      .from("partners")
      .select("commission")
      .order("commission", { ascending: false })
      .limit(1)

    if (partnersError) throw partnersError

    const topPartnerCommission = partners.length > 0 ? partners[0].commission : 0

    // Get recent reservations (last 30 days)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const { count, error: recentError } = await supabase
      .from("reservations")
      .select("*", { count: "exact", head: true })
      .gte("created_at", thirtyDaysAgo.toISOString())

    if (recentError) throw recentError

    return {
      totalRevenue,
      avgTicketPrice,
      topPartnerCommission,
      recentReservations: count || 0,
    }
  } catch (error) {
    console.error("Error fetching dashboard stats:", error)
    throw error
  }
}

