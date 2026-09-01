// Notification envelope emitted by the native NotificationListenerService and
// consumed by the JS recognizer. Contains only the fields we are allowed to read
// (title/text/bigText extras + package name + post time). The raw text is NEVER
// persisted by JS — only a safe digest (see redact.ts) and extracted fields.

export interface NotifyEnvelope {
  pkg: string;
  title: string;
  text: string;
  bigText: string;
  postedAt: number; // epoch millis from StatusBarNotification.postTime
}

// Result of running a single envelope through a parser.
export type ParsedKind = 'expense' | 'income' | 'unknown';

export interface ParsedNotification {
  amountMinor?: number; // integer minor units of `currency`
  currency?: 'MYR' | 'CNY';
  merchant?: string;
  kind: ParsedKind;
  confidence: number; // 0..1
  bankRef?: string; // bank transaction reference, if extractable
  predictedSettleMinor?: number; // for RMB-credit-card cross-currency spends
  accountHint?: 'myr_ewallet' | 'myr_bank' | 'cny_bank' | 'cny_credit';
}
