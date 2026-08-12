"use client";

import type React from "react";
import { useState, useRef } from "react";
import { Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { uploadToBucket } from "@/lib/upload-helper";

interface FileUploadZoneProps {
  bucket: string;
  path: string;
  onUploadComplete: () => void;
}

export function FileUploadZone({
  bucket,
  path,
  onUploadComplete,
}: FileUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    if (!e.dataTransfer.files || !e.dataTransfer.files.length) return;

    await handleFiles(Array.from(e.dataTransfer.files));
  };

  const handleFileInputChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (!e.target.files || !e.target.files.length) return;

    await handleFiles(Array.from(e.target.files));

    // Reset the file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  // Upload a file directly to Supabase Storage (signed URL - no 4.5 MB
  // Vercel function body limit, so large images no longer fail at the edge).
  const uploadFileToServer = async (file: File): Promise<{ success: boolean; error?: string }> => {
    try {
      await uploadToBucket(bucket, path, file);
      return { success: true };
    } catch (error) {
      console.error("Upload error:", error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  };

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;

    setIsUploading(true);
    setProgress(0);
    let successCount = 0;
    const errors: { name: string; message: string }[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const result = await uploadFileToServer(file);
      if (result.success) {
        successCount++;
      } else {
        errors.push({ name: file.name, message: result.error ?? "Unknown error" });
      }
      // Update progress
      setProgress(Math.round(((i + 1) / files.length) * 100));
    }

    setIsUploading(false);

    // Show toast with results
    if (successCount > 0) {
      toast({
        title: "Upload complete",
        description: `Successfully uploaded ${successCount} file${
          successCount !== 1 ? "s" : ""
        }${errors.length > 0 ? `, ${errors.length} failed` : ""}.`,
      });

      // Refresh the file list
      onUploadComplete();
    }

    if (errors.length > 0) {
      const description =
        errors.length === 1
          ? `${errors[0].name}: ${errors[0].message}`
          : errors.map((e) => `${e.name}: ${e.message}`).join("\n");
      toast({
        variant: "destructive",
        title: `Upload failed (${errors.length} file${errors.length !== 1 ? "s" : ""})`,
        description,
      });
    }
  };

  const handleButtonClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  return (
    <div
      className={`relative flex min-h-[200px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors ${
        isDragging
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/25"
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleButtonClick}
    >
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        onChange={handleFileInputChange}
        multiple
      />

      <div className="flex flex-col items-center justify-center text-center">
        <Upload
          className={`mb-4 h-10 w-10 ${
            isUploading ? "animate-pulse text-primary" : "text-muted-foreground"
          }`}
        />

        {isUploading ? (
          <div className="w-full space-y-2">
            <p className="text-sm font-medium">
              Uploading files... {progress}%
            </p>
            <div className="h-2 w-full rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300 ease-in-out"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <p className="mb-2 text-sm font-medium">
              Drag and drop files here, or click to select files
            </p>
            <p className="text-xs text-muted-foreground">
              Upload multiple files at once
            </p>
          </>
        )}
      </div>
    </div>
  );
}
