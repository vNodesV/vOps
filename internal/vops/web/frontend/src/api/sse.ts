export interface SSEMessage {
  event?: string;
  data: string;
}

export function openSSEStream(
  url: string,
  method: 'GET' | 'POST' = 'POST',
  onMessage: (msg: SSEMessage) => void,
  onDone?: () => void,
  onError?: (err: Error) => void,
  body?: unknown,
): () => void {
  const controller = new AbortController();

  const fetchOpts: RequestInit = {
    method,
    credentials: 'include',
    headers: {
      'Accept': 'text/event-stream',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    signal: controller.signal,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  };

  fetch(url, fetchOpts).then(async (res) => {
    if (!res.ok || !res.body) {
      onError?.(new Error(`SSE ${res.status}`));
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { onDone?.(); break; }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      let event: Partial<SSEMessage> = {};
      for (const line of lines) {
        if (line.startsWith('event:')) event.event = line.slice(6).trim();
        else if (line.startsWith('data:')) event.data = line.slice(5).trim();
        else if (line === '' && event.data !== undefined) {
          onMessage(event as SSEMessage);
          event = {};
        }
      }
    }
  }).catch((err: unknown) => {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    onError?.(err instanceof Error ? err : new Error(String(err)));
  });

  return () => controller.abort();
}
