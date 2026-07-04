import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.hardcoreerik.theorccompanion",
  appName: "TheOrc Companion",
  webDir: "dist",
  plugins: { CapacitorHttp: { enabled: true } },
  server: process.env.CAP_SERVER_URL
    ? {
        androidScheme: "http",
        cleartext: true,
        url: process.env.CAP_SERVER_URL,
      }
    : {
        androidScheme: "http",
        cleartext: true,
      },
};

export default config;
