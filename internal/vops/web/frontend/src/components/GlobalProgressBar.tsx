import { useIsFetching } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

// Only show after this many ms of continuous fetching — avoids flash on fast responses.
const DELAY_MS = 400;

export default function GlobalProgressBar() {
  const count = useIsFetching();
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (count > 0) {
      if (!timerRef.current && !show) {
        timerRef.current = setTimeout(() => {
          setShow(true);
          timerRef.current = null;
        }, DELAY_MS);
      }
    } else {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setShow(false);
    }
  }, [count, show]);

  if (!show) return null;

  return (
    <div aria-hidden="true" className="global-progress-bar">
      <div className="global-progress-bar__fill" />
    </div>
  );
}
