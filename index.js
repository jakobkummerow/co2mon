class Timeline {
  constructor(capacity, config) {
    if (capacity <= 0) throw new Error("Capacity <= 0 does not make sense");
    this.capacity = capacity;
    this.config = config;
    this.time = new Array(capacity);
    this.value = new Array(capacity);
    this.size = 0;
    this.cursor = 0;
    this.min_time = Infinity;
    this.max_time = -Infinity;
    this.min_value = Infinity;
    this.max_value = -Infinity;
  }

  firstIndex() {
    return this.size < this.capacity ? 0 : this.cursor;
  }

  addPointInternal(time, value) {
    let recalibrate = false;
    let next_pos = this.cursor + 1;
    if (next_pos === this.capacity) next_pos = 0;
    if (time < this.max_time) {
      throw new Error("new time should be maximum time");
    }
    this.max_time = time;
    if (this.size === this.capacity) {
      // Overwriting an entry.
      if (this.time[this.cursor] !== this.min_time) {
        throw new Error("about-to-be-overwritten time should be minimum time");
      }
      this.min_time = this.time[next_pos];
      let current = this.value[this.cursor];
      if (current === this.min_value || current === this.max_value) {
        recalibrate = true;
      }
    } else {
      if (this.size === 0) this.min_time = time;
      this.size++;
    }
    this.time[this.cursor] = time;
    this.value[this.cursor] = value;
    this.cursor = next_pos;
    if (!recalibrate) {
      if (value > this.max_value) this.max_value = value;
      if (value < this.min_value) this.min_value = value;
    }
    return recalibrate;
  }

  addPoint(time, value) {
    let recalibrate = this.addPointInternal(time, value);
    if (recalibrate) this.Recalibrate();
  }

  Recalibrate() {
    if (this.size === 0) {
      this.min_value = Infinity;
      this.max_value = -Infinity;
      return;
    }
    let min_value = this.value[0];
    let max_value = min_value;
    for (let i = 1; i < this.size; i++) {
      let value = this.value[i];
      if (value < min_value) min_value = value;
      if (value > max_value) max_value = value;
    }
    this.max_value = max_value;
    this.min_value = min_value;
  }

  ToRelativeTime(t) {
    return (t - this.min_time) / (this.max_time - this.min_time);
  }

  IndexFromRelative(t) {
    if (this.size === 0) return -1;
    let absolute = this.min_time + (this.max_time - this.min_time) * t;
    let delta = Infinity;
    // Linear search for now, might improve later.
    let index = this.firstIndex();
    let last = index;
    for (let i = 0; i < this.size; i++) {
      let new_delta = Math.abs(this.time[index] - absolute);
      if (new_delta > delta) return last;
      delta = new_delta;
      last = index;
      index++;
      if (index >= this.size) index = 0;
    }
    return last;
  }
}

function DynamicMin(value, factor) {
  let m = factor * Math.floor(value / factor);
  if (m === value) return m - factor;
  return m;
}

function DynamicMax(value, factor) {
  let m = factor * Math.ceil(value / factor);
  if (m === value) return m + factor;
  return m;
}

class TemperatureConfig {
  constructor() {}

  Label() { return "Temperature"; }
  Format(v, fractional=1) { return `${v.toFixed(fractional)}\u00b0C`; }
  DefaultMin() { return 22; }
  DefaultMax() { return 25; }
  DynamicMin(value) { return DynamicMin(value, 1); }
  DynamicMax(value) { return DynamicMax(value, 1); }

  MakeGradient(plot) {
    let grad_min = plot.ToRelativeValue(18);
    let grad_max = plot.ToRelativeValue(30);
    if (!Number.isFinite(grad_min)) grad_min = -10000;
    if (!Number.isFinite(grad_max)) grad_max = 10000;
    const grad = plot.ctx.createLinearGradient(0, grad_min, 0, grad_max);
    grad.addColorStop(0, "#0000D0");
    grad.addColorStop(0.5, "#00D000");
    grad.addColorStop(0.66, "#ffe000");
    grad.addColorStop(1, "#D00000");
    return grad;
  }
}

class HumidityConfig {
  constructor() {}

  Label() { return "Humidity"; }
  Format(v, fractional=1) { return `${v.toFixed(fractional)}%`; }
  DefaultMin() { return 40; }
  DefaultMax() { return 60; }
  DynamicMin(value) { return DynamicMin(value, 5); }
  DynamicMax(value) { return DynamicMax(value, 5); }

