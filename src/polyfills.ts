// Node-core polyfills for the Unified Importer.
//
// `iconv-lite` (GB18030 decoding for Alipay CSV) is written for Node and expects
// `Buffer` to exist as a global. React Native / Hermes does not provide one, so
// we install the `buffer` package's implementation before ANY module that could
// reach iconv-lite loads. `string_decoder` is a separate npm polyfill package.
//
// IMPORTANT: this module must remain the FIRST import in `index.js`. ES imports
// execute in source order, so importing it first guarantees the globals exist by
// the time the app graph (and thus src/import/charset.ts) evaluates.

import { Buffer } from 'buffer';

const g = globalThis as unknown as Record<string, unknown>;

if (!g.Buffer) {
  g.Buffer = Buffer;
}
