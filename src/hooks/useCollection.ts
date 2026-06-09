import { useCallback, useEffect, useMemo, useState } from 'react';
import { dataService } from '../services/dataService';

type Params = Record<string, unknown> | undefined;

interface UseCollectionOptions {
  params?: Params;
  refreshMs?: number;
  paginated?: boolean;
}

interface UseCollectionResult<T> {
  data: T[];
  loading: boolean;
  error: Error | null;
  total: number;
  page: number;
  limit: number;
  refresh: () => Promise<void>;
}

export function useCollection<T = any>(
  collectionName: string,
  options: UseCollectionOptions = {}
): UseCollectionResult<T> {
  const { params, refreshMs, paginated = false } = options;
  const paramsKey = useMemo(() => JSON.stringify(params ?? {}), [params]);
  const stableParams = useMemo(() => params, [paramsKey]);
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (paginated) {
        const result = await dataService.getPaginated(collectionName, stableParams);
        setData(result.data as T[]);
        setTotal(result.total);
        setPage(result.page);
        setLimit(result.limit);
      } else {
        const result = await dataService.getAll(collectionName, stableParams);
        const list = Array.isArray(result) ? result : result?.data ?? [];
        setData(list);
        setTotal(Array.isArray(list) ? list.length : 0);
        setPage(1);
        setLimit(Array.isArray(list) ? list.length : 0);
      }
    } catch (err) {
      setError(err as Error);
      setData([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [collectionName, stableParams, paginated]);

  useEffect(() => {
    if (paginated) {
      load();
      return undefined;
    }

    const unsubscribe = dataService.subscribe(
      collectionName,
      (rows) => {
        setData(rows as T[]);
        setTotal(rows.length);
        setPage(1);
        setLimit(rows.length);
      },
      stableParams,
      refreshMs,
      (state) => {
        setLoading(state.loading);
        setError(state.error);
      }
    );
    return unsubscribe;
  }, [collectionName, stableParams, refreshMs, paginated, load]);

  return {
    data,
    loading,
    error,
    total,
    page,
    limit,
    refresh: load,
  };
}
