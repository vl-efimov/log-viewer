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
export const LOG_FORMAT_PATTERNS: LogFormatPattern[] = [
    {
        id: 'apache-error',
        name: 'Apache Error Log',
        description: 'Apache HTTP Server error log format',
        priority: 100,
        patterns: [
            /^\[(?<timestamp>.*?)\] \[(?<level>[a-z]+)\](?: \[client (?<client>[^\]]+)\])?(?: (?<message>.*))?$/m
        ],
        fields: [
            { name: 'timestamp', description: 'Log entry timestamp', type: 'datetime' },
            { name: 'level', description: 'Log severity level', type: 'string' },
            { name: 'client', description: 'Client IP address and port', type: 'string', optional: true },
            { name: 'message', description: 'Error message text', type: 'string' },
        ],
    },
    {
        id: 'hdfs-v2',
        name: 'HDFS v2',
        description: 'Hadoop HDFS version 2 log format (YYYY-MM-DD HH:MM:SS,mmm)',
        priority: 90,
        patterns: [
            /^(?<timestamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}) (?<level>INFO|WARN|ERROR|DEBUG|TRACE|FATAL) (?<class>[\w.$:-]+): ?(?<message>.*)/m
        ],
        fields: [
            { name: 'timestamp', description: 'Timestamp in format YYYY-MM-DD HH:MM:SS,mmm', type: 'datetime' },
            { name: 'level', description: 'Log level', type: 'string' },
            { name: 'class', description: 'Java class name', type: 'string' },
            { name: 'message', description: 'Log message content', type: 'string' },
        ],
    },
    {
        id: 'hdfs-v1',
        name: 'HDFS v1',
        description: 'Hadoop HDFS version 1 log format (yyMMdd HHmmss)',
        priority: 85,
        patterns: [
            /^(?<date>\d{6}) (?<time>\d{6}) (?<thread>\d+) (?<level>[A-Z]+) (?<class>[\w.$:-]+): ?(?<message>.*)/m
        ],
        fields: [
            { name: 'date', description: 'Date in format yyMMdd', type: 'date' },
            { name: 'time', description: 'Time in format HHmmss', type: 'time' },
            { name: 'thread', description: 'Thread ID', type: 'number' },
            { name: 'level', description: 'Log level', type: 'string' },
            { name: 'class', description: 'Java class name', type: 'string' },
            { name: 'message', description: 'Log message content', type: 'string' },
        ],
    },
    {
        id: 'bgl-new',
        name: 'BGL (New)',
        description: 'Blue Gene/L new format with structured job information',
        priority: 80,
        patterns: [
            /^(?<timestamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) JOB (?<jobId>\d+) USER=(?<user>\w+) QUEUE=(?<queue>\w+) NODES=(?<nodes>\d+) CORES=(?<cores>\d+) RUNTIME=(?<runtime>\d{2}:\d{2}:\d{2}) STATUS=(?<status>\w+)/m
        ],
        fields: [
            { name: 'timestamp', description: 'Job event timestamp', type: 'datetime' },
            { name: 'jobId', description: 'Unique job identifier', type: 'number' },
            { name: 'user', description: 'Username who submitted the job', type: 'string' },
            { name: 'queue', description: 'Queue name', type: 'string' },
            { name: 'nodes', description: 'Number of compute nodes', type: 'number' },
            { name: 'cores', description: 'Total CPU cores used', type: 'number' },
            { name: 'runtime', description: 'Job runtime in HH:MM:SS', type: 'duration' },
            { name: 'status', description: 'Job completion status', type: 'string' },
        ],
    },
    {
        id: 'bgl-old',
        name: 'BGL (Old)',
        description: 'Blue Gene/L old format with timestamp',
        priority: 75,
        patterns: [
            /(?<timestamp>\d{4}-\d{2}-\d{2}-\d{2}\.\d{2}\.\d{2}\.\d{6})/m
        ],
        fields: [
            { name: 'timestamp', description: 'Timestamp in format YYYY-MM-DD-HH.MM.SS.microseconds', type: 'datetime' },
        ],
    },
    {
        id: 'nginx',
        name: 'Nginx',
        description: 'Nginx web server access log',
        priority: 70,
        patterns: [
            /^(?<ip>\S+) - (?<user>\S+) \[(?<timestamp>\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4})\] "(?<method>\w+) (?<path>\S+) (?<protocol>HTTP\/[\d.]+)" (?<status>\d{3}) (?<bytes>\d+) "(?<referer>[^"]*)" "(?<userAgent>[^"]*)"/m
        ],
        validate: (content: string) => {
            const nginxAgentRegex = /nginx/i;
            const preview = content.split(/\r?\n/).slice(0, 50).join('\n');
            return nginxAgentRegex.test(preview);
        },
        fields: [
            { name: 'ip', description: 'Client IP address', type: 'string' },
            { name: 'user', description: 'Authenticated username', type: 'string' },
            { name: 'timestamp', description: 'Request timestamp', type: 'datetime' },
            { name: 'method', description: 'HTTP method', type: 'string' },
            { name: 'path', description: 'Request URI path', type: 'string' },
            { name: 'protocol', description: 'HTTP protocol version', type: 'string' },
            { name: 'status', description: 'HTTP response status code', type: 'number' },
            { name: 'bytes', description: 'Response size in bytes', type: 'number' },
            { name: 'referer', description: 'HTTP referer header', type: 'string' },
            { name: 'userAgent', description: 'Client user agent string', type: 'string' },
        ],
    },
    {
        id: 'apache-access',
        name: 'Apache Access Log',
        description: 'Apache HTTP Server access log (Common Log Format)',
        priority: 65,
        patterns: [
            /^(?<ip>\S+) (?<ident>\S+) (?<user>(?!-)\S+) \[(?<timestamp>\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4})\] "(?<method>\w+) (?<path>\S+) (?<protocol>HTTP\/[\d.]+)" (?<status>\d{3}) (?<bytes>\d+)/m
        ],
        fields: [
            { name: 'ip', description: 'Client IP address', type: 'string' },
            { name: 'ident', description: 'Client identity (RFC 1413)', type: 'string' },
            { name: 'user', description: 'Authenticated username', type: 'string' },
            { name: 'timestamp', description: 'Request timestamp', type: 'datetime' },
            { name: 'method', description: 'HTTP method', type: 'string' },
            { name: 'path', description: 'Request URI path', type: 'string' },
            { name: 'protocol', description: 'HTTP protocol version', type: 'string' },
            { name: 'status', description: 'HTTP response status code', type: 'number' },
            { name: 'bytes', description: 'Response size in bytes', type: 'number' },
        ],
    },
    {
        id: 'syslog',
        name: 'Syslog',
        description: 'Standard Unix/Linux syslog format',
        priority: 60,
        patterns: [
            /^(?<month>\w{3}) +(?<day>\d{1,2}) (?<time>\d{2}:\d{2}:\d{2}) (?<hostname>\S+) (?<process>\S+?)(?:\[(?<pid>\d+)\])?: ?(?<message>.*)/m
        ],
        fields: [
            { name: 'month', description: 'Month abbreviation', type: 'string' },
            { name: 'day', description: 'Day of month', type: 'number' },
            { name: 'time', description: 'Time in HH:MM:SS', type: 'time' },
            { name: 'hostname', description: 'Hostname or IP', type: 'string' },
            { name: 'process', description: 'Process or daemon name', type: 'string' },
            { name: 'pid', description: 'Process ID', type: 'number', optional: true },
            { name: 'message', description: 'Log message content', type: 'string' },
        ],
    },
    {
        id: 'web-access-generic',
        name: 'Web Access Log',
        description: 'Generic web server access log format',
        priority: 50,
        patterns: [
            /^(?<ip>\S+) - (?<user>\S+) \[(?<timestamp>\d{2}\/\w{3}\/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4})\]/m
        ],
        fields: [
            { name: 'ip', description: 'Client IP address', type: 'string' },
            { name: 'user', description: 'Username', type: 'string' },
            { name: 'timestamp', description: 'Request timestamp', type: 'datetime' },
        ],
    },
];

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
