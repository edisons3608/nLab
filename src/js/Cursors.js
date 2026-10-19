import { clamp, getId, idFromCh, isEmpty } from './Utils.js'
import { colors } from './Axes.js'
import { getSampleRate } from './Timing.js'

const CHANNELS = ["Ch1", "Ch2", "Ch3", "Ch4"];
const CURSORS = ["A", "B"];
const NUM_DIVS = 12;

// Shapes 0 through 10 are the channel and trigger flags drawn by Flags.js. A
// mousedown on one of those starts a drag, so it must not place a cursor.
const NUM_FLAG_SHAPES = 11;

let enabled = false;

// Cursor positions are held in x-axis divisions (0 to 12) rather than sample
// indices so they stay put on screen when the timebase changes.
let positions = { A: null, B: null };
let next_cursor = "A";
let last_placed = null;

// Resolved readings for the current frame, filled in by update().
let readings = { A: null, B: null };

let cells = {};
let channel_rows = {};

// Sample count of the data behind the most recent readings, cached so the mouse
// and key handlers can snap to samples without re-reading the plot.
let num_samples = 0;

function fmtVolts(v) {
    if (v === null || v === undefined || Number.isNaN(v)) {
        return "--";
    }
    if (Math.abs(v) < 1.0) {
        return `${(v * 1000).toFixed(1)} mV`;
    }
    return `${v.toFixed(3)} V`;
}

function fmtSeconds(t) {
    if (t === null || t === undefined || Number.isNaN(t)) {
        return "--";
    }
    let magnitude = Math.abs(t);
    if (magnitude === 0) {
        return "0 s";
    } else if (magnitude >= 1.0) {
        return `${t.toFixed(4)} s`;
    } else if (magnitude >= 1e-3) {
        return `${(t * 1e3).toFixed(3)} ms`;
    } else if (magnitude >= 1e-6) {
        return `${(t * 1e6).toFixed(2)} µs`;
    }
    return `${(t * 1e9).toFixed(1)} ns`;
}

function fmtHertz(f) {
    if (f === null || f === undefined || Number.isNaN(f) || !Number.isFinite(f)) {
        return "--";
    }
    let magnitude = Math.abs(f);
    if (magnitude >= 1e6) {
        return `${(f / 1e6).toPrecision(4)} MHz`;
    } else if (magnitude >= 1e3) {
        return `${(f / 1e3).toPrecision(4)} kHz`;
    }
    return `${f.toPrecision(4)} Hz`;
}

function buildReadout() {
    let table = getId('cursor-readout-table');

    let header = document.createElement('tr');
    for (let text of ["", "A", "B", "Δ"]) {
        let th = document.createElement('th');
        th.textContent = text;
        header.appendChild(th);
    }
    table.appendChild(header);

    for (let ch of CHANNELS) {
        let row = document.createElement('tr');

        let label = document.createElement('th');
        label.textContent = `${idFromCh(ch)}`;
        label.style.color = colors[ch];
        row.appendChild(label);

        for (let key of ["A", "B", "D"]) {
            let cell = document.createElement('td');
            cell.textContent = "--";
            cells[`${ch}-${key}`] = cell;
            row.appendChild(cell);
        }

        channel_rows[ch] = row;
        table.appendChild(row);
    }

    let time_row = document.createElement('tr');
    time_row.className = "cursor-readout-time";
    let time_label = document.createElement('th');
    time_label.textContent = "t";
    time_row.appendChild(time_label);
    for (let key of ["A", "B", "D"]) {
        let cell = document.createElement('td');
        cell.textContent = "--";
        cells[`t-${key}`] = cell;
        time_row.appendChild(cell);
    }
    table.appendChild(time_row);

    let freq_row = document.createElement('tr');
    let freq_label = document.createElement('th');
    freq_label.innerHTML = "1/Δt";
    freq_row.appendChild(freq_label);
    for (let key of ["A", "B", "D"]) {
        let cell = document.createElement('td');
        cell.textContent = "";
        cells[`f-${key}`] = cell;
        freq_row.appendChild(cell);
    }
    table.appendChild(freq_row);
}

