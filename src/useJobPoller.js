import { useEffect, useRef, useState } from 'react';
import { apiFetch } from './api';

const POLL_INTERVAL_MS = 1000;

export function useJobPoller() {
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

  const start = (jobId, { onDone, onError } = {}) => {
    setIsRunning(true);
    setFiles([]);
    setPercent(0);
    setMessage('Iniciando...');

    pollRef.current = setInterval(async () => {
      try {
        const res = await apiFetch(`/api/status/${jobId}`);
        if (!res.ok) throw new Error('No se pudo obtener el estado.');
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
