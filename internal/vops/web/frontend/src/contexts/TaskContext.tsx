import React, { createContext, useCallback, useContext, useRef, useState } from 'react';

export interface Task {
  id: string;
  label: string;
  status: 'running' | 'done' | 'error';
  startedAt: Date;
  detail?: string;
}

interface TaskContextValue {
  tasks: Task[];
  addTask: (task: Task) => void;
  updateTask: (id: string, patch: Partial<Omit<Task, 'id'>>) => void;
  removeTask: (id: string) => void;
}

const TaskContext = createContext<TaskContextValue | null>(null);

export function TaskProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeTask = useCallback((id: string) => {
    const t = timers.current.get(id);
    if (t) { clearTimeout(t); timers.current.delete(id); }
    setTasks(prev => prev.filter(task => task.id !== id));
  }, []);

  const scheduleRemoval = useCallback((id: string) => {
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => removeTask(id), 10_000);
    timers.current.set(id, timer);
  }, [removeTask]);

  const addTask = useCallback((task: Task) => {
    setTasks(prev => {
      const exists = prev.find(t => t.id === task.id);
      return exists ? prev.map(t => t.id === task.id ? task : t) : [...prev, task];
    });
    if (task.status === 'done') {
      scheduleRemoval(task.id);
    }
  }, [scheduleRemoval]);

  const updateTask = useCallback((id: string, patch: Partial<Omit<Task, 'id'>>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
    if (patch.status === 'done') {
      scheduleRemoval(id);
    }
  }, [scheduleRemoval]);

  return (
    <TaskContext.Provider value={{ tasks, addTask, updateTask, removeTask }}>
      {children}
    </TaskContext.Provider>
  );
}

export function useTasks(): TaskContextValue {
  const ctx = useContext(TaskContext);
  if (!ctx) throw new Error('useTasks must be used within a TaskProvider');
  return ctx;
}
