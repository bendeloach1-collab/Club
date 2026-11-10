import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "node_modules/**", "drizzle/**", "next-env.d.ts", "e2e/**"] },
  ...nextVitals,
  ...nextTs,
];
export default config;
