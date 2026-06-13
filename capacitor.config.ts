import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.hardcoreerik.theorccompanion",
  appName: "TheOrc Companion",
  webDir: "dist",
  server: {
    androidScheme: "https",
    cleartext: true,
    url: "http://100.112.36.18:3000",
  },
};

export default config;