function xToIndex(x) {
    return clamp(Math.round(x * num_samples / NUM_DIVS), 0, num_samples - 1);
}

// Reads every channel at a cursor position, snapped to the nearest real sample.
function readAt(x, trace_data) {
    let idx = xToIndex(x);
    let sample_rate = getSampleRate();

    let reading = {
        x: idx * NUM_DIVS / num_samples,
        time: sample_rate ? idx / sample_rate : null,
        volts: {},
    };

    for (let ch of CHANNELS) {
        let y_data = trace_data.y[idFromCh(ch) - 1];
        let value = y_data ? y_data[idx] : null;
        reading.volts[ch] = (value === null || value === undefined) ? null : value;
    }

    return reading;
}

function setStatus() {
    let status = getId('cursors-status');

    if (!enabled) {
        status.textContent = "Off";
    } else if (readings.A && readings.B) {
        status.textContent = fmtSeconds(readings.B.time - readings.A.time);
    } else if (readings.A || readings.B) {
        status.textContent = `${readings.A ? "A" : "B"} set`;
    } else {
        status.textContent = "Click plot";
    }
}

function clearReadout() {
    for (let cell of Object.values(cells)) {
        cell.textContent = "";
    }
}

export function update(trace_data, chState) {
    let readout = getId('cursor-readout');

    readings = { A: null, B: null };

    num_samples = (!isEmpty(trace_data) && trace_data.x && trace_data.x[0]) ? trace_data.x[0].length : 0;

    if (enabled && num_samples > 0 && trace_data.y) {
        for (let name of CURSORS) {
            if (positions[name] !== null) {
                readings[name] = readAt(positions[name], trace_data);
            }
        }
    }

    setStatus();

    if (!enabled) {
        readout.classList.add("d-none");
        return;
    }
    readout.classList.remove("d-none");

    for (let ch of CHANNELS) {
        let isOn = !isEmpty(chState) && chState[ch].isOn;
        channel_rows[ch].classList.toggle("d-none", !isOn);
        if (!isOn) {
            continue;
        }

        let a = readings.A ? readings.A.volts[ch] : null;
        let b = readings.B ? readings.B.volts[ch] : null;

        cells[`${ch}-A`].textContent = fmtVolts(a);
        cells[`${ch}-B`].textContent = fmtVolts(b);
        cells[`${ch}-D`].textContent = (a === null || b === null) ? "--" : fmtVolts(b - a);
    }

    let time_a = readings.A ? readings.A.time : null;
    let time_b = readings.B ? readings.B.time : null;
    let delta_t = (time_a === null || time_b === null) ? null : time_b - time_a;

    cells["t-A"].textContent = fmtSeconds(time_a);
    cells["t-B"].textContent = fmtSeconds(time_b);
    cells["t-D"].textContent = fmtSeconds(delta_t);

    cells["f-A"].textContent = "";
    cells["f-B"].textContent = "";
    cells["f-D"].textContent = (delta_t === null || delta_t === 0) ? "--" : fmtHertz(1.0 / delta_t);
}

function drawCursorLine(name, reading) {
    return {
        type: 'line',
        layer: 'above',
        x0: reading ? reading.x : 0,
        y0: -5,
        x1: reading ? reading.x : 0,
        y1: 5,
        yref: 'y',
        label: {
            text: name,
            font: {
                color: 'rgba(255,255,255,1)',
                size: 11,
            },
            textposition: 'end',
            yanchor: 'top',
            padding: 3,
        },
        line: {
            color: 'rgba(255,255,255,0.8)',
            width: 1,
            dash: name === "A" ? 'solid' : '6px,4px',
        },
        visible: enabled && reading !== null
    }
}

