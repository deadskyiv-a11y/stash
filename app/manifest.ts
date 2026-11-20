import type { MetadataRoute } from "next";

/** Lets Stash be added to a phone's home screen and open full-screen, like an app. */
export default function manifest(): MetadataRoute.Manifest {
  const name = process.env.NEXT_PUBLIC_APP_NAME || "Stash";
  return {
    name,
    short_name: name,
    description: "A private place to save anything and find it again.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
