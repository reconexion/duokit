import { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Clipboard,
  Download01,
  File06,
  Image01,
  Link01,
  MusicNote01,
  Scissors01,
  VideoRecorder,
} from '@untitledui/icons';
import { Badge } from '@/components/base/badges/badges';
import { Button } from '@/components/base/buttons/button';
import { Checkbox } from '@/components/base/checkbox/checkbox';
import { Input } from '@/components/base/input/input';
import { ProgressBar } from '@/components/base/progress-indicators/progress-indicators';
import { Select } from '@/components/base/select/select';
import { FeaturedIcon } from '@/components/foundations/featured-icon/featured-icon';
import { AnimatedCounter } from '@/components/ui/animated-counter';
import { cx } from '@/utils/cx';
import { apiFetch } from './api';
import { useAuth } from './auth';
import { useI18n } from './i18n';
import { useJobPoller } from './useJobPoller';

// Altura en píxeles de cada calidad: el plan del usuario define hasta cuál puede elegir.
const VIDEO_HEIGHTS = { '480p': 480, '720p': 720, '1080p': 1080, '2K': 1440, '4K': 2160 };
const AUDIO_QUALITY_OPTIONS = ['64k', '128k', '192k', '256k', '320k'].map((id) => ({ id, label: `${id}bps` }));
const AUDIO_LANG_IDS = ['original', 'es', 'en', 'pt', 'fr', 'de', 'ja', 'ko', 'it', 'ru', 'hi', 'ar'];

// "1:30" -> "00:01:30". Devuelve '' si está vacío y null si no es un tiempo válido.
function normalizeTime(value) {
  const text = value.trim();
  if (!text) return '';
  const parts = text.split(':');
  if (parts.length > 3 || parts.some((p) => !/^\d{1,2}$/.test(p))) return null;
  const [s, m = 0, h = 0] = parts.map(Number).reverse();
  if (m > 59 || s > 59) return null;
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':');
}

// Pide al navegador que descargue el archivo: aparece en su barra de descargas, listo para abrir.
function startBrowserDownload(file) {
  const link = document.createElement('a');
  link.href = file.url;
  link.download = file.name;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function SectionTitle({ children, aside }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold text-secondary">{children}</h2>
      {aside}
    </div>
  );
}

