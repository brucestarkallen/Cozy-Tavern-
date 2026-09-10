/* Cozy Tavern — ui/download.js
 * M22-E4/E7: one small courtesy shared by the per-story export and the
 * lore shelf's worldbook export — hand a file to the device's Downloads.
 */
export function download(name, text, type) {
  const blob = new Blob([text], { type: type || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
