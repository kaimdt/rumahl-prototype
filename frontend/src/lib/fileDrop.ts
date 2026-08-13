/**
 * Cross-app file drag & drop protocol (Package 0, Feature 6c).
 *
 * The Files explorer tags dragged entries with a custom MIME type carrying
 * the file id; any OS app can register a drop target and read the reference
 * (then copy/open the file via the files API). `text/plain` carries the file
 * name so non-ORA drop zones (e.g. the OS) still see something useful.
 */

export const IORA_FILE_MIME = 'application/x-iora-file'

export interface FileDropPayload {
  id: string
  name: string
}

/** Tag a DataTransfer with a file reference (call in onDragStart). */
export function setFileDragData(dataTransfer: DataTransfer, file: FileDropPayload) {
  try {
    dataTransfer.setData(IORA_FILE_MIME, file.id)
    dataTransfer.setData('text/plain', file.name)
    dataTransfer.effectAllowed = 'copy'
  } catch {
    // dataTransfer unavailable (some browsers on programmatic drags)
  }
}

/** Read a file reference from a drop/dragover event. */
export function readFileDragData(dataTransfer: DataTransfer): FileDropPayload | null {
  try {
    const id = dataTransfer.getData(IORA_FILE_MIME)
    if (!id) return null
    return { id, name: dataTransfer.getData('text/plain') || id }
  } catch {
    return null
  }
}
