import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "منوی کافه ران",
    short_name: "Run Café",
    description: "منوی دیجیتال کافه ران",
    start_url: "/",
    display: "standalone",
    background_color: "#12100d",
    theme_color: "#12100d",
    lang: "fa",
    dir: "rtl",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
