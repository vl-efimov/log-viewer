import type { ParsedLogLine } from './logFormatDetector';

export function parseTimestamp(timestamp: string): Date | null {
    if (!timestamp) return null;

    const directParse = new Date(timestamp);
    if (!isNaN(directParse.getTime())) {
        return directParse;
    }

    const hdfsMatch = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})[,.](\d{3})?/);
    if (hdfsMatch) {
        const [, year, month, day, hour, min, sec, ms] = hdfsMatch;
        return new Date(
            parseInt(year, 10),
            parseInt(month, 10) - 1,
            parseInt(day, 10),
            parseInt(hour, 10),
            parseInt(min, 10),
            parseInt(sec, 10),
            parseInt(ms || '0', 10),
        );
    }

    // Compact HDFS style: YYMMDD HHMMSS[,fraction]
    const compactHdfsMatch = timestamp.match(/^(\d{2})(\d{2})(\d{2})\s+(\d{2})(\d{2})(\d{2})(?:[,.](\d{1,6}))?$/);
    if (compactHdfsMatch) {
        const [, yy, month, day, hour, min, sec, fraction] = compactHdfsMatch;
        const year = parseInt(yy, 10) < 50 ? `20${yy}` : `19${yy}`;
        const millis = fraction
            ? Math.floor(parseInt(fraction.padEnd(6, '0').slice(0, 6), 10) / 1000)
            : 0;

        return new Date(
            parseInt(year, 10),
            parseInt(month, 10) - 1,
            parseInt(day, 10),
            parseInt(hour, 10),
            parseInt(min, 10),
            parseInt(sec, 10),
            millis,
        );
    }

    const apacheMatch = timestamp.match(/^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})/);
    if (apacheMatch) {
        const [, month, day, hour, min, sec, year] = apacheMatch;
        const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(month);
        if (monthIndex >= 0) {
            return new Date(
                parseInt(year, 10),
                monthIndex,
                parseInt(day, 10),
                parseInt(hour, 10),
                parseInt(min, 10),
                parseInt(sec, 10),
            );
        }
    }

    const accessMatch = timestamp.match(/^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})/);
    if (accessMatch) {
        const [, day, month, year, hour, min, sec] = accessMatch;
        const monthIndex = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(month);
        if (monthIndex >= 0) {
            return new Date(
                parseInt(year, 10),
                monthIndex,
                parseInt(day, 10),
                parseInt(hour, 10),
                parseInt(min, 10),
                parseInt(sec, 10),
            );
        }
    }

    const bglOldMatch = timestamp.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})\.(\d{2})\.(\d{2})\.(\d{1,6})$/);
    if (bglOldMatch) {
        const [, year, month, day, hour, min, sec, micros] = bglOldMatch;
        const ms = Math.floor(parseInt(micros.padEnd(6, '0').slice(0, 6), 10) / 1000);
        return new Date(
            parseInt(year, 10),
            parseInt(month, 10) - 1,
            parseInt(day, 10),
            parseInt(hour, 10),
            parseInt(min, 10),
            parseInt(sec, 10),
            ms,
        );
    }

    return null;
}

export function extractTimestampFromParsedLine(parsed: ParsedLogLine): number | null {
    const directCandidates = [parsed.fields.timestamp, parsed.fields.datetime];

    for (const candidate of directCandidates) {
        if (!candidate) continue;
        const ts = parseTimestamp(candidate);
        if (ts) {
            return ts.getTime();
        }
    }

    if (parsed.fields.date && parsed.fields.time) {
        const msPart = parsed.fields.milliseconds || parsed.fields.ms;
        const combined = msPart
            ? `${parsed.fields.date} ${parsed.fields.time},${msPart}`
            : `${parsed.fields.date} ${parsed.fields.time}`;
        const ts = parseTimestamp(combined);
        if (ts) {
            return ts.getTime();
        }
    }

    if (parsed.fields.date) {
        const ts = parseTimestamp(parsed.fields.date);
        if (ts) {
            return ts.getTime();
        }
    }

    return null;
}