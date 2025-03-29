"use client";

import React from "react";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Folder,
  File,
  Upload,
  Trash2,
  RefreshCw,
  ArrowLeft,
  ExternalLink,
  Download,
  Copy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  getFiles,
  deleteFile,
  getPublicUrl,
  createFolder,
} from "@/lib/actions/storage-actions";
import { FileUploadZone } from "@/components/file-upload-zone";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface StorageClientProps {
  initialBuckets: any[];
  initialBucket: string | null;
  initialPath: string;
}

export function StorageClient({
  initialBuckets,
  initialBucket,
  initialPath,
}: StorageClientProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [buckets, setBuckets] = useState<any[]>(initialBuckets);
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentBucket, setCurrentBucket] = useState<string | null>(
    initialBucket
  );
  const [currentPath, setCurrentPath] = useState<string>(initialPath);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<any | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [filePreviewOpen, setFilePreviewOpen] = useState(false);
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [fileToDelete, setFileToDelete] = useState<string | null>(null);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  // Load files when bucket or path changes
  useEffect(() => {
    async function loadFiles() {
      if (!currentBucket) return;

      setLoading(true);
      try {
        const data = await getFiles(currentBucket, currentPath);
        setFiles(data);
      } catch (error) {
        console.error("Error loading files:", error);
        toast({
          variant: "destructive",
          title: "Error",
          description: "Failed to load files. Please try again.",
        });
      } finally {
        setLoading(false);
      }
    }

    loadFiles();
  }, [currentBucket, currentPath, toast]);

  // Navigate to a bucket or folder
  const navigateTo = (bucket: string, path = "") => {
    setCurrentBucket(bucket);
    setCurrentPath(path);

    // Update URL
    const params = new URLSearchParams();
    params.set("bucket", bucket);
    if (path) params.set("path", path);
    router.push(`/storage?${params.toString()}`);
  };

  // Navigate up one level
  const navigateUp = () => {
    if (!currentPath) {
      // If at root of a bucket, go back to bucket list
      setCurrentBucket(null);
      setCurrentPath("");
      router.push("/storage");
      return;
    }

    // Remove the last folder from the path
    const newPath = currentPath.split("/").slice(0, -1).join("/");
    navigateTo(currentBucket!, newPath);
  };

  // Handle file deletion
  const handleDeleteFile = async (path: string) => {
    if (!currentBucket) return;

    // Check if the confirmation text matches
    const expectedText = "delete this file";
    if (deleteConfirmation.toLowerCase() !== expectedText) {
      toast({
        variant: "destructive",
        title: "Deletion cancelled",
        description: "Please type the confirmation text exactly as shown.",
      });
      return;
    }

    try {
      await deleteFile(currentBucket, path);

      // Refresh the file list
      const data = await getFiles(currentBucket, currentPath);
      setFiles(data);

      toast({
        title: "File deleted",
        description: "The file has been deleted successfully.",
      });

      // Reset state
      setDeleteConfirmation("");
      setFileToDelete(null);
      setIsDeleteDialogOpen(false);
    } catch (error) {
      console.error("Error deleting file:", error);
      toast({
        variant: "destructive",
        title: "Deletion failed",
        description: "Failed to delete file. Please try again.",
      });
    }
  };

  // Handle folder creation
  const handleCreateFolder = async () => {
    if (!currentBucket || !newFolderName) return;

    const folderPath = currentPath
      ? `${currentPath}/${newFolderName}`
      : newFolderName;

    try {
      await createFolder(currentBucket, folderPath);

      // Refresh the file list
      const data = await getFiles(currentBucket, currentPath);
      setFiles(data);

      toast({
        title: "Folder created",
        description: `Folder "${newFolderName}" has been created successfully.`,
      });

      // Reset and close dialog
      setNewFolderName("");
      setNewFolderDialogOpen(false);
    } catch (error) {
      console.error("Error creating folder:", error);
      toast({
        variant: "destructive",
        title: "Creation failed",
        description: "Failed to create folder. Please try again.",
      });
    }
  };

  // Get file URL for preview
  const handleFileClick = async (file: any) => {
    if (!currentBucket) return;

    try {
      const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;
      const url = await getPublicUrl(currentBucket, filePath);
      setFilePreviewUrl(url);
      setSelectedFile(file);
      setFilePreviewOpen(true);
    } catch (error) {
      console.error("Error getting file URL:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to get file URL. Please try again.",
      });
    }
  };

  // Copy URL to clipboard
  const copyUrlToClipboard = () => {
    if (!filePreviewUrl) return;

    navigator.clipboard.writeText(filePreviewUrl);
    toast({
      title: "URL copied",
      description: "File URL has been copied to clipboard.",
    });
  };

  // Refresh current view
  const refreshFiles = async () => {
    if (!currentBucket) return;

    setLoading(true);
    try {
      const data = await getFiles(currentBucket, currentPath);
      setFiles(data);

      toast({
        title: "Refreshed",
        description: "File list has been refreshed.",
      });
    } catch (error) {
      console.error("Error refreshing files:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to refresh files. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  // Generate breadcrumbs
  const generateBreadcrumbs = () => {
    if (!currentBucket) return null;

    const parts = currentPath.split("/").filter(Boolean);

    return (
      <Breadcrumb className="mb-4">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink onClick={() => navigateTo(currentBucket!)}>
              {currentBucket}
            </BreadcrumbLink>
          </BreadcrumbItem>

          {parts.map((part, index) => {
            const path = parts.slice(0, index + 1).join("/");
            return (
              <React.Fragment key={path}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbLink
                    onClick={() => navigateTo(currentBucket!, path)}
                  >
                    {part}
                  </BreadcrumbLink>
                </BreadcrumbItem>
              </React.Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
    );
  };

  // Render file preview
  const renderFilePreview = () => {
    if (!selectedFile || !filePreviewUrl) return null;

    const isImage = selectedFile.metadata?.mimetype?.startsWith("image/");
    const isVideo = selectedFile.metadata?.mimetype?.startsWith("video/");
    const isAudio = selectedFile.metadata?.mimetype?.startsWith("audio/");
    const isPdf = selectedFile.metadata?.mimetype === "application/pdf";

    return (
      <Dialog open={filePreviewOpen} onOpenChange={setFilePreviewOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{selectedFile.name}</DialogTitle>
            <DialogDescription>
              {selectedFile.metadata?.mimetype} •{" "}
              {formatFileSize(selectedFile.metadata?.size || 0)}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center justify-center p-4">
            {isImage && (
              <img
                src={filePreviewUrl || "/placeholder.svg"}
                alt={selectedFile.name}
                className="max-h-[60vh] max-w-full object-contain"
              />
            )}

            {isVideo && (
              <video
                src={filePreviewUrl}
                controls
                className="max-h-[60vh] max-w-full"
              />
            )}

            {isAudio && (
              <audio src={filePreviewUrl} controls className="w-full" />
            )}

            {isPdf && (
              <iframe src={filePreviewUrl} className="h-[60vh] w-full border" />
            )}

            {!isImage && !isVideo && !isAudio && !isPdf && (
              <div className="flex flex-col items-center justify-center p-8">
                <File className="h-16 w-16 text-muted-foreground" />
                <p className="mt-4 text-center text-muted-foreground">
                  Preview not available for this file type
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <div className="flex w-full items-center justify-between">
              <Button variant="outline" onClick={copyUrlToClipboard}>
                <Copy className="mr-2 h-4 w-4" />
                Copy URL
              </Button>

              <div className="flex gap-2">
                <Button variant="outline" asChild>
                  <a
                    href={filePreviewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open
                  </a>
                </Button>

                <Button variant="outline" asChild>
                  <a href={filePreviewUrl} download={selectedFile.name}>
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </a>
                </Button>
              </div>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  };

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";

    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return (
      Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
    );
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {currentBucket && (
            <Button variant="ghost" onClick={navigateUp} className="mr-2">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={refreshFiles} disabled={loading}>
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>

          {currentBucket && (
            <>
              <Dialog
                open={newFolderDialogOpen}
                onOpenChange={setNewFolderDialogOpen}
              >
                <DialogTrigger asChild>
                  <Button variant="outline">
                    <Folder className="mr-2 h-4 w-4" />
                    New Folder
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create New Folder</DialogTitle>
                    <DialogDescription>
                      Enter a name for the new folder.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                    <Label htmlFor="folder-name">Folder Name</Label>
                    <Input
                      id="folder-name"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      placeholder="my-folder"
                      className="mt-2"
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setNewFolderDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleCreateFolder}
                      disabled={!newFolderName}
                    >
                      Create Folder
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog
                open={uploadDialogOpen}
                onOpenChange={setUploadDialogOpen}
              >
                <DialogTrigger asChild>
                  <Button>
                    <Upload className="mr-2 h-4 w-4" />
                    Upload Files
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Upload Files</DialogTitle>
                    <DialogDescription>
                      Upload files to{" "}
                      {currentPath
                        ? `${currentBucket}/${currentPath}`
                        : currentBucket}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                    <FileUploadZone
                      bucket={currentBucket}
                      path={currentPath}
                      onUploadComplete={() => {
                        refreshFiles();
                        setUploadDialogOpen(false);
                      }}
                    />
                  </div>
                </DialogContent>
              </Dialog>
            </>
          )}
        </div>
      </div>

      {currentBucket && generateBreadcrumbs()}

      {currentBucket ? (
        <Card>
          <CardHeader>
            <CardTitle>Files</CardTitle>
            <CardDescription>
              {currentPath
                ? `Folder: ${currentPath}`
                : `Bucket: ${currentBucket}`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : files.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center text-center">
                <Folder className="h-12 w-12 text-muted-foreground" />
                <p className="mt-4 text-muted-foreground">
                  This folder is empty
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                {files.map((file) => {
                  const isFolder = file.id === null;
                  const filePath = currentPath
                    ? `${currentPath}/${file.name}`
                    : file.name;

                  return (
                    <div
                      key={file.name}
                      className="flex items-center justify-between rounded-md p-2 hover:bg-muted"
                    >
                      <div
                        className="flex cursor-pointer items-center gap-2"
                        onClick={() =>
                          isFolder
                            ? navigateTo(currentBucket!, filePath)
                            : handleFileClick(file)
                        }
                      >
                        {isFolder ? (
                          <Folder className="h-5 w-5 text-blue-500" />
                        ) : (
                          <File className="h-5 w-5 text-gray-500" />
                        )}
                        <span>{file.name}</span>

                        {!isFolder && file.metadata && (
                          <span className="text-xs text-muted-foreground">
                            {formatFileSize(file.metadata.size)}
                          </span>
                        )}
                      </div>

                      {!isFolder && (
                        <AlertDialog
                          open={isDeleteDialogOpen && fileToDelete === filePath}
                          onOpenChange={(open) => {
                            setIsDeleteDialogOpen(open);
                            if (!open) {
                              setDeleteConfirmation("");
                              setFileToDelete(null);
                            }
                          }}
                        >
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setFileToDelete(filePath)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Are you absolutely sure?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently delete the file "
                                {file.name}". This action cannot be undone.
                                <div className="mt-4">
                                  <Label
                                    htmlFor="delete-confirmation"
                                    className="text-sm font-medium"
                                  >
                                    Type{" "}
                                    <span className="font-bold">
                                      delete this file
                                    </span>{" "}
                                    to confirm
                                  </Label>
                                  <Input
                                    id="delete-confirmation"
                                    value={deleteConfirmation}
                                    onChange={(e) =>
                                      setDeleteConfirmation(e.target.value)
                                    }
                                    className="mt-2"
                                    placeholder="delete this file"
                                  />
                                </div>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel
                                onClick={() => {
                                  setDeleteConfirmation("");
                                  setFileToDelete(null);
                                }}
                              >
                                Cancel
                              </AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteFile(filePath)}
                                disabled={
                                  deleteConfirmation.toLowerCase() !==
                                  "delete this file"
                                }
                                className={
                                  deleteConfirmation.toLowerCase() !==
                                  "delete this file"
                                    ? "opacity-50 cursor-not-allowed"
                                    : ""
                                }
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Storage Buckets</CardTitle>
            <CardDescription>
              Select a bucket to browse its contents.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {buckets.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center text-center">
                <Folder className="h-12 w-12 text-muted-foreground" />
                <p className="mt-4 text-muted-foreground">No buckets found</p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {buckets.map((bucket) => (
                  <Card
                    key={bucket.name}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigateTo(bucket.name)}
                  >
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg">{bucket.name}</CardTitle>
                      <CardDescription>
                        {bucket.public ? "Public" : "Private"} bucket
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex items-center gap-2">
                        <Folder className="h-5 w-5 text-blue-500" />
                        <span>Browse files</span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {renderFilePreview()}
    </>
  );
}
