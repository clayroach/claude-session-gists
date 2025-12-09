import ESLint from "@eslint/js"
import tsPlugin from "@typescript-eslint/eslint-plugin"
import tsParser from "@typescript-eslint/parser"
import globals from "globals"

export default [
  {
    ignores: [
      "build/**/*",
      "dist/**/*",
      "coverage/**/*",
      "node_modules/**/*",
      ".tsbuildinfo/**/*"
    ]
  },
  ESLint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.src.json",
        ecmaVersion: 2022,
        sourceType: "module"
      },
      globals: {
        ...globals.node
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/array-type": ["error", { default: "generic" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": "warn",
      "no-unused-vars": "off",
      "no-redeclare": "off",
      "prefer-const": "error",
      "no-fallthrough": "error"
    }
  }
]
