export interface LeadInput {
  name: string;
  email: string;
  phone?: string;
  message?: string;
  preferredContactMethod?: 'email' | 'phone';
  metadata?: Record<string, unknown>;
}

export interface LeadRecord extends LeadInput {
  id: string;
  createdAt: string;
}

export interface CrmAdapter {
  saveLead(input: LeadInput): LeadRecord;
  listLeads(): LeadRecord[];
}
