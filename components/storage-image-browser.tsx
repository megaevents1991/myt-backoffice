"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { FileUploadZone } from "@/components/file-upload-zone";
import {
  listAllBucketImages,
  type StorageImage,
} from "@/lib/actions/storage-actions";
import { Check, ImageIcon, RefreshCw, Search, Upload } from "lucide-react";

const ALL = "__all__";

export function StorageImageBrowser({
  trigger,
  multiple = false,
  uploadBucket = "templates",
  uploadFolder = "",
  onConfirm,
}: {
  trigger: React.ReactNode;
  multiple?: boolean;
  uploadBucket?: string;
  uploadFolder?: string;
  onConfirm: (urls: string[]) => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState<StorageImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [bucket, setBucket] = useState<string>(ALL);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState("select");

  const load = async () => {
    setLoading(true);
    try {
      setImages(await listAllBucketImages());
    } catch (error) {
      console.error(error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load images from storage",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setTab("select");
      setSelected(new Set());
      setSearch("");
      setBucket(ALL);
      load();
    }
  }, [open]);

  const buckets = useMemo(
    () => Array.from(new Set(images.map((i) => i.bucket))).sort(),
    [images],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return images.filter(
      (i) =>
        (bucket === ALL || i.bucket === bucket) &&
        (!q ||
          i.name.toLowerCase().includes(q) ||
          i.path.toLowerCase().includes(q)),
    );
  }, [images, bucket, search]);

  const toggle = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (multiple) {
        if (next.has(url)) next.delete(url);
        else next.add(url);
      } else {
        next.clear();
        next.add(url);
      }
      return next;
    });
  };

  const confirm = () => {
    if (selected.size === 0) return;
    onConfirm(Array.from(selected));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-4xl h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Select image{multiple ? "s" : ""} from storage</DialogTitle>
          <DialogDescription>
            Browse and search across all storage buckets, or upload a new file.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
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

          <TabsContent value="select" className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="flex flex-col h-full min-h-0">
              <div className="flex flex-wrap items-center gap-2 mb-3 flex-shrink-0">
                <Select value={bucket} onValueChange={setBucket}>
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All storages</SelectItem>
                    {buckets.map((b) => (
                      <SelectItem key={b} value={b}>
                        {b}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="relative flex-1 min-w-[12rem]">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8"
                    placeholder="Search filename across all buckets…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Button variant="outline" size="sm" onClick={load} disabled={loading}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>

              <ScrollArea className="flex-1 min-h-0">
                <div className="pr-4">
                  {loading ? (
                    <div className="flex items-center justify-center h-32">
                      <RefreshCw className="h-6 w-6 animate-spin" />
                    </div>
                  ) : visible.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {visible.map((img) => {
                        const isSel = selected.has(img.url);
                        return (
                          <button
                            key={`${img.bucket}::${img.path}`}
                            type="button"
                            onClick={() => toggle(img.url)}
                            className={`relative text-left rounded-md border overflow-hidden transition-all hover:shadow-md ${
                              isSel ? "ring-2 ring-primary" : ""
                            }`}
                          >
                            <div className="aspect-video bg-muted flex items-center justify-center overflow-hidden">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={img.url}
                                alt={img.name}
                                className="max-w-full max-h-full object-cover"
                                onError={(e) => {
                                  e.currentTarget.style.visibility = "hidden";
                                }}
                              />
                            </div>
                            <div className="p-2">
                              <p className="text-xs font-medium truncate">{img.name}</p>
                              <p className="text-[10px] text-muted-foreground truncate">
                                {img.bucket}
                              </p>
                            </div>
                            {isSel && (
                              <span className="absolute top-1 right-1 rounded-full bg-primary text-primary-foreground p-1">
                                <Check className="h-3 w-3" />
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                      <ImageIcon className="h-12 w-12 mb-2" />
                      <p>No image files found</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="upload" className="flex-1">
            <FileUploadZone
              bucket={uploadBucket}
              path={uploadFolder}
              onUploadComplete={() => {
                setTab("select");
                load();
              }}
            />
            <p className="text-xs text-muted-foreground mt-2">
              Uploads go to the <code>{uploadBucket}</code> bucket. Supported: JPG, PNG, GIF, WebP, SVG.
            </p>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex-shrink-0">
          <span className="mr-auto self-center text-sm text-muted-foreground">
            {multiple ? `${selected.size} selected` : ""}
          </span>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={selected.size === 0}>
            {multiple ? "Add selected" : "Use selected"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
