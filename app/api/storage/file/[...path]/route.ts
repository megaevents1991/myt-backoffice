import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase-server";

export async function GET(
  request: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    const bucket = params.path[0];
    const filePath = params.path.slice(1).join('/');
    
    if (!bucket || !filePath) {
      return NextResponse.json(
        { error: "Missing bucket or file path" },
        { status: 400 }
      );
    }

    // Get the file from Supabase storage
    const { data, error } = await supabase.storage
      .from(bucket)
      .download(filePath);

    if (error) {
      console.error("Error downloading file:", error);
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }

    // Get file info to determine content type
    const { data: fileInfo } = await supabase.storage
      .from(bucket)
      .list(filePath.split('/').slice(0, -1).join('/'), {
        search: filePath.split('/').pop(),
      });

    const file = fileInfo?.[0];
    const contentType = file?.metadata?.mimetype || 'application/octet-stream';

    // Convert blob to array buffer
    const arrayBuffer = await data.arrayBuffer();
    
    return new NextResponse(arrayBuffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error("Error serving file:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
