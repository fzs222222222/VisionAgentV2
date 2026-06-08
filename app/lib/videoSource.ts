export type SceneImageSource = {
  sceneNumber: number;
  title: string;
  prompt: string;
  filename: string;
  relativePath: string;
  publicUrl: string;
  createdAt: string;
};

export type SceneHtmlSource = {
  sceneNumber: number;
  title: string;
  prompt: string;
  html: string;
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

export type HtmlVideoSource = {
  kind: "html_animation";
  scenes: SceneHtmlSource[];
  audios: SceneAudioSource[];
  updatedAt: string;
};

export type VideoSource = SlideshowVideoSource | HtmlVideoSource;

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

function isSceneHtmlSource(value: unknown): value is SceneHtmlSource {
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
    typeof record.html === "string" &&
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

function sortBySceneNumber<T extends { sceneNumber: number }>(items: T[]) {
  return items.sort((left, right) => left.sceneNumber - right.sceneNumber);
}

export function parseVideoSource(content: string): VideoSource | null {
  if (!content) {
    return null;
  }

  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (parsed?.kind === "image_slideshow" && Array.isArray(parsed.images) && typeof parsed.updatedAt === "string") {
      return {
        kind: "image_slideshow",
        images: sortBySceneNumber(parsed.images.filter(isSceneImageSource)),
        audios: sortBySceneNumber((Array.isArray(parsed.audios) ? parsed.audios : []).filter(isSceneAudioSource)),
        updatedAt: parsed.updatedAt,
      };
    }

    if (parsed?.kind === "html_animation" && Array.isArray(parsed.scenes) && typeof parsed.updatedAt === "string") {
      return {
        kind: "html_animation",
        scenes: sortBySceneNumber(parsed.scenes.filter(isSceneHtmlSource)),
        audios: sortBySceneNumber((Array.isArray(parsed.audios) ? parsed.audios : []).filter(isSceneAudioSource)),
        updatedAt: parsed.updatedAt,
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function createEmptySlideshowVideoSource(): SlideshowVideoSource {
  return {
    kind: "image_slideshow",
    images: [],
    audios: [],
    updatedAt: new Date().toISOString(),
  };
}

export function createEmptyHtmlVideoSource(): HtmlVideoSource {
  return {
    kind: "html_animation",
    scenes: [],
    audios: [],
    updatedAt: new Date().toISOString(),
  };
}

export function getSceneImageMap(content: string) {
  const parsed = parseVideoSource(content);
  const images = parsed?.kind === "image_slideshow" ? parsed.images : [];
  return Object.fromEntries(images.map((item) => [item.sceneNumber, item])) as Record<number, SceneImageSource>;
}

export function getSceneHtmlMap(content: string) {
  const parsed = parseVideoSource(content);
  const scenes = parsed?.kind === "html_animation" ? parsed.scenes : [];
  return Object.fromEntries(scenes.map((item) => [item.sceneNumber, item])) as Record<number, SceneHtmlSource>;
}

export function getSceneAudioMap(content: string) {
  const parsed = parseVideoSource(content);
  return Object.fromEntries((parsed?.audios ?? []).map((item) => [item.sceneNumber, item])) as Record<number, SceneAudioSource>;
}

export function upsertSceneImageSource(content: string, nextImage: SceneImageSource) {
  const current = parseVideoSource(content);
  const base = current?.kind === "image_slideshow" ? current : createEmptySlideshowVideoSource();
  const images = sortBySceneNumber(base.images.filter((item) => item.sceneNumber !== nextImage.sceneNumber).concat(nextImage));

  return JSON.stringify({
    kind: "image_slideshow",
    images,
    audios: base.audios,
    updatedAt: new Date().toISOString(),
  } satisfies SlideshowVideoSource);
}

export function upsertSceneHtmlSource(content: string, nextScene: SceneHtmlSource) {
  const current = parseVideoSource(content);
  const base = current?.kind === "html_animation" ? current : createEmptyHtmlVideoSource();
  const scenes = sortBySceneNumber(base.scenes.filter((item) => item.sceneNumber !== nextScene.sceneNumber).concat(nextScene));

  return JSON.stringify({
    kind: "html_animation",
    scenes,
    audios: base.audios,
    updatedAt: new Date().toISOString(),
  } satisfies HtmlVideoSource);
}

export function upsertSceneAudioSource(content: string, nextAudio: SceneAudioSource) {
  const current = parseVideoSource(content);

  if (current?.kind === "html_animation") {
    const audios = sortBySceneNumber(current.audios.filter((item) => item.sceneNumber !== nextAudio.sceneNumber).concat(nextAudio));

    return JSON.stringify({
      kind: "html_animation",
      scenes: current.scenes,
      audios,
      updatedAt: new Date().toISOString(),
    } satisfies HtmlVideoSource);
  }

  const base = current?.kind === "image_slideshow" ? current : createEmptySlideshowVideoSource();
  const audios = sortBySceneNumber(base.audios.filter((item) => item.sceneNumber !== nextAudio.sceneNumber).concat(nextAudio));

  return JSON.stringify({
    kind: "image_slideshow",
    images: base.images,
    audios,
    updatedAt: new Date().toISOString(),
  } satisfies SlideshowVideoSource);
}

export function shiftSceneNumbersAfterInsertion(content: string, insertAfterScene: number) {
  const current = parseVideoSource(content);
  if (!current) {
    return content;
  }

  const nextSceneNumber = insertAfterScene + 1;

  if (current.kind === "html_animation") {
    return JSON.stringify({
      kind: "html_animation",
      scenes: sortBySceneNumber(
        current.scenes.map((item) =>
          item.sceneNumber >= nextSceneNumber ? { ...item, sceneNumber: item.sceneNumber + 1 } : item,
        ),
      ),
      audios: sortBySceneNumber(
        current.audios.map((item) =>
          item.sceneNumber >= nextSceneNumber ? { ...item, sceneNumber: item.sceneNumber + 1 } : item,
        ),
      ),
      updatedAt: new Date().toISOString(),
    } satisfies HtmlVideoSource);
  }

  return JSON.stringify({
    kind: "image_slideshow",
    images: sortBySceneNumber(
      current.images.map((item) =>
        item.sceneNumber >= nextSceneNumber ? { ...item, sceneNumber: item.sceneNumber + 1 } : item,
      ),
    ),
    audios: sortBySceneNumber(
      current.audios.map((item) =>
        item.sceneNumber >= nextSceneNumber ? { ...item, sceneNumber: item.sceneNumber + 1 } : item,
      ),
    ),
    updatedAt: new Date().toISOString(),
  } satisfies SlideshowVideoSource);
}
