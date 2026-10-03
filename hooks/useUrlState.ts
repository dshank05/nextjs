import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';

/**
 * useState, but the value is mirrored in the URL query string.
 *
 * Every settings list page kept its search, sort and page number in plain
 * component state, so all of it was lost on a refresh and on every return from
 * an edit - and a filtered list could not be linked or bookmarked (F-49).
 *
 * Deliberately shaped as a drop-in for useState so each page changes by one
 * line per value rather than being restructured around a new state container.
 *
 * Notes on the mechanics:
 * - `router.query` is empty until `router.isReady` on the pages router, so the
 *   value is hydrated from the URL once, when the router becomes ready, rather
 *   than during the first render.
 * - Writes use `router.replace` with `shallow: true`: the URL updates without
 *   a navigation, and the back button is not filled with one entry per
 *   keystroke.
 * - A value equal to its default is removed from the query, so an untouched
 *   page keeps a clean URL.
 */
/** Query writes made in the same tick, replaced together (see `set`). */
let pendingQuery: Record<string, any> | null = null;

export function useUrlState<T extends string | number>(
  key: string,
  defaultValue: T
): [T, (next: T) => void] {
  const router = useRouter();
  const [value, setValue] = useState<T>(defaultValue);
  const hydrated = useRef(false);

  useEffect(() => {
    if (!router.isReady || hydrated.current) return;
    hydrated.current = true;

    const raw = router.query[key];
    const text = Array.isArray(raw) ? raw[0] : raw;
    if (text === undefined || text === '') return;

    if (typeof defaultValue === 'number') {
      const parsed = Number(text);
      if (!Number.isNaN(parsed)) setValue(parsed as T);
    } else {
      setValue(text as T);
    }
    // defaultValue and key are fixed for the life of the component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady]);

  const set = useCallback(
    (next: T) => {
      setValue(next);

      if (!router.isReady) return;

      // Several setters can run in one event (a new sort column sets sortBy AND
      // sortOrder). Each used to copy the same stale router.query, so the second
      // replace wiped the first and the URL lost sortBy. Writes made in the same
      // tick are merged into one pending query and replaced once.
      const query = pendingQuery ?? { ...router.query };
      if (next === defaultValue || next === '') {
        delete query[key];
      } else {
        query[key] = String(next);
      }
      if (pendingQuery) return;
      pendingQuery = query;
      const pathname = router.pathname;
      Promise.resolve().then(() => {
        const merged = pendingQuery;
        pendingQuery = null;
        router.replace({ pathname, query: merged }, undefined, {
          shallow: true,
          scroll: false,
        });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router.isReady, router.query, key]
  );

  return [value, set];
}
