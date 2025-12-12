"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Map as MapIcon } from "lucide-react";

interface DynamicMap {
  name: string;
  path: string;
}

interface DynamicMapsContentProps {
  maps: DynamicMap[];
}

export function DynamicMapsContent({ maps }: DynamicMapsContentProps) {
  const [selectedMap, setSelectedMap] = useState<DynamicMap | null>(null);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    async function fetchSvg() {
      if (!selectedMap) {
        setSvgContent(null);
        return;
      }

      setIsLoading(true);
      try {
        const response = await fetch(selectedMap.path);
        const text = await response.text();
        setSvgContent(text);
      } catch (error) {
        console.error("Failed to load SVG:", error);
        setSvgContent(null);
      } finally {
        setIsLoading(false);
      }
    }

    fetchSvg();
  }, [selectedMap]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Dynamic Maps</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* List of Maps */}
        <Card className="md:col-span-1 h-fit">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <MapIcon className="h-5 w-5" />
              Available Maps
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {maps.length === 0 ? (
              <p className="text-muted-foreground text-sm">No compatible maps found in public folder.</p>
            ) : (
              maps.map((map) => (
                <Button
                  key={map.path}
                  variant={selectedMap?.path === map.path ? "default" : "outline"}
                  className="w-full justify-start"
                  onClick={() => setSelectedMap(map)}
                >
                  {map.name}
                </Button>
              ))
            )}
          </CardContent>
        </Card>

        {/* Map Viewer */}
        <Card className="md:col-span-2 min-h-[500px]">
          <CardHeader>
            <CardTitle>
              {selectedMap ? selectedMap.name : "Select a map"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center min-h-[400px] p-6 bg-white rounded-md border">
            {isLoading ? (
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            ) : svgContent ? (
              <div 
                className="w-full h-full flex items-center justify-center [&>svg]:max-w-full [&>svg]:max-h-[600px] [&>svg]:w-auto [&>svg]:h-auto"
                dangerouslySetInnerHTML={{ __html: svgContent }} 
              />
            ) : (
              <p className="text-muted-foreground">
                {selectedMap ? "Failed to load map" : "Select a map from the list to view it"}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
