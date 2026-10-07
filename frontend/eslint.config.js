import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  { rules: { "@next/next/no-html-link-for-pages": "off" } },
  {
    files: ["apps/**/*.tsx", "packages/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: "JSXOpeningElement[name.name='select']", message: "Use the shared SelectField so the menu matches the m8itwork web UI." },
        { selector: "JSXOpeningElement[name.name='input']:has(JSXAttribute[name.name='type'][value.value='date'])", message: "Use the shared DateField so the calendar matches the m8itwork web UI." },
      ],
    },
  },
  globalIgnores(["**/.next/**", "coverage/**", "playwright-report/**", "test-results/**", "packages/api-client/src/generated/**", "apps/**/next-env.d.ts"]),
]);
