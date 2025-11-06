/**
 * Log format detection configuration
 * Each format has a name, description, patterns for detection, and priority
 */

export interface LogFormatField {
    /** Field name (matches named capture group in regex) */
    name: string;
    /** Human-readable description of the field */
    description: string;
    /** Data type of the field */
    type: 'string' | 'number' | 'datetime' | 'date' | 'time' | 'duration';
    /** Whether this field is optional */
    optional?: boolean;
}

export interface LogFormatPattern {
    /** Unique identifier for the log format */
    id: string;
    /** Display name of the log format */
    name: string;
    /** Description of the log format */
    description: string;
    /** Array of regex patterns to test against log content (with named capture groups) */
    patterns: RegExp[];
    /** 
     * Priority for detection (higher = checked first)
     * Use this to ensure more specific patterns are checked before generic ones
     */
    priority: number;
    /** 
     * Optional: Additional validation function for complex detection logic
     * Returns true if the format matches
     */
    validate?: (content: string) => boolean;
    /** 
     * Field definitions describing what each named capture group represents
     */
    fields?: LogFormatField[];
}

/**
 * Result of parsing a log line with a specific format
 */
export interface ParsedLogLine {
    /** The format that was used to parse this line */
    formatId: string;
    /** The extracted fields as key-value pairs */
    fields: Record<string, string>;
    /** The original log line */
    raw: string;
}

/**
 * Predefined log format patterns
 * Ordered by priority (higher priority formats are checked first)
 */
export let LOG_FORMAT_PATTERNS: LogFormatPattern[] = [];

/**
 * Loads log formats from JSON file
 */
export async function loadLogFormatsFromJSON(): Promise<void> {
    try {
        const response = await fetch('/log-formats.json');
        const data = await response.json();
        
        // Convert JSON patterns (strings) to RegExp objects
        LOG_FORMAT_PATTERNS = data.formats.map((format: {
            id: string;
            name: string;
            description: string;
            priority: number;
            patterns: string[];
            fields?: LogFormatField[];
        }) => ({
            ...format,
            patterns: format.patterns.map((pattern: string) => new RegExp(pattern, 'm'))
        }));
        
        console.log('Loaded log formats:', LOG_FORMAT_PATTERNS.length);
    } catch (error) {
        console.error('Failed to load log formats from JSON:', error);
        // Fallback to empty array
        LOG_FORMAT_PATTERNS = [];
    }
}

/**
 * Initialize log formats (call this at app startup)
 */
let formatsInitialized = false;
export async function initializeLogFormats(): Promise<void> {
    if (!formatsInitialized) {
        await loadLogFormatsFromJSON();
        formatsInitialized = true;
    }
}

/**
 * Detects the log format based on content analysis
 * @param content The log file content as string
 * @param previewLines Number of lines to analyze (default: 50)
 * @returns The detected format name or 'Unknown format'
 */
export function detectLogFormat(content: string, previewLines: number = 50): string {
    const preview = content.split(/\r?\n/).slice(0, previewLines).join('\n');

    // Sort patterns by priority (descending)
    const sortedPatterns = [...LOG_FORMAT_PATTERNS].sort((a, b) => b.priority - a.priority);

    for (const format of sortedPatterns) {
        // Check all patterns for this format
        const matchesPattern = format.patterns.some(pattern => pattern.test(preview));
        
        if (matchesPattern) {
            // If there's additional validation, run it
            if (format.validate) {
                if (format.validate(content)) {
                    return format.name;
                }
                // If validation fails, continue to next format
                continue;
            }
            
            // Pattern matched and no additional validation needed
            return format.name;
        }
    }

    return 'Unknown format';
}

/**
 * Gets all available log formats
 * @returns Array of all configured log formats
 */
export function getAvailableLogFormats(): LogFormatPattern[] {
    return LOG_FORMAT_PATTERNS;
}

/**
 * Gets a specific log format by ID
 * @param id The format ID to look up
 * @returns The log format or undefined if not found
 */
export function getLogFormatById(id: string): LogFormatPattern | undefined {
    return LOG_FORMAT_PATTERNS.find(format => format.id === id);

}

/**
 * Adds a custom log format pattern
 * Useful for plugins or dynamic format registration
 * @param format The custom format to add
 */
export function registerCustomLogFormat(format: LogFormatPattern): void {
    // Check if format with this ID already exists
    const existingIndex = LOG_FORMAT_PATTERNS.findIndex(f => f.id === format.id);
    
    if (existingIndex >= 0) {
        // Replace existing format
        LOG_FORMAT_PATTERNS[existingIndex] = format;
    } else {
        // Add new format
        LOG_FORMAT_PATTERNS.push(format);
    }
}

/**
 * Parses a log line using a specific format and extracts named fields
 * @param line The log line to parse
 * @param formatId The format ID to use for parsing
 * @returns Parsed log line with extracted fields, or null if parsing failed
 */
export function parseLogLine(line: string, formatId: string): ParsedLogLine | null {
    const format = getLogFormatById(formatId);
    if (!format) {
        return null;
    }

    for (const pattern of format.patterns) {
        const match = line.match(pattern);
        if (match && match.groups) {
            return {
                formatId,
                fields: match.groups,
                raw: line,
            };
        }
    }

    return null;
}

/**
 * Parses a log line using auto-detection to find the best matching format
 * @param line The log line to parse
 * @returns Parsed log line with extracted fields, or null if no format matched
 */
export function parseLogLineAuto(line: string): ParsedLogLine | null {
    const sortedPatterns = [...LOG_FORMAT_PATTERNS].sort((a, b) => b.priority - a.priority);

    for (const format of sortedPatterns) {
        for (const pattern of format.patterns) {
            const match = line.match(pattern);
            if (match && match.groups) {
                return {
                    formatId: format.id,
                    fields: match.groups,
                    raw: line,
                };
            }
        }
    }

    return null;
}

/**
 * Gets field definitions for a specific format
 * @param formatId The format ID to get fields for
 * @returns Array of field definitions, or empty array if format not found
 */
export function getFormatFields(formatId: string): LogFormatField[] {
    const format = getLogFormatById(formatId);
    return format?.fields || [];
}