function drawCursorMarker(ch, reading, isOn) {
    let value = reading ? reading.volts[ch] : null;
    return {
        type: 'circle',
        layer: 'above',
        xsizemode: 'pixel',
        ysizemode: 'pixel',
        xanchor: reading ? reading.x : 0,
        yanchor: value === null ? 0 : value,
        x0: -3.5,
        y0: -3.5,
        x1: 3.5,
        y1: 3.5,
        yref: `y${idFromCh(ch) + 1}`,
        fillcolor: colors[ch],
        line: {
            color: 'rgba(255,255,255,0.9)',
            width: 1,
        },
        visible: enabled && isOn && value !== null
    }
}

export function drawShapes(chState) {
    let shapes = [];

    for (let name of CURSORS) {
        shapes.push(drawCursorLine(name, readings[name]));
    }

    for (let name of CURSORS) {
        for (let ch of CHANNELS) {
            let isOn = !isEmpty(chState) && chState[ch].isOn;
            shapes.push(drawCursorMarker(ch, readings[name], isOn));
        }
    }

    return shapes;
}

function placeCursorAtPixel(clientX) {
    let gd = getId('scope-graph');
    let xaxis = gd._fullLayout.xaxis;
    if (num_samples === 0) {
        return;
    }

    let pixel = clientX - gd.getBoundingClientRect().left - xaxis._offset;
    let x = clamp(xaxis.p2r(pixel), 0, NUM_DIVS);

    positions[next_cursor] = x;
    last_placed = next_cursor;
    next_cursor = next_cursor === "A" ? "B" : "A";
}

function nudgeCursor(samples) {
    if (last_placed === null || num_samples === 0) {
        return;
    }

    let idx = xToIndex(positions[last_placed]) + samples;
    positions[last_placed] = clamp(idx, 0, num_samples - 1) * NUM_DIVS / num_samples;
}

function setEnabled(value) {
    enabled = value;
    getId('cursors-onoff').classList.toggle("active", enabled);
    if (!enabled) {
        clearReadout();
    }
}

export function clearCursors() {
    positions = { A: null, B: null };
    next_cursor = "A";
    last_placed = null;
    clearReadout();
}

// A mousedown on a channel or trigger flag begins a drag handled by Flags.js.
function onFlagShape(target) {
    let group = target.closest ? target.closest('.shape-group') : null;
    if (!group) {
        return false;
    }
    return parseInt(group.dataset.index) < NUM_FLAG_SHAPES;
}

export function initCursorEvents() {
    buildReadout();

    let gd = getId('scope-graph');
    let mouse_down = null;

    gd.addEventListener('mousedown', (event) => {
        mouse_down = {
            x: event.clientX,
            y: event.clientY,
            onFlag: onFlagShape(event.target),
        };
    });

    window.addEventListener('mouseup', (event) => {
        let start = mouse_down;
        mouse_down = null;

        if (!enabled || start === null || start.onFlag) {
            return;
        }
        // Ignore anything that was a drag rather than a click.
        if (Math.abs(event.clientX - start.x) > 3 || Math.abs(event.clientY - start.y) > 3) {
            return;
        }

        placeCursorAtPixel(event.clientX);
    });

    window.addEventListener('keydown', (event) => {
        if (!enabled) {
            return;
        }
        let tag = document.activeElement ? document.activeElement.tagName : null;
        if (tag === "INPUT" || tag === "TEXTAREA") {
            return;
        }

        if (event.key === "ArrowLeft") {
            nudgeCursor(event.shiftKey ? -10 : -1);
        } else if (event.key === "ArrowRight") {
            nudgeCursor(event.shiftKey ? 10 : 1);
        } else {
            return;
        }
        event.preventDefault();
    });

    getId('cursors-onoff').onclick = () => {
        setEnabled(!enabled);
    }

    getId('cursors-clear').onclick = () => {
        clearCursors();
    }

    setEnabled(false);
}