  MakeGradient(plot) {
    let grad_min = plot.ToRelativeValue(0);
    let grad_max = plot.ToRelativeValue(100);
    if (!Number.isFinite(grad_min)) grad_min = -10000;
    if (!Number.isFinite(grad_max)) grad_max = 10000;
    const grad = plot.ctx.createLinearGradient(0, grad_min, 0, grad_max);
    grad.addColorStop(0.2, "#D00000");
    grad.addColorStop(0.3, "#ffe000");
    grad.addColorStop(0.4, "#00D000");
    grad.addColorStop(0.6, "#00D000");
    grad.addColorStop(0.7, "#ffe000");
    grad.addColorStop(0.8, "#D00000");
    return grad;
  }
}

class Co2Config {
  constructor() {}

  Label() { return "CO\u2082 concentration"; }
  Format(v) { return `${v.toFixed(0)} ppm`; }
  DefaultMin() { return 500; }
  DefaultMax() { return 700; }
  DynamicMin(value) { return DynamicMin(value, 50); }
  DynamicMax(value) { return DynamicMax(value, 50); }

  MakeGradient(plot) {
    let grad_min = plot.ToRelativeValue(400);
    let grad_max = plot.ToRelativeValue(2000);
    if (!Number.isFinite(grad_min)) grad_min = -10000;
    if (!Number.isFinite(grad_max)) grad_max = 10000;
    const grad = plot.ctx.createLinearGradient(0, grad_min, 0, grad_max);
    grad.addColorStop(0, "#00D000");
    grad.addColorStop(0.375, "#ffe000");
    grad.addColorStop(1, "#D00000");
    return grad;
  }
}

class Plot {
  constructor(canvas, height_fraction, config) {
    this.canvas = document.getElementById(canvas);
    this.config = config;
    this.changed = true;
    this.mouse_x = -1;
    this.mouse_y = -1;
    this.timeformat =
        new Intl.DateTimeFormat(navigator.language, {timeStyle: 'medium'});
    this.scale_max = 0;
    this.scale_min = 0;
    this.scale_range = 0;

    this.width = window.innerWidth - 20;
    this.height = Math.trunc((window.innerHeight - 50) / height_fraction);
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.min_draw_x = 60;
    this.max_draw_y = 10;
    this.min_draw_y = this.height - 10;
    this.draw_height = this.min_draw_y - this.max_draw_y;
    this.draw_width = this.width - this.min_draw_x;

    this.canvas.onmousemove = (event) => {
      let x = event.offsetX;
      let y = event.offsetY;
      if (x >= 0 && x < this.width && x !== this.mouse_x) {
        this.changed = true;
        this.mouse_x = x;
      }
      if (y >= 0 && y < this.height && y !== this.mouse_y) {
        this.changed = true;
        this.mouse_y = y;
      }
    }
    this.canvas.onmouseleave = (_) => {
      this.mouse_x = this.mouse_y = -1;
      this.changed = true;
    }

    this.ctx = this.canvas.getContext("2d");
    this.ctx.lineJoin = "round";

    this.data = new Timeline(this.draw_width, config);

    this.update();
  }

  update() {
    if (!this.changed) return;
    this.ctx.fillStyle = "white";
    this.ctx.fillRect(0, 0, this.width, this.height);
    this.scale_max = this.config.DynamicMax(this.data.max_value);
    this.scale_min = this.config.DynamicMin(this.data.min_value);
    this.scale_range = this.scale_max - this.scale_min;
    this.DrawScale();
    this.DrawLine();
    this.DrawMouse();
    this.changed = false;
  }

  addPoint(time, value) {
    this.data.addPoint(time, value);
    this.changed = true;
  }

  DrawScale() {
    this.ctx.fillStyle = "black";
    this.ctx.font = "12pt Arial";
    this.ctx.textBaseline = "middle";
    let max_label = this.config.Format(this.scale_max, 0);
    let min_label = this.config.Format(this.scale_min, 0);
    this.ctx.fillText(max_label, 5, this.max_draw_y);
    this.ctx.fillText(min_label, 5, this.min_draw_y);
    this.ctx.strokeStyle = "#888";
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(this.min_draw_x, this.max_draw_y);
    this.ctx.lineTo(this.width, this.max_draw_y);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(this.min_draw_x, this.min_draw_y);
    this.ctx.lineTo(this.width, this.min_draw_y);
    this.ctx.stroke();

    this.ctx.save();
    this.ctx.rotate(-Math.PI / 2);
    this.ctx.textAlign = "center";
    this.ctx.fillText(this.config.Label(), -this.height / 2, this.min_draw_x / 3);
    this.ctx.restore();
  }

