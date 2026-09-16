export const MAX_LOG_FILE_MB = 50;
export const MAX_LOG_FILE_BYTES = MAX_LOG_FILE_MB * 1024 * 1024;

// Analysis results are sent as JSON after the browser parses the source file.
export const MAX_WORKSPACE_PAYLOAD_BYTES = MAX_LOG_FILE_BYTES;
