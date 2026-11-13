// ABOUTME: ESLint flat config for the wewere.online site and its shared visualization code.
// ABOUTME: Runs ESLint and typescript-eslint recommended rules plus the React hooks and refresh checks on TS/TSX.
import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  { ignores: ["dist/**", "**/*.{js,cjs,mjs}"] },
  { files: ["**/*.{ts,tsx}"], ...js.configs.recommended },
  ...tseslint.configs["flat/recommended"],
  {
    files: ["**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      // The site's existing `any` uses are reported but don't fail the lint.
      "@typescript-eslint/no-explicit-any": "warn",
      // An underscore marks a deliberately unused binding.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      // `try { localStorage... } catch {}` is how the site ignores storage
      // that is unavailable.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
