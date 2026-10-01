import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import type { DecisionResult, TriageInput } from '../types';

export type AssistantPageId = 'home' | 'alerts' | 'patients' | 'triage' | 'default';
export type AssistantContextMode = 'case' | 'page' | 'general';

type SavedTriage = {
  input: TriageInput;
  result: DecisionResult;
};

export function readOpenCase(): SavedTriage | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem('zm_last_triage');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedTriage;
    if (!parsed?.input || !parsed?.result) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function pageIdFromPath(pathname: string): AssistantPageId {
  const p = pathname.replace(/\/$/, '');
  if (p.includes('/alerts')) return 'alerts';
  if (p.includes('/patients') || p.includes('/my-patients')) return 'patients';
  if (p.includes('/triage')) return 'triage';
  if (p.includes('/home') || p === '/app') return 'home';
  return 'default';
}

export function useAssistantPageContext() {
  const location = useLocation();
  const resultOpen = new URLSearchParams(location.search).get('result') === 'open';
  const openCase = useMemo(() => readOpenCase(), [location.pathname, location.search]);
  const pageId = pageIdFromPath(location.pathname);
  const hasCase = Boolean(openCase);

  const contextMode: AssistantContextMode = useMemo(() => {
    if (hasCase && (resultOpen || pageId === 'triage')) return 'case';
    if (pageId !== 'default') return 'page';
    return 'general';
  }, [hasCase, resultOpen, pageId]);

  return { openCase, hasCase, pageId, contextMode, resultOpen };
}

export const PAGE_CHIP_KEYS: Record<AssistantPageId, string[]> = {
  home: ['chipHomeCounts', 'chipHomePrevent', 'chipHomeReferrals'],
  alerts: ['chipAlertsOverdue', 'chipAlertsPending', 'chipAlertsMeaning'],
  patients: ['chipPatientsPending', 'chipPatientsToday', 'chipPatientsFollowUp'],
  triage: ['chipTriageWhenTest', 'chipGeneralMalaria', 'askWhy'],
  default: ['chipDataMyCounts', 'chipGeneralMalaria', 'chipDataPending'],
};
