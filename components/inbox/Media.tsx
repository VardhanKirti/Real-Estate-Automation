'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileText, Pause, Play } from 'lucide-react';
import type { ThreadMedia } from '@/lib/inbox';

/**
 * WhatsApp media, played from the copy already on this machine. Nothing is
 * downloaded: the app stores what it has under Message/Media, and the route
 * serves that file with range support so audio and video can seek.
 */

function secs(n: number): string {
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

const BARS = 42;

/**
 * Voice note with a real waveform. The peaks are decoded from the opus file in
 * the browser (Web Audio decodes it natively), so the shape is the actual
 * audio rather than a decorative stand-in. If decoding fails — an unusual
 * codec, a blocked fetch — the player still works and the bars stay flat.
 */
export function VoiceNote({ media }: { media: ThreadMedia }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [playing, setPlaying] = useState(false);
  const [at, setAt] = useState(0);
  const [total, setTotal] = useState(media.duration ?? 0);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const res = await fetch(media.url);
        const buf = await res.arrayBuffer();
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new Ctx();
        const decoded = await ctx.decodeAudioData(buf);
        const data = decoded.getChannelData(0);
        const per = Math.floor(data.length / BARS) || 1;
        const out: number[] = [];
        for (let i = 0; i < BARS; i++) {
          let peak = 0;
          for (let j = 0; j < per; j++) {
            const v = Math.abs(data[i * per + j] ?? 0);
            if (v > peak) peak = v;
          }
          out.push(peak);
        }
        const max = Math.max(0.01, ...out);
        if (!dead) {
          setPeaks(out.map((p) => p / max));
          if (!media.duration) setTotal(decoded.duration);
        }
        void ctx.close();
      } catch {
        if (!dead) setPeaks([]); // player still works; bars stay flat
      }
    })();
    return () => {
      dead = true;
    };
  }, [media.url, media.duration]);

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  const seek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const el = audioRef.current;
      if (!el || !total) return;
      const box = e.currentTarget.getBoundingClientRect();
      el.currentTime = ((e.clientX - box.left) / box.width) * total;
    },
    [total],
  );

  const progress = total > 0 ? at / total : 0;
  const bars = peaks && peaks.length ? peaks : new Array(BARS).fill(0.12);

  return (
    <div className="ib-voice">
      <button className="ib-voice-btn" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? <Pause strokeWidth={2} /> : <Play strokeWidth={2} />}
      </button>
      <div className="ib-wave" onClick={seek} role="presentation">
        {bars.map((p, i) => (
          <i key={i} data-on={i / BARS <= progress ? '1' : '0'} style={{ height: `${Math.max(9, p * 100)}%` }} />
        ))}
      </div>
      <span className="ib-voice-t">{secs(total ? (playing || at ? at : total) : 0)}</span>
      <audio
        ref={audioRef}
        src={media.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setAt(0);
        }}
        onTimeUpdate={(e) => setAt(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setTotal(d);
        }}
      />
    </div>
  );
}

export function MediaBlock({ media }: { media: ThreadMedia }) {
  if (media.kind === 'voice') return <VoiceNote media={media} />;
  if (media.kind === 'image') {
    return (
      <a className="ib-media-img" href={media.url} target="_blank" rel="noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={media.url} alt={media.name} loading="lazy" decoding="async" />
      </a>
    );
  }
  if (media.kind === 'gif') {
    return <video className="ib-media-vid" src={media.url} autoPlay loop muted playsInline />;
  }
  if (media.kind === 'video') {
    return <video className="ib-media-vid" src={media.url} controls preload="metadata" playsInline />;
  }
  return (
    <a className="ib-media-doc" href={media.url} target="_blank" rel="noreferrer" download={media.name}>
      <span className="ib-media-doc-ic">
        <FileText strokeWidth={1.8} />
      </span>
      <span className="ib-media-doc-main">
        <span className="ib-media-doc-name">{media.name}</span>
        {media.bytes ? <span className="ib-media-doc-size">{Math.round(media.bytes / 1024)} KB</span> : null}
      </span>
      <Download strokeWidth={1.8} />
    </a>
  );
}
