import { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import {
    clearAnomalyResults,
    setAnomalyResults,
} from '../../../redux/slices/anomalySlice';
import {
    getAnomalySnapshot,
    pruneAnomalySnapshots,
    saveAnomalySnapshot,
} from '../../../utils/logIndexedDb';

interface UseAnomalySnapshotOptions {
    storageKey: string;
    isRunning: boolean;
    hasResults: boolean;
    lastAnalyzedAt: number | null;
    lastModelId: 'bgl' | 'hdfs' | null;
    lastRunParams: {
        threshold: number;
        stepSize: number;
        minRegionLines: number;
        analysisScope: 'all' | 'filtered';
        timestampColumn: 'auto' | 'timestamp' | 'datetime' | 'time' | 'date' | 'event_time' | 'created_at';
    } | null;
    regions: Array<{
        start_index: number;
        end_index: number;
        start_line: number;
        end_line: number;
        count: number;
        start_timestamp: string | null;
        end_timestamp: string | null;
    }>;
    rowsCount: number;
    totalRows: number;
}

export const useAnomalySnapshot = ({
    storageKey,
    isRunning,
    hasResults,
    lastAnalyzedAt,
    lastModelId,
    lastRunParams,
    regions,
    rowsCount,
    totalRows,
}: UseAnomalySnapshotOptions) => {
    const dispatch = useDispatch();
    const [isHydrated, setIsHydrated] = useState(false);
    const previousStorageKeyRef = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const previousStorageKey = previousStorageKeyRef.current;
        const storageKeyChanged = previousStorageKey !== null && previousStorageKey !== storageKey;
        previousStorageKeyRef.current = storageKey;
        setIsHydrated(false);

        const loadSnapshot = async () => {
            if (!storageKey) {
                if (!cancelled) {
                    if (!isRunning) {
                        dispatch(clearAnomalyResults());
                    }
                    setIsHydrated(true);
                }
                return;
            }

            await pruneAnomalySnapshots(storageKey);
            const snapshot = await getAnomalySnapshot(storageKey);
            if (cancelled) {
                return;
            }

            if (snapshot) {
                dispatch(setAnomalyResults({
                    regions: snapshot.regions,
                    lineNumbers: snapshot.lineNumbers ?? [],
                    rowsCount: snapshot.rowsCount,
                    totalRows: snapshot.totalRows ?? snapshot.rowsCount,
                    analyzedAt: snapshot.analyzedAt,
                    modelId: snapshot.modelId,
                    params: snapshot.params,
                }));
            } else if (!isRunning && (storageKeyChanged || !hasResults)) {
                dispatch(clearAnomalyResults());
            }

            setIsHydrated(true);
        };

        void loadSnapshot();

        return () => {
            cancelled = true;
        };
    }, [dispatch, hasResults, isRunning, storageKey]);

    useEffect(() => {
        if (!isHydrated || !storageKey) {
            return;
        }

        if (!hasResults || !lastAnalyzedAt || !lastModelId || !lastRunParams) {
            // Keep latest snapshot until an explicit replacement (new calculation)
            // or full DB/session cleanup happens.
            void pruneAnomalySnapshots(storageKey);
            return;
        }

        void (async () => {
            await saveAnomalySnapshot(storageKey, {
                regions,
                rowsCount,
                totalRows,
                analyzedAt: lastAnalyzedAt,
                modelId: lastModelId,
                params: lastRunParams,
            });
            await pruneAnomalySnapshots(storageKey);
        })();
    }, [
        hasResults,
        isHydrated,
        lastAnalyzedAt,
        lastModelId,
        lastRunParams,
        regions,
        rowsCount,
        totalRows,
        storageKey,
    ]);
};
