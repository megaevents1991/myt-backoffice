import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { guardAdminRoute } from "@/lib/auth/guards";

// 4 MB file size limit (transparent cut-out PNGs run larger than JPEGs).
const MAX_FILE_SIZE = 4 * 1024 * 1024;

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
    const file = formData.get("file") as File;

    if (!bucket || !file) {
      return NextResponse.json(
        { error: "Missing required parameters" },
        { status: 400 }
      );
    }

    if (!isSafeSegment(bucket) || !isSafeSegment(path) || !isSafeSegment(file.name)) {
      return NextResponse.json(
        { error: "Invalid bucket or path" },
        { status: 400 }
      );
    }

    // Add this check after getting the file from formData:
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB` },
        { status: 400 }
      );
    }

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

    if (error) {
      console.error("Upload error:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    // Revalidate the storage page
    revalidatePath("/storage");

    return NextResponse.json({
      success: true,
      path: filePath,
      data
    });
  } catch (error: any) {
    console.error("Server upload error:", error);
    return NextResponse.json(
      { error: error.message || "Upload failed" },
      { status: 500 }
    );
  }
}