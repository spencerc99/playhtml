// ABOUTME: Loads participant colors in bounded batches for event responses.
// ABOUTME: Surfaces lookup failures instead of treating them as missing identity colors.

interface ParticipantColorRow {
  pid: string;
  cursor_color: string | null;
}

// Public-key participant IDs are 133 characters; 50 fit below the HTTP URL limit.
const PARTICIPANT_COLOR_BATCH_SIZE = 50;

export async function loadParticipantColors(
  participantIds: readonly string[],
  loadBatch: (ids: string[]) => PromiseLike<{
    data: ParticipantColorRow[] | null;
    error?: { message: string } | null;
  }>,
): Promise<Map<string, string | null>> {
  const ids = [...new Set(participantIds)];
  const colors = new Map<string, string | null>();
  for (let offset = 0; offset < ids.length; offset += PARTICIPANT_COLOR_BATCH_SIZE) {
    const { data, error } = await loadBatch(
      ids.slice(offset, offset + PARTICIPANT_COLOR_BATCH_SIZE),
    );
    if (error) throw new Error(`Participant color lookup failed: ${error.message}`);
    if (data === null) throw new Error('Participant color lookup returned no data');
    for (const row of data) colors.set(row.pid, row.cursor_color);
  }
  return colors;
}
