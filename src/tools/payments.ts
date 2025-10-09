import { getPaymentAdapter, type PaymentLinkInput, type PaymentLinkResult } from '../adapters/payments';

export type { PaymentLinkInput, PaymentLinkResult } from '../adapters/payments';

export function generatePaymentLink(input: PaymentLinkInput): PaymentLinkResult {
  return getPaymentAdapter().generatePaymentLink(input);
}
