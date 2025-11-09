/**
 * Lazy file reader for large log files
 * Reads file in chunks on demand
 */

export interface LineMetadata {
    lineNumber: number;
    startByte: number;
    endByte: number;
}

export class LazyFileReader {
    private file: File;
    private lineIndex: LineMetadata[] = [];
    private indexingComplete = false;
    private chunkSize = 1024 * 1024; // 1MB chunks for indexing

    constructor(file: File) {
        this.file = file;
    }

    /**
     * Build index of line positions in the file
     * This scans the file once to find all line breaks
     */
    async buildIndex(): Promise<void> {
        if (this.indexingComplete) return;

        const decoder = new TextDecoder('utf-8');
        let position = 0;
        let lineNumber = 1;
        let lineStart = 0;
        let leftover = '';

        while (position < this.file.size) {
            const chunk = this.file.slice(position, Math.min(position + this.chunkSize, this.file.size));
            const buffer = await chunk.arrayBuffer();
            const text = leftover + decoder.decode(buffer, { stream: position + this.chunkSize < this.file.size });

            let searchStart = 0;
            let nlIndex;

            while ((nlIndex = text.indexOf('\n', searchStart)) !== -1) {
                const lineEnd = position + nlIndex - leftover.length;
                
                this.lineIndex.push({
                    lineNumber,
                    startByte: lineStart,
                    endByte: lineEnd,
                });

                lineNumber++;
                lineStart = lineEnd + 1;
                searchStart = nlIndex + 1;
            }

            leftover = text.substring(searchStart);
            position += this.chunkSize;
        }

        // Last line without newline
        if (lineStart < this.file.size) {
            this.lineIndex.push({
                lineNumber,
                startByte: lineStart,
                endByte: this.file.size,
            });
        }

        this.indexingComplete = true;
        console.log(`Indexed ${this.lineIndex.length} lines in file`);
    }

    /**
     * Get total number of lines
     */
    getTotalLines(): number {
        return this.lineIndex.length;
    }

    /**
     * Read a specific line by number (1-indexed)
     */
    async readLine(lineNumber: number): Promise<string | null> {
        if (!this.indexingComplete) {
            await this.buildIndex();
        }

        const metadata = this.lineIndex[lineNumber - 1];
        if (!metadata) return null;

        const chunk = this.file.slice(metadata.startByte, metadata.endByte);
        const text = await chunk.text();
        return text.replace(/\r?\n$/, ''); // Remove trailing newline
    }

    /**
     * Read multiple lines in a range
     */
    async readLines(startLine: number, endLine: number): Promise<Array<{ lineNumber: number; content: string }>> {
        if (!this.indexingComplete) {
            await this.buildIndex();
        }

        const lines: Array<{ lineNumber: number; content: string }> = [];
        
        // Find byte range for all requested lines
        const firstMeta = this.lineIndex[startLine - 1];
        const lastMeta = this.lineIndex[Math.min(endLine, this.lineIndex.length) - 1];
        
        if (!firstMeta || !lastMeta) return lines;

        // Read the entire byte range at once
        const chunk = this.file.slice(firstMeta.startByte, lastMeta.endByte);
        const text = await chunk.text();
        
        // Split into individual lines
        const rawLines = text.split(/\r?\n/);
        
        for (let i = 0; i < rawLines.length && startLine + i <= endLine; i++) {
            lines.push({
                lineNumber: startLine + i,
                content: rawLines[i],
            });
        }

        return lines;
    }

    /**
     * Get file size
     */
    getFileSize(): number {
        return this.file.size;
    }

    /**
     * Get indexing progress (0-1)
     */
    isIndexed(): boolean {
        return this.indexingComplete;
    }
}
