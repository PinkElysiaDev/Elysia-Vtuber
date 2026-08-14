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
