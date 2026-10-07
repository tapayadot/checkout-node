export class PaymentError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    /** True when a charge may have been submitted. Check the status before paying again. */
    public readonly submitted = false,
  ) {
    super(message)
    this.name = 'PaymentError'
  }
}
