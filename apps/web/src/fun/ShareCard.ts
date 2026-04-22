/**
 * MVP share card (plan §7). Lazy-imports html-to-image so the library only ships when
 * someone taps the share button — it's big-ish relative to the rest of the app.
 *
 * Tries Web Share API first (native iOS/Android share sheet). Falls back to blob download.
 */

export interface ShareCardOptions {
  filename?: string;
  /** Pixel ratio used when rasterizing. Default `devicePixelRatio`, capped at 2. */
  pixelRatio?: number;
  /** Background color behind the card. Defaults to transparent. */
  backgroundColor?: string;
}

export async function shareCard(el: HTMLElement, opts: ShareCardOptions = {}): Promise<void> {
  const { toPng } = await import("html-to-image");
  const pixelRatio = opts.pixelRatio ?? Math.min(2, window.devicePixelRatio || 1);
  const dataUrl = await toPng(el, {
    pixelRatio,
    cacheBust: true,
    ...(opts.backgroundColor !== undefined ? { backgroundColor: opts.backgroundColor } : {}),
  });
  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], opts.filename ?? "pose-royale-mvp.png", { type: "image/png" });

  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && typeof nav.share === "function") {
    await nav.share({
      files: [file],
      title: "Pose Royale MVP",
      text: "My Pose Royale Gauntlet result",
    });
    return;
  }

  // Fallback: trigger a file download.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
