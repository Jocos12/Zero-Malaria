import { isDemoModeEnabled } from './AuthContext';
import { BROAD_ROLES, normalizeRole, type UserRole } from './roles';

export type { UserRole };
export {
  ALL_ROLES,
  BROAD_ROLES,
  NATIONAL_ROLES,
  assignableRoles,
  normalizeRole,
  roleI18nKey,
} from './roles';

const VIEW_KEY = 'zm_preferred_view';

export type PreferredView = 'web' | 'mobile' | 'auto';

export const DESKTOP_MIN_WIDTH = 1024;

export function getPreferredView(): PreferredView {
  const v = localStorage.getItem(VIEW_KEY);
  if (v === 'web' || v === 'mobile') return v;
  return 'auto';
}

export function setPreferredView(view: PreferredView) {
  localStorage.setItem(VIEW_KEY, view);
}

export function isDesktopViewport() {
  return typeof window !== 'undefined' && window.innerWidth >= DESKTOP_MIN_WIDTH;
}

/** Always false: product is a single responsive web app (no mobile shell). */
export function shouldUseMobileShell(): boolean {
  return false;
}

const ROLE_ALLOW: Record<UserRole, string[]> = {
  CHW: [
    '/m',
    '/app/home',
    '/app/chw',
    '/app/my-referrals',
    '/app/my-patients',
    '/app/alerts',
    '/app/triage',
    '/app/result',
    '/app/settings',
    '/app/change-password',
    '/app/not-authorized',
    '/login',
  ],
  HEALTH_CENTER: [
    '/app/home',
    '/app/referrals',
    '/app/patients',
    '/app/settings',
    '/app/change-password',
    '/app/not-authorized',
    '/login',
    '/m',
  ],
  RBC_ADMIN: ['/app', '/login', '/m', '/demo', '/app/not-authorized'],
  SUPER_ADMIN: ['/app', '/login', '/m', '/demo', '/app/not-authorized'],
};

const BLOCKED_FOR_CHW = [
  '/app/dashboard',
  '/app/analytics',
  '/app/supplies',
  '/app/users',
  '/app/referrals',
  '/app/permissions',
  '/app/audit',
  '/app/facilities',
  '/app/config',
];

const BLOCKED_FOR_HEALTH_CENTER = [
  '/app/dashboard',
  '/app/analytics',
  '/app/supplies',
  '/app/users',
  '/app/chw',
  '/app/permissions',
  '/app/audit',
  '/app/facilities',
  '/app/config',
];

export function webHomePath(role: UserRole | string): string {
  const r = normalizeRole(role);
  if (r === 'CHW') return '/app/home';
  if (r === 'HEALTH_CENTER') return '/app/referrals';
  return '/app/dashboard';
}

export function mobileHomePath(role: UserRole | string): string {
  const r = normalizeRole(role);
  if (r === 'CHW') return '/m/home';
  return webHomePath(r);
}

export function homePath(role: UserRole | string): string {
  return webHomePath(role);
}

export function mapPathAcrossShells(pathname: string, toMobile: boolean, role: UserRole): string | null {
  const r = normalizeRole(role);
  const path = pathname.split('?')[0];
  if (toMobile) {
    if (!path.startsWith('/app')) return null;
    const map: Record<string, string> = {
      '/app/home': '/m/home',
      '/app/chw': '/m/home',
      '/app/triage': '/m/triage',
      '/app/result': '/m/triage?result=open',
      '/app/my-referrals': '/m/referrals',
      '/app/alerts': '/m/alerts',
      '/app/settings/voice': '/m/voice-settings',
    };
    if (map[path]) return map[path];
    if (r === 'CHW') return '/m/home';
    return null;
  }
  if (!path.startsWith('/m')) return null;
  const map: Record<string, string> = {
    '/m': '/app/home',
    '/m/home': '/app/home',
    '/m/triage': '/app/triage',
    '/m/result': '/app/triage?result=open',
    '/m/referrals': r === 'HEALTH_CENTER' ? '/app/referrals' : '/app/my-referrals',
    '/m/alerts': '/app/alerts',
    '/m/voice-settings': '/app/settings/voice',
    '/m/handover': '/app/triage?result=open',
    '/m/prevention': '/app/home',
  };
  return map[path] || webHomePath(r);
}

export function canAccess(path: string, role: UserRole | null | undefined): boolean {
  if (!role) return path === '/login' || path.startsWith('/lang');
  const r = normalizeRole(role);
  const normalized = path.split('?')[0];
  if (normalized === '/login' || normalized.startsWith('/app/not-authorized')) return true;
  if (normalized.startsWith('/demo') && (isDemoModeEnabled || BROAD_ROLES.includes(r))) {
    return true;
  }

  if (r === 'CHW') {
    if (BLOCKED_FOR_CHW.some((p) => normalized === p || normalized.startsWith(`${p}/`))) return false;
    if (normalized === '/app' || normalized === '/app/') return false;
    return ROLE_ALLOW.CHW.some((p) => normalized === p || normalized.startsWith(`${p}/`));
  }

  if (r === 'HEALTH_CENTER') {
    if (BLOCKED_FOR_HEALTH_CENTER.some((p) => normalized === p || normalized.startsWith(`${p}/`))) return false;
    if (normalized === '/app' || normalized === '/app/dashboard') return false;
    return ROLE_ALLOW.HEALTH_CENTER.some((p) => normalized === p || normalized.startsWith(`${p}/`));
  }

  return ROLE_ALLOW[r].some((p) => normalized === p || normalized.startsWith(`${p}/`));
}

export { ROLE_ALLOW as ROLE_PREFIXES };
