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
import { useJobPoller } from './useJobPoller';

const VIDEO_QUALITY_OPTIONS = ['480p', '720p', '1080p', '2K', '4K'].map((id) => ({ id, label: id }));
const AUDIO_QUALITY_OPTIONS = ['64k', '128k', '192k', '256k', '320k'].map((id) => ({ id, label: `${id}bps` }));

const AUDIO_LANG_OPTIONS = [
  { id: 'original', label: 'Original (automático)' },
  { id: 'es', label: 'Español' },
  { id: 'en', label: 'Inglés' },
  { id: 'pt', label: 'Portugués' },
  { id: 'fr', label: 'Francés' },
  { id: 'de', label: 'Alemán' },
  { id: 'ja', label: 'Japonés' },
  { id: 'ko', label: 'Coreano' },
  { id: 'it', label: 'Italiano' },
  { id: 'ru', label: 'Ruso' },
  { id: 'hi', label: 'Hindi' },
  { id: 'ar', label: 'Árabe' },
];

const TIME_HINT = 'Usa horas:minutos:segundos, por ejemplo 00:01:30.';

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

function friendlyError(raw = '') {
  if (/precondition|not available|sign in|unable to extract/i.test(raw)) {
    return 'YouTube cambió algo y yt-dlp quedó desactualizado. Actualízalo e inténtalo de nuevo.';
  }
  if (/no se pudo ejecutar yt-dlp/i.test(raw)) {
    return 'No encuentro yt-dlp en tu equipo. Instálalo y vuelve a intentarlo.';
  }
  return 'Revisa el enlace e inténtalo de nuevo.';
}

