// src/lib/utils/config.ts

interface Config {
  apiUrl: string;
}

const config: Config = {
  // Development override for local testing
  apiUrl: import.meta.env.VITE_API_URL || "http://127.0.0.1:8000",

  // Production API endpoint - HTTPS required for Chrome Web Store
  // apiUrl: "https://api.faultmaven.ai"
};

export default config;
