# Log Format Detection System

## Overview

The log format detection system loads all format definitions from a JSON configuration file (`public/log-formats.json`). This makes it easy to add, modify, or remove log formats without changing the code.

## Structure

### 1. **Core Module**: `src/utils/logFormatDetector.ts`
- Contains the detection and parsing logic
- Defines TypeScript interfaces
- Loads formats from JSON at application startup
- Provides API for format detection and parsing

### 2. **Configuration File**: `public/log-formats.json`
- JSON-based format definitions (the single source of truth)
- Can be edited without code changes
- Contains all regex patterns and field definitions

## How It Works

1. **Application Startup**: When the app starts, `initializeLogFormats()` is called in `main.tsx`
2. **JSON Loading**: The function fetches `/log-formats.json` and converts string patterns to RegExp objects
3. **Format Detection**: All detection and parsing functions use the loaded formats from JSON

## Usage

### Basic Usage

```typescript
import { detectLogFormat } from '@/utils/logFormatDetector';

const logContent = "..."; // Your log file content
const format = detectLogFormat(logContent);
console.log(`Detected format: ${format}`);
```

### Parse Individual Log Lines

```typescript
import { parseLogLine, parseLogLineAuto } from '@/utils/logFormatDetector';

// Parse with specific format
const line = "2025-10-30 12:34:56,789 INFO org.example.MyClass: Starting application";
const parsed = parseLogLine(line, 'hdfs-v2');

if (parsed) {
  console.log('Timestamp:', parsed.fields.timestamp);
  console.log('Level:', parsed.fields.level);
  console.log('Class:', parsed.fields.class);
  console.log('Message:', parsed.fields.message);
}

// Auto-detect format and parse
const autoParsed = parseLogLineAuto(line);
console.log('Detected format:', autoParsed?.formatId);
```

### Get Field Definitions

```typescript
import { getFormatFields } from '@/utils/logFormatDetector';

const fields = getFormatFields('nginx');
fields.forEach(field => {
  console.log(`${field.name}: ${field.description} (${field.type})`);
});
```

### Get All Available Formats

```typescript
import { getAvailableLogFormats } from '@/utils/logFormatDetector';

const formats = getAvailableLogFormats();
formats.forEach(format => {
  console.log(`${format.name}: ${format.description}`);
});
```

## Adding New Formats

Edit `public/log-formats.json` and add a new format object:

```json
{
  "id": "my-format",
  "name": "My Log Format",
  "description": "Description of the format",
  "priority": 70,
  "patterns": [
    "^(?<timestamp>\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}) \\[(?<level>\\w+)\\] (?<message>.*)"
  ],
  "fields": [
    {
      "name": "timestamp",
      "description": "ISO timestamp",
      "type": "datetime"
    },
    {
      "name": "level",
      "description": "Log level",
      "type": "string"
    },
    {
      "name": "message",
      "description": "Log message",
      "type": "string"
    }
  ]
}
```

## Format Priority

Formats are checked in **descending priority order**:
- **100+**: Highly specific formats (e.g., Apache Error)
- **80-99**: Specific formats with unique structure
- **60-79**: Common formats
- **50-59**: Generic/fallback formats

## Benefits of New Structure

✅ **Separation of Concerns**: Logic separated from configuration
✅ **Easy Maintenance**: Add/modify formats without touching core code
✅ **Type Safety**: TypeScript interfaces ensure correct format definition
✅ **Extensibility**: Plugin-like system for custom formats
✅ **Documentation**: Self-documenting with descriptions
✅ **Testability**: Easy to test individual format patterns
✅ **Priority System**: Control detection order explicitly

## Pattern Tips

1. **Use named capture groups**: `(?<fieldName>pattern)` to extract structured data
2. **Use multiline flag** (`/pattern/m`) for line-start anchors
3. **Be specific**: More specific patterns should have higher priority
4. **Test thoroughly**: Use sample logs to verify patterns
5. **Document fields**: Always add field definitions with descriptions and types
6. **Validate edge cases**: Use `validate` function for complex logic

## Field Types

- **`string`**: Text data (usernames, messages, etc.)
- **`number`**: Numeric values (status codes, bytes, PIDs)
- **`datetime`**: Full date and time
- **`date`**: Date only
- **`time`**: Time only
- **`duration`**: Time duration (e.g., HH:MM:SS)

## Dashboard Facet Standard (Locked, v1)

This section defines the shared dashboard analytics contract for all existing and future log formats.

### Scope

- Applies to dashboard charts built from parsed fields.
- Applies to built-in formats and custom formats added to `public/log-formats.json`.

### Top Charts (Fixed Core)

