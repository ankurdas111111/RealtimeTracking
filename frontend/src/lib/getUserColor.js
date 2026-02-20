/**
 * Deterministic HSL color from a userId string.
 * Hue is constrained to 195–345° to avoid red (SOS) and gray (offline).
 */
export function getUserColor(userId) {
  if (!userId) return 'hsl(220, 65%, 48%)';
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0; // Convert to 32-bit int
  }
  const hue = 195 + (Math.abs(hash) % 150); // 195–344°
  return `hsl(${hue}, 65%, 48%)`;
}

export function getUserColorLight(userId) {
  if (!userId) return 'hsla(220, 65%, 48%, 0.15)';
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  const hue = 195 + (Math.abs(hash) % 150);
  return `hsla(${hue}, 65%, 48%, 0.15)`;
}

export function getUserColorDark(userId) {
  if (!userId) return 'hsl(220, 65%, 36%)';
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0;
  }
  const hue = 195 + (Math.abs(hash) % 150);
  return `hsl(${hue}, 65%, 36%)`;
}
