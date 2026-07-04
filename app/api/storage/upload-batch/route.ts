import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { guardAdminRoute } from "@/lib/auth/guards";

// Reject path traversal / absolute paths so an upload can't escape its folder.
function isSafeSegment(s: string): boolean {
  return !s.includes("..") && !s.startsWith("/") && !s.includes("\\");
}

export async function POST(request: NextRequest) {
  try {
    // Validate the signed admin session (was a forgeable cookie-presence check).
    const denied = await guardAdminRoute();
    if (denied) return denied;

    const formData = await request.formData();
    const bucket = formData.get("bucket") as string;
    const path = formData.get("path") as string || "";

    // Process multiple files
    const files: File[] = [];
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("files")) {
        files.push(value as File);
      }
    }

    if (!bucket || files.length === 0) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    if (
      !isSafeSegment(bucket) ||
      !isSafeSegment(path) ||
      files.some((f) => !isSafeSegment(f.name))
    ) {
      return NextResponse.json(
        { error: "Invalid bucket or path" },
        { status: 400 }
      );
    }

    // Upload each file
    const results = [];
    for (const file of files) {
      // Create file path
      const filePath = path ? `${path}/${file.name}` : file.name;

      // Convert file to buffer
      const buffer = await file.arrayBuffer();

      // Upload to Supabase
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(filePath, buffer, {
          contentType: file.type,
          upsert: false,
        });

      results.push({
        filename: file.name,
        success: !error,
        path: filePath,
        error: error ? error.message : null,
        data,
      });
    }

    // Revalidate the storage page
    revalidatePath("/storage");

    return NextResponse.json({
      success: true,
      results
    });
  } catch (error: any) {
    console.error("Server batch upload error:", error);
    return NextResponse.json(
      { error: error.message || "Batch upload failed" },
      { status: 500 }
    );
  }
}