// Type-aware lint, kept to rules the code-health ratchet tracks (tools/health.py). The ratchet
// fails only on findings that are not in tools/baselines/eslint.json.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/dist-single/**", "**/build/**", "target/**", ".venv/**"],
  },
  {
    files: ["**/*.ts"],
    ignores: ["**/*.config.ts", "**/*.d.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: { "@typescript-eslint/no-floating-promises": "error" },
  },
);
