"use client";

interface LogoImageProps {
  src: string;
  alt: string;
}

export function LogoImage({ src, alt }: LogoImageProps) {
  return (
    <img
      src={src}
      alt={alt}
      className="h-16 w-auto border rounded"
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = "none";
        const errorMsg = document.createElement("span");
        errorMsg.textContent = "Could not load image";
        errorMsg.className = "text-xs text-red-500";
        (e.target as HTMLImageElement).parentNode?.appendChild(errorMsg);
      }}
    />
  );
}
