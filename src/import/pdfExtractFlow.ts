// Pure orchestration for the encrypted-PDF unlock + extract flow.
//
// Kept free of React Native so it can be unit-tested with injected fakes. The UI
// supplies `extract` (which calls the native module) and `onNeedPassword` (which
// shows the password dialog). The flow guarantees the password is never persisted:
// it is held only by the injected session and cleared on every terminal outcome.

import type { ExtractPdfResult } from '../native/PdfTextExtractor';
import type { PdfPasswordSession } from './pdfPassword';

export interface PdfFlowDeps {
  /** Calls the native extractor. Should read the password from `session`. */
  extract: (uri: string, session: PdfPasswordSession) => Promise<ExtractPdfResult>;
  /** UI callback: show the password dialog. Returns the entered password, or
   *  null if the user cancelled. `wrongPassword` tells the UI to show an error. */
  onNeedPassword: (wrongPassword: boolean) => Promise<string | null>;
  /** In-memory password holder; cleared by this flow on every terminal outcome. */
  session: PdfPasswordSession;
  /** URI of the PDF to extract. */
  uri: string;
}

export interface PdfFlowOutcome {
  ok: boolean;
  text?: string;
  /** Scanned (no text layer) PDF — caller shows "暂不支持扫描件". */
  scanned?: boolean;
  /** User cancelled the password prompt (or attempts exhausted). */
  cancelled?: boolean;
  reason?: string;
}

/**
 * Run the extract flow:
 *  1. Try without a password.
 *  2. If encrypted, ask the UI for a password (up to maxAttempts times).
 *  3. On success return text; on scanned return scanned; on cancel/lock return cancelled.
 * The session is cleared in every terminal branch.
 */
export async function runPdfExtractFlow(deps: PdfFlowDeps): Promise<PdfFlowOutcome> {
  const { extract, onNeedPassword, session, uri } = deps;
  let askedBefore = false;

  while (true) {
    let result: ExtractPdfResult;
    try {
      result = await extract(uri, session);
    } catch (e) {
      session.clear();
      return { ok: false, reason: e instanceof Error ? e.message : 'PDF 解析失败' };
    }

    if (!result.encrypted) {
      session.clear();
      if (result.scanned) {
        return { ok: false, scanned: true, reason: '当前PDF没有可提取文本，暂不支持扫描件' };
      }
      return { ok: true, text: result.text };
    }

    // Encrypted: need a password.
    const password = await onNeedPassword(askedBefore && result.wrongPassword);
    if (password === null) {
      session.clear();
      return { ok: false, cancelled: true, reason: '已取消输入密码' };
    }
    if (session.locked) {
      session.clear();
      return { ok: false, cancelled: true, reason: '密码尝试次数过多，已停止' };
    }
    session.set(password);
    session.registerAttempt(false); // will be reset to 0 on eventual success
    askedBefore = true;
  }
}
