import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        // Defense in depth alongside the explicit per-route header already set on media
        // responses: stops a content-sniffing client from executing an uploaded file whose
        // declared MIME type disagrees with a browser's own guess about its bytes.
        source: "/:path*",
        headers: [{ key: "X-Content-Type-Options", value: "nosniff" }],
      },
    ];
  },
};

export default nextConfig;
