import { Mic, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { ChwShell, WebShell } from '../components/shells';
import { Badge, Button, Card, SegmentedControl } from '../components/ui';
import { useVoice } from '../voice/VoiceContext';
import {
  browserTtsMatchesLang,
  getLanguageCapabilities,
  getSpeed,
  isMuted,
  probeCloudReachable,
  probePreRecordedAudio,
  setMuted,
  setSpeed,
  type VoiceSpeed,
} from '../voice/speak';

const REVIEW_KEY = 'zm_voice_reviewed';

export function VoiceSettingsPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const voice = useVoice();
  const lang = i18n.language.startsWith('rw') ? 'rw' : 'en';
  const isApp = location.pathname.startsWith('/app');

  const [mute, setMuteState] = useState(isMuted);
  const [speed, setSpeedState] = useState<VoiceSpeed>(getSpeed());
  const [audioPack, setAudioPack] = useState<boolean | null>(null);
  const [cloudOk, setCloudOk] = useState<boolean | null>(null);
  const [serverCaps, setServerCaps] = useState<Record<string, unknown> | null>(null);

  const caps = getLanguageCapabilities(lang);
  const ttsOk = browserTtsMatchesLang(lang);
  const ttsRw = serverCaps?.tts_rw as { available?: boolean; mode?: string; self_test?: string } | undefined;
  const ttsEn = serverCaps?.tts_en as { available?: boolean; mode?: string; self_test?: string } | undefined;
  const ttsAvailable =
    lang === 'rw'
      ? Boolean(ttsRw?.available ?? audioPack)
      : Boolean(ttsEn?.available ?? (ttsOk || audioPack));

  useEffect(() => {
    void probePreRecordedAudio(lang).then(setAudioPack);
    void probeCloudReachable().then(setCloudOk);
    void api
      .voiceCapabilities(lang)
      .then((r) => setServerCaps(r))
      .catch(() => setServerCaps(null));
  }, [lang]);

  const shell = (children: React.ReactNode) =>
    isApp ? (
      <WebShell title={t('voiceSettings.title')} crumbs={[t('nav.settings'), t('voiceSettings.title')]}>
        <div className="mx-auto max-w-lg space-y-4">{children}</div>
      </WebShell>
    ) : (
      <ChwShell title={t('voiceSettings.title')}>{children}</ChwShell>
    );

  return shell(
    <>
      <Card>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Mic className="h-5 w-5 text-primary" strokeWidth={1.75} />
          {t('voiceSettings.capabilities')}
        </h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li className="flex items-center justify-between gap-2">
            <span>{t('voiceSettings.speechSynthesis')} ({lang})</span>
            <Badge tone={ttsAvailable ? 'success' : 'warning'}>
              {ttsAvailable ? t('voiceSettings.available') : t('voiceSettings.unavailable')}
            </Badge>
          </li>
          <li className="flex items-center justify-between gap-2 text-xs text-ink-muted">
            <span>{t('voiceSettings.ttsBrowserDetail')}</span>
            <span>{ttsOk ? '✓' : '·'}</span>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span>{t('voiceSettings.speechRecognition')}</span>
            <Badge tone={caps.sttBrowser ? 'success' : 'warning'}>
              {caps.sttBrowser ? t('voiceSettings.available') : t('voiceSettings.unavailable')}
            </Badge>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span>{t('voiceSettings.audioFiles', { lang })}</span>
            <Badge tone={audioPack ? 'success' : audioPack === false ? 'neutral' : 'info'}>
              {audioPack === null
                ? t('common.loading')
                : audioPack
                  ? t('voiceSettings.available')
                  : t('voiceSettings.notInstalled')}
            </Badge>
          </li>
          <li className="flex items-center justify-between gap-2">
            <span>{t('voiceSettings.cloudTts')}</span>
            <Badge tone={cloudOk ? 'success' : cloudOk === false ? 'warning' : 'info'}>
              {cloudOk === null
                ? t('common.loading')
                : cloudOk
                  ? t('voiceSettings.available')
                  : t('voiceSettings.unavailable')}
            </Badge>
          </li>
          {serverCaps ? (
            <li className="flex items-center justify-between gap-2 text-xs text-ink-muted">
              <span>{t('voiceSettings.serverSelfTest')}</span>
              <span>
                {lang === 'rw'
                  ? (ttsRw?.self_test ?? t('voiceSettings.unavailable'))
                  : (ttsEn?.self_test ?? t('voiceSettings.unavailable'))}
              </span>
            </li>
          ) : null}
        </ul>
        {lang === 'rw' && !ttsAvailable ? (
          <p className="mt-3 text-xs text-ink-muted">{t('voiceSettings.rwHonestHint')}</p>
        ) : null}
        {lang === 'en' && ttsEn?.self_test === 'fail_missing_credentials' ? (
          <p className="mt-3 text-xs text-ink-muted">{t('voiceSettings.vertexMissingCreds')}</p>
        ) : null}
      </Card>

      <Card>
        <h3 className="font-semibold">{t('voiceSettings.playback')}</h3>
        <p className="mt-1 text-sm text-ink-muted">{t('voiceSettings.playbackHint')}</p>
        <div className="mt-4">
          <p className="mb-2 text-sm font-semibold">{t('voiceSettings.speed')}</p>
          <SegmentedControl
            value={String(speed) as '0.75' | '1' | '1.25'}
            onChange={(v) => {
              const n = Number(v) as VoiceSpeed;
              setSpeed(n);
              setSpeedState(n);
            }}
            options={[
              { value: '0.75', label: '0.75×' },
              { value: '1', label: '1×' },
              { value: '1.25', label: '1.25×' },
            ]}
          />
        </div>
        <Button
          className="mt-4 w-full"
          variant="secondary"
          leftIcon={<Volume2 className="h-4 w-4" />}
          onClick={() => {
            voice.unlock();
            void voice.play(['disclaimer']);
          }}
        >
          {t('voiceSettings.testVoice')}
        </Button>
        <Button
          className="mt-2 w-full"
          variant={mute ? 'secondary' : 'primary'}
          onClick={() => {
            voice.unlock();
            const next = !mute;
            setMuted(next);
            setMuteState(next);
            voice.setMute(next);
          }}
        >
          {mute ? t('voiceSettings.unmute') : t('voiceSettings.mute')}
        </Button>
        {isApp ? (
          <Button className="mt-2 w-full" variant="outline" onClick={() => navigate('/app/settings/voice-review')}>
            {t('voiceReview.open')}
          </Button>
        ) : null}
      </Card>
    </>,
  );
}

export function loadReviewedMap(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(REVIEW_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function saveReviewedMap(map: Record<string, boolean>) {
  localStorage.setItem(REVIEW_KEY, JSON.stringify(map));
}

/** Re-export for VoiceReviewPage */
export { REVIEW_KEY };
