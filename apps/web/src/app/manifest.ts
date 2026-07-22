import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#ffffff",
    description: "A private relationship memory and follow-up assistant.",
    display: "standalone",
    icons: [
      { src: "/icons/tendnote-192.png?asset=v1", sizes: "192x192", type: "image/png" },
      {
        src: "/icons/tendnote-512.png?asset=v1",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/tendnote-512.png?asset=v1",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    name: "Tendnote",
    orientation: "any",
    scope: "/",
    short_name: "Tendnote",
    start_url: "/",
    theme_color: "#315f3a",
  };
}
