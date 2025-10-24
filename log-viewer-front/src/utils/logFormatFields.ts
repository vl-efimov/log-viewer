// Auto-detection of fields for each log format
export function getLogFieldsForFormat(format: string): string[] {
    switch (format) {
        case 'Apache':
            // Combined list for access and error logs
            return [
                'ip', 'ident', 'user', 'datetime', 'request', 'status', 'size', 'referer', 'userAgent',
                'level', 'client', 'message'
            ];
        case 'Apache access':
        case 'Nginx':
        case 'Nginx access':
        case 'Web Access Log':
            return [
                'ip', 'ident', 'user', 'datetime', 'request', 'status', 'size', 'referer', 'userAgent'
            ];
        case 'HDFS':
            return [
                'date', 'time', 'ms', 'level', 'class', 'message'
            ];
        case 'BGL':
            return [
                'date', 'time', 'job', 'user', 'queue', 'nodes', 'cores', 'runtime', 'status', 'epoch', 'location1', 'timestamp', 'location2', 'type', 'component', 'level', 'message'
            ];
        case 'Syslog':
            return [
                'month', 'day', 'time', 'host', 'process', 'message'
            ];
        default:
            return ['line'];
    }
}

// Generic parser for a log line by format
export function parseLogLine(line: string, format: string): Record<string, any> {
    switch (format) {
        case 'Apache': {
            // First try Apache error log
            const errorRegex = /^\[([^\]]+)\] \[([^\]]+)\](?: \[client ([^\]]+)\])?(?: (.*))?$/;
            const errorMatch = line.match(errorRegex);
            if (errorMatch) {
                return {
                    datetime: errorMatch[1],
                    level: errorMatch[2],
                    client: errorMatch[3] ?? '',
                    message: errorMatch[4] ?? ''
                };
            }
            // If not an error log, try parsing as access log
            const accessRegex = /^(\S+) (\S+) (\S+) \[([^\]]+)\] "([^"]*)" (\d{3}) (\S+)(?: "([^"]*)" "([^"]*)")?/;
            const accessMatch = line.match(accessRegex);
            if (accessMatch) {
                return {
                    ip: accessMatch[1],
                    ident: accessMatch[2],
                    user: accessMatch[3],
                    datetime: accessMatch[4],
                    request: accessMatch[5],
                    status: accessMatch[6],
                    size: accessMatch[7],
                    referer: accessMatch[8] ?? '',
                    userAgent: accessMatch[9] ?? ''
                };
            }
            return { line };
        }
        case 'Apache access':
        case 'Nginx':
        case 'Nginx access':
        case 'Web Access Log': {
            // Common/Combined log format
            const regex = /^(\S+) (\S+) (\S+) \[([^\]]+)\] "([^"]*)" (\d{3}) (\S+)(?: "([^"]*)" "([^"]*)")?/;
            const match = line.match(regex);
            if (match) {
                return {
                    ip: match[1],
                    ident: match[2],
                    user: match[3],
                    datetime: match[4],
                    request: match[5],
                    status: match[6],
                    size: match[7],
                    referer: match[8] ?? '',
                    userAgent: match[9] ?? ''
                };
            }
            return { line };
        }

        case 'HDFS': {
            const regexNew = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}),(\d{3}) (\w+) ([\w.$:-]+): (.*)$/;
            const matchNew = line.match(regexNew);
            if (matchNew) {
                return {
                    date: matchNew[1], time: matchNew[2], ms: matchNew[3], level: matchNew[4], class: matchNew[5], message: matchNew[6]
                };
            }
            const regexOld = /^(\d{6}) (\d{6}) (\d+) (\w+) ([\w.$:-]+): (.*)$/;
            const matchOld = line.match(regexOld);
            if (matchOld) {
                const yy = matchOld[1]?.slice(0,2) ?? '';
                const MM = matchOld[1]?.slice(2,4) ?? '';
                const dd = matchOld[1]?.slice(4,6) ?? '';
                const date = `20${yy}-${MM}-${dd}`;
                const HH = matchOld[2]?.slice(0,2) ?? '';
                const mm = matchOld[2]?.slice(2,4) ?? '';
                const ss = matchOld[2]?.slice(4,6) ?? '';
                const time = `${HH}:${mm}:${ss}`;
                return {
                    date,
                    time,
                    ms: matchOld[3] ?? '',
                    level: matchOld[4] ?? '',
                    class: matchOld[5] ?? '',
                    message: matchOld[6] ?? ''
                };
            }
            return { line };
        }
        case 'BGL': {
            const match = line.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) JOB (\d+) USER=(\w+) QUEUE=(\w+) NODES=(\d+) CORES=(\d+) RUNTIME=(\d{2}:\d{2}:\d{2}) STATUS=(\w+)/);
            if (match) {
                return {
                    date: match[1], time: match[2], job: match[3], user: match[4], queue: match[5], nodes: match[6], cores: match[7], runtime: match[8], status: match[9]
                };
            }
            const altMatch = line.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (.+)$/);
            if (altMatch) {
                return {
                    date: altMatch[1],
                    time: altMatch[2],
                    message: altMatch[3]
                };
            }
            const oldBglMatch = line.match(/^[-\s]*(\d+) (\d{4}\.\d{2}\.\d{2}) ([^\s]+) (\d{4}-\d{2}-\d{2}-\d{2}\.\d{2}\.\d{2}\.\d+) ([^\s]+) (RAS|APP) (\w+) (\w+) (.+)$/);
            if (oldBglMatch) {
                return {
                    epoch: oldBglMatch[1],
                    date: oldBglMatch[2],
                    location1: oldBglMatch[3],
                    timestamp: oldBglMatch[4],
                    location2: oldBglMatch[5],
                    type: oldBglMatch[6],
                    component: oldBglMatch[7],
                    level: oldBglMatch[8],
                    message: oldBglMatch[9]
                };
            }
            return { line };
        }
        case 'Syslog': {
            const regex = /^(\w{3}) +(\d{1,2}) (\d{2}:\d{2}:\d{2}) ([\w.-]+) ([^:]+): (.*)$/;
            const match = line.match(regex);
            if (match) {
                return {
                    month: match[1], day: match[2], time: match[3], host: match[4], process: match[5], message: match[6]
                };
            }
            return { line };
        }
        default:
            return { line };
    }
}


