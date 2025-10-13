import { promises as fs } from 'fs';
import path from 'path';

export function createLeadsStore(baseDir) {
  const leadsDir = path.join(baseDir, 'data');
  const leadsPath = path.join(leadsDir, 'leads.json');

  async function ensureFile() {
    try {
      await fs.mkdir(leadsDir, { recursive: true });
      await fs.access(leadsPath);
    } catch {
      await fs.writeFile(leadsPath, '[]', 'utf8');
    }
  }

  async function readAll() {
    await ensureFile();
    const raw = await fs.readFile(leadsPath, 'utf8');
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async function writeAll(leads) {
    await fs.writeFile(leadsPath, JSON.stringify(leads, null, 2), 'utf8');
  }

  async function addLead(entry) {
    const leads = await readAll();
    leads.push({
      ...entry,
      created_at: new Date().toISOString(),
    });
    await writeAll(leads);
    return entry;
  }

  return {
    ensureFile,
    addLead,
    getLeads: readAll,
  };
}
