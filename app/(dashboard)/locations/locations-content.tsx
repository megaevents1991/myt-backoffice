"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import { Plus, Search, Edit, Trash2, MapPin, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getLocations, deleteLocation } from "@/lib/actions/location-actions";
import type { Location } from "@/types/location.types";

export default function LocationsContent() {
  const router = useRouter();
  const { toast } = useToast();
  const [locations, setLocations] = useState<Location[]>([]);
  const [filteredLocations, setFilteredLocations] = useState<Location[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadLocations();
  }, []);

  useEffect(() => {
    // Filter locations based on search term
    const filtered = locations.filter(
      (location) =>
        location.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        location.city_iata?.toLowerCase().includes(searchTerm.toLowerCase())
    );
    setFilteredLocations(filtered);
  }, [locations, searchTerm]);

  const loadLocations = async () => {
    try {
      setIsLoading(true);
      const data = await getLocations();
      setLocations(data);
    } catch (error) {
      console.error("Error loading locations:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load locations",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (location: Location) => {
    try {
      await deleteLocation(location.id);
      toast({
        title: "Success",
        description: "Location deleted successfully",
      });
      await loadLocations();
    } catch (error) {
      console.error("Error deleting location:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to delete location",
      });
    }
  };

  const formatCoordinates = (lat: number, lng: number) => {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="h-4 bg-muted rounded w-1/3 mb-2"></div>
                <div className="h-3 bg-muted rounded w-1/2"></div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with search and create button */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder="Search locations..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button onClick={() => router.push("/locations/new")}>
          <Plus className="h-4 w-4 mr-2" />
          Add Location
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Locations
            </CardTitle>
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{locations.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              With IATA Codes
            </CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {locations.filter((l) => l.city_iata).length}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Filtered Results
            </CardTitle>
            <Search className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{filteredLocations.length}</div>
          </CardContent>
        </Card>
      </div>

      {/* Locations grid */}
      {filteredLocations.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <MapPin className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-lg font-medium text-muted-foreground mb-2">
              {searchTerm ? "No locations found" : "No locations yet"}
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              {searchTerm
                ? "Try adjusting your search terms"
                : "Get started by adding your first location"}
            </p>
            {!searchTerm && (
              <Button onClick={() => router.push("/locations/new")}>
                <Plus className="h-4 w-4 mr-2" />
                Add Location
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredLocations.map((location) => (
            <Card
              key={location.id}
              className="hover:shadow-md transition-shadow"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <CardTitle className="text-lg">{location.name}</CardTitle>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {formatCoordinates(location.latitude, location.longitude)}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        router.push(`/locations/${location.id}/edit`)
                      }
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Location</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete "{location.name}"?
                            This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(location)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2">
                  {location.city_iata && (
                    <Badge variant="secondary" className="text-xs">
                      {location.city_iata}
                    </Badge>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Created {new Date(location.created_at).toLocaleDateString()}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
