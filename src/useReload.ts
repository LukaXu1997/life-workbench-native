import { useState, useCallback, useEffect, useRef } from 'react';
import { onChange } from './store';

// Reloads data when the store changes (any mutation emits onChange).
export function useReload<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const ref = useRef(loader);
  ref.current = loader;
  const reload = useCallback(() => {
    ref.current().then(setData);
  }, []);
  useEffect(() => {
    reload();
    return onChange(reload);
  }, [reload]);
  return [data, reload] as const;
}
