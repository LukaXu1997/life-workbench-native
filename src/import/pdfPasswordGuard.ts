import { AppState } from 'react-native';
import type { PdfPasswordSession } from './pdfPassword';

/**
 * Tie a password session's lifetime to app visibility. The password is wiped from
 * memory whenever the app moves to the background, satisfying the rule that a PDF
 * password must not survive backgrounding. Returns an unsubscribe function.
 *
 * (Per-component page-destroy clearing is done by the screen's useEffect cleanup;
 *  this guard covers the app-background case.)
 */
export function attachPasswordGuard(session: PdfPasswordSession): () => void {
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'background') session.clear();
  });
  return () => sub.remove();
}
