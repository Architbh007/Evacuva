import eslint from "@eslint/js";

export default [
  {
    ignores: ["**/coverage/**", "**/node_modules/**"],
  },
  eslint.configs.recommended,
];
