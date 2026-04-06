import { useState, useEffect, useRef, useCallback } from 'react';
import { openSSEStream } from '../api/sse';
import Spinner from './Spinner';

interface SSEStreamProps {
  url: string;
  method?: 'GET' | 'POST';
  /** Called when the stream ends successfully. */
  onDone?: () => void;
  /** Called for each incoming SSE data payload (raw JSON string). */
  onMessage?: (data: string) => void;
}

type StreamState = 'connecting' | 'streaming' | 'done' | 'error';

export default function SSEStream({ url, method = 'POST', onDone, onMessage }: SSEStreamProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [state, setState] = useState<StreamState>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    setLines([]);
    setState('connecting');
    setErrorMsg('');

    const cancel = openSSEStream(
      url,
      method,
      (msg) => {
        setState('streaming');
        setLines((prev) => [...prev, msg.data]);
        onMessage?.(msg.data);
      },
      () => {
        setState('done');
        onDone?.();
      },
      (err) => {
        setState('error');
        setErrorMsg(err.message);
      },
    );

    return cancel;
  }, [url, method, onDone, onMessage]);

  useEffect(() => {
    scrollToBottom();
  }, [lines, scrollToBottom]);

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{
        backgroundColor: 'var(--vn-surface-2)',
        border: '1px solid var(--vn-border)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 text-xs font-medium"
        style={{ borderBottom: '1px solid var(--vn-border)', color: 'var(--vn-text-muted)' }}
      >
        <span>Live Output</span>
        {state === 'connecting' && (
          <span className="flex items-center gap-1">
            <Spinner size={12} label="Connecting" /> Connecting…
          </span>
        )}
        {state === 'streaming' && (
          <span className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: 'var(--vn-success)' }}
              aria-hidden="true"
            />
            Streaming
          </span>
        )}
        {state === 'done' && (
          <span className="flex items-center gap-1" style={{ color: 'var(--vn-success)' }}>
            ✓ Complete
          </span>
        )}
        {state === 'error' && (
          <span style={{ color: 'var(--vn-danger)' }} role="alert">
            ✗ Error
          </span>
        )}
      </div>

      {/* Output */}
      <div
        className="overflow-y-auto p-3 font-mono text-xs leading-relaxed"
        style={{ maxHeight: '320px', color: 'var(--vn-text)' }}
        role="log"
        aria-live="polite"
        aria-label="Stream output"
      >
        {lines.length === 0 && state === 'connecting' && (
          <Spinner size={16} label="Waiting for output" />
        )}
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap break-all">
            {line}
          </div>
        ))}
        {state === 'error' && errorMsg && (
          <div style={{ color: 'var(--vn-danger)' }} role="alert">
            Error: {errorMsg}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
