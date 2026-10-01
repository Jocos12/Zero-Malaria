import Dexie, { type Table } from 'dexie';
import type { LocalReferral, SyncQueueItem, TriageInput } from '../types';

export type LocalCase = {
  id?: number;
  client_uuid: string;
  input: TriageInput;
  decision: string;
  reasons: string[];
  created_at: string;
  synced: boolean;
};

/** In-progress guided triage draft (local only; API has no timing fields). */
export type TriageDraft = {
  id: string;
  form: TriageInput;
  answered: string[];
  stepIndex: number;
  ageUnit: 'months' | 'years';
  freeText: string;
  startedAt: string;
  stepAnsweredAt: Record<string, string>;
  updatedAt: string;
};

/** Fixed TTS phrases for the assistant avatar (never live mic recordings). */
export type AvatarAudioCache = {
  id: string;
  lang: string;
  text: string;
  blob: Blob;
  updatedAt: string;
};

class ZeroMalariaDB extends Dexie {
  cases!: Table<LocalCase, number>;
  referrals!: Table<LocalReferral, number>;
  syncQueue!: Table<SyncQueueItem, number>;
  triageDrafts!: Table<TriageDraft, string>;
  avatarAudio!: Table<AvatarAudioCache, string>;

  constructor() {
    super('zeromalaria');
    this.version(1).stores({
      cases: '++id, client_uuid, created_at, synced',
      referrals: '++id, client_uuid, status, created_at, synced',
      syncQueue: '++id, client_uuid, created_at',
    });
    this.version(2).stores({
      cases: '++id, client_uuid, created_at, synced',
      referrals: '++id, client_uuid, status, created_at, synced',
      syncQueue: '++id, client_uuid, created_at',
      triageDrafts: 'id, updatedAt',
    });
    this.version(3).stores({
      cases: '++id, client_uuid, created_at, synced',
      referrals: '++id, client_uuid, status, created_at, synced',
      syncQueue: '++id, client_uuid, created_at',
      triageDrafts: 'id, updatedAt',
      avatarAudio: 'id, lang, updatedAt',
    });
  }
}

export const db = new ZeroMalariaDB();

export const TRIAGE_DRAFT_ID = 'current';

export async function saveTriageDraft(draft: Omit<TriageDraft, 'id' | 'updatedAt'>) {
  const row: TriageDraft = {
    ...draft,
    id: TRIAGE_DRAFT_ID,
    updatedAt: new Date().toISOString(),
  };
  await db.triageDrafts.put(row);
}

export async function loadTriageDraft(): Promise<TriageDraft | undefined> {
  return db.triageDrafts.get(TRIAGE_DRAFT_ID);
}

export async function clearTriageDraft() {
  await db.triageDrafts.delete(TRIAGE_DRAFT_ID);
}

export async function enqueueReferral(referral: LocalReferral) {
  await db.referrals.put(referral);
  await db.syncQueue.put({
    client_uuid: referral.client_uuid,
    type: 'referral',
    payload: {
      client_uuid: referral.client_uuid,
      facility_id: referral.facility_id,
      chw_id: referral.chw_id,
      district: referral.district,
      sector: referral.sector,
      age_months: referral.age_months,
      sex: referral.sex,
      decision: referral.decision,
      reasons: referral.reasons,
      summary: referral.summary,
    },
    created_at: new Date().toISOString(),
  });
}

export type ActivityCountQueuePayload = {
  client_uuid: string;
  chw_id: string;
  facility_id: string;
  date: string;
  patients_seen: number;
  patients_treated: number;
  rdt_done: number;
  rdt_positive: number;
  referred: number;
  note?: string | null;
  version?: number | null;
};

export async function enqueueActivityCount(payload: ActivityCountQueuePayload) {
  await db.syncQueue.put({
    client_uuid: payload.client_uuid,
    type: 'activity_count',
    payload,
    created_at: new Date().toISOString(),
  });
}
