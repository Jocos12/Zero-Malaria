import { Globe2, Languages } from 'lucide-react';
import { DrawCheck, Orb } from '../components/liquid/alive';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setLanguage, type AppLang } from '../i18n';
import { WebShell } from '../components/shells';
import { Button, Card } from '../components/ui';
import { cn } from '../lib/cn';

export function AppLanguagePage() {
  const { t, i18n } = useTranslation();
  const initial: AppLang = i18n.language.startsWith('rw') ? 'rw' : 'en';
  const [selected, setSelected] = useState<AppLang>(initial);

  return (
    <WebShell title={t('lang.title')} crumbs={[t('nav.settingsGroup'), t('nav.language')]}>
      <div className="flex w-full justify-center py-4">
      <div className="w-full max-w-lg space-y-3">
        {(
          [
            { id: 'rw' as const, label: t('lang.kinyarwanda'), Icon: Languages },
            { id: 'en' as const, label: t('lang.english'), Icon: Globe2 },
          ]
        ).map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setSelected(opt.id)}
            className={cn(
              'flex w-full items-center gap-4 rounded-card border px-5 py-5 text-left transition duration-300',
              selected === opt.id
                ? 'zm-card border-accent/40 ring-2 ring-accent/25'
                : 'zm-card hover:-translate-y-0.5',
            )}
          >
            <Orb size={40} tone={opt.id === 'rw' ? 'teal' : 'sky'} />
            <span className="flex-1 text-lg font-semibold text-ink">{opt.label}</span>
            <span className={cn('flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-300', selected === opt.id ? 'bg-accent' : 'bg-[rgba(118,118,128,0.14)]')}>
              <DrawCheck on={selected === opt.id} size={14} />
            </span>
          </button>
        ))}
        <Button className="w-full" size="lg" onClick={() => setLanguage(selected)}>
          {t('common.continue')}
        </Button>
        <Card>
          <p className="text-sm text-ink-muted">{t('lang.subtitle')}</p>
        </Card>
      </div>
      </div>
    </WebShell>
  );
}
