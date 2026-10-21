import React, { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";

declare global {
  interface Window {
    BarcodeDetector?: {
      new (opts: { formats: string[] }): {
        detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
      };
      getSupportedFormats?: () => Promise<string[]>;
    };
  }
}

/**
 * Renders a value as a QR image. Nothing but the opaque token is encoded.
 *
 * Printed and shown on phone screens at a gate, so the code is generated for the
 * worst case rather than the best: highest error correction (a scuffed print or a
 * finger over a corner still reads), a full four-module quiet zone, pure black on
 * white for maximum contrast, and three device pixels per module so the modules
 * stay square instead of being resampled into grey edges.
 */
export const QrImage: React.FC<{
  value: string;
  size?: number;
  alt: string;
  className?: string;
  level?: "L" | "M" | "Q" | "H";
}> = ({ value, size = 220, alt, className, level = "H" }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, {
      errorCorrectionLevel: level,
      margin: 4,
      width: size * 3,
      color: { dark: "#000000", light: "#FFFFFF" },
    })
      .then((d) => live && setSrc(d))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [value, size, level]);
  if (!src)
    return (
      <div
        style={{ width: size, height: size }}
        className="bg-slate-100 rounded-xl animate-pulse"
        aria-hidden="true"
      />
    );
  // `pixelated` keeps module edges hard when the browser scales the image down.
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className={className}
      style={{ imageRendering: "pixelated", background: "#fff" }}
    />
  );
};

/** Counts down to an expiry instant; the server is still the authority on validity. */
export const Countdown: React.FC<{
  expiresAt: string;
  onExpired?: () => void;
  className?: string;
}> = ({ expiresAt, onExpired, className }) => {
  const [left, setLeft] = useState(() => Date.parse(expiresAt) - Date.now());
  const fired = useRef(false);
  useEffect(() => {
    fired.current = false;
    setLeft(Date.parse(expiresAt) - Date.now());
    const t = window.setInterval(() => {
      const ms = Date.parse(expiresAt) - Date.now();
      setLeft(ms);
      if (ms <= 0 && !fired.current) {
        fired.current = true;
        onExpired?.();
      }
    }, 1000);
    return () => window.clearInterval(t);
  }, [expiresAt, onExpired]);
  if (left <= 0) return <span className={className}>expired</span>;
  const s = Math.floor(left / 1000);
  return (
    <span className={className}>
      {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")} left
    </span>
  );
};

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

/**
 * One frame, two decoders. The native BarcodeDetector (Chromium, and Safari 17+)
 * is fast and handles blur and angle best, so it is tried first; jsQR decodes in
 * JavaScript everywhere else, which is what makes the scanner work on iPhones and
 * Firefox instead of falling back to typing the code.
 */
const decodeCanvas = async (
  canvas: HTMLCanvasElement,
  detector: {
    detect: (s: CanvasImageSource) => Promise<{ rawValue: string }[]>;
  } | null,
): Promise<string | null> => {
  if (detector) {
    try {
      const found = await detector.detect(canvas);
      const hit = found.find((f) => f.rawValue?.trim());
      if (hit) return hit.rawValue.trim();
    } catch {
      /* fall through to jsQR */
    }
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || !canvas.width || !canvas.height) return null;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // attemptBoth also reads light-on-dark codes, e.g. a phone screen in dark mode.
  const r = jsQR(img.data, img.width, img.height, {
    inversionAttempts: "attemptBoth",
  });
  return r?.data?.trim() || null;
};

/** Makes a detector when the browser has one and it really supports QR. */
const makeDetector = async () => {
  if (typeof window === "undefined" || !window.BarcodeDetector) return null;
  try {
    const formats = (await window.BarcodeDetector.getSupportedFormats?.()) ?? [
      "qr_code",
    ];
    if (!formats.includes("qr_code")) return null;
    return new window.BarcodeDetector({ formats: ["qr_code"] });
  } catch {
    return null;
  }
};

/** Short confirmation beep + haptic, so the operator knows the read landed without looking. */
const confirmFeedback = () => {
  try {
    navigator.vibrate?.(60);
  } catch {
    /* not supported */
  }
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.18);
    osc.onended = () => ctx.close().catch(() => undefined);
  } catch {
    /* audio is a nicety, never a requirement */
  }
};

/** Cameras need a secure page: https, or localhost during development. */
const secureEnough = () =>
  typeof window === "undefined" ||
  window.isSecureContext ||
  ["localhost", "127.0.0.1"].includes(window.location.hostname);

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

