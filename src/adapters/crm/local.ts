import { CrmAdapter, LeadInput, LeadRecord } from './types';

const leads: LeadRecord[] = [];

function assertNonEmpty(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required`);
  }
}

function createLeadId(): string {
  return `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export const localCrmAdapter: CrmAdapter = {
  saveLead(input: LeadInput): LeadRecord {
    assertNonEmpty(input.name, 'name');
    assertNonEmpty(input.email, 'email');

    const lead: LeadRecord = {
      ...input,
      id: createLeadId(),
      createdAt: new Date().toISOString(),
    };

    leads.push(lead);
    return lead;
  },
  listLeads(): LeadRecord[] {
    return [...leads];
  },
};
