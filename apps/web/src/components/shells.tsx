import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  ChevronLeft,
  ChevronRight,
  Home,
  Languages,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  Package,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Stethoscope,
  Sun,
  User,
  UserCog,
  Users,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useSync } from '../sync/SyncContext';
import { useTheme } from '../theme/ThemeContext';
import { setLanguage } from '../i18n';
import { db } from '../db';
import { Badge, IconButton, StatusPill, SyntheticBadge } from './ui';
import { PresenterMenu } from './PresenterMenu';
import { cn } from '../lib/cn';
import { easeOut, pageVariants } from '../lib/motion';
import { useAuth, type UserRole } from '../auth/AuthContext';
import {
  ALL_ROLES,
  BROAD_ROLES,
  normalizeRole,
  roleI18nKey,
} from '../auth/roleAccess';
import { api } from '../api/client';

const SIDEBAR_KEY = 'zm_sidebar_collapsed';
const APP_VERSION = '0.2.0';

function roleLabel(role: UserRole | string, t: (k: string) => string) {
  return t(roleI18nKey(role));
}

function LogoMark({ compact }: { compact?: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-w-0 items-center gap-2">
      <img
        src="/favicon.svg"
        alt=""
        width={36}
        height={36}
        className="h-9 w-9 shrink-0 rounded-[10px] shadow-sm"
        data-testid="app-logo"
      />
      {!compact ? (
        <div className="min-w-0 overflow-visible">
          <p
            className="text-sm font-bold leading-tight text-ink whitespace-normal break-words"
            data-testid="app-name"
            title={t('common.appName')}
          >
            {t('common.appName')}
          </p>
          <p
            className="mt-0.5 text-[10px] leading-snug text-ink-muted whitespace-normal break-words"
            title={t('common.tagline')}
          >
            {t('common.tagline')}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function SyncPill() {
  const { t } = useTranslation();
  const { status, pending } = useSync();
  const { offlineSim } = useTheme();
  const effective = offlineSim ? 'offline' : status;
  if (pending > 0 && effective !== 'offline') {
    return <Badge tone="info">{t('common.pending', { count: pending })}</Badge>;
  }
  return <StatusPill status={effective} />;
}

type NavItem = {
  to: string;
  label: string;
  icon: typeof Home;
  roles: UserRole[];
  badge?: number;
  group?: string;
};

export function WebShell({
  children,
  title,
  crumbs,
}: {
  children: ReactNode;
  title: string;
  crumbs?: string[];
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { dark, themeMode, cycleTheme, offlineSim } = useTheme();
  const themeLabel =
    themeMode === 'light'
      ? t('common.themeLight')
      : themeMode === 'dark'
        ? t('common.themeDark')
        : t('common.themeSystem');
  const { user, logout } = useAuth();
  const reduce = useReducedMotion();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === '1');
  const [mobileNav, setMobileNav] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [mainScrolled, setMainScrolled] = useState(false);
  const [overdueAlerts, setOverdueAlerts] = useState<{ id: string; summary: string }[]>([]);
  const [referralCount, setReferralCount] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);
  const avatarRef = useRef<HTMLDivElement>(null);

  const role = user?.role as UserRole | undefined;

  const loadAlerts = useCallback(async () => {
    try {
      const data = await api.alerts();
      setOverdueAlerts(
        (data as { id: string; summary?: string; message?: string }[])
          .slice(0, 8)
          .map((a) => ({ id: a.id, summary: a.summary || a.message || t('alerts.notArrived') })),
      );
    } catch {
      setOverdueAlerts([]);
    }
  }, [t]);

  const loadReferralCount = useCallback(async () => {
    try {
      let remote: { client_uuid?: string; id?: string }[] = [];
      try {
        remote = (await api.scopedReferrals()) as { client_uuid?: string; id?: string }[];
      } catch {
        remote = (await api.referrals()) as { client_uuid?: string; id?: string }[];
      }
      const local = await db.referrals.toArray();
      const seen = new Set<string>();
      for (const r of [...remote, ...local]) {
        const k = String(r.client_uuid || r.id || '');
        if (k) seen.add(k);
      }
      setReferralCount(seen.size);
    } catch {
      const local = await db.referrals.toArray();
      setReferralCount(local.length);
    }
  }, []);

  useEffect(() => {
    void loadAlerts();
    void loadReferralCount();
    const id = window.setInterval(() => {
      void loadAlerts();
      void loadReferralCount();
    }, 15000);
    return () => window.clearInterval(id);
  }, [loadAlerts, loadReferralCount]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
      if (e.key === 'Escape') {
        setPaletteOpen(false);
        setNotifOpen(false);
        setAvatarOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!notifRef.current?.contains(e.target as Node)) setNotifOpen(false);
      if (!avatarRef.current?.contains(e.target as Node)) setAvatarOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const navItems: NavItem[] = useMemo(
    () => [
      { to: '/app/home', label: t('nav.home'), icon: Home, roles: ['CHW'] },
      { to: '/app/triage', label: t('nav.newTriage'), icon: Plus, roles: ['CHW'] },
      {
        to: '/app/my-patients',
        label: t('nav.myPatients'),
        icon: Users,
        roles: ['CHW'],
        badge: referralCount || undefined,
      },
      {
        to: '/app/my-referrals',
        label: t('nav.myReferrals'),
        icon: Stethoscope,
        roles: ['CHW'],
        badge: referralCount || undefined,
      },
      { to: '/app/alerts', label: t('nav.alerts'), icon: AlertTriangle, roles: ['CHW'] },
      { to: '/app/dashboard', label: t('nav.dashboard'), icon: LayoutDashboard, roles: [...BROAD_ROLES] },
      {
        to: '/app/patients',
        label: t('nav.patients'),
        icon: Users,
        roles: ['HEALTH_CENTER', ...BROAD_ROLES],
      },
      {
        to: '/app/referrals',
        label: t('nav.referralsInbox'),
        icon: Stethoscope,
        roles: ['HEALTH_CENTER', ...BROAD_ROLES],
        badge: overdueAlerts.length || undefined,
      },
      { to: '/app/analytics', label: t('nav.analytics'), icon: BarChart3, roles: [...BROAD_ROLES] },
      { to: '/app/ai-activity', label: t('nav.aiActivity'), icon: Activity, roles: [...BROAD_ROLES] },
      { to: '/app/supplies', label: t('nav.supplies'), icon: Package, roles: [...BROAD_ROLES] },
      { to: '/app/users', label: t('nav.users'), icon: User, roles: [...BROAD_ROLES], group: 'settings' },
      {
        to: '/app/facilities',
        label: t('common.facilities'),
        icon: Stethoscope,
        roles: [...BROAD_ROLES],
        group: 'settings',
      },
      {
        to: '/app/permissions',
        label: t('common.permissions'),
        icon: UserCog,
        roles: ['SUPER_ADMIN'],
        group: 'settings',
      },
      {
        to: '/app/audit',
        label: t('common.auditLog'),
        icon: UserCog,
        roles: [...BROAD_ROLES],
        group: 'settings',
      },
      {
        to: '/app/config',
        label: t('nav.settings'),
        icon: Settings,
        roles: ['SUPER_ADMIN', 'RBC_ADMIN'],
        group: 'settings',
      },
      {
        to: '/app/change-password',
        label: t('auth.changePassword'),
        icon: Settings,
        roles: [...ALL_ROLES],
        group: 'settings',
      },
      {
        to: '/app/settings/language',
        label: t('nav.language'),
        icon: Languages,
        roles: [...ALL_ROLES],
        group: 'settings',
      },
      {
        to: '/m/voice-settings',
        label: t('nav.voice'),
        icon: Settings,
        roles: ['CHW'],
        group: 'settings',
      },
      {
        to: '/app/settings/about',
        label: t('nav.about'),
        icon: Settings,
        roles: [...ALL_ROLES],
        group: 'settings',
      },
    ],
    [t, overdueAlerts.length, referralCount],
  );

  const normalizedRole = role ? normalizeRole(role) : undefined;
  const visibleNav = user
    ? navItems.filter((item) => normalizedRole && item.roles.includes(normalizedRole))
    : [
        {
          to: '/facility',
          label: t('nav.referralsInbox'),
          icon: Stethoscope,
          roles: ['HEALTH_CENTER'] as UserRole[],
        },
        {
          to: '/about',
          label: t('nav.about'),
          icon: Settings,
          roles: ['HEALTH_CENTER'] as UserRole[],
          group: 'settings' as const,
        },
      ];

  const paletteItems = visibleNav.filter((item) =>
    item.label.toLowerCase().includes(paletteQuery.trim().toLowerCase()),
  );

  const connectionStatus = offlineSim ? 'offline' : 'online';

  // Close mobile nav on route change; lock body scroll while open
  useEffect(() => {
    setMobileNav(false);
  }, [location.pathname]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, []);

  useEffect(() => {
    if (!mobileNav) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNav(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileNav]);

  const onMainScroll = (e: UIEvent<HTMLElement>) => {
    setMainScrolled(e.currentTarget.scrollTop > 4);
  };

  const renderSidebar = (testId: string, forceExpanded = false) => {
    const slim = !forceExpanded && collapsed;
    return (
    <aside
      data-testid={testId}
      className={cn(
        'zm-glass zm-glass-strong flex h-full flex-col overflow-hidden rounded-[28px] transition-[width] duration-500 [transition-timing-function:cubic-bezier(.32,.72,0,1)]',
        reduce && 'transition-none',
        slim ? 'w-[72px]' : 'w-60',
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--zm-separator)] p-4">
        <LogoMark compact={slim} />
        <button
          type="button"
          className="hidden rounded-control border border-border p-1 lg:inline-flex"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={t('nav.toggleSidebar')}
        >
          {slim ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
      {user ? (
        <div className={cn('shrink-0 border-b border-border px-3 py-3', slim && 'px-2 text-center')}>
          <Badge tone="primary">{roleLabel(user.role, t)}</Badge>
        </div>
      ) : (
        <div className={cn('shrink-0 border-b border-border px-3 py-3', slim && 'px-2 text-center')}>
          <Badge tone="neutral">{t('common.demoMode')}</Badge>
        </div>
      )}
      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain p-3">
        {visibleNav
          .filter((item) => !item.group)
          .map((item) => {
            const Icon = item.icon;
            const active =
              item.to === '/app'
                ? location.pathname === '/app' || location.pathname === '/app/dashboard'
                : location.pathname.startsWith(item.to);
            return (
              <button
                key={item.to}
                type="button"
                title={item.label}
                onClick={() => {
                  navigate(item.to);
                  setMobileNav(false);
                }}
                className={cn(
                  'relative flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-[14.5px] font-medium transition-colors duration-300',
                  active ? 'bg-primary-soft text-primary' : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                  slim && 'justify-center px-2',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                {!slim ? <span className="flex-1 text-left">{item.label}</span> : null}
                {!slim && item.badge ? (
                  <span className="rounded-full bg-danger px-1.5 text-[10px] text-white">{item.badge}</span>
                ) : null}
              </button>
            );
          })}
        {!slim ? (
          <p className="mb-1 mt-4 px-2 text-[10px] font-bold uppercase tracking-wide text-ink-muted">
            {t('nav.settingsGroup')}
          </p>
        ) : null}
        {visibleNav
          .filter((item) => item.group === 'settings')
          .map((item) => {
            const Icon = item.icon;
            const active = location.pathname.startsWith(item.to);
            return (
              <button
                key={item.to}
                type="button"
                title={item.label}
                onClick={() => {
                  navigate(item.to);
                  setMobileNav(false);
                }}
                className={cn(
                  'relative flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-[14.5px] font-medium transition-colors duration-300',
                  active ? 'bg-primary-soft text-primary' : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                  slim && 'justify-center px-2',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                {!slim ? <span className="flex-1 text-left">{item.label}</span> : null}
              </button>
            );
          })}
      </nav>
      <div className="shrink-0 space-y-2 border-t border-border p-4 text-xs text-ink-muted">
        <SyncPill />
        <p className="flex flex-wrap items-center gap-2">
          <span>v{APP_VERSION}</span>
          <SyntheticBadge label={t('common.synthetic')} />
        </p>
        {user && !slim ? (
          <p className="truncate font-medium text-ink">
            {user.display_name} · {roleLabel(user.role, t)}
          </p>
        ) : null}
      </div>
    </aside>
    );
  };

  const initials =
    user?.display_name
      ?.split(' ')
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase() || 'ZM';

  return (
    <div className="flex h-dvh overflow-hidden bg-app text-ink" data-testid="app-shell">
      <div className="hidden h-full shrink-0 p-3 pr-0 lg:block">{renderSidebar('web-sidebar')}</div>
      {mobileNav ? (
        <div className="fixed inset-0 z-40 flex lg:hidden" role="dialog" aria-modal="true" data-testid="mobile-nav">
          <button
            type="button"
            className="zm-backdrop absolute inset-0 bg-ink/40"
            aria-label={t('common.close')}
            onClick={() => setMobileNav(false)}
          />
          <div className="relative z-10 h-full p-3 [animation:zm-pop_.45s_cubic-bezier(.32,.72,0,1)_both] [transform-origin:left_center]">
            {renderSidebar('web-sidebar-drawer', true)}
          </div>
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          data-testid="app-header"
          className={cn(
            'z-20 mx-3 mt-3 flex h-[64px] shrink-0 flex-nowrap items-center gap-2 rounded-[24px] border border-white/70 bg-surface/75 px-3 shadow-[0_10px_30px_-18px_rgba(6,36,58,0.35)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/[0.07] dark:bg-[rgba(14,27,40,0.72)] sm:px-4',
            mainScrolled && 'shadow-[0_12px_36px_-16px_rgba(6,36,58,0.45)]',
          )}
        >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <button
                type="button"
                className="shrink-0 rounded-control border border-border p-2 lg:hidden"
                onClick={() => setMobileNav(true)}
                aria-label={t('nav.toggleSidebar')}
                title={t('nav.toggleSidebar')}
              >
                <PanelLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="hidden shrink-0 rounded-control border border-border p-2 lg:inline-flex"
                onClick={() => setCollapsed((c) => !c)}
                aria-label={t('nav.toggleSidebar')}
                title={t('nav.toggleSidebar')}
              >
                <PanelLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <p className="hidden truncate text-[11px] text-ink-muted sm:block">
                  {(crumbs || [title]).join(' / ')}
                </p>
                <h1 className="truncate text-base font-semibold lg:text-lg">{title}</h1>
              </div>
            </div>
            <div className="flex shrink-0 flex-nowrap items-center gap-1">
              <span className="hidden xl:inline-flex">
                <SyntheticBadge label={t('common.syntheticShort')} />
              </span>
              <IconButton
                label={t('nav.commandPalette')}
                showLabel={false}
                className="hidden md:inline-flex"
                onClick={() => setPaletteOpen(true)}
              >
                <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
              </IconButton>
              <IconButton
                label={i18n.language.startsWith('rw') ? 'RW' : 'EN'}
                showLabel={false}
                className="hidden sm:inline-flex"
                onClick={() => setLanguage(i18n.language.startsWith('rw') ? 'en' : 'rw')}
              >
                <Languages className="h-3.5 w-3.5" strokeWidth={1.75} />
              </IconButton>
              <IconButton label={themeLabel} showLabel={false} className="hidden sm:inline-flex" onClick={cycleTheme}>
                {themeMode === 'system' ? (
                  <Monitor className="h-4 w-4" strokeWidth={1.75} />
                ) : dark ? (
                  <Sun className="h-4 w-4" strokeWidth={1.75} />
                ) : (
                  <Moon className="h-4 w-4" strokeWidth={1.75} />
                )}
              </IconButton>
              <div className="relative" ref={notifRef}>
                <IconButton
                  label={t('nav.notifications')}
                  showLabel={false}
                  className="relative"
                  onClick={() => setNotifOpen((o) => !o)}
                >
                  <Bell className="h-4 w-4" strokeWidth={1.75} />
                  {overdueAlerts.length ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] text-white">
                      {overdueAlerts.length}
                    </span>
                  ) : null}
                </IconButton>
                {notifOpen ? (
                  <div className="zm-glass zm-glass-strong absolute right-0 z-40 mt-2 w-72 overflow-hidden rounded-[20px] !shadow-lift">
                    <p className="border-b border-border px-3 py-2 text-xs font-semibold uppercase text-ink-muted">
                      {t('nav.notifications')}
                    </p>
                    {overdueAlerts.length === 0 ? (
                      <p className="px-3 py-4 text-sm text-ink-muted">{t('alerts.empty')}</p>
                    ) : (
                      <ul className="max-h-64 overflow-y-auto">
                        {overdueAlerts.map((a) => (
                          <li key={a.id} className="border-b border-border/60 px-3 py-2 text-sm last:border-0">
                            {a.summary}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
              <span className="hidden md:inline-flex">
                <StatusPill status={connectionStatus} />
              </span>
              <span className="hidden sm:inline-flex">
                <PresenterMenu />
              </span>
              <div className="relative" ref={avatarRef}>
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-sm font-bold text-primary"
                  onClick={() => setAvatarOpen((o) => !o)}
                  aria-label={user?.display_name || t('common.account')}
                >
                  {initials}
                </button>
                {avatarOpen ? (
                  <div className="zm-glass zm-glass-strong absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-[20px] !shadow-lift">
                    <div className="border-b border-border px-3 py-2">
                      <p className="text-sm font-semibold">{user?.display_name}</p>
                      <p className="text-xs text-ink-muted">{user?.username}</p>
                    </div>
                    {user ? (
                      <>
                        <button
                          type="button"
                          className="flex w-full px-3 py-2.5 text-left text-sm hover:bg-surface-muted sm:hidden"
                          onClick={() => {
                            setLanguage(i18n.language.startsWith('rw') ? 'en' : 'rw');
                            setAvatarOpen(false);
                          }}
                        >
                          {t('nav.language')} ({i18n.language.startsWith('rw') ? 'RW' : 'EN'})
                        </button>
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-3 text-left text-sm hover:bg-surface-muted"
                          onClick={() => void logout().then(() => navigate('/login'))}
                        >
                          <LogOut className="h-4 w-4" strokeWidth={1.75} />
                          {t('auth.signOut')}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-3 text-left text-sm hover:bg-surface-muted"
                        onClick={() => navigate('/login')}
                      >
                        <LogOut className="h-4 w-4" strokeWidth={1.75} />
                        {t('login.signIn')}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </header>
          <motion.main
            key={location.pathname}
            data-testid="app-main"
            className="relative mx-auto w-full max-w-[1440px] min-h-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth p-4 [scrollbar-gutter:stable] sm:p-6"
            variants={reduce ? undefined : pageVariants}
            initial="initial"
            animate="animate"
            transition={easeOut}
            onScroll={onMainScroll}
          >
            {children}
          </motion.main>
        </div>

      {paletteOpen ? (
        <div className="zm-backdrop fixed inset-0 z-50 flex items-start justify-center bg-ink/40 p-4 pt-[15vh]">
          <div className="zm-glass zm-glass-strong w-full max-w-lg overflow-hidden rounded-[28px] !shadow-lift">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="h-4 w-4 text-ink-muted" />
              <input
                autoFocus
                className="h-10 flex-1 bg-transparent text-sm outline-none"
                placeholder={t('nav.commandPalettePlaceholder')}
                value={paletteQuery}
                onChange={(e) => setPaletteQuery(e.target.value)}
              />
            </div>
            <ul className="max-h-72 overflow-y-auto py-1">
              {paletteItems.map((item) => (
                <li key={item.to}>
                  <button
                    type="button"
                    className="flex w-full px-4 py-2.5 text-left text-sm hover:bg-surface-muted"
                    onClick={() => {
                      navigate(item.to);
                      setPaletteOpen(false);
                      setPaletteQuery('');
                    }}
                  >
                    {item.label}
                  </button>
                </li>
              ))}
              {paletteItems.length === 0 ? (
                <li className="px-4 py-6 text-sm text-ink-muted">{t('common.empty')}</li>
              ) : null}
            </ul>
          </div>
          <button type="button" className="absolute inset-0 -z-10" aria-label={t('common.close')} onClick={() => setPaletteOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}

/** @deprecated Phone-frame shell removed; alias to WebShell. */
export function ChwShell({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <WebShell title={title || ''} crumbs={title ? [title] : undefined}>
      {children}
    </WebShell>
  );
}

/** @deprecated use WebShell */
export const DesktopShell = WebShell;
