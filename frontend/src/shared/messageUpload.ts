/** Max size for Messages page attachments (images, video, audio, documents, etc.). */
export const MESSAGE_MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

export const MESSAGE_MAX_FILE_ERROR =
  "File size exceeds the 50MB limit. Please select a smaller file.";

export function isMessageFileWithinLimit(file: Pick<File, "size">): boolean {
  return file.size <= MESSAGE_MAX_FILE_BYTES;
}
