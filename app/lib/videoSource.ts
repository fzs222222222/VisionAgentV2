export type SceneImageSource = {
  sceneNumber: number;
  title: string;
  prompt: string;
  filename: string;
  relativePath: string;
  publicUrl: string;
  createdAt: string;
};

export type SceneAudioSource = {
  sceneNumber: number;
  title: string;
  narration: string;
  voice: string;
  filename: string;
  relativePath: string;
  publicUrl: string;
  durationMs?: number;
  createdAt: string;
};

export type SlideshowVideoSource = {
  kind: "image_slideshow";
  images: SceneImageSource[];
  audios: SceneAudioSource[];
  updatedAt: string;
};

function isSceneImageSource(value: unknown): value is SceneImageSource {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.sceneNumber === "number" &&
    Number.isInteger(record.sceneNumber) &&
    record.sceneNumber > 0 &&
    typeof record.title === "string" &&
    typeof record.prompt === "string" &&
    typeof record.filename === "string" &&
    typeof record.relativePath === "string" &&
    typeof record.publicUrl === "string" &&
    typeof record.createdAt === "string"
  );
}

function isSceneAudioSource(value: unknown): value is SceneAudioSource {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const durationMs = record.durationMs;

  return (
    typeof record.sceneNumber === "number" &&
    Number.isInteger(record.sceneNumber) &&
    record.sceneNumber > 0 &&
    typeof record.title === "string" &&
    typeof record.narration === "string" &&
    typeof record.voice === "string" &&
    typeof record.filename === "string" &&
    typeof record.relativePath === "string" &&
    typeof record.publicUrl === "string" &&
    typeof record.createdAt === "string" &&
    (durationMs === undefined || (typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0))
  );
}

export function parseVideoSource(content: string) {
  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content) as SlideshowVideoSource;
    if (parsed?.kind !== "image_slideshow" || !Array.isArray(parsed.images) || typeof parsed.updatedAt !== "string") {
      return null;
    }

    const images = parsed.images.filter(isSceneImageSource).sort((left, right) => left.sceneNumber - right.sceneNumber);
    const audios = (Array.isArray(parsed.audios) ? parsed.audios : [])
      .filter(isSceneAudioSource)
      .sort((left, right) => left.sceneNumber - right.sceneNumber);

    return {
      kind: "image_slideshow" as const,
      images,
      audios,
      updatedAt: parsed.updatedAt,
    };
  } catch {
    return null;
  }
}

export function createEmptyVideoSource(): SlideshowVideoSource {
  return {
    kind: "image_slideshow",
    images: [],
    audios: [],
    updatedAt: new Date().toISOString(),
  };
}

export function getSceneImageMap(content: string) {
  const parsed = parseVideoSource(content);
  return Object.fromEntries((parsed?.images ?? []).map((item) => [item.sceneNumber, item])) as Record<number, SceneImageSource>;
}

export function getSceneAudioMap(content: string) {
  const parsed = parseVideoSource(content);
  return Object.fromEntries((parsed?.audios ?? []).map((item) => [item.sceneNumber, item])) as Record<number, SceneAudioSource>;
}

export function upsertSceneImageSource(content: string, nextImage: SceneImageSource) {
  const current = parseVideoSource(content) ?? createEmptyVideoSource();
  const images = current.images
    .filter((item) => item.sceneNumber !== nextImage.sceneNumber)
    .concat(nextImage)
    .sort((left, right) => left.sceneNumber - right.sceneNumber);

  return JSON.stringify({
    kind: "image_slideshow",
    images,
    audios: current.audios,
    updatedAt: new Date().toISOString(),
  });
}

export function upsertSceneAudioSource(content: string, nextAudio: SceneAudioSource) {
  const current = parseVideoSource(content) ?? createEmptyVideoSource();
  const audios = current.audios
    .filter((item) => item.sceneNumber !== nextAudio.sceneNumber)
    .concat(nextAudio)
    .sort((left, right) => left.sceneNumber - right.sceneNumber);

  return JSON.stringify({
    kind: "image_slideshow",
    images: current.images,
    audios,
    updatedAt: new Date().toISOString(),
  });
}
