import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

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