const FILE_KIND = {
  mp4: { label: 'Video', icon: VideoRecorder },
  mp3: { label: 'Audio', icon: MusicNote01 },
  jpg: { label: 'Miniatura', icon: Image01 },
};
const fileKind = (name) => FILE_KIND[name.split('.').pop().toLowerCase()] ?? { label: 'Archivo', icon: File06 };

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
  const [failure, setFailure] = useState(null);

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
      setErrors((prev) => ({ ...prev, url: 'No pude leer el portapapeles. Pega el enlace con Ctrl+V.' }));
    }
  };

  const handleDownload = async () => {
    setFailure(null);
    const next = {};
    const url = ytUrl.trim();
    if (!url.includes('youtube.com')) {
      next.url = 'Pega un enlace de youtube.com (los enlaces cortos youtu.be todavía no funcionan).';
    }
    if (!wantsMedia && !dlThumb) {
      next.kind = 'Elige al menos una opción para descargar.';
    }
    const start = trim && wantsMedia ? normalizeTime(timeStart) : '';
    const end = trim && wantsMedia ? normalizeTime(timeEnd) : '';
    if (start === null) next.start = TIME_HINT;
    if (end === null) next.end = TIME_HINT;
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
        throw new Error(data.error || 'No se pudo iniciar la descarga.');
      }

      const data = await res.json();
      job.start(data.jobId, {
        onError: (d) => setFailure(d.error || 'La descarga falló.'),
      });
    } catch (err) {
      setFailure(err.message);
    }
  };

  return (
    <section className="relative flex w-full flex-col gap-7 rounded-2xl bg-primary p-5 shadow-xl shadow-brand-600/10 ring-1 ring-brand-200 sm:p-8">
      {/* Enlace */}
      <div className="flex flex-col gap-2">
        <SectionTitle
          aside={
            <Button size="sm" color="link-color" iconLeading={Clipboard} isDisabled={locked} onPress={pasteFromClipboard}>
              Pegar
            </Button>
          }
        >
          Enlace del video
        </SectionTitle>
        <Input
          aria-label="Enlace del video de YouTube"
          size="md"
          icon={Link01}
          placeholder="https://www.youtube.com/watch?v=..."
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
        <SectionTitle>¿Qué quieres descargar?</SectionTitle>
        <div className="grid grid-cols-3 gap-3">
          <OptionTile
            icon={VideoRecorder}
            title="Video"
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
            title="Audio"
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
            title="Miniatura"
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
          <SectionTitle>Calidad</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            {dlVid && (
              <Select
                aria-label="Calidad del video"
                label="Video"
                selectedKey={qualVid}
                onSelectionChange={(key) => setQualVid(String(key))}
                isDisabled={locked}
                items={VIDEO_QUALITY_OPTIONS}
              >
                {(item) => <Select.Item id={item.id} label={item.label} />}
              </Select>
            )}
            {dlAud && (
              <Select
                aria-label="Calidad del audio"
                label="Audio"
                selectedKey={qualAud}
                onSelectionChange={(key) => setQualAud(String(key))}
                isDisabled={locked}
                items={AUDIO_QUALITY_OPTIONS}
              >
                {(item) => <Select.Item id={item.id} label={item.label} />}
              </Select>
            )}
            <Select
              aria-label="Idioma del audio"
              label="Idioma del audio"
              selectedKey={audioLang}
              onSelectionChange={(key) => setAudioLang(String(key))}
              isDisabled={locked}
              items={AUDIO_LANG_OPTIONS}
              className={dlVid && dlAud ? 'sm:col-span-2' : undefined}
              hint="Si el video tiene doblajes, aquí eliges cuál descargar."
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
                Recortar un fragmento
              </span>
            }
            hint="Descarga solo una parte, no el video completo."
          />
          {trim && (
            <div className="grid grid-cols-2 gap-3 animate-in fade-in duration-200">
              <Input
                label="Desde"
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
                label="Hasta"
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
              <p className="col-span-2 text-xs text-tertiary">
                Formato horas:minutos:segundos. Si dejas uno vacío, se usa el inicio o el final del video.
              </p>
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
        {locked ? 'Descargando...' : 'Descargar'}
      </Button>

      {/* Progreso */}
      {locked && (
        <div className="flex flex-col gap-2" role="status" aria-live="polite">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium text-secondary">{job.message || 'Iniciando...'}</span>
            <AnimatedCounter value={job.percent} suffix="%" className="font-semibold text-primary" />
          </div>
          <ProgressBar value={job.percent} />
          <p className="text-xs text-tertiary">Puedes dejar esta pestaña abierta mientras termina.</p>
        </div>
      )}

      {/* Error */}
      {failure && !locked && (
        <div role="alert" className="flex gap-3 rounded-xl bg-error-primary p-4 ring-1 ring-error_subtle ring-inset">
          <FeaturedIcon icon={AlertCircle} color="error" theme="light" size="sm" className="shrink-0" />
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm font-semibold text-error-primary">No se pudo descargar</p>
            <p className="text-sm text-secondary">{friendlyError(failure)}</p>
            <details className="text-xs text-tertiary">
              <summary className="cursor-pointer select-none">Ver detalle técnico</summary>
              <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-primary p-2 break-words whitespace-pre-wrap">{failure}</pre>
            </details>
          </div>
        </div>
      )}

      {/* Resultado */}
      {isDone && (
        <div className="flex flex-col gap-3 rounded-xl bg-success-primary p-4 ring-1 ring-green-200 ring-inset animate-in fade-in duration-300">
          <div className="flex items-center gap-2">
            <FeaturedIcon icon={CheckCircle} color="success" theme="light" size="sm" />
            <p className="text-sm font-semibold text-success-primary">Listo, tu navegador está guardando el archivo</p>
          </div>
          <p className="text-sm text-secondary">
            Búscalo en la barra de descargas de tu navegador (arriba) y ábrelo desde ahí. Si no aparece, usa Guardar.
          </p>
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
                    Guardar
                  </Button>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-tertiary">No se guarda nada en el servidor: estos archivos se borran solos a los 10 minutos.</p>
        </div>
      )}
    </section>
  );
}
