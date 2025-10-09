import { env } from '../../config/env';
import { PaymentAdapter } from './types';
import { localPaymentAdapter } from './local';

const adapters: Record<string, PaymentAdapter> = {
  local: localPaymentAdapter,
};

export function getPaymentAdapter(): PaymentAdapter {
  return adapters[env.PAYMENT_PROVIDER] ?? localPaymentAdapter;
}

export type { PaymentLinkInput, PaymentLinkResult, PaymentAdapter } from './types';
