/# AGENTS.md

## Prerequisites

-   Node.js >=18 <=20 (Volta pinned to `20.18.0` in package.json)

## Build / Lint / Test

-   Build: `npm run build`
-   Type check: `npx tsc --noEmit`
-   Format: `npm run format`
-   Test (all): `npm test`
-   Test (watch): `npm run test:watch`
-   Test (coverage): `npm run test:coverage`
-   Single test: `npm test -- --testNamePattern="MyTestName"` (replace `MyTestName`)
-   Dead code checks: `npm run check:dead-code`

## Code style (for agents)

-   Imports: group external packages first, a blank line, then project/relative imports.
-   Formatting: run `npm run format` (Prettier config: single quotes, no semicolons, 4-space indent).
-   Naming: `camelCase` for vars/functions, `PascalCase` for classes/types/interfaces, `UPPER_CASE` for constants.
-   Types: prefer explicit TypeScript types and interfaces; avoid `any` unless justified and commented.
-   Async: use `async/await`; avoid mixing Promise chains and callbacks.
-   Errors: catch and wrap errors with context, log meaningful messages (no secrets), avoid throwing raw primitives.
-   Comments: JSDoc for public APIs; short inline comments only when non-obvious.
-   Security: never commit or log secrets (tokens, keys, passwords).

## Repository rules

-   No `.cursor` or Copilot rules detected; if present, include them here for agents to follow.
-   CLAUDE.md may be stale — prefer this AGENTS.md as the single source for agent behavior.
