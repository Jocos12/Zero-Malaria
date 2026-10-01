import { Check, Globe2, Languages } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { setLanguage, type AppLang } from '../i18n';
import { Button, Card, Disclaimer } from '../components/ui';
import { cn } from '../lib/cn';

export function LanguagePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<AppLang>('rw');

  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-4 py-8">
      <div className="w-full max-w-chw">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-control bg-primary text-primary-foreground">
            <Globe2 className="h-6 w-6" strokeWidth={1.75} />
          </div>
          <h1 className="text-2xl font-semibold text-ink">{t('common.appName')}</h1>
          <p className="mt-2 text-sm text-ink-muted">{t('lang.subtitle')}</p>
        </div>
        <h2 className="mb-3 text-lg font-semibold">{t('lang.title')}</h2>
        <div className="space-y-3">
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
                'flex w-full items-center gap-3 rounded-card border px-4 py-5 text-left transition',
                selected === opt.id
                  ? 'border-primary bg-primary-soft shadow-card'
                  : 'border-border bg-surface hover:bg-surface-muted',
              )}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-control bg-surface text-primary">
                <opt.Icon className="h-5 w-5" strokeWidth={1.75} />
              </span>
              <span className="flex-1 text-lg font-semibold text-ink">{opt.label}</span>
              {selected === opt.id ? <Check className="h-5 w-5 text-primary" strokeWidth={1.75} /> : null}
            </button>
          ))}
        </div>
        <div className="mt-6">
          <Button
            className="w-full"
            size="lg"
            onClick={() => {
              setLanguage(selected);
              navigate('/m/home');
            }}
          >
            {t('common.continue')}
          </Button>
        </div>
        <Card className="mt-6">
          <Disclaimer text={t('common.disclaimer')} />
        </Card>
      </div>
    </div>
  );
}
