"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The hero animation: a cloud of points that keeps taking the shape of a
 * business. It forms the Shapewise mark, then an invoice, stacked stock and
 * a sales chart, scattering on a slow current between each. Points shy away
 * from the pointer. Pauses off screen; a still shape for reduced motion.
 */

const SHAPES = ["Your setup", "Invoices and quotes", "Stock and lots", "Reports and books"] as const;
const FORM = 1.5;
const HOLD = 2.8;
const DRIFT = 1.5;
const CYCLE = FORM + HOLD + DRIFT;

interface Dot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Which sample this dot takes in every shape. */
  slot: number;
  size: number;
  accent: boolean;
  phase: number;
}

type Draw = (g: CanvasRenderingContext2D, s: number) => void;

/** Each shape drawn into a square of side s, filled where points should land. */
const DRAWINGS: Draw[] = [
  // The mark: the S ribbon and its two datum points.
  (g, s) => {
    const k = s / 24;
    g.save();
    g.scale(k, k);
    g.lineWidth = 2.9;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.stroke(new Path2D("M17.5 5.5H8.75A3.25 3.25 0 0 0 8.75 12h6.5a3.25 3.25 0 0 1 0 6.5H6.5"));
    g.beginPath();
    g.arc(6.5, 5.5, 1.6, 0, Math.PI * 2);
    g.arc(17.5, 18.5, 1.6, 0, Math.PI * 2);
    g.fill();
    g.restore();
  },
  // An invoice: the page, a header block, lines, and the total.
  (g, s) => {
    const x = s * 0.2, y = s * 0.08, w = s * 0.6, h = s * 0.84;
    g.lineWidth = s * 0.018;
    g.strokeRect(x, y, w, h);
    g.fillRect(x + w * 0.1, y + h * 0.08, w * 0.34, h * 0.07);
    g.fillRect(x + w * 0.62, y + h * 0.09, w * 0.28, h * 0.03);
    g.fillRect(x + w * 0.62, y + h * 0.14, w * 0.2, h * 0.025);
    for (let i = 0; i < 5; i++) {
      const ly = y + h * (0.32 + i * 0.09);
      g.fillRect(x + w * 0.1, ly, w * (i % 2 ? 0.42 : 0.5), h * 0.022);
      g.fillRect(x + w * 0.72, ly, w * 0.18, h * 0.022);
    }
    g.fillRect(x + w * 0.52, y + h * 0.8, w * 0.38, h * 0.07);
  },
  // Stock: cartons stacked on a pallet.
  (g, s) => {
    const box = s * 0.2, gap = s * 0.025, base = s * 0.8;
    g.lineWidth = s * 0.016;
    const rows = [3, 3, 2];
    rows.forEach((n, r) => {
      const width = n * box + (n - 1) * gap;
      for (let i = 0; i < n; i++) {
        const bx = (s - width) / 2 + i * (box + gap);
        const by = base - (r + 1) * box - r * gap;
        g.strokeRect(bx, by, box, box);
        g.fillRect(bx + box * 0.38, by, box * 0.24, box * 0.3);
      }
    });
    g.fillRect(s * 0.12, base + gap, s * 0.76, s * 0.035);
    for (let i = 0; i < 4; i++) g.fillRect(s * (0.14 + i * 0.235), base + gap + s * 0.035, s * 0.05, s * 0.04);
  },
  // A sales chart: rising bars on a baseline, and the trend.
  (g, s) => {
    const heights = [0.22, 0.34, 0.3, 0.48, 0.62];
    const bw = s * 0.1, gap = s * 0.055, base = s * 0.82;
    const left = (s - (heights.length * bw + (heights.length - 1) * gap)) / 2;
    heights.forEach((h, i) => g.fillRect(left + i * (bw + gap), base - s * h, bw, s * h));
    g.fillRect(s * 0.1, base + s * 0.02, s * 0.8, s * 0.018);
    g.lineWidth = s * 0.016;
    g.beginPath();
    heights.forEach((h, i) => {
      const px = left + i * (bw + gap) + bw / 2;
      const py = base - s * h - s * 0.07;
      if (i) g.lineTo(px, py);
      else g.moveTo(px, py);
    });
    g.stroke();
  },
];

/** Points spread evenly over a shape's filled area, as offsets from its centre (unit square). */
function sample(draw: Draw, count: number): Float32Array {
  const s = 220;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.fillStyle = g.strokeStyle = "#000";
  draw(g, s);
  const data = g.getImageData(0, 0, s, s).data;
  const filled: number[] = [];
  for (let y = 0; y < s; y += 2) for (let x = 0; x < s; x += 2) if (data[(y * s + x) * 4 + 3]! > 128) filled.push(x, y);
  const out = new Float32Array(count * 2);
  const n = filled.length / 2;
  // An even stride through the filled pixels, shuffled so neighbours don't travel together.
  const order = Array.from({ length: count }, (_, i) => Math.floor((i * n) / count));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  order.forEach((p, i) => {
    out[i * 2] = (filled[p * 2]! + Math.random() * 2) / s - 0.5;
    out[i * 2 + 1] = (filled[p * 2 + 1]! + Math.random() * 2) / s - 0.5;
  });
  return out;
}

