import { env } from '../../config/env';
import type { CrmAdapter } from './types';
import { localCrmAdapter } from './local';

const adapters: Record<string, CrmAdapter> = {
  local: localCrmAdapter,
};

export function getCrmAdapter(): CrmAdapter {
  return adapters[env.CRM_PROVIDER] ?? localCrmAdapter;
}

export type { CrmAdapter, LeadInput, LeadRecord } from './types';
