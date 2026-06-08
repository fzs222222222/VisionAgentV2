"use client";

import { ArrayBufferTarget, Muxer } from "mp4-muxer";

type RecordingStatus =
  | "requesting-capture"
  | "capturing"
  | "encoding"
  | "finalizing"
  | "completed";

type RecordingResult = {
  blob: Blob;
  filename: string;
};

type RecordingSession = {
  completion: Promise<RecordingResult>;
  start: () => void;
  stop: () => Promise<RecordingResult>;
};

type BeginHtmlMp4RecordingOptions = {
  filename: string;
  requireAudio?: boolean;
  targetFrameRate?: number;
  onStatusChange?: (status: RecordingStatus) => void;
};

type CaptureController = {
  completion: Promise<RecordingResult>;
  start: () => void;
  requestStop: () => void;
};

type MediaStreamTrackProcessorLike = new (options: {
  track: MediaStreamTrack;
}) => {
  readable: ReadableStream<VideoFrame | AudioData>;
};

type ExtendedDisplayMediaStreamOptions = DisplayMediaStreamOptions & {
  preferCurrentTab?: boolean;
  selfBrowserSurface?: "include" | "exclude";
  surfaceSwitching?: "include" | "exclude";
  systemAudio?: "include" | "exclude";
  monitorTypeSurfaces?: "include" | "exclude";
};

const H264_CODEC_CANDIDATES = ["avc1.640028", "avc1.4d4028", "avc1.42E01E"] as const;
const AAC_CODEC = "mp4a.40.2";
const DEFAULT_FRAME_RATE = 30;
const DEFAULT_BITRATE = 8_000_000;
const DEFAULT_AUDIO_BITRATE = 192_000;

export function isHtmlMp4RecordingSupported() {
  if (typeof window === "undefined") {
    return false;
  }

  const processor = (window as typeof window & { MediaStreamTrackProcessor?: MediaStreamTrackProcessorLike })
    .MediaStreamTrackProcessor;
  return Boolean(
    typeof navigator.mediaDevices?.getDisplayMedia === "function" &&
      window.VideoEncoder &&
      processor &&
      window.VideoFrame,
  );
}

export async function beginHtmlMp4Recording(options: BeginHtmlMp4RecordingOptions): Promise<RecordingSession> {
  if (!isHtmlMp4RecordingSupported()) {
    throw new Error("当前浏览器不支持基于 WebCodecs 的 MP4 导出");
  }

  options.onStatusChange?.("requesting-capture");

  const captureOptions: ExtendedDisplayMediaStreamOptions = {
    video: {
      displaySurface: "browser",
      frameRate: options.targetFrameRate ?? DEFAULT_FRAME_RATE,
    },
    audio: true,
    preferCurrentTab: true,
    selfBrowserSurface: "include",
    surfaceSwitching: "exclude",
    monitorTypeSurfaces: "exclude",
    systemAudio: "include",
  };
  const stream = await navigator.mediaDevices.getDisplayMedia(captureOptions);
  const videoTrack = stream.getVideoTracks()[0];
  const audioTrack = stream.getAudioTracks()[0] ?? null;

  if (!videoTrack) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("未获取到共享标签页的视频轨道");
  }

  if (options.requireAudio && !audioTrack) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("未检测到标签页音频，请重新共享当前标签页并勾选“共享标签页音频”");
  }
  if (options.requireAudio && typeof window.AudioEncoder === "undefined") {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("当前浏览器不支持导出带声音的 MP4，请升级到最新版 Chrome 后重试");
  }

  options.onStatusChange?.("capturing");

  const controller = createCaptureController({
    filename: options.filename,
    onStatusChange: options.onStatusChange,
    stream,
    targetFrameRate: options.targetFrameRate ?? DEFAULT_FRAME_RATE,
    audioTrack,
    videoTrack,
  });

  return {
    completion: controller.completion,
    start: controller.start,
    stop: async () => {
      controller.requestStop();
      return controller.completion;
    },
  };
}

