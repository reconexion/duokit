import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';
import { useI18n } from './i18n';

const POLL_INTERVAL_MS = 1000;

export function useJobPoller() {
  const { t } = useI18n();
  const [isRunning, setIsRunning] = useState(false);
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState([]);
  const pollRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const stop = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  // statusUrl/fetchImpl son opcionales: por defecto pregunta a nuestro propio backend (/api/status/:jobId, con
  // sesión). El Asistente de escritorio (helper/) usa este mismo poller pero contra su propio servidor local
  // (http://127.0.0.1:.../status/:jobId, sin sesión) — ver Downloader.jsx.
  const start = (jobId, { onDone, onError, statusUrl = (id) => `/api/status/${id}`, fetchImpl = apiFetch } = {}) => {
    setIsRunning(true);
    setFiles([]);
    setPercent(0);
    setMessage(t('downloader.starting'));

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetchImpl(statusUrl(jobId));
        if (!res.ok) throw new Error(t('downloader.statusError'));
        const data = await res.json();

        setPercent(data.percent ?? 0);
        setMessage(data.message || '');

        if (data.status === 'done') {
          stop();
          setIsRunning(false);
          setFiles(data.files || []);
          onDone?.(data);
        } else if (data.status === 'error') {
          stop();
          setIsRunning(false);
          onError?.(data);
        }
      } catch (err) {
        stop();
        setIsRunning(false);
        onError?.({ error: err.message });
      }
    }, POLL_INTERVAL_MS);
  };

  return { isRunning, percent, message, files, start, stop };
}
