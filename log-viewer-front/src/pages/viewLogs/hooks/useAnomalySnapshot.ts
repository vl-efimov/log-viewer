import { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import {
    clearAnomalyResults,
    setAnomalyResults,
} from '../../../redux/slices/anomalySlice';
import {
    deleteAnomalySnapshot,
    getAnomalySnapshot,
    saveAnomalySnapshot,
} from '../../../utils/logIndexedDb';

interface UseAnomalySnapshotOptions {
    storageKey: string;
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
        start_line: number;
        end_line: number;
        start_timestamp: string | null;
        end_timestamp: string | null;
    }>;
    lineNumbers: number[];
    rowsCount: number;
}

export const useAnomalySnapshot = ({
    storageKey,
    hasResults,
    lastAnalyzedAt,
    lastModelId,
    lastRunParams,
    regions,
    lineNumbers,
    rowsCount,
}: UseAnomalySnapshotOptions) => {
    const dispatch = useDispatch();
    const [isHydrated, setIsHydrated] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setIsHydrated(false);

        const loadSnapshot = async () => {
            if (!storageKey) {
                if (!cancelled) {
                    dispatch(clearAnomalyResults());
                    setIsHydrated(true);
                }
                return;
            }

            const snapshot = await getAnomalySnapshot(storageKey);
            if (cancelled) {
                return;
            }

            if (snapshot) {
                dispatch(setAnomalyResults({
                    regions: snapshot.regions,
                    lineNumbers: snapshot.lineNumbers,
                    rowsCount: snapshot.rowsCount,
                    analyzedAt: snapshot.analyzedAt,
                    modelId: snapshot.modelId,
                    params: snapshot.params,
                }));
            } else {
                dispatch(clearAnomalyResults());
            }

            setIsHydrated(true);
        };

        void loadSnapshot();

        return () => {
            cancelled = true;
        };
    }, [dispatch, storageKey]);

    useEffect(() => {
        if (!isHydrated || !storageKey) {
            return;
        }

        if (!hasResults || !lastAnalyzedAt || !lastModelId || !lastRunParams) {
            void deleteAnomalySnapshot(storageKey);
            return;
        }

        void saveAnomalySnapshot(storageKey, {
            regions,
            lineNumbers,
            rowsCount,
            analyzedAt: lastAnalyzedAt,
            modelId: lastModelId,
            params: lastRunParams,
        });
    }, [
        hasResults,
        isHydrated,
        lastAnalyzedAt,
        lastModelId,
        lastRunParams,
        lineNumbers,
        regions,
        rowsCount,
        storageKey,
    ]);
};
