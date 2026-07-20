/** Max size for Messages page attachments (images, video, audio, documents, etc.). */
export const MESSAGE_MAX_FILE_BYTES = 20 * 1024 * 1024; // 20 MB

export const MESSAGE_MAX_FILE_LABEL = "20 MB";

export const MESSAGE_MAX_FILE_ERROR =
  `This file exceeds the maximum attachment size of ${MESSAGE_MAX_FILE_LABEL}. Please choose a file that is ${MESSAGE_MAX_FILE_LABEL} or smaller.`;

export function isMessageFileWithinLimit(file: Pick<File, "size">): boolean {
  return file.size <= MESSAGE_MAX_FILE_BYTES;
}
