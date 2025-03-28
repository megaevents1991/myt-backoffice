"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { supabase } from "@/lib/supabase-server"

// Admin credentials from environment variables
const ADMIN_EMAIL = process.env.NEXT_SECRET_ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.NEXT_SECRET_ADMIN_PASSWORD

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error("Missing admin credentials environment variables")
}

export async function signIn(formData: FormData) {
  const email = formData.get("email") as string
  const password = formData.get("password") as string

  // Check if the email matches the admin email
  console.log(email, password);
  
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return {
      error: "Invalid credentials",
      success: false,
    }
  }

  console.log('sent to supabase');

  // Authenticate with Supabase
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    return {
      error: error.message,
      success: false,
    }
  }

  // Set auth cookie
  (await
    // Set auth cookie
    cookies()).set("session", JSON.stringify(data.session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7, // 1 week
    path: "/",
  })

  return { success: true, error: null }
}

export async function signOut() {
  // Clear auth cookie
  (await
    // Clear auth cookie
    cookies()).delete("session")

  // Also sign out from Supabase
  await supabase.auth.signOut()

  redirect("/auth/login")
}

export async function getSession() {
  const sessionCookie = (await cookies()).get("session")

  if (!sessionCookie?.value) {
    return { session: null, user: null }
  }

  try {
    const session = JSON.parse(sessionCookie.value)

    // Verify the session with Supabase
    const { data, error } = await supabase.auth.getUser(session.access_token)

    if (error || !data.user) {
      return { session: null, user: null }
    }

    return {
      session,
      user: data.user,
    }
  } catch (error) {
    console.error("Error parsing session:", error)
    return { session: null, user: null }
  }
}

