import { beforeEach, describe, expect, it, vi } from 'vitest';

let saveLead: typeof import('../crm').saveLead;
let listLeads: typeof import('../crm').listLeads;

beforeEach(async () => {
  vi.resetModules();
  ({ saveLead, listLeads } = await import('../crm'));
});

describe('saveLead', () => {
  it('stores a lead in memory', () => {
    const lead = saveLead({
      name: 'Jordan Prospect',
      email: 'jordan@example.com',
      phone: '+1-555-777-8888',
      message: 'Curious about deep cleaning.',
    });

    expect(lead.id).toMatch(/^lead_/);
    expect(listLeads()).toHaveLength(1);
  });

  it('requires a name and email', () => {
    expect(() =>
      saveLead({
        name: '',
        email: '',
      }),
    ).toThrow(/name/);
  });
});
