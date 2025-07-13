"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { FileUploadZone } from "@/components/file-upload-zone";
import { getFiles, getPublicUrl } from "@/lib/actions/storage-actions";
import {
  FolderOpen,
  Upload,
  Check,
  ImageIcon,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import type { FileObject } from "@supabase/storage-js";

interface ImageFilePickerProps {
  value: string;
  onChange: (url: string) => void;
  label: string;
  bucketName?: string;
  folder?: string;
}

export function ImageFilePicker({
  value,
  onChange,
  label,
  bucketName = "card-images",
  folder = "",
}: ImageFilePickerProps) {
  const { toast } = useToast();
  const [isOpen, setIsOpen] = useState(false);
  const [files, setFiles] = useState<FileObject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("select");

  const loadFiles = async () => {
    try {
      setIsLoading(true);
      const filesData = await getFiles(bucketName, folder);

      // Filter only image files
      const imageFiles = filesData.filter((file) => {
        const isImage =
          file.metadata?.mimetype?.startsWith("image/") ||
          file.name.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
        return isImage && file.name !== ".folder";
      });

      setFiles(imageFiles);
    } catch (error) {
      console.error("Error loading files:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load files from storage",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const refreshFiles = async () => {
    setIsRefreshing(true);
    await loadFiles();
    setIsRefreshing(false);
  };

  const handleFileSelect = async (fileName: string) => {
    try {
      const fileUrl = await getPublicUrl(
        bucketName,
        folder ? `${folder}/${fileName}` : fileName
      );
      setSelectedFile(fileUrl);
    } catch (error) {
      console.error("Error getting file URL:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to get file URL",
      });
    }
  };

  const handleConfirmSelection = () => {
    if (selectedFile) {
      onChange(selectedFile);
      setIsOpen(false);
      setSelectedFile("");
      toast({
        title: "Success",
        description: "Image URL has been updated",
      });
    }
  };

  const handleUploadComplete = () => {
    toast({
      title: "Upload Complete",
      description: "File has been uploaded successfully",
    });
    refreshFiles();
    // Switch to the Select File tab to show the newly uploaded file
    setActiveTab("select");
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  useEffect(() => {
    if (isOpen) {
      setActiveTab("select"); // Reset to select tab when opening
      loadFiles();
    }
  }, [isOpen]);

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter image URL or select from storage"
          className="flex-1"
        />
        <Button
          variant="outline"
          size="icon"
          type="button"
          onClick={() => value && window.open(value, "_blank")}
          disabled={!value}
          title="Open image in new tab"
        >
          <ExternalLink className="h-4 w-4" />
        </Button>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="icon" type="button">
              <FolderOpen className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
            <DialogHeader>
              <DialogTitle>Select Image File</DialogTitle>
              <DialogDescription>
                Choose an existing file from storage or upload a new one
              </DialogDescription>
            </DialogHeader>

            <Tabs
              value={activeTab}
              onValueChange={setActiveTab}
              className="flex-1 flex flex-col"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="select" className="flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" />
                  Select File
                </TabsTrigger>
                <TabsTrigger value="upload" className="flex items-center gap-2">
                  <Upload className="h-4 w-4" />
                  Upload New
                </TabsTrigger>
              </TabsList>

              <TabsContent value="select" className="flex-1 overflow-hidden">
                <div className="flex flex-col h-full min-h-0">
                  <div className="flex justify-between items-center mb-4 flex-shrink-0">
                    <p className="text-sm text-muted-foreground">
                      {files.length} image file(s) found in {bucketName}/
                      {folder || "root"}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={refreshFiles}
                      disabled={isRefreshing}
                    >
                      <RefreshCw
                        className={`h-4 w-4 mr-2 ${
                          isRefreshing ? "animate-spin" : ""
                        }`}
                      />
                      Refresh
                    </Button>
                  </div>

                  <ScrollArea
                    className="flex-1 min-h-0 overflow-auto"
                    style={{ maxHeight: "400px" }}
                  >
                    <div className="pr-4">
                      {isLoading ? (
                        <div className="flex items-center justify-center h-32">
                          <RefreshCw className="h-6 w-6 animate-spin" />
                        </div>
                      ) : files.length > 0 ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {files.map((file) => (
                            <Card
                              key={file.id}
                              className={`cursor-pointer transition-all hover:shadow-md ${
                                selectedFile.includes(file.name)
                                  ? "ring-2 ring-primary"
                                  : ""
                              }`}
                              onClick={() => handleFileSelect(file.name)}
                            >
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm truncate">
                                  {file.name}
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="pt-0">
                                <div className="aspect-video bg-muted rounded-md mb-2 flex items-center justify-center overflow-hidden">
                                  <img
                                    src={`/api/storage/file/${bucketName}/${
                                      folder ? `${folder}/` : ""
                                    }${file.name}`}
                                    alt={file.name}
                                    className="max-w-full max-h-full object-cover"
                                    onError={(e) => {
                                      e.currentTarget.style.display = "none";
                                      e.currentTarget.nextElementSibling?.setAttribute(
                                        "style",
                                        "display: flex"
                                      );
                                    }}
                                  />
                                  <div className="hidden items-center justify-center h-full">
                                    <ImageIcon className="h-8 w-8 text-muted-foreground" />
                                  </div>
                                </div>
                                <div className="space-y-1 text-xs text-muted-foreground">
                                  <div>
                                    Size:{" "}
                                    {formatFileSize(file.metadata?.size || 0)}
                                  </div>
                                  <div>
                                    Modified:{" "}
                                    {formatDate(file.updated_at || "")}
                                  </div>
                                </div>
                                {selectedFile.includes(file.name) && (
                                  <div className="flex items-center gap-1 text-primary text-xs mt-2">
                                    <Check className="h-3 w-3" />
                                    Selected
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          ))}{" "}
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                          <ImageIcon className="h-12 w-12 mb-2" />
                          <p>No image files found</p>
                          <p className="text-xs">
                            Upload some images to get started
                          </p>
                        </div>
                      )}
                    </div>
                  </ScrollArea>
                </div>
              </TabsContent>

              <TabsContent value="upload" className="flex-1">
                <div className="h-full">
                  <FileUploadZone
                    bucket={bucketName}
                    path={folder}
                    onUploadComplete={handleUploadComplete}
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Supported formats: JPG, PNG, GIF, WebP, SVG
                  </p>
                </div>
              </TabsContent>
            </Tabs>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleConfirmSelection} disabled={!selectedFile}>
                Use Selected File
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {value && (
        <div className="mt-2">
          <div className="aspect-video w-32 bg-muted rounded-md overflow-hidden">
            <img
              src={value}
              alt="Preview"
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.style.display = "none";
                e.currentTarget.nextElementSibling?.setAttribute(
                  "style",
                  "display: flex"
                );
              }}
            />
            <div className="hidden w-full h-full items-center justify-center">
              <ImageIcon className="h-8 w-8 text-muted-foreground" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
