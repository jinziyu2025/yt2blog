/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Lets us build/start a production bundle next to a running dev server
  // without touching the dev `.next` directory. Render uses the default.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
