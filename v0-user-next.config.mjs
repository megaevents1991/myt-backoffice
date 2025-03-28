/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standard Next.js configuration
  images: {
    domains: ['localhost'],
  },
  env: {
    // We don't need to expose any environment variables to the client
    // All server-side environment variables are accessed directly in server components and actions
  },
};

export default nextConfig;

