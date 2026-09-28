import type { NextConfig } from "next";

// The Go API. In Docker it is the `api` service; locally it runs on :8081.
const API_URL = process.env.API_URL ?? "http://127.0.0.1:8081";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // The browser, run.py and curl all talk to one origin (:8080). Everything
  // under /api and /.well-known is the Go API, forwarded untouched.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
      {
        source: "/.well-known/:path*",
        destination: `${API_URL}/.well-known/:path*`,
      },
      { source: "/healthz", destination: `${API_URL}/healthz` },
    ];
  },
  async headers() {
    const base = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
    ];
    return [
      {
        source: "/((?!embed/).*)",
        headers: [
          ...base,
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; form-action 'self'",
          },
        ],
      },
      {
        // The gallery widget exists to be framed by other sites.
        source: "/embed/:path*",
        headers: [
          ...base,
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
    ];
  },
};

export default nextConfig;
