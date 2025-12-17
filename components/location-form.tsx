"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { createLocation, updateLocation } from "@/lib/actions/location-actions";
import type {
  Location,
  CreateLocationData,
  UpdateLocationData,
} from "@/types/location.types";

interface LocationFormProps {
  location?: Location;
  onSuccess?: () => void;
}

export function LocationForm({ location, onSuccess }: LocationFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: location?.name || "",
    latitude: location?.latitude?.toString() || "",
    longitude: location?.longitude?.toString() || "",
    city_iata: location?.city_iata || "",
    country_code: location?.country_code || "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Location name is required",
      });
      return;
    }

    const latitude = parseFloat(formData.latitude);
    const longitude = parseFloat(formData.longitude);

    if (isNaN(latitude) || latitude < -90 || latitude > 90) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter a valid latitude (-90 to 90)",
      });
      return;
    }

    if (isNaN(longitude) || longitude < -180 || longitude > 180) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter a valid longitude (-180 to 180)",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const countryCode = formData.country_code.trim();
      if (countryCode && !/^[A-Z]{2}$/.test(countryCode)) {
        toast({
          variant: "destructive",
          title: "Error",
          description: "Country code must be 2 uppercase letters (e.g., US)",
        });
        return;
      }

      const locationData = {
        name: formData.name.trim(),
        latitude,
        longitude,
        city_iata: formData.city_iata.trim() || undefined,
        country_code: countryCode || undefined,
      };

      if (location) {
        // Update existing location
        await updateLocation(location.id, locationData as UpdateLocationData);
        toast({
          title: "Success",
          description: "Location updated successfully",
        });
      } else {
        // Create new location
        await createLocation(locationData as CreateLocationData);
        toast({
          title: "Success",
          description: "Location created successfully",
        });
      }

      if (onSuccess) {
        onSuccess();
      } else {
        router.push("/locations");
      }
    } catch (error) {
      console.error("Error saving location:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: location
          ? "Failed to update location"
          : "Failed to create location",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>
          {location ? "Edit Location" : "Create New Location"}
        </CardTitle>
        <CardDescription>
          {location
            ? "Update the location details below."
            : "Add a new location to the system."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Location Name *</Label>
            <Input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => handleChange("name", e.target.value)}
              placeholder="Enter location name"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="latitude">Latitude *</Label>
              <Input
                id="latitude"
                type="number"
                step="any"
                value={formData.latitude}
                onChange={(e) => handleChange("latitude", e.target.value)}
                placeholder="e.g., 32.0853"
                min="-90"
                max="90"
                required
              />
              <p className="text-xs text-muted-foreground">Range: -90 to 90</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="longitude">Longitude *</Label>
              <Input
                id="longitude"
                type="number"
                step="any"
                value={formData.longitude}
                onChange={(e) => handleChange("longitude", e.target.value)}
                placeholder="e.g., 34.7818"
                min="-180"
                max="180"
                required
              />
              <p className="text-xs text-muted-foreground">
                Range: -180 to 180
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="city_iata">City IATA Code</Label>
            <Input
              id="city_iata"
              type="text"
              value={formData.city_iata}
              onChange={(e) =>
                handleChange("city_iata", e.target.value.toUpperCase())
              }
              placeholder="e.g., TLV"
              maxLength={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="country_code">Country Code</Label>
            <Input
              id="country_code"
              type="text"
              value={formData.country_code}
              onChange={(e) =>
                handleChange("country_code", e.target.value.toUpperCase())
              }
              placeholder="e.g., US"
              maxLength={2}
            />
            <p className="text-xs text-muted-foreground">
              Optional 2-letter ISO code (uppercase)
            </p>
          </div>

          <div className="flex justify-end space-x-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? "Saving..."
                : location
                ? "Update Location"
                : "Create Location"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
