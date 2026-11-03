/** Duration in seconds as m:ss, or h:mm:ss past an hour. e.g. 212 → "3:32", 3725 → "1:02:05". */
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Size in megabytes to one decimal place. e.g. 48.2 → "48.2 MB". */
export function formatSize(sizeMb: number): string {
  return `${sizeMb.toFixed(1)} MB`;
}
