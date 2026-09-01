// In-memory PDF password session.
//
// The password lives ONLY here, in RAM, for the duration of one parse attempt.
// It is never written to logs, AsyncStorage, SecureStore, or the ImportBatch.
// Clear it on: successful parse, user cancel, hard failure, app background, or
// page destroy (see pdfPasswordGuard for the background hook).

export class PdfPasswordSession {
  private _password: string | null = null;
  private _attempts = 0;
  readonly maxAttempts: number;

  constructor(maxAttempts = 5) {
    this.maxAttempts = Math.max(1, maxAttempts);
  }

  /** Store the password for the current attempt. Overwrites any prior value. */
  set(password: string): void {
    this._password = password;
  }

  /** Read the current password (or null if none). Never logs it. */
  get(): string | null {
    return this._password;
  }

  get attempts(): number {
    return this._attempts;
  }

  get locked(): boolean {
    return this._attempts >= this.maxAttempts;
  }

  /** Record an attempt outcome. Success resets the counter; failure increments. */
  registerAttempt(success: boolean): void {
    if (success) this._attempts = 0;
    else this._attempts = Math.min(this.maxAttempts, this._attempts + 1);
  }

  /** Wipe the password AND the attempt counter from memory. */
  clear(): void {
    this._password = null;
    this._attempts = 0;
  }
}
