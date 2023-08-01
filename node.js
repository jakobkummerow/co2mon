const {exec, spawn} = require('child_process');
const fs = require('fs');
const http = require('http');
const url = require('url');

const kPort = 8553;
const kSaveFileName = 'saved_data.txt';
const kDriverExeName = './driver.bin';
// We're getting 3 data points per 2 seconds, so we need
// 3600 / 2 * 3 == 5400 capacity per hour.
const kDataCapacity = 5400;

const kDetectHidraw = 'dmesg | grep zyTemp | grep input0 | tail -1 | ' +
    'sed -e \'s/.*hidraw\\([[:digit:]]\\+\\).*/\\/dev\\/hidraw\\1/\'';

let g_hidraw_device;

class DataPoint {
  constructor(metric, time, value) {
    this.metric = metric;
    this.time = time;
    this.value = value;
  }

  toSerializable() {
    return {m: this.metric, t: this.time, v: this.value};
  }
  static fromSerializable(obj) {
    return new DataPoint(obj.m, obj.t, obj.v);
  }

  static fromLogLine(str) {
    let words = str.split(" ");
    let metric = words[0];
    let value = Number(words[1]);
    let timestamp = Date.now();
    if (metric === "C") {
      return new DataPoint("C", timestamp, value);
    }
    if (metric === "H") {
      return new DataPoint("H", timestamp, value / 100);
    }
    if (metric === "T") {
      let celsius = value / 16 - 273.15;
      return new DataPoint("T", timestamp, celsius);
    }
    return null;
  }
}

class Data {
  constructor(filename) {
    this.buffer = new Array(kDataCapacity);
    this.cursor = 0;
    this.size = 0;
    this.capacity = kDataCapacity;
    this.min_time = 0;
    this.max_time = 0;
    if (fs.existsSync(filename)) {
      let data = JSON.parse(fs.readFileSync(filename, 'utf8'));
      for (let i = 0; i < data.length; i++) {
        this.addDataPoint(DataPoint.fromSerializable(data[i]));
      }
    }
  }

  getAll() {
    let data = [];
    let index = this.size < this.capacity ? 0 : this.cursor;
    for (let i = 0; i < this.size; i++) {
      data.push(this.buffer[index].toSerializable());
      index++;
      if (index === this.capacity) index = 0;
    }
    return data;
  }

  toSaveFileContents() {
    return JSON.stringify(this.getAll());
  }

  addDataPoint(dp) {
    if (dp.time < this.max_time) {
      throw new Error("data points must be chronological");
    }
    let next_pos = this.cursor + 1;
    if (next_pos === this.capacity) next_pos = 0;
    this.max_time = dp.time;
    if (this.size === this.capacity) {
      // Overwriting an entry.
      if (this.buffer[this.cursor].time !== this.min_time) {
        throw new Error("to-be-overwritten time should be minimum time");
      }
      this.min_time = this.buffer[next_pos].time;
    } else {
      if (this.size === 0) this.min_time = dp.time;
      this.size++;
    }
    this.buffer[this.cursor] = dp;
    this.cursor = next_pos;
  }

  getItemsSince(since) {
    if (since < this.min_time) return this.getAll();
    if (since >= this.max_time) return null;
    if (this.size === 0) return null;
    let dist_from_min = Math.abs(since - this.min_time);
    let dist_from_max = Math.abs(since - this.max_time);
    let index;
    let end = this.size < this.capacity ? this.size : this.cursor;
    if (dist_from_min < dist_from_max) {
      index = this.size < this.capacity ? 0 : this.cursor;
      while (this.buffer[index].time <= since) {
        index++;
        if (index === this.capacity) index = 0;
      }
    } else {
      index = this.size < this.capacity ? this.size : this.cursor;
      while (true) {
        let next = index - 1;
        if (next < 0) next = this.capacity - 1;
        if (this.buffer[next].time <= since) break;
        index = next;
      }
    }
    let data = [];
    while (index != end) {
      data.push(this.buffer[index].toSerializable());
      index++;
      if (index === this.capacity) index = 0;
    }
    return data;
  }
}

let g_data = new Data(kSaveFileName);

