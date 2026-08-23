/**
 * Real-time Audio Spectrum & Waveform Canvas Visualizer
 * Renders Neon Frequency Bars & Smooth Waveform Spectra
 */

class AudioSpectrumVisualizer {
  constructor(canvasElement, options = {}) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    this.barCount = options.barCount || 32;
    this.barGap = options.barGap || 3;
    this.color = options.color || '#38bdf8';
    this.secondaryColor = options.secondaryColor || '#a855f7';
    this.active = false;
    this.dataArray = new Uint8Array(this.barCount);
    this.animId = null;
    // 真实电平驱动模式状态
    this.level = 0;
    this.peakLevel = 0;
    this.lastFeedAt = 0;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width * (window.devicePixelRatio || 1);
    this.canvas.height = rect.height * (window.devicePixelRatio || 1);
    this.ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    this.width = rect.width;
    this.height = rect.height;
  }

  /**
   * 喂入执行器上报的真实电平（rms/peak ∈ 0..1，按播放位置对齐）。
   * 超过 250ms 未喂入视为停止，波形归零。
   */
  feedLevel(level) {
    this.lastFeedAt = performance.now();
    const rms = Math.max(0, Math.min(1, Number(level && level.rms) || 0));
    const peak = Math.max(0, Math.min(1, Number(level && level.peak) || 0));
    // 平滑，避免 30Hz 上报的块级跳变
    this.level += (rms - this.level) * 0.6;
    this.peakLevel = Math.max(this.peakLevel * 0.9, peak);
  }

  /** 真实电平驱动模式：柱条幅度由真实 RMS 决定，各柱带确定性造型与时间扰动 */
  startRealtime() {
    this.active = true;
    const loop = () => {
      if (!this.active) return;
      const stale = performance.now() - this.lastFeedAt > 250;
      const base = stale ? 0 : this.level;
      for (let i = 0; i < this.barCount; i++) {
        const shape = 0.35 + 0.65 * Math.sin(Math.PI * (i + 1) / (this.barCount + 1));
        const jitter = 0.7 + 0.3 * Math.abs(Math.sin(Date.now() * 0.004 + i * 1.7));
        const target = stale ? 3 : 8 + base * 230 * shape * jitter;
        this.dataArray[i] += (target - this.dataArray[i]) * (stale ? 0.2 : 0.5);
      }
      this.render();
      this.animId = requestAnimationFrame(loop);
    };
    loop();
  }

  startSimulated() {
    this.active = true;
    const loop = () => {
      if (!this.active) return;

      // Generate soft organic simulated spectrum frequencies
      for (let i = 0; i < this.barCount; i++) {
        const target = Math.sin(Date.now() * 0.005 + i * 0.3) * 60 + Math.random() * 80 + 20;
        this.dataArray[i] += (target - this.dataArray[i]) * 0.15;
      }

      this.render();
      this.animId = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() {
    this.active = false;
    if (this.animId) cancelAnimationFrame(this.animId);
    this.ctx.clearRect(0, 0, this.width, this.height);
  }

  render() {
    this.ctx.clearRect(0, 0, this.width, this.height);

    const totalGapWidth = (this.barCount - 1) * this.barGap;
    const barWidth = (this.width - totalGapWidth) / this.barCount;

    const gradient = this.ctx.createLinearGradient(0, this.height, 0, 0);
    gradient.addColorStop(0, this.color);
    gradient.addColorStop(1, this.secondaryColor);

    for (let i = 0; i < this.barCount; i++) {
      const val = this.dataArray[i] || 0;
      const barHeight = (val / 255) * (this.height * 0.85);
      const x = i * (barWidth + this.barGap);
      const y = this.height - barHeight;

      // Render Bar
      this.ctx.fillStyle = gradient;
      this.ctx.beginPath();
      this.ctx.roundRect(x, y, barWidth, barHeight, [4, 4, 0, 0]);
      this.ctx.fill();

      // Render Top Glow Cap
      this.ctx.fillStyle = '#ffffff';
      this.ctx.beginPath();
      this.ctx.arc(x + barWidth / 2, y, barWidth / 3, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }
}

window.AudioSpectrumVisualizer = AudioSpectrumVisualizer;
