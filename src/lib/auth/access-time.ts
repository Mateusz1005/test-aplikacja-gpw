const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;

export function getAccessTimeInfo(
  startsAt: string | null,
  expiresAt: string | null,
) {
  const now = Date.now();
  const startTime = startsAt ? new Date(startsAt).getTime() : null;
  const expiryTime = expiresAt ? new Date(expiresAt).getTime() : null;

  return {
    notStarted: startTime !== null && startTime > now,
    expired: expiryTime !== null && expiryTime <= now,
    daysRemaining:
      expiryTime === null
        ? null
        : Math.max(0, Math.ceil((expiryTime - now) / DAY_IN_MILLISECONDS)),
  };
}
