import { NativeModules } from 'react-native';

// Thin bridge over the native PdfTextExtractor module. The native side does the
// actual on-device, network-free extraction (pdfbox-android). The password, if
// any, is passed per-call and never persisted by this layer.

const Native = (NativeModules as Record<string, any>).PdfTextExtractor;

export interface ExtractPdfResult {
  /** Extracted text (empty when encrypted or scanned). */
  text: string;
  /** PDF is encrypted and no/wrong password was supplied. */
  encrypted: boolean;
  /** A wrong password was supplied (only meaningful when encrypted=true). */
  wrongPassword: boolean;
  /** No extractable text layer (e.g. a scanned image PDF). */
  scanned: boolean;
}

/** Thrown when the PDF is encrypted; carries whether the password was wrong. */
export class PdfEncryptedError extends Error {
  wrongPassword: boolean;
  constructor(wrongPassword: boolean) {
    super(wrongPassword ? 'PDF 密码错误' : 'PDF 已加密，需要密码');
    this.name = 'PdfEncryptedError';
    this.wrongPassword = wrongPassword;
  }
}

/**
 * Extract text from a PDF given its content URI. `password` is optional and is
 * only used for this single call. Rejects (not resolves) only on hard failures;
 * encryption is reported via the resolved `encrypted` flag.
 */
export async function extractPdfText(uri: string, password?: string): Promise<ExtractPdfResult> {
  if (!Native) throw new Error('PdfTextExtractor native module 不可用');
  const r = (await Native.extractText(uri, password ?? null)) as ExtractPdfResult;
  return r;
}
