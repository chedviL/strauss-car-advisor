/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // מאפשר ייבוא עם סיומת .js שתיפתר ל-.ts/.tsx (ESM NodeNext style),
    // כדי לשמור על ייבוא עקבי בין vitest (NodeNext) ל-Next.
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".jsx": [".tsx", ".jsx"],
    };
    return config;
  },
};

export default nextConfig;