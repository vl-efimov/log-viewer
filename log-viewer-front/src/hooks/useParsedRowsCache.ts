import { useCallback, useRef } from 'react';
import type { ParsedLogLine } from '../utils/logFormatDetector';
import { parseLogLineAuto } from '../utils/logFormatDetector';
import { LRUCache } from '../utils/lruCache';

type ViewRow = {
    lineNumber: number;
    raw: string;
};

type ViewParsedLine = {
    lineNumber: number;
    parsed: ParsedLogLine | null;
    raw: string;
    error?: string;
};

type ParsedRowCacheEntry = {
    raw: string;
    parsed: ParsedLogLine | null;
    error?: string;
};

const DEFAULT_PARSED_ROWS_CACHE_CAPACITY = 20000;

export const useParsedRowsCache = (capacity = DEFAULT_PARSED_ROWS_CACHE_CAPACITY) => {
    const cacheRef = useRef<LRUCache<number, ParsedRowCacheEntry>>(new LRUCache<number, ParsedRowCacheEntry>(capacity));

    const clearParsedRowCache = useCallback(() => {
        cacheRef.current.clear();
    }, []);

    const getParsedRow = useCallback((row: ViewRow): ViewParsedLine => {
        const cached = cacheRef.current.get(row.lineNumber);
        if (cached && cached.raw === row.raw) {
            return {
                lineNumber: row.lineNumber,
                raw: row.raw,
                parsed: cached.parsed,
                ...(cached.error ? { error: cached.error } : {}),
            };
        }

        let parsed: ParsedLogLine | null = null;
        let error: string | undefined;

        try {
            parsed = parseLogLineAuto(row.raw);
        } catch (e) {
            error = String(e);
        }

        cacheRef.current.set(row.lineNumber, {
            raw: row.raw,
            parsed,
            ...(error ? { error } : {}),
        });

        return {
            lineNumber: row.lineNumber,
            raw: row.raw,
            parsed,
            ...(error ? { error } : {}),
        };
    }, []);

    return {
        getParsedRow,
        clearParsedRowCache,
    };
};
