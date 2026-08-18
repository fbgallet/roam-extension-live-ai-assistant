/**
 * Ambient module declarations.
 *
 * Style sheets are imported for their side effect (webpack injects them), but
 * TypeScript has no declaration for them, so every `import "./x.css"` in a .tsx
 * file is reported as TS2882 "no type declarations for this side-effect import".
 * These declarations tell TS such imports are legitimate and carry no value.
 */

declare module "*.css";
declare module "*.scss";
