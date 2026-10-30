/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Always build into the default `.next` directory. A configurable distDir
  // (previously driven by NEXT_DIST_DIR) could point Render's build and start
  // steps at different folders and surface as a 404 on every route.
  webpack: (config, { dev }) => {
    if (dev) {
      // Keep the project-local Node/npm toolchain out of the dev watcher so
      // `d:\yt2blog\.tools` (thousands of files) never stalls compilation.
      config.watchOptions = {
        ...config.watchOptions,
        ignored: ["**/.tools/**", "**/.next/**", "**/node_modules/**"],
      };
    }
    return config;
  },
};

export default nextConfig;