  DrawLine() {
    if (this.data.size === 0) return;
    this.ctx.strokeStyle = this.config.MakeGradient(this);
    this.ctx.lineWidth = 3;

    this.ctx.beginPath();
    let index = this.data.firstIndex();
    let t = this.data.time[index];
    let v = this.data.value[index];
    let draw_x = this.ToRelativeTime(t);
    let draw_y = this.ToRelativeValue(v);
    this.ctx.moveTo(draw_x, draw_y);
    for (let i = 1; i < this.data.size; i++) {
      index++;
      if (index === this.data.capacity) index = 0;
      t = this.data.time[index];
      v = this.data.value[index];
      draw_x = this.ToRelativeTime(t);
      draw_y = this.ToRelativeValue(v);
      this.ctx.lineTo(draw_x, draw_y);
    }
    this.ctx.stroke();
  }

  DrawMouse() {
    if (this.mouse_x >= 0 && this.mouse_y >= 0) {
      // Vertical line at cursor position.
      this.ctx.strokeStyle = "#888";
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(this.mouse_x, 0);
      this.ctx.lineTo(this.mouse_x, this.height);
      this.ctx.stroke();

      // Tooltip for nearest data point.
      let index = this.IndexFromCoordinates(this.mouse_x);
      if (index === -1) return;
      let t = this.data.time[index];
      let v = this.data.value[index];
      let draw_x = this.ToRelativeTime(t);
      let draw_y = this.ToRelativeValue(v);
      let draw_dot_x = draw_x;
      let draw_dot_y = draw_y;

      this.ctx.fillStyle = "#ffffd0";
      let formatted = this.config.Format(v);
      let text = `${this.timeformat.format(new Date(t))}: ${formatted}`;
      const width = this.ctx.measureText(text).width + 10;
      const kHeight = 20;
      if (draw_x + width > this.width) draw_x -= width;
      if (draw_y + kHeight > this.height) draw_y -= kHeight;
      this.ctx.fillRect(draw_x, draw_y, width, kHeight);
      this.ctx.strokeRect(draw_x, draw_y, width, kHeight);
      this.ctx.fillStyle = "black";
      this.ctx.fillText(text, draw_x + 5, draw_y + kHeight / 2 + 1, width);

      this.ctx.beginPath();
      this.ctx.arc(draw_dot_x, draw_dot_y, 4, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  DrawError(text) {
    this.ctx.fillStyle = "#bbb";
    this.ctx.font = "24pt Arial";
    this.ctx.textBaseline = "middle";
    this.ctx.textAlign = "center";
    let middle_x = (this.min_draw_x + this.width) / 2;
    let middle_y = (this.min_draw_y + this.max_draw_y) / 2;
    this.ctx.fillText(text, middle_x, middle_y);
  }

  ToRelativeTime(t) {
    return this.min_draw_x + this.data.ToRelativeTime(t) * this.data.size;
  }

  ToRelativeValue(v) {
    return this.max_draw_y +
        (this.scale_max - v) / this.scale_range * this.draw_height;
  }

  IndexFromCoordinates(x) {
    let in_area = x - this.min_draw_x;
    let scaled = in_area / this.data.size;
    return this.data.IndexFromRelative(scaled);
  }
}

var g_plot_temp;
var g_plot_humid;
var g_plot_co2;
var g_ui;

function update() {
  g_plot_temp.update();
  g_plot_humid.update();
  g_plot_co2.update();
  window.requestAnimationFrame(update);
}

class UI {
  constructor() {
    this.last_event = 0;
  }
  GetData() {
    fetch("get?since=" + this.last_event).then((response) => {
      if (!response.ok) {
        g_plot_temp.DrawError("Network response was not ok");
        throw new Error('Network response was not ok');
      }
      return response.json();
    }).then((response) => {
      this.processResponse(response);
    }, (error) => {
      console.error('GET error: ' + error);
    });
  }
  processResponse(data) {
    if (data.status) {
      if (data.status === "shutdown") {
        g_plot_temp.DrawError("Server shutting down, please reload");
        return;  // Don't schedule a new request.
      }
    }
    if (data.data) {
      for (let c of data.data) {
        let metric = c.m;
        let time = c.t;
        let value = c.v;
        if (metric === "C") {
          g_plot_co2.addPoint(time, value);
        } else if (metric === "H") {
          g_plot_humid.addPoint(time, value);
        } else if (metric === "T") {
          g_plot_temp.addPoint(time, value);
        }
        if (time > this.last_event) this.last_event = time;
      }
    }
    setTimeout(() => { this.GetData(); }, 0);
  }
}

function start() {
  g_plot_temp = new Plot("temp_canvas", 3, new TemperatureConfig());
  g_plot_humid = new Plot("hum_canvas", 3, new HumidityConfig());
  g_plot_co2 = new Plot("co2_canvas", 3, new Co2Config());
  g_ui = new UI();
  g_ui.GetData();
  window.requestAnimationFrame(update);
}
