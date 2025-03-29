"use client";

import type React from "react";

import { useState, useRef } from "react";
import { Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { uploadFileToSupabase } from "@/lib/client-upload";

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

  const handleFiles = async (files: File[]) => {
    if (!files.length) return;

    setIsUploading(true);
    setProgress(0);
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        await uploadFileToSupabase(bucket, path, file);
        successCount++;
        // Update progress
        setProgress(Math.round(((i + 1) / files.length) * 100));
      } catch (error) {
        console.error(`Error uploading file ${file.name}:`, error);
        errorCount++;
      }
    }

    setIsUploading(false);

    // Show toast with results
    if (successCount > 0) {
      toast({
        title: "Upload complete",
        description: `Successfully uploaded ${successCount} file${
          successCount !== 1 ? "s" : ""
        }${errorCount > 0 ? `, ${errorCount} failed` : ""}.`,
      });

      // Refresh the file list
      onUploadComplete();
    } else if (errorCount > 0) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: `Failed to upload ${errorCount} file${
          errorCount !== 1 ? "s" : ""
        }.`,
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