function OptionTile({ icon: Icon, title, detail, isSelected, isDisabled, onChange }) {
  return (
    <label
      className={cx(
        'group relative flex cursor-pointer flex-col gap-3 rounded-xl bg-primary p-4 ring-1 ring-primary transition duration-150 ring-inset',
        'hover:ring-brand-300 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand',
        isSelected && 'bg-brand-primary ring-2 ring-brand-solid hover:ring-brand-solid',
        isDisabled && 'cursor-not-allowed opacity-50 hover:ring-primary',
      )}
    >
      <input
        type="checkbox"
        className="sr-only"
        checked={isSelected}
        disabled={isDisabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <FeaturedIcon icon={Icon} theme={isSelected ? 'dark' : 'light'} color="brand" size="md" />
      <span className="flex flex-col items-start gap-1.5">
        <span className="text-sm font-semibold text-primary">{title}</span>
        <Badge size="sm" color={isSelected ? 'brand' : 'gray'}>
          {detail}
        </Badge>
      </span>
      <span
        aria-hidden="true"
        className={cx(
          'absolute top-3 right-3 flex size-5 items-center justify-center rounded-full bg-brand-solid text-white transition duration-150',
          isSelected ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
        )}
      >
        <svg viewBox="0 0 14 14" fill="none" className="size-3">
          <path d="M11.6666 3.5L5.24992 9.91667L2.33325 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </label>
  );
}

export default function Downloader() {
  const { t } = useI18n();
  const [ytUrl, setYtUrl] = useState('');
  const [dlVid, setDlVid] = useState(true);
  const [dlAud, setDlAud] = useState(false);
  const [dlThumb, setDlThumb] = useState(false);
  const [trim, setTrim] = useState(false);
  const [timeStart, setTimeStart] = useState('');
  const [timeEnd, setTimeEnd] = useState('');
  const [qualVid, setQualVid] = useState('1080p');
  const [qualAud, setQualAud] = useState('192k');
  const [audioLang, setAudioLang] = useState('original');
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null); // { friendly }
  const { user } = useAuth();

  const FILE_KIND = {
    mp4: { label: t('downloader.video'), icon: VideoRecorder },
    mp3: { label: t('downloader.audio'), icon: MusicNote01 },
    jpg: { label: t('downloader.thumbnail'), icon: Image01 },
  };
  const fileKind = (name) => FILE_KIND[name.split('.').pop().toLowerCase()] ?? { label: t('downloader.file'), icon: File06 };
  const audioLangOptions = AUDIO_LANG_IDS.map((id) => ({ id, label: t(`downloader.audioLangOptions.${id}`) }));

  const videoQualityOptions = Object.entries(VIDEO_HEIGHTS).map(([id, height]) => ({
    id,
    label: id,
    isDisabled: height > user.maxHeight,
    supportingText: height > user.maxHeight ? t('downloader.lifetimePlanRequired') : undefined,
  }));

  const job = useJobPoller();
  const locked = job.isRunning;
  const wantsMedia = dlVid || dlAud;
  const isDone = !job.isRunning && job.files.length > 0;

  // Al terminar, el navegador descarga solo cada archivo (con una pausa entre uno y otro, para que
  // no los bloquee como descargas múltiples). Los temporizadores se limpian si el efecto se repite.
  const startedRef = useRef(new Set());
  useEffect(() => {
    if (!isDone) return undefined;
    const timers = job.files
      .filter((file) => !startedRef.current.has(file.url))
      .map((file, index) =>
        setTimeout(() => {
          startedRef.current.add(file.url);
          startBrowserDownload(file);
        }, 200 + index * 900),
      );
    return () => timers.forEach(clearTimeout);
  }, [isDone, job.files]);

  const clearError = (key) => setErrors((prev) => ({ ...prev, [key]: undefined }));

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setYtUrl(text.trim());
        clearError('url');
      }
    } catch {
      setErrors((prev) => ({ ...prev, url: t('downloader.pasteError') }));
    }
  };

  const handleDownload = async () => {
    setFailure(null);
    const next = {};
    const url = ytUrl.trim();
    if (!url.includes('youtube.com')) {
      next.url = t('downloader.urlInvalid');
    }
    if (!wantsMedia && !dlThumb) {
      next.kind = t('downloader.kindRequired');
    }
    const start = trim && wantsMedia ? normalizeTime(timeStart) : '';
    const end = trim && wantsMedia ? normalizeTime(timeEnd) : '';
    if (start === null) next.start = t('downloader.timeHint');
    if (end === null) next.end = t('downloader.timeHint');
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    if (start) setTimeStart(start);
    if (end) setTimeEnd(end);

    try {
      const res = await apiFetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          downloadVideo: dlVid,
          downloadAudio: dlAud,
          downloadThumbnail: dlThumb,
          videoQuality: qualVid,
          audioQuality: qualAud,
          audioLang,
          startTime: start,
          endTime: end,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Mensaje del servidor (límite del plan, demasiado rápido...): ya viene listo para mostrarse.
        const rejection = new Error(data.error || t('downloader.startError'));
        rejection.ready = true;
        throw rejection;
      }

      const data = await res.json();
      job.start(data.jobId, {
        onError: (d) => setFailure({ friendly: d.error || t('downloader.genericJobError') }),
      });
    } catch (err) {
      setFailure({ friendly: err.ready ? err.message : t('downloader.connectionError') });
    }
  };

  return (
    <section className="relative flex w-full flex-col gap-7 rounded-2xl bg-primary p-5 shadow-xl shadow-brand-600/10 ring-1 ring-brand-200 sm:p-8">
      {/* Enlace */}
      <div className="flex flex-col gap-2">
        <SectionTitle
          aside={
            <Button size="sm" color="link-color" iconLeading={Clipboard} isDisabled={locked} onPress={pasteFromClipboard}>
              {t('downloader.paste')}
            </Button>
          }
        >
          {t('downloader.linkLabel')}
        </SectionTitle>
        <Input
          aria-label={t('downloader.linkAriaLabel')}
          size="md"
          icon={Link01}
          placeholder={t('downloader.linkPlaceholder')}
          value={ytUrl}
          onChange={(v) => {
            setYtUrl(v);
            clearError('url');
          }}
          isInvalid={Boolean(errors.url)}
          hint={errors.url}
          isDisabled={locked}
        />
      </div>

      {/* Qué descargar */}
      <div className="flex flex-col gap-3">
        <SectionTitle>{t('downloader.whatToDownload')}</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          <OptionTile
            icon={VideoRecorder}
            title={t('downloader.video')}
            detail="MP4"
            isSelected={dlVid}
            isDisabled={locked}
            onChange={(v) => {
              setDlVid(v);
              clearError('kind');
            }}
          />
          <OptionTile
            icon={MusicNote01}
            title={t('downloader.audio')}
            detail="MP3"
            isSelected={dlAud}
            isDisabled={locked}
            onChange={(v) => {
              setDlAud(v);
              clearError('kind');
            }}
          />
          <OptionTile
            icon={Image01}
            title={t('downloader.thumbnail')}
            detail="JPG"
            isSelected={dlThumb}
            isDisabled={locked}
            onChange={(v) => {
              setDlThumb(v);
              clearError('kind');
            }}
          />
        </div>
        {errors.kind && <p className="text-sm text-error-primary">{errors.kind}</p>}
      </div>

      {/* Calidad: solo lo que aplica a lo elegido */}
      {wantsMedia && (
        <div className="flex flex-col gap-3 animate-in fade-in duration-200">
          <SectionTitle>{t('downloader.quality')}</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {dlVid && (
              <Select
                aria-label={t('downloader.videoQualityAriaLabel')}
                label={t('downloader.video')}
                selectedKey={qualVid}
                onSelectionChange={(key) => setQualVid(String(key))}
                isDisabled={locked}
                items={videoQualityOptions}
                hint={user.maxHeight < VIDEO_HEIGHTS['4K'] ? t('downloader.planHint', { plan: user.planName, quality: user.qualityLabel }) : undefined}
              >
                {(item) => <Select.Item id={item.id} label={item.label} isDisabled={item.isDisabled} supportingText={item.supportingText} />}
              </Select>
            )}
            {dlAud && (
              <Select
                aria-label={t('downloader.audioQualityAriaLabel')}
                label={t('downloader.audio')}
                selectedKey={qualAud}
                onSelectionChange={(key) => setQualAud(String(key))}
                isDisabled={locked}
                items={AUDIO_QUALITY_OPTIONS}
              >
                {(item) => <Select.Item id={item.id} label={item.label} />}
              </Select>
            )}
            <Select
              aria-label={t('downloader.audioLangAriaLabel')}
              label={t('downloader.audioLang')}
              selectedKey={audioLang}
              onSelectionChange={(key) => setAudioLang(String(key))}
              isDisabled={locked}
              items={audioLangOptions}
              className={dlVid && dlAud ? 'sm:col-span-2' : undefined}
              hint={t('downloader.audioLangHint')}
            >
              {(item) => <Select.Item id={item.id} label={item.label} />}
            </Select>
          </div>
        </div>
      )}

      {/* Recorte */}
      {wantsMedia && (
        <div className="flex flex-col gap-3 rounded-xl bg-brand-primary p-4 ring-1 ring-brand-200 ring-inset">
          <Checkbox
            size="sm"
            isSelected={trim}
            onChange={setTrim}
            isDisabled={locked}
            label={
              <span className="inline-flex items-center gap-1.5">
                <Scissors01 className="size-4 text-fg-brand-primary" aria-hidden="true" />
                {t('downloader.trim')}
              </span>
            }
            hint={t('downloader.trimHint')}
          />
          {trim && (
            <div className="grid grid-cols-2 gap-3 animate-in fade-in duration-200">
              <Input
                label={t('downloader.from')}
                placeholder="00:00:00"
                value={timeStart}
                onChange={(v) => {
                  setTimeStart(v);
                  clearError('start');
                }}
                onBlur={() => {
                  const n = normalizeTime(timeStart);
                  if (n) setTimeStart(n);
                }}
                isInvalid={Boolean(errors.start)}
                hint={errors.start}
                isDisabled={locked}
              />
              <Input
                label={t('downloader.to')}
                placeholder="00:00:00"
                value={timeEnd}
                onChange={(v) => {
                  setTimeEnd(v);
                  clearError('end');
                }}
                onBlur={() => {
                  const n = normalizeTime(timeEnd);
                  if (n) setTimeEnd(n);
                }}
                isInvalid={Boolean(errors.end)}
                hint={errors.end}
                isDisabled={locked}
              />
              <p className="col-span-2 text-xs text-tertiary">{t('downloader.trimFormatHint')}</p>
            </div>
          )}
        </div>
      )}

      <Button
        size="xl"
        color="primary"
        className="w-full"
        iconLeading={Download01}
        isLoading={locked}
        isDisabled={locked}
        showTextWhileLoading
        onPress={handleDownload}
      >
        {locked ? t('downloader.downloading') : t('downloader.download')}
      </Button>

      {/* Progreso */}
      {locked && (
        <div className="flex flex-col gap-2" role="status" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium text-secondary">{job.message || t('downloader.starting')}</span>
            <AnimatedCounter value={job.percent} suffix="%" className="font-semibold text-primary" />
          </div>
          <ProgressBar value={job.percent} />
          <p className="text-xs text-tertiary">{t('downloader.keepTabOpen')}</p>
        </div>
      )}

      {/* Error */}
      {failure && !locked && (
        <div role="alert" className="flex gap-3 rounded-xl bg-error-primary p-4 ring-1 ring-error_subtle ring-inset">
          <FeaturedIcon icon={AlertCircle} color="error" theme="light" size="sm" className="shrink-0" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm font-semibold text-error-primary">{t('downloader.failedTitle')}</p>
            <p className="text-sm text-secondary">{failure.friendly}</p>
          </div>
        </div>
      )}

      {/* Resultado */}
      {isDone && (
        <div className="flex flex-col gap-3 rounded-xl bg-success-primary p-4 ring-1 ring-green-200 ring-inset animate-in fade-in duration-300">
          <div className="flex items-center gap-2">
            <FeaturedIcon icon={CheckCircle} color="success" theme="light" size="sm" />
            <p className="text-sm font-semibold text-success-primary">{t('downloader.doneTitle')}</p>
          </div>
          <p className="text-sm text-secondary">{t('downloader.doneText')}</p>
          <ul className="flex flex-col gap-2">
            {job.files.map((file) => {
              const { label, icon: Icon } = fileKind(file.name);
              return (
                <li key={file.name} className="flex items-center gap-3 rounded-lg bg-primary p-3 ring-1 ring-secondary ring-inset">
                  <FeaturedIcon icon={Icon} color="brand" theme="light" size="md" className="shrink-0" />
                  <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
                    <span className="max-w-full truncate text-sm font-medium text-primary" title={file.name}>
                      {file.name}
                    </span>
                    <Badge size="sm" color="brand">
                      {label}
                    </Badge>
                  </span>
                  <Button size="sm" color="secondary" iconLeading={Download01} href={file.url} download={file.name}>
                    {t('downloader.save')}
                  </Button>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-tertiary">{t('downloader.autoDelete')}</p>
        </div>
      )}
    </section>
  );
}
