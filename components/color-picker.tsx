"use client";

import type React from "react";

import { useState, useEffect, useRef } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ColorPickerProps {
  value: string;
  onChange: (value: string) => void;
  mapImageUrl?: string;
}

export function ColorPicker({
  value,
  onChange,
  mapImageUrl,
}: ColorPickerProps) {
  const [color, setColor] = useState(value || "#000000");
  const [croppedImageUrl, setCroppedImageUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setColor(value || "#000000");
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newColor = e.target.value;
    setColor(newColor);
    onChange(newColor);
  };

  // Function to detect content boundaries and crop the image
  const detectBoundariesAndCrop = (img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size to match image
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;

    // Draw the image
    ctx.drawImage(img, 0, 0);

    // Get image data
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Function to check if a pixel is "content" (not white/transparent)
    const isContentPixel = (r: number, g: number, b: number, a: number) => {
      // Consider pixels that are not white or transparent as content
      const threshold = 250; // Adjust this value if needed
      return a > 10 && (r < threshold || g < threshold || b < threshold);
    };

    // Find bounding box
    let minX = canvas.width;
    let minY = canvas.height;
    let maxX = 0;
    let maxY = 0;

    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const index = (y * canvas.width + x) * 4;
        const r = data[index];
        const g = data[index + 1];
        const b = data[index + 2];
        const a = data[index + 3];

        if (isContentPixel(r, g, b, a)) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    // Add some padding around the content
    const padding = 10;
    minX = Math.max(0, minX - padding);
    minY = Math.max(0, minY - padding);
    maxX = Math.min(canvas.width, maxX + padding);
    maxY = Math.min(canvas.height, maxY + padding);

    // Check if we found any content
    if (minX < maxX && minY < maxY) {
      // Create cropped canvas
      const croppedWidth = maxX - minX;
      const croppedHeight = maxY - minY;

      const croppedCanvas = document.createElement("canvas");
      croppedCanvas.width = croppedWidth;
      croppedCanvas.height = croppedHeight;

      const croppedCtx = croppedCanvas.getContext("2d");
      if (croppedCtx) {
        // Draw the cropped portion
        croppedCtx.drawImage(
          canvas,
          minX,
          minY,
          croppedWidth,
          croppedHeight,
          0,
          0,
          croppedWidth,
          croppedHeight
        );

        // Convert to data URL and set as cropped image
        const croppedDataUrl = croppedCanvas.toDataURL("image/png");
        setCroppedImageUrl(croppedDataUrl);
      }
    } else {
      // If no content boundaries found, use original image
      setCroppedImageUrl(null);
    }
  };

  // Handle image load for boundary detection
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    detectBoundariesAndCrop(img);
  };

  // Reset cropped image when mapImageUrl changes
  useEffect(() => {
    if (!mapImageUrl) {
      setCroppedImageUrl(null);
    }
  }, [mapImageUrl]);

  const presetColors = [
    "#FF0000", // Red
    "#00FF00", // Green
    "#0000FF", // Blue
    "#FFFF00", // Yellow
    "#FF00FF", // Magenta
    "#00FFFF", // Cyan
    "#FFA500", // Orange
    "#800080", // Purple
    "#008000", // Dark Green
    "#000000", // Black
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-start text-left font-normal"
          style={{ backgroundColor: color }}
        >
          <div className="flex items-center gap-2">
            <div
              className="h-4 w-4 rounded border"
              style={{ backgroundColor: color }}
            />
            <span className="flex-1">{color}</span>
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[600px] max-w-[90vw]"
        side="bottom"
        align="start"
        sideOffset={5}
        avoidCollisions={true}
        collisionPadding={20}
      >
        <div className="space-y-4">
          {/* Color Input Section */}
          <div className="space-y-2">
            <Label htmlFor="color">Color</Label>
            <div className="flex gap-2">
              <Input
                id="color"
                type="color"
                value={color}
                onChange={handleChange}
                className="h-10 w-10 cursor-pointer"
              />
              <Input
                type="text"
                value={color}
                onChange={handleChange}
                className="flex-1"
              />
            </div>
          </div>

          {/* Preset Colors */}
          <div className="space-y-2">
            <Label>Preset Colors</Label>
            <div className="flex flex-wrap gap-2">
              {presetColors.map((presetColor) => (
                <Button
                  key={presetColor}
                  variant="outline"
                  className="h-8 w-8 p-0 flex-shrink-0"
                  style={{ backgroundColor: presetColor }}
                  onClick={() => {
                    setColor(presetColor);
                    onChange(presetColor);
                  }}
                />
              ))}
            </div>
          </div>

          {/* Map Image Display */}
          {mapImageUrl && (
            <div className="space-y-3">
              <Label>Map Reference</Label>
              <div className="relative">
                {/* Hidden canvas for image processing */}
                <canvas ref={canvasRef} className="hidden" />

                {/* Hidden original image for boundary detection */}
                <img
                  src={mapImageUrl}
                  alt="Original map for processing"
                  className="hidden"
                  onLoad={handleImageLoad}
                  crossOrigin="anonymous"
                />

                {/* Display cropped image if available, otherwise original */}
                <img
                  src={croppedImageUrl || mapImageUrl}
                  alt="Map reference"
                  className="w-full max-h-[768px] object-contain border rounded"
                  style={{
                    maxWidth: "100%",
                    height: "auto",
                    minHeight: "400px",
                  }}
                  crossOrigin="anonymous"
                />

                {croppedImageUrl && (
                  <div className="mt-2 text-xs text-muted-foreground text-center">
                    ✂️ Auto-cropped to content boundaries
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
