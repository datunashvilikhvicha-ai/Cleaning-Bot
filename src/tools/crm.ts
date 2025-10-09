import { getCrmAdapter, type LeadInput, type LeadRecord } from '../adapters/crm';

export type { LeadInput, LeadRecord } from '../adapters/crm';

export function saveLead(input: LeadInput): LeadRecord {
  return getCrmAdapter().saveLead(input);
}

export function listLeads(): LeadRecord[] {
  return getCrmAdapter().listLeads();
}
