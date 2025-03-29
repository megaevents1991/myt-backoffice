import { Suspense } from "react";
import { StorageClient } from "./storage-client";
import { getBuckets } from "@/lib/actions/storage-actions";

export default async function StoragePage({
  searchParams,
}: {
  searchParams: { bucket?: string; path?: string };
}) {
  // Fetch buckets on the server
  const { bucket } = await searchParams;
  const { path } = await searchParams;
  const buckets = await getBuckets();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Storage</h1>
        <p className="text-muted-foreground">
          Manage your files and assets in Supabase Storage.
        </p>
      </div>

      <Suspense fallback={<div>Loading storage...</div>}>
        <StorageClient
          initialBuckets={buckets}
          initialBucket={bucket || null}
          initialPath={path || ""}
        />
      </Suspense>
    </div>
  );
}
