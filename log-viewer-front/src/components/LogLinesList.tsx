import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { type FC, type RefObject } from 'react';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';

interface FilteredLine {
    lineNumber: number;
    raw: string;
}

interface LogLinesListProps {
    filteredLines: FilteredLine[];
    selectedLine: number | null;
    onSelectLine: (lineNumber: number) => void;
    virtuosoRef: RefObject<VirtuosoHandle | null>;
}

const LogLinesList: FC<LogLinesListProps> = ({
    filteredLines,
    selectedLine,
    onSelectLine,
    virtuosoRef,
}) => {
    return (
        <Virtuoso
            ref={virtuosoRef}
            style={{ height: '100%', width: '100%' }}
            totalCount={filteredLines.length}
            overscan={200}
            fixedItemHeight={20}
            computeItemKey={(index) => {
                return filteredLines[index]?.lineNumber || index;
            }}
            itemContent={(index) => {
                const row = filteredLines[index];
                if (!row) {
                    console.warn(`Missing row at index ${index}, total: ${filteredLines.length}`);
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
                            backgroundColor: selectedLine === row.lineNumber ? '#e3f2fd' : 'transparent',
                            '&:hover': {
                                backgroundColor: selectedLine === row.lineNumber ? '#e3f2fd' : (theme) => theme.palette.action.hover,
                            },
                        }}
                        onClick={() => onSelectLine(row.lineNumber)}
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
                            {row.lineNumber}
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