function createCaptureController(input: {
  filename: string;
  onStatusChange?: (status: RecordingStatus) => void;
  stream: MediaStream;
  targetFrameRate: number;
  audioTrack: MediaStreamTrack | null;
  videoTrack: MediaStreamTrack;
}): CaptureController {
  let stopRequested = false;
  let cleanupStarted = false;
  let started = false;
  let resolveStart!: () => void;
  const startSignal = new Promise<void>((resolve) => {
    resolveStart = resolve;
  });

  const completion = (async () => {
    const processorCtor = (window as typeof window & { MediaStreamTrackProcessor?: MediaStreamTrackProcessorLike })
      .MediaStreamTrackProcessor;
    if (!processorCtor) {
      throw new Error("当前浏览器缺少 MediaStreamTrackProcessor");
    }

    await startSignal;
    if (stopRequested) {
      throw new Error("录制在开始前已停止");
    }

    const processor = new processorCtor({ track: input.videoTrack });
    const reader = processor.readable.getReader();
    const firstFrameRead = await reader.read();
    const firstFrame = firstFrameRead.value as VideoFrame | undefined;

    if (firstFrameRead.done || !firstFrame) {
      throw new Error("共享标签页未输出可编码的视频帧");
    }

    input.onStatusChange?.("encoding");

    const width = sanitizeVideoDimension(firstFrame.displayWidth || firstFrame.codedWidth || 1280);
    const height = sanitizeVideoDimension(firstFrame.displayHeight || firstFrame.codedHeight || 720);
    const frameRate = Math.max(Math.round(input.targetFrameRate || DEFAULT_FRAME_RATE), 1);
    const frameDurationUs = Math.round(1_000_000 / frameRate);
    const audioSettings = input.audioTrack?.getSettings();
    const hasAudioTrack = Boolean(input.audioTrack && window.AudioEncoder);
    const audioChannels = sanitizeAudioChannels(audioSettings?.channelCount);
    const audioSampleRate = sanitizeAudioSampleRate(audioSettings?.sampleRate);

    const codec = await pickSupportedH264Codec(width, height, frameRate);
    if (hasAudioTrack) {
      await ensureSupportedAacConfig(audioChannels, audioSampleRate);
    }
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      fastStart: "in-memory",
      firstTimestampBehavior: hasAudioTrack ? "cross-track-offset" : "offset",
      video: {
        codec: "avc",
        width,
        height,
        frameRate,
      },
      audio: hasAudioTrack
        ? {
            codec: "aac",
            numberOfChannels: audioChannels,
            sampleRate: audioSampleRate,
          }
        : undefined,
    });

    let firstChunkSeen = false;
    let lastTimestampUs: number | null = null;
    let encoderFailure: Error | null = null;
    let audioEncoderFailure: Error | null = null;

    const encoder = new VideoEncoder({
      output: (chunk, meta) => {
        const timestamp = chunk.timestamp;
        const duration =
          typeof chunk.duration === "number" && Number.isFinite(chunk.duration) && chunk.duration > 0
            ? chunk.duration
            : frameDurationUs;
        muxer.addVideoChunk(chunk, meta, timestamp, 0);
        lastTimestampUs = timestamp + duration;
      },
      error: (error) => {
        encoderFailure = error instanceof Error ? error : new Error(String(error));
      },
    });
    const audioProcessor = input.audioTrack ? new processorCtor({ track: input.audioTrack }) : null;
    const audioReader = audioProcessor?.readable.getReader() ?? null;
    const audioEncoder =
      hasAudioTrack && input.audioTrack
        ? new AudioEncoder({
            output: (chunk, meta) => {
              muxer.addAudioChunk(chunk, meta, chunk.timestamp);
            },
            error: (error) => {
              audioEncoderFailure = error instanceof Error ? error : new Error(String(error));
            },
          })
        : null;

    encoder.configure({
      codec,
      width,
      height,
      bitrate: DEFAULT_BITRATE,
      framerate: frameRate,
      bitrateMode: "variable",
      latencyMode: "quality",
      avc: {
        format: "avc",
      },
    });
    if (audioEncoder) {
      audioEncoder.configure({
        codec: AAC_CODEC,
        numberOfChannels: audioChannels,
        sampleRate: audioSampleRate,
        bitrate: DEFAULT_AUDIO_BITRATE,
      });
    }

    const encodeFrame = (sourceFrame: VideoFrame) => {
      const timestamp =
        typeof sourceFrame.timestamp === "number" && Number.isFinite(sourceFrame.timestamp)
          ? Math.max(sourceFrame.timestamp, 0)
          : lastTimestampUs ?? 0;
      const duration =
        typeof sourceFrame.duration === "number" && Number.isFinite(sourceFrame.duration) && sourceFrame.duration > 0
          ? sourceFrame.duration
          : frameDurationUs;
      const frame = new VideoFrame(sourceFrame, {
        timestamp,
        duration,
      });

      try {
        encoder.encode(frame, { keyFrame: !firstChunkSeen || encoder.encodeQueueSize > frameRate * 2 });
        firstChunkSeen = true;
        if (encoderFailure) {
          throw encoderFailure;
        }
      } finally {
        frame.close();
        sourceFrame.close();
      }
    };
    const encodeAudio = (sourceAudio: AudioData) => {
      if (!audioEncoder) {
        sourceAudio.close();
        return;
      }

      try {
        audioEncoder.encode(sourceAudio);
        if (audioEncoderFailure) {
          throw audioEncoderFailure;
        }
      } finally {
        sourceAudio.close();
      }
    };

    try {
      const pumpVideo = async () => {
        encodeFrame(firstFrame);

        while (!stopRequested) {
          const { done, value } = await reader.read();
          if (done || !value) {
            break;
          }

          encodeFrame(value as VideoFrame);
        }
      };
      const pumpAudio = async () => {
        if (!audioReader) {
          return;
        }

        while (!stopRequested) {
          const { done, value } = await audioReader.read();
          if (done || !value) {
            break;
          }

          encodeAudio(value as AudioData);
        }
      };

      await Promise.all([pumpVideo(), pumpAudio()]);
      input.onStatusChange?.("finalizing");
      await Promise.all([encoder.flush(), audioEncoder?.flush() ?? Promise.resolve()]);
      if (encoderFailure) {
        throw encoderFailure;
      }
      if (audioEncoderFailure) {
        throw audioEncoderFailure;
      }
      muxer.finalize();
      encoder.close();
      audioEncoder?.close();
      reader.releaseLock();
      audioReader?.releaseLock();
      cleanupStream(input.stream);

      input.onStatusChange?.("completed");

      return {
        blob: new Blob([target.buffer], { type: "video/mp4" }),
        filename: input.filename,
      };
    } catch (error) {
      if (encoder.state !== "closed") {
        encoder.close();
      }
      if (audioEncoder && audioEncoder.state !== "closed") {
        audioEncoder.close();
      }
      reader.releaseLock();
      audioReader?.releaseLock();
      cleanupStream(input.stream);
      throw error;
    }
  })();

  const requestStop = () => {
    if (cleanupStarted) {
      return;
    }

    cleanupStarted = true;
    stopRequested = true;
    if (!started) {
      resolveStart();
    }
    input.stream.getTracks().forEach((track) => track.stop());
  };

  const start = () => {
    if (started || stopRequested) {
      return;
    }

    started = true;
    resolveStart();
  };

  input.videoTrack.addEventListener("ended", () => {
    requestStop();
  });
  input.audioTrack?.addEventListener("ended", () => {
    requestStop();
  });

  return {
    completion,
    start,
    requestStop,
  };
}

