import { useEffect, useState } from 'react';
import Spinner from './Spinner';
import { useTasks } from '../contexts/TaskContext';
import type { Task } from '../contexts/TaskContext';

function TaskPill({ task, onRemove }: { task: Task; onRemove: (id: string) => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (task.status !== 'running') return;
    setElapsed(Math.floor((Date.now() - task.startedAt.getTime()) / 1000));
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - task.startedAt.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [task.status, task.startedAt]);

  const truncDetail = task.detail ? task.detail.slice(0, 40) : '';
  const hasMore = task.detail ? task.detail.length > 40 : false;

  const pillStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.35rem',
    fontSize: '0.78rem',
    padding: '0.25rem 0.65rem',
    borderRadius: '999px',
    cursor: 'pointer',
    userSelect: 'none',
    border: '1px solid',
    position: 'relative',
    ...(task.status === 'running' ? {
      borderColor: 'var(--vn-border)',
      background: 'var(--vn-surface-2)',
      color: 'var(--vn-text)',
    } : task.status === 'done' ? {
      borderColor: 'var(--vn-success)',
      background: 'transparent',
      color: 'var(--vn-success)',
    } : {
      borderColor: 'var(--vn-danger)',
      background: 'transparent',
      color: 'var(--vn-danger)',
    }),
  };

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <div style={pillStyle} onClick={() => setExpanded(e => !e)}>
        {task.status === 'running' && <Spinner size={12} label="" />}
        {task.status === 'done' && <span aria-hidden="true">✓</span>}
        {task.status === 'error' && <span aria-hidden="true">✕</span>}
        <span>{task.label}</span>
        {task.status === 'running' && (
          <span style={{ color: 'var(--vn-text-muted)', fontSize: '0.72rem' }}>{elapsed}s</span>
        )}
        {task.status === 'error' && truncDetail && (
          <span style={{ opacity: 0.8, fontSize: '0.72rem' }}>
            {truncDetail}{hasMore ? '…' : ''}
          </span>
        )}
        {task.status === 'error' && (
          <button
            onClick={e => { e.stopPropagation(); onRemove(task.id); }}
            style={{
              marginLeft: '0.15rem',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'inherit',
              padding: 0,
              fontSize: '0.9rem',
              lineHeight: 1,
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
      {expanded && task.detail && (
        <div style={{
          position: 'absolute',
          bottom: 'calc(100% + 6px)',
          left: 0,
          minWidth: 200,
          maxWidth: 360,
          background: 'var(--vn-surface)',
          border: '1px solid var(--vn-border)',
          borderRadius: 'var(--vn-radius)',
          padding: '0.5rem 0.75rem',
          fontSize: '0.75rem',
          color: 'var(--vn-text)',
          zIndex: 1001,
          boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          wordBreak: 'break-word',
          whiteSpace: 'pre-wrap',
        }}>
          {task.detail}
        </div>
      )}
    </div>
  );
}

export default function TaskBar() {
  const { tasks, removeTask } = useTasks();
  if (tasks.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 900,
        background: 'var(--vn-surface)',
        borderTop: '1px solid var(--vn-border)',
        padding: '0.4rem 1rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        flexWrap: 'wrap',
        minHeight: '48px',
      }}
    >
      {tasks.map(task => (
        <TaskPill key={task.id} task={task} onRemove={removeTask} />
      ))}
    </div>
  );
}