- Top area is reserved for core operational fields only:
  - `level`
  - `status`
  - `method`
- A top chart is rendered only if that field has at least one value in the active filter window.
- If a core field is missing or empty in the active window, its chart is hidden.

### Lower Charts (Facets)

- Lower area is for additional field distributions (facets).
- Lower area shows up to 3 facet charts.
- A facet candidate must:
  - not be a core field (`level`, `status`, `method`)
  - not be an excluded technical field (`raw`, `timestamp`, `datetime`, `event_time`, `created_at`)
  - have more than one unique value in the active window
- When no facet qualifies:
  - show a single no-data state in the lower area
  - text: `No data to display` (or localized equivalent)

### Canonical Field Names for Cross-Format Consistency

Custom and built-in formats should map equivalent fields to canonical names when possible.

- `timestamp`: full timestamp value
- `level`: log severity
- `status`: numeric status code or discrete job state
- `method`: HTTP or operation method
- `host`: hostname or node identifier
- `class`: class/logger/source class
- `process`: process name
- `component`: subsystem/component
- `user`: user/account
- `ip`: client/server IP
- `queue`: queue name
- `type`: event/type family

Recommended aliases:

- `hostname` -> `host`
- `node` or `node2` -> `host`
- `logger` or `source` -> `class`
- `client` -> `ip`

### Value Normalization Rules

- Trim spaces.
- Ignore empty values and placeholders: `-`, `null`, `undefined`.
- Preserve semantics of categorical values (do not convert to numeric bins at parse stage).
- Keep raw high-cardinality fields (for example `message`) out of dashboard facets.

### Time and Filter Dependence

- Dashboard charts always reflect the active histogram time range and active legend/category filtering.
- The histogram control is the source of truth for filtered dashboard analytics.

### Format Author Checklist

When adding a new format in `public/log-formats.json`:

1. Capture `timestamp` whenever possible.
2. Capture at least one core field from `level` / `status` / `method`.
3. Capture at least one low-cardinality operational field for facets (`class`, `host`, `component`, `queue`, `type`, `user`).
4. Avoid using free-text fields (like `message`) as facet candidates.
5. Prefer canonical field names or alias mapping to canonical names.

### Supported Formats: Practical Target Facets

- Apache Access / Nginx / Web Access:
  - Core: `status`, `method`
  - Facets: `ip`, `user`, `protocol` (or normalized path group if implemented)
- Apache Error:
  - Core: `level`
  - Facets: `client`, `host`, `component/class`
- BGL (New):
  - Core: `status`
  - Facets: `queue`, `user`, `host`
- BGL (Old):
  - Core: `level`
  - Facets: `type`, `host`
- HDFS v1 / HDFS v2:
  - Core: `level`
  - Facets: `class`, `host/component`
- Syslog:
  - Core: `level` (when available)
  - Facets: `process`, `host`

## Example Formats with Named Capture Groups

### Apache Error Log
```regex
^\[(?<timestamp>.*?)\] \[(?<level>[a-z]+)\](?: \[client (?<client>[^\]]+)\])?(?: (?<message>.*))?$
```
**Fields**: `timestamp`, `level`, `client`, `message`

### HDFS v2
```regex
^(?<timestamp>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3}) (?<level>INFO|WARN|ERROR|DEBUG|TRACE|FATAL) (?<class>[\w.$:-]+): ?(?<message>.*)
```
**Fields**: `timestamp`, `level`, `class`, `message`

### Nginx Access Log
```regex
^(?<ip>\S+) - (?<user>\S+) \[(?<timestamp>\d{2}/\w{3}/\d{4}:\d{2}:\d{2}:\d{2} [+-]\d{4})\] "(?<method>\w+) (?<path>\S+) (?<protocol>HTTP/[\d.]+)" (?<status>\d{3}) (?<bytes>\d+) "(?<referer>[^"]*)" "(?<userAgent>[^"]*)"
```
**Fields**: `ip`, `user`, `timestamp`, `method`, `path`, `protocol`, `status`, `bytes`, `referer`, `userAgent`

### Syslog
```regex
^(?<month>\w{3}) +(?<day>\d{1,2}) (?<time>\d{2}:\d{2}:\d{2}) (?<hostname>\S+) (?<process>\S+?)(?:\[(?<pid>\d+)\])?: ?(?<message>.*)
```
**Fields**: `month`, `day`, `time`, `hostname`, `process`, `pid` (optional), `message`

## Future Enhancements

- [ ] Load formats from external API
- [ ] User-defined formats in settings
- [ ] Format auto-learning based on user feedback
- [ ] Import/export format configurations
- [ ] Visual format pattern builder