export function ShapeParticleCanvas({ className = "", caption = true }: { className?: string; caption?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [shape, setShape] = useState(0);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0;

    const colours = () => {
      const css = getComputedStyle(document.documentElement);
      return { ink: css.getPropertyValue("--sw-ink").trim() || "#1c1a17", accent: css.getPropertyValue("--sw-accent").trim() || "#2b4acb" };
    };
    let col = colours();
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => (col = colours());
    scheme.addEventListener("change", onScheme);
    const themeWatch = new MutationObserver(onScheme);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const count = Math.round(Math.min(1100, Math.max(420, w * h * 0.0042)));
    const samples = DRAWINGS.map((d) => sample(d, count));
    const dots: Dot[] = Array.from({ length: count }, (_, i) => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: 0,
      vy: 0,
      slot: i,
      size: Math.random() < 0.12 ? 2.2 : 1.4,
      accent: Math.random() < 0.24,
      phase: Math.random() * Math.PI * 2,
    }));

    let pointer = { x: -1e4, y: -1e4 };
    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onLeave = () => (pointer = { x: -1e4, y: -1e4 });
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);

    const target = (d: Dot, k: number) => {
      const size = Math.min(w, h) * 0.86;
      const s = samples[k]!;
      return { x: w / 2 + s[d.slot * 2]! * size, y: h / 2 + s[d.slot * 2 + 1]! * size };
    };

    const draw = (t: number) => {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        const glow = 0.55 + 0.45 * Math.sin(t * 1.7 + d.phase);
        ctx.globalAlpha = d.accent ? 0.9 : 0.32 + 0.22 * glow;
        ctx.fillStyle = d.accent ? col.accent : col.ink;
        ctx.fillRect(d.x - d.size / 2, d.y - d.size / 2, d.size, d.size);
      }
      ctx.globalAlpha = 1;
    };

    if (reduced) {
      for (const d of dots) Object.assign(d, target(d, 0));
      draw(0);
      const ro = new ResizeObserver(() => {
        resize();
        for (const d of dots) Object.assign(d, target(d, 0));
        draw(0);
      });
      ro.observe(canvas);
      return () => {
        ro.disconnect();
        themeWatch.disconnect();
        scheme.removeEventListener("change", onScheme);
        window.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerleave", onLeave);
      };
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = Boolean(e?.isIntersecting)));
    io.observe(canvas);

    let clock = 0;
    let last = performance.now();
    let shown = -1;
    let raf = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min((now - last) / 1000, 1 / 20);
      last = now;
      if (!visible || document.hidden) return;
      clock += dt;
      const k = Math.floor(clock / CYCLE) % DRAWINGS.length;
      const into = clock % CYCLE;
      if (k !== shown) {
        shown = k;
        setShape(k);
      }
      const forming = into < FORM + HOLD;
      // The spring tightens as the shape forms, so points arrive softly and then settle.
      const pull = forming ? 26 * Math.min(1, 0.25 + into / FORM) : 0;
      const damping = forming ? 7.5 : 1.6;

      for (const d of dots) {
        let ax = 0, ay = 0;
        if (forming) {
          const p = target(d, k);
          // A breath of motion while holding, so the shape feels alive.
          const wob = into > FORM ? 0.9 : 0;
          ax = (p.x + Math.sin(clock * 2 + d.phase) * wob - d.x) * pull;
          ay = (p.y + Math.cos(clock * 1.6 + d.phase) * wob - d.y) * pull;
        } else {
          // Released onto a slow current that curls across the canvas.
          const a = Math.sin(d.x * 0.006 + clock * 0.5) * Math.cos(d.y * 0.007 - clock * 0.4) * Math.PI * 2;
          ax = Math.cos(a) * 60 + (w / 2 - d.x) * 0.15;
          ay = Math.sin(a) * 60 + (h / 2 - d.y) * 0.15;
        }
        const mx = d.x - pointer.x, my = d.y - pointer.y;
        const m2 = mx * mx + my * my;
        if (m2 < 90 * 90 && m2 > 1) {
          const m = Math.sqrt(m2);
          const push = (1 - m / 90) * 2600;
          ax += (mx / m) * push;
          ay += (my / m) * push;
        }
        d.vx = (d.vx + ax * dt) * Math.max(0, 1 - damping * dt);
        d.vy = (d.vy + ay * dt) * Math.max(0, 1 - damping * dt);
        d.x += d.vx * dt;
        d.y += d.vy * dt;
      }
      draw(clock);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      themeWatch.disconnect();
      scheme.removeEventListener("change", onScheme);
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div className={`relative ${className}`}>
      <canvas ref={ref} aria-hidden="true" className="absolute inset-0 h-full w-full" />
      {caption && (
        <p className="absolute inset-x-0 bottom-0 text-center font-mono text-[11px] tracking-wider text-ink-faint uppercase" aria-hidden="true">
          <span key={shape} className="inline-block animate-rise">
            {SHAPES[shape]}
          </span>
        </p>
      )}
    </div>
  );
}
