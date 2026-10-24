/** A setup step that failed once. Callers stop; nothing in this package retries it. */
export class SetupError extends Error {
  /**
   * @param {string} message
   * @param {{ step?: string, cause?: unknown }} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = "SetupError";
    this.step = info.step ?? "setup";
    if (info.cause !== undefined) this.cause = info.cause;
  }
}
