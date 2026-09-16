export const MAX_LOG_FILE_MB = 50;
export const MAX_LOG_FILE_BYTES = MAX_LOG_FILE_MB * 1024 * 1024;

// Kept for non-file workspace actions. Log files are uploaded as multipart data
// and parsed by the server.
export const MAX_WORKSPACE_PAYLOAD_BYTES = MAX_LOG_FILE_BYTES;