/**
 * Camera QR scanner built for a noisy gate desk rather than a demo: it scans the
 * middle of the frame and the whole frame on alternating passes (a code held close
 * and a code held far both read), runs the native detector with a JavaScript
 * decoder behind it, and offers a photo and a typed code when the camera is not
 * available at all. Whatever it reads, the server still validates.
 */
export const QrScanner: React.FC<{
  onDetect: (value: string) => void;
  busy?: boolean;
  label?: string;
  manualLabel?: string;
  manualPlaceholder?: string;
  minManualLength?: number;
  /** Off where the page already has its own code field, so the operator sees one box, not two. */
  showManual?: boolean;
}> = ({
  onDetect,
  busy,
  label = "Scan the session QR code",
  manualLabel = "Session code",
  manualPlaceholder = "Or type the session code",
  minManualLength = 6,
  showManual = true,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeRef = useRef(false);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hit, setHit] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string>("");
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({
    supported: false,
    on: false,
  });
  const [decoding, setDecoding] = useState(false);
  const cameraPossible =
    typeof window !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    secureEnough();

  const stop = useCallback(() => {
    activeRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
    setTorch({ supported: false, on: false });
  }, []);

  useEffect(() => () => stop(), [stop]);

  /** One detection, from any source: stop the camera, confirm, hand the value up. */
  const accept = useCallback(
    (value: string) => {
      confirmFeedback();
      setHit(true);
      window.setTimeout(() => setHit(false), 600);
      stop();
      onDetect(value);
    },
    [onDetect, stop],
  );

  const start = async (deviceId?: string) => {
    setError(null);
    if (!cameraPossible) {
      setError(
        secureEnough()
          ? "This browser cannot open a camera. Use “Scan from photo” or type the code."
          : "Phones only allow the camera on a secure (https) page. Use “Scan from photo”, type the code, or open the site over https.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: deviceId
          ? {
              deviceId: { exact: deviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            }
          : // The rear camera focuses closer and is what a gate desk points at a phone screen.
            {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      const track = stream.getVideoTracks()[0];
      const caps = (track?.getCapabilities?.() ??
        {}) as MediaTrackCapabilities & {
        torch?: boolean;
        focusMode?: string[];
      };
      if (caps.focusMode?.includes("continuous")) {
        await track
          .applyConstraints({ advanced: [{ focusMode: "continuous" } as any] })
          .catch(() => undefined);
      }
      setTorch({ supported: !!caps.torch, on: false });
      setCameraId(track?.getSettings?.().deviceId ?? deviceId ?? "");
      // Labels are only published once permission is granted, so enumerate after starting.
      navigator.mediaDevices
        .enumerateDevices()
        .then((list) => setCameras(list.filter((d) => d.kind === "videoinput")))
        .catch(() => undefined);
      setScanning(true);
    } catch (err: any) {
      const name = err?.name ?? "";
      setError(
        name === "NotAllowedError"
          ? "Camera permission was refused. Allow the camera in your browser, or use “Scan from photo”."
          : name === "NotFoundError"
            ? "No camera was found on this device. Use “Scan from photo” or type the code."
            : name === "NotReadableError"
              ? "The camera is in use by another app. Close it and try again."
              : "The camera could not be opened. Use “Scan from photo” or type the code.",
      );
      stop();
    }
  };

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch.on;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as any] });
      setTorch((t) => ({ ...t, on: next }));
    } catch {
      setTorch((t) => ({ ...t, supported: false }));
    }
  };

  // The scan loop. Alternates a centre crop with the whole frame: the crop gives the
  // decoder more pixels per module for a small code, the full frame catches a code
  // held off to one side.
  useEffect(() => {
    if (!scanning) return;
    activeRef.current = true;
    let raf = 0;
    let timer = 0;
    let zoomed = true;
    let detector: Awaited<ReturnType<typeof makeDetector>> = null;
    let busyFrame = false;

    const tick = async () => {
      if (!activeRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (
        !busyFrame &&
        video &&
        canvas &&
        video.readyState >= video.HAVE_CURRENT_DATA &&
        video.videoWidth
      ) {
        busyFrame = true;
        try {
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          const crop = zoomed ? 0.62 : 1;
          const sw = Math.round(vw * crop);
          const sh = Math.round(vh * crop);
          const sx = Math.round((vw - sw) / 2);
          const sy = Math.round((vh - sh) / 2);
          // Decoding cost grows with pixels; ~640px on the long edge is plenty for a QR.
          const scale = Math.min(1, 640 / Math.max(sw, sh));
          canvas.width = Math.round(sw * scale);
          canvas.height = Math.round(sh * scale);
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(
              video,
              sx,
              sy,
              sw,
              sh,
              0,
              0,
              canvas.width,
              canvas.height,
            );
            const value = await decodeCanvas(canvas, detector);
            if (value && activeRef.current) {
              accept(value);
              return;
            }
          }
        } catch {
          /* keep scanning */
        } finally {
          busyFrame = false;
          zoomed = !zoomed;
        }
      }
      // ~12 passes a second: fast enough to feel instant, light enough for a phone.
      timer = window.setTimeout(() => {
        raf = window.requestAnimationFrame(tick);
      }, 80);
    };

    makeDetector().then((d) => {
      detector = d;
      raf = window.requestAnimationFrame(tick);
    });

    return () => {
      activeRef.current = false;
      window.clearTimeout(timer);
      window.cancelAnimationFrame(raf);
    };
  }, [scanning, accept]);

  /** Last resort that works on every phone: decode a photo the user just took. */
  const scanFromFile = async (file: File) => {
    setError(null);
    setDecoding(true);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas
        .getContext("2d", { willReadFrequently: true })
        ?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      const value = await decodeCanvas(canvas, await makeDetector());
      if (value) accept(value);
      else
        setError(
          "No QR code was found in that picture. Fill the frame with the code and try again.",
        );
    } catch {
      setError(
        "That image could not be read. Try another photo or type the code.",
      );
    } finally {
      setDecoding(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>

      <div
        className={`relative rounded-xl overflow-hidden bg-slate-900 ${scanning ? "" : "hidden"}`}
        style={{ aspectRatio: "4 / 3" }}
      >
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          muted
          playsInline
          autoPlay
          aria-label="Camera preview"
        />
        {/* Aiming frame: tells the operator where the decoder is looking. */}
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
          <div
            className={`w-3/5 aspect-square rounded-2xl border-2 transition-colors ${hit ? "border-emerald-400" : "border-white/70"}`}
            style={{ boxShadow: "0 0 0 9999px rgba(15,23,42,0.35)" }}
          />
        </div>
        <p className="absolute bottom-2 inset-x-0 text-center text-[11px] font-semibold text-white/90">
          {hit ? "Code read" : "Hold the code inside the frame"}
        </p>
      </div>
      <canvas ref={canvasRef} className="hidden" />

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={scanning ? stop : () => start(cameraId || undefined)}
          disabled={busy || decoding}
          className="px-4 py-2 rounded-xl bg-[var(--kv-primary)] hover:bg-[var(--kv-primary-hover)] text-white text-xs font-semibold disabled:opacity-60 cursor-pointer"
        >
          {scanning ? "Stop camera" : "Open camera to scan"}
        </button>
        {scanning && torch.supported && (
          <button
            type="button"
            onClick={toggleTorch}
            className="px-3 py-2 rounded-xl border border-[var(--kv-border)] text-xs font-semibold text-[var(--kv-heading)] hover:bg-slate-50 cursor-pointer"
          >
            {torch.on ? "Torch off" : "Torch on"}
          </button>
        )}
        {scanning && cameras.length > 1 && (
          <select
            value={cameraId}
            aria-label="Camera"
            onChange={(e) => {
              const id = e.target.value;
              setCameraId(id);
              stop();
              start(id);
            }}
            className="px-3 py-2 rounded-xl border border-[var(--kv-border)] text-xs font-semibold text-[var(--kv-heading)] bg-white cursor-pointer"
          >
            {cameras.map((c, i) => (
              <option key={c.deviceId} value={c.deviceId}>
                {c.label || `Camera ${i + 1}`}
              </option>
            ))}
          </select>
        )}
        <label className="px-3 py-2 rounded-xl border border-[var(--kv-border)] text-xs font-semibold text-[var(--kv-heading)] hover:bg-slate-50 cursor-pointer">
          {decoding ? "Reading…" : "Scan from photo"}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            disabled={busy || decoding}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) scanFromFile(f);
            }}
          />
        </label>
      </div>

      {showManual && (
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && manual.trim().length >= minManualLength)
                onDetect(manual.trim());
            }}
            placeholder={manualPlaceholder}
            aria-label={manualLabel}
            className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800 focus:outline-none focus:border-[var(--kv-primary)]"
          />
          <button
            type="button"
            disabled={busy || manual.trim().length < minManualLength}
            onClick={() => onDetect(manual.trim())}
            className="px-4 py-2 rounded-xl border border-[var(--kv-primary)] text-[var(--kv-primary)] text-xs font-semibold hover:bg-blue-50 disabled:opacity-50 cursor-pointer"
          >
            Submit code
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs text-rose-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};
