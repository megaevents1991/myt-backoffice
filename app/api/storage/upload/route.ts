import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

// 0.5 MB file size limit
const MAX_FILE_SIZE = 0.5 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    // Check for session cookie to ensure user is authenticated
    const session = (await cookies()).get("session");
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

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