class PendingRequest {
  constructor(res, since) {
    this.res = res;
    this.since = since;
  }
}
class PendingRequests {
  static kTimeout = 60 * 1000;
  constructor() {
    this.pending_requests = [];
    this.timeout = null;
    this.serve_wrapper = () => this.Serve();
  }
  Add(res, since) {
    this.pending_requests.push(new PendingRequest(res, since));
    if (this.timeout === null) {
      this.timeout = setTimeout(this.serve_wrapper, PendingRequests.kTimeout);
    }
  }
  Serve() {
    for (let pr of this.pending_requests) {
      pr.res.statusCode = 200;
      pr.res.write(JSON.stringify({status: "retry"}));
      pr.res.end();
    }
    this.pending_requests = [];
    this.timeout = null;
  }
  Notify() {
    for (let pr of this.pending_requests) {
      let data = g_data.getItemsSince(pr.since);
      if (data === null) {
        console.log("no data for pending request? bug!")
        data = {};
      }
      pr.res.writeHead(200, { 'Content-Type': 'application/json' });
      pr.res.write(JSON.stringify({data}));
      pr.res.end();
    }
    this.clearTimeout();
    this.pending_requests = [];
  }
  Shutdown() {
    for (let pr of this.pending_requests) {
      pr.res.writeHead(200, { 'Content-Type': 'application/json' });
      pr.res.write(JSON.stringify({status: "shutdown"}));
      pr.res.end();
    }
    this.clearTimeout();
  }
  clearTimeout() {
    if (this.timeout !== null) clearTimeout(this.timeout);
    this.timeout = null;
  }
}

let g_pending_requests = new PendingRequests();

exec(kDetectHidraw, (error, stdout, stderr) => {
  if (error) {
    console.log(`error: ${error.message}`);
    return;
  }
  if (stderr) {
    console.log(`stderr: ${stderr}`);
    return;
  }
  g_hidraw_device = stdout.trim();
  console.log(`device detected: ${g_hidraw_device}`);

  let driver = spawn(kDriverExeName, [g_hidraw_device]);
  driver.stdout.on('data', function(data) {
    process.stdout.write(data);
    let dp = DataPoint.fromLogLine(data.toString());
    if (dp === null) return;
    g_data.addDataPoint(dp);
    g_pending_requests.Notify();
  });
  driver.stderr.on('data', function(data) {
    process.stderr.write(data);
  });
  driver.on('close', function(code, signal) {
    console.log(`${kDriverExeName} closed with signal ${signal}, code ${code}`);
  });
});

const server = http.createServer((req, res) => {
  if (req.method === "GET") {
    let req_url = req.url;
    if (req_url === '/') req_url = "/index.html";
    let mimetype = null;
    if (req_url === "/index.html") {
      mimetype = "text/html; charset=utf-8";
    } else if (req_url === "/index.js") {
      mimetype = "text/javascript";
    }
    if (mimetype) {
      let path = "." + req_url;
      fs.readFile(path, 'utf8', (err, data) => {
        if (err) {
          console.error(err);
          res.writeHead(404);
          res.end();
          return;
        }
        res.statusCode = 200;
        res.setHeader('Content-Type', mimetype);
        res.write(data);
        res.end();
      });
      return;
    }
    let urlparts = url.parse(req_url, true);
    if (urlparts.pathname === "/get") {
      let since = Number(urlparts.query.since);
      let data = g_data.getItemsSince(since);
      if (data === null) {
        g_pending_requests.Add(res, since);
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write(JSON.stringify({data}));
      res.end();
      return;
    }
    // Everything else is 404.
    res.statusCode = 404;
    res.end();
  } else {
    res.statusCode = 404;
    res.write("unsupported");
    res.end();
  }
});

function Shutdown() {
  console.log("Shutting down...");
  g_pending_requests.Shutdown();
  try {
    fs.writeFileSync(kSaveFileName, g_data.toSaveFileContents());
    console.log("Data written to file.")
  } catch (err) {
    console.error(err);
  }
  server.close(() => {
    console.log("Server stopped.");
    process.exit();
  });
  // Fallback: kill the process if the server fails to stop quickly.
  setTimeout(() => { process.exit(); }, 3000);
}

process.on('SIGTERM', () => { Shutdown(); });
process.on('SIGINT', () => { Shutdown(); });

server.listen(kPort, () => {
  console.log(`Server running on port ${kPort}`);
});
