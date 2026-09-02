/// <reference types="expo/types" />

// Asset module declarations (fonts/images). expo/types in SDK 52 does not declare
// these, so tsc would otherwise fail on `import X from './assets/...ttf'` etc.
// Metro/Babel resolves them at build time; this is only for type-checking.
declare module '*.ttf' {
  const src: number;
  export default src;
}
declare module '*.png' {
  const src: number;
  export default src;
}
declare module '*.jpg' {
  const src: number;
  export default src;
}
declare module '*.jpeg' {
  const src: number;
  export default src;
}
declare module '*.gif' {
  const src: number;
  export default src;
}
declare module '*.webp' {
  const src: number;
  export default src;
}
declare module '*.svg' {
  const src: number;
  export default src;
}
