import eslint from "@eslint/js";

export default [
  {
    ignores: ["**/coverage/**", "**/node_modules/**"],
  },
  eslint.configs.recommended,
  {
    files: ["apps/dashboard/**/*.js"],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  },
];
