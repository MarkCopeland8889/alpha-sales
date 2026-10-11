// Projects: a business or idea with its preset variables, used by jobs and AI prompts
// ({{business_name}} placeholders). Example variables: business_type, business_name,
// business_description, and optional ICP lines (industry, geography, company_size, ...).
import { db } from '../db/index.js';

export const SUGGESTED_VARIABLES = [
  ['business_type', 'Business type', true],
  ['business_name', 'Business name', true],
  ['business_description', 'Business description', true],
  ['industry', 'ICP: industry'],
  ['geography', 'ICP: geography'],
  ['company_size', 'ICP: company size'],
  ['budget', 'ICP: budget'],
  ['buying_process', 'ICP: buying process'],
  ['decision_makers', 'ICP: decision makers'],
  ['pain_points', 'ICP: pain points'],
  ['business_goals', 'ICP: business goals'],
  ['buying_intent', 'ICP: buying intent'],
];

export async function listProjects(accountId) {
  return db.select('projects', { account_id: accountId }, { order: 'created_at', desc: true });
}

export async function saveProject(accountId, data) {
  if (!data.name) throw new Error('Project name is required');
  const row = { name: data.name, description: data.description || null, variables: data.variables || {} };
  if (data.id) {
    const existing = await db.get('projects', data.id);
    if (!existing || existing.account_id !== accountId) throw new Error('Project not found');
    const [saved] = await db.update('projects', { id: data.id, account_id: accountId }, row);
    return saved;
  }
  return db.insert('projects', { account_id: accountId, ...row });
}

export async function deleteProject(accountId, id) {
  await db.remove('projects', { id, account_id: accountId });
}
