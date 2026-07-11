/**
 * Allowed action catalog (spec §6) — the ONLY executable actions. Expanding
 * this catalog is itself a Tier 2 decision requiring Abdulla's approval and a
 * new row here; the AI can never propose a free-form action.
 */

export type ActionType =
  | 'notify_abdulla_telegram'
  | 'create_reminder'
  | 'flag_client_churn_risk'
  | 'draft_client_message'
  | 'propose_content_direction_change'
  | 'strategic_decision_package';

type FieldSpec = { name: string; type: 'string' };

type CatalogEntry = {
  tier: 1 | 2 | 3;
  n8nPath: string | null; // null for strategic_decision_package (display only)
  payloadFields: FieldSpec[];
};

export const ACTION_CATALOG: Record<ActionType, CatalogEntry> = {
  notify_abdulla_telegram: { tier: 1, n8nPath: '/webhook/notify', payloadFields: [{ name: 'messageAr', type: 'string' }] },
  create_reminder: {
    tier: 1,
    n8nPath: '/webhook/reminder',
    payloadFields: [
      { name: 'titleAr', type: 'string' },
      { name: 'dueDate', type: 'string' },
    ],
  },
  flag_client_churn_risk: {
    tier: 2,
    n8nPath: '/webhook/notify',
    payloadFields: [
      { name: 'organizationId', type: 'string' },
      { name: 'reasonAr', type: 'string' },
    ],
  },
  draft_client_message: {
    tier: 2,
    n8nPath: '/webhook/notify',
    payloadFields: [
      { name: 'organizationId', type: 'string' },
      { name: 'draftAr', type: 'string' },
    ],
  },
  propose_content_direction_change: {
    tier: 2,
    n8nPath: '/webhook/notify',
    payloadFields: [
      { name: 'organizationId', type: 'string' },
      { name: 'changeAr', type: 'string' },
    ],
  },
  strategic_decision_package: { tier: 3, n8nPath: null, payloadFields: [] },
};

export type ProposedAction = { actionType: ActionType; payload: Record<string, string> };

export class InvalidActionError extends Error {}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validates a proposedAction against the catalog. Throws InvalidActionError — never coerces. */
export function validateProposedAction(raw: unknown): ProposedAction {
  if (!isRecord(raw)) {
    throw new InvalidActionError('proposedAction must be an object');
  }
  const actionType = raw.actionType;
  if (typeof actionType !== 'string' || !(actionType in ACTION_CATALOG)) {
    throw new InvalidActionError(`unknown actionType: ${String(actionType)}`);
  }
  const entry = ACTION_CATALOG[actionType as ActionType];
  const payload = isRecord(raw.payload) ? raw.payload : {};
  const validated: Record<string, string> = {};
  for (const field of entry.payloadFields) {
    const value = payload[field.name];
    if (typeof value !== 'string' || value.length === 0) {
      throw new InvalidActionError(`${actionType}: missing or invalid field "${field.name}"`);
    }
    validated[field.name] = value;
  }
  // Reject extra fields — never store free-form additions to a known action.
  const extra = Object.keys(payload).filter((k) => !entry.payloadFields.some((f) => f.name === k));
  if (extra.length > 0) {
    throw new InvalidActionError(`${actionType}: unexpected payload fields: ${extra.join(', ')}`);
  }
  return { actionType: actionType as ActionType, payload: validated };
}

export function catalogTier(actionType: ActionType): 1 | 2 | 3 {
  return ACTION_CATALOG[actionType].tier;
}
