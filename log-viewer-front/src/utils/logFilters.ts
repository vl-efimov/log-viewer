import type { LogFilters } from '../types/filters';
import type { ParsedLogLine } from './logFormatDetector';

interface LogLineWithRaw {
    lineNumber: number;
    parsed: ParsedLogLine | null;
    raw: string;
    error?: string;
}

/**
 * Apply filters to log lines.
 * Important: Unparsed lines are treated as part of the nearest parsed line above them (stacktrace).
 * If a parsed line matches filters, all unparsed lines below it (until next parsed line) are included.
 */
export function applyLogFilters(
    lines: LogLineWithRaw[],
    filters: LogFilters
): LogLineWithRaw[] {
    // If no filters active, return all lines
    if (Object.keys(filters).length === 0 || !hasActiveFilters(filters)) {
        return lines;
    }

    const result: LogLineWithRaw[] = [];
    let lastMatchedParsedLine: LogLineWithRaw | null = null;
    let collectingStacktrace = false;

    for (const line of lines) {
        if (line.parsed) {
            // This is a parsed line - check if it matches filters
            const matches = matchesFilters(line, filters);
            
            if (matches) {
                result.push(line);
                lastMatchedParsedLine = line;
                collectingStacktrace = true;
            } else {
                lastMatchedParsedLine = null;
                collectingStacktrace = false;
            }
        } else {
            // This is an unparsed line (likely stacktrace or continuation)
            // Include it if the last parsed line matched
            if (collectingStacktrace && lastMatchedParsedLine) {
                result.push(line);
            }
        }
    }

    return result;
}

/**
 * Check if there are any active filters
 */
function hasActiveFilters(filters: LogFilters): boolean {
    for (const [, value] of Object.entries(filters)) {
        if (!value) continue;
        
        // Check date range filters
        if (typeof value === 'object' && ('start' in value || 'end' in value)) {
            const dateRange = value as { start?: Date | null; end?: Date | null };
            if (dateRange.start !== undefined && dateRange.start !== null) return true;
            if (dateRange.end !== undefined && dateRange.end !== null) return true;
        }
        // Check array filters (like level)
        else if (Array.isArray(value) && value.length > 0) {
            return true;
        }
        // Check text filters
        else if (typeof value === 'object' && 'value' in value) {
            const textFilter = value as { value: string };
            if (textFilter.value && textFilter.value.trim().length > 0) return true;
        }
    }
    return false;
}

/**
 * Check if a single log line matches the filters
 */
function matchesFilters(line: LogLineWithRaw, filters: LogFilters): boolean {
    const parsed = line.parsed;
    if (!parsed) return false;

    const fields = parsed.fields;

    // Check each filter
    for (const [filterKey, filterValue] of Object.entries(filters)) {
        if (!filterValue) continue;

        // Handle date range filters
        if (typeof filterValue === 'object' && ('start' in filterValue || 'end' in filterValue)) {
            const dateRange = filterValue as { start?: Date | null; end?: Date | null };
            const fieldValue = fields[filterKey];
            
            if (fieldValue && (dateRange.start || dateRange.end)) {
                const logDate = new Date(fieldValue);
                
                if (dateRange.start) {
                    const startDate = new Date(dateRange.start);
                    if (logDate < startDate) return false;
                }
                
                if (dateRange.end) {
                    const endDate = new Date(dateRange.end);
                    if (logDate > endDate) return false;
                }
            }
        }
        // Handle enum/array filters (level, status, method, queue, etc.)
        else if (Array.isArray(filterValue) && filterValue.length > 0) {
            // Get value from the field that matches the filter key
            const fieldValue = fields[filterKey];
            if (!fieldValue) return false;
            
            // Case-insensitive comparison
            const normalizedFieldValue = fieldValue.toUpperCase();
            if (!filterValue.some(v => v.toUpperCase() === normalizedFieldValue)) {
                return false;
            }
        }
        // Handle text filters
        else if (typeof filterValue === 'object' && 'value' in filterValue) {
            const textFilter = filterValue as { value: string };
            if (textFilter.value) {
                const searchTerm = textFilter.value.toLowerCase();
                const fieldValue = fields[filterKey];
                
                if (!fieldValue || !fieldValue.toLowerCase().includes(searchTerm)) {
                    return false;
                }
            }
        }
    }

    return true;
}

/**
 * Get count of filtered results
 */
export function getFilteredCount(
    lines: LogLineWithRaw[],
    filters: LogFilters
): { total: number; filtered: number; parsedFiltered: number } {
    const total = lines.length;
    const filtered = applyLogFilters(lines, filters).length;
    
    // Count only parsed lines that matched
    const parsedFiltered = applyLogFilters(lines, filters)
        .filter(line => line.parsed !== null)
        .length;

    return { total, filtered, parsedFiltered };
}
