/**
 * Scan compressed video packets without decoding or buffering the recording.
 * framecrc exposes PTS and packet duration; `-progress out_time` from stream
 * copy follows DTS and undercounts H.264 with reordered frames (B-frames).
 * Format: https://ffmpeg.org/ffmpeg-formats.html#framecrc
 */
export function replayMp4VideoTimelineArgs(filePath: string): string[] {
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-nostats",
    "-fflags", "+genpts", "-i", filePath,
    "-map", "0:v:0", "-c", "copy", "-f", "framecrc", "pipe:1"
  ];
}

/** Constant-memory presentation span, independent of packet/decode order. */
export class ReplayMp4VideoTimeline {
  private tickMs = 0;
  private firstPts = Number.POSITIVE_INFINITY;
  private lastPts = Number.NEGATIVE_INFINITY;
  private endPts = Number.NEGATIVE_INFINITY;
  private invalid = false;

  consumeLine(line: string): void {
    const trimmed = line.trim();
    if (trimmed.startsWith("#tb 0:")) {
      const timebase = trimmed.match(/^#tb 0:\s*(\d+)\/(\d+)$/);
      const numerator = Number(timebase?.[1]);
      const denominator = Number(timebase?.[2]);
      if (!Number.isSafeInteger(numerator) || numerator <= 0 || !Number.isSafeInteger(denominator) || denominator <= 0 || this.tickMs) {
        this.invalid = true;
        return;
      }
      this.tickMs = numerator * 1_000 / denominator;
      return;
    }
    // Only the mapped video stream is relevant; headers and progress aren't packets.
    if (!/^0\s*,/.test(trimmed)) return;
    const fields = trimmed.split(",");
    const pts = Number(fields[2]?.trim());
    const duration = Number(fields[3]?.trim());
    const end = pts + duration;
    if (!this.tickMs || fields.length < 6 || !fields[2]?.trim() || !fields[3]?.trim()
      || !Number.isSafeInteger(pts) || !Number.isSafeInteger(duration) || duration < 0 || !Number.isSafeInteger(end)) {
      this.invalid = true;
      return;
    }
    this.firstPts = Math.min(this.firstPts, pts);
    this.lastPts = Math.max(this.lastPts, pts);
    this.endPts = Math.max(this.endPts, end);
  }

  get durationMs(): number {
    // A header or an audio tail must not stand in for missing video packets.
    if (this.invalid || !this.tickMs || this.endPts <= this.lastPts) return 0;
    const duration = (this.endPts - this.firstPts) * this.tickMs;
    return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0;
  }
}