async function pickSupportedH264Codec(width: number, height: number, frameRate: number) {
  for (const codec of H264_CODEC_CANDIDATES) {
    const support = await VideoEncoder.isConfigSupported({
      codec,
      width,
      height,
      bitrate: DEFAULT_BITRATE,
      framerate: frameRate,
      avc: {
        format: "avc",
      },
    });

    if (support.supported) {
      return codec;
    }
  }

  throw new Error("当前浏览器不支持 H.264 MP4 编码");
}

function sanitizeVideoDimension(value: number) {
  const rounded = Math.max(2, Math.round(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

async function ensureSupportedAacConfig(numberOfChannels: number, sampleRate: number) {
  const support = await AudioEncoder.isConfigSupported({
    codec: AAC_CODEC,
    numberOfChannels,
    sampleRate,
    bitrate: DEFAULT_AUDIO_BITRATE,
  });

  if (!support.supported) {
    throw new Error("当前浏览器不支持 AAC 音频编码，暂时无法导出带声音的 MP4");
  }
}

function sanitizeAudioChannels(value?: number) {
  if (!value || !Number.isFinite(value)) {
    return 2;
  }

  return Math.max(1, Math.min(Math.round(value), 2));
}

function sanitizeAudioSampleRate(value?: number) {
  if (!value || !Number.isFinite(value)) {
    return 48_000;
  }

  return Math.max(8_000, Math.round(value));
}

function cleanupStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
}

export function triggerMp4Download(result: RecordingResult) {
  const url = URL.createObjectURL(result.blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = result.filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
