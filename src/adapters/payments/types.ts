export interface PaymentLinkInput {
  bookingId: string;
  amount: number;
  currency: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface PaymentLinkResult {
  url: string;
  bookingId: string;
  amount: number;
  currency: string;
  createdAt: string;
  expiresAt: string;
}

export interface PaymentAdapter {
  generatePaymentLink(input: PaymentLinkInput): PaymentLinkResult;
}
