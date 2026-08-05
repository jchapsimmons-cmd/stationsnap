import type { MetadataRoute } from "next";

/**
 * PWA manifest, served by Next.js at /manifest.webmanifest. Icons are minimal
 * placeholders generated from the Nocturne design tokens (--color-bg,
 * --color-primary) — replace public/icons/*.png with real design assets under
 * design/ once available, matching the existing "visual tokens must remain
 * easy to replace" guidance in README.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "StationSnap",
    short_name: "StationSnap",
    description: "Restaurant SOPs and training, ready where the work happens.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#161826",
    theme_color: "#161826",
    orientation: "any",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
