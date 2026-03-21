import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { type FC, type RefObject } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

interface DisplayLine {
    displayLineNumber: number;
    raw: string;
}

interface LogLinesListProps {
    displayLines?: DisplayLine[];
    totalCount?: number;
    getLineAtIndex?: (index: number) => DisplayLine | null;
    onRangeChange?: (startIndex: number, endIndex: number) => void;
    selectedLine: number | null;
    onSelectLine: (lineNumber: number) => void;
    virtuosoRef: RefObject<VirtuosoHandle | null>;
}

const LogLinesList: FC<LogLinesListProps> = ({
    displayLines,
    totalCount,
    getLineAtIndex,
    onRangeChange,
    selectedLine,
    onSelectLine,
    virtuosoRef,
}) => {
    const resolvedTotalCount = totalCount ?? displayLines?.length ?? 0;
    return (
        <Virtuoso
            ref={virtuosoRef}
            style={{ height: '100%', width: '100%' }}
            totalCount={resolvedTotalCount}
            overscan={200}
            fixedItemHeight={20}
            rangeChanged={(range) => {
                if (onRangeChange) {
                    onRangeChange(range.startIndex, range.endIndex);
                }
            }}
            computeItemKey={(index) => {
                const row = getLineAtIndex ? getLineAtIndex(index) : displayLines?.[index];
                return row?.displayLineNumber || index;
            }}
            itemContent={(index) => {
                const row = getLineAtIndex ? getLineAtIndex(index) : displayLines?.[index];
                if (!row) {
                    return null;
                }

                return (
                    <Box
                        sx={{
                            display: 'flex',
                            height: '20px',
                            alignItems: 'center',
                            px: 2,
                            cursor: 'pointer',
                            backgroundColor: selectedLine === row.displayLineNumber ? '#e3f2fd' : 'transparent',
                            '&:hover': {
                                backgroundColor: selectedLine === row.displayLineNumber ? '#e3f2fd' : (theme) => theme.palette.action.hover,
                            },
                        }}
                        onClick={() => onSelectLine(row.displayLineNumber)}
                    >
                        <Typography
                            variant="body2"
                            sx={{
                                minWidth: '80px',
                                color: 'text.secondary',
                                fontFamily: 'monospace',
                                fontSize: '0.8rem',
                                lineHeight: '20px',
                                userSelect: 'none',
                                mr: 2,
                                flexShrink: 0,
                            }}
                        >
                            {row.displayLineNumber}
                        </Typography>
                        <Typography
                            variant="body2"
                            sx={{
                                fontFamily: 'monospace',
                                fontSize: '0.8rem',
                                lineHeight: '20px',
                                flex: 1,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}
                        >
                            {row.raw}
                        </Typography>
                    </Box>
                );
            }}
        />
    );
};

export default LogLinesList;
