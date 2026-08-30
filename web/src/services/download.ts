export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Deferred, not immediate: the browser reads the object URL asynchronously
  // after the click, and Safari aborts a multi-MB batch zip if it has already
  // been revoked by the time it gets there.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
