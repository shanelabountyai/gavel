/** 0:42 under an hour, then 1 h 12 m, then 3 d 4 h. Shared by the live board and the catalog (R21). */
export function formatLeft(s: number) {
  if (s >= 86_400) return `${Math.floor(s / 86_400)} d ${Math.floor((s % 86_400) / 3600)} h`;
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} m`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
