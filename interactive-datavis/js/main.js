// js/main.js

// Globals we'll fill after data loads
let times = [];
let cells = [];
let values = [];

let valuesByCell;   // Map: cell_id -> array of rows
let valuesByTime;   // Map: frame_index -> array of rows

let currentFrameIndex = 0;
let playing = false;
let playInterval = null;

const mapImg = document.getElementById("goes-frame");
const overlaySvg = d3.select("#map-overlay");
const timeSlider = document.getElementById("time-slider");
const currentTimeLabel = document.getElementById("current-time");
const playPauseButton = document.getElementById("play-pause");

const tsSvg = d3.select("#timeseries");
const tsMargin = { top: 20, right: 20, bottom: 30, left: 50 };
const tsWidth = +tsSvg.attr("width") - tsMargin.left - tsMargin.right;
const tsHeight = +tsSvg.attr("height") - tsMargin.top - tsMargin.bottom;
const tsG = tsSvg.append("g")
  .attr("transform", `translate(${tsMargin.left},${tsMargin.top})`);

let xScaleTS, yScaleTS;
let xAxisTS, yAxisTS;
let xAxisGroup, yAxisGroup;
let tsLinePath;     // path element for currently selected cell
let tsFocusLine;    // vertical line showing current time

// Load all data
Promise.all([
  d3.csv("data/times.csv", d => ({
    frame_index: +d.frame_index,
    time_iso: d.time_iso,
    image_url: d.image_url
  })),
  d3.csv("data/cells.csv", d => ({
    cell_id: +d.cell_id,
    row: +d.row,
    col: +d.col,
    x_norm: +d.x_norm,
    y_norm: +d.y_norm,
    width_norm: +d.width_norm,
    height_norm: +d.height_norm,
    lat: +d.lat,
    lon: +d.lon
  })),
  d3.csv("data/values.csv", d => ({
    frame_index: +d.frame_index,
    cell_id: +d.cell_id,
    brightness_temp: +d.brightness_temp
  }))
]).then(([timesData, cellsData, valuesData]) => {
  times = timesData.sort((a, b) => a.frame_index - b.frame_index);
  cells = cellsData;
  values = valuesData;

  valuesByCell = d3.group(values, d => d.cell_id);
  valuesByTime = d3.group(values, d => d.frame_index);

  initVis();
}).catch(err => {
  console.error("Error loading data:", err);
});

function initVis() {
  // 1. Set slider bounds
  timeSlider.min = 0;
  timeSlider.max = times.length - 1;
  timeSlider.value = 0;

  // 2. Set initial image + time label
  updateFrame(0);

  // 3. Once image loads, size overlay SVG to match
  mapImg.addEventListener("load", () => {
    const bbox = mapImg.getBoundingClientRect();
    overlaySvg
      .attr("width", bbox.width)
      .attr("height", bbox.height)
      .style("width", bbox.width + "px")
      .style("height", bbox.height + "px");

    drawCellOverlay(bbox.width, bbox.height);
  });

  // Force a load event if image URL already set
  mapImg.src = times[0].image_url;

  // 4. Set up slider interaction
  timeSlider.addEventListener("input", e => {
    const idx = +e.target.value;
    updateFrame(idx);
  });

  // 5. Play / pause
  playPauseButton.addEventListener("click", togglePlay);

  // 6. Initialize time series axes
  initTimeseries();
}

function updateFrame(frameIndex) {
  currentFrameIndex = frameIndex;

  // Update image
  const t = times[frameIndex];
  mapImg.src = t.image_url;

  // Update label
  currentTimeLabel.textContent = t.time_iso;

  // Sync slider if needed
  if (+timeSlider.value !== frameIndex) {
    timeSlider.value = frameIndex;
  }

  // Move vertical line in timeseries (if created)
  if (tsFocusLine && xScaleTS) {
    const xVal = frameIndex; // we’ll use frame_index as x domain
    tsFocusLine
      .attr("x1", xScaleTS(xVal))
      .attr("x2", xScaleTS(xVal));
  }
}

function togglePlay() {
  if (!playing) {
    playing = true;
    playPauseButton.textContent = "Pause";

    playInterval = setInterval(() => {
      let nextIndex = currentFrameIndex + 1;
      if (nextIndex >= times.length) {
        nextIndex = 0;
      }
      updateFrame(nextIndex);
    }, 500); // 500 ms per frame; adjust speed as you like

  } else {
    playing = false;
    playPauseButton.textContent = "Play";
    clearInterval(playInterval);
  }
}

function drawCellOverlay(imgWidth, imgHeight) {
  // Each cell gets a rect; we’ll allow pointer events on those
  const cellSelection = overlaySvg
    .selectAll("rect.cell")
    .data(cells, d => d.cell_id);

  cellSelection.enter()
    .append("rect")
    .attr("class", "cell")
    .attr("x", d => (d.x_norm - d.width_norm / 2) * imgWidth)
    .attr("y", d => (d.y_norm - d.height_norm / 2) * imgHeight)
    .attr("width", d => d.width_norm * imgWidth)
    .attr("height", d => d.height_norm * imgHeight)
    .attr("fill", "rgba(255,255,255,0)")   // invisible by default
    .attr("stroke", "none")
    .style("pointer-events", "all")         // capture mouse events
    .on("mouseover", (event, d) => {
      d3.select(event.currentTarget)
        .attr("stroke", "yellow")
        .attr("stroke-width", 1.5);

      showTimeseriesForCell(d.cell_id, d);
    })
    .on("mouseout", (event, d) => {
      d3.select(event.currentTarget)
        .attr("stroke", "none");
    })
    .append("title")
    .text(d => `Cell ${d.cell_id}\nlat=${d.lat.toFixed(2)}, lon=${d.lon.toFixed(2)}`);
}

function initTimeseries() {
  // Domain of x = frame_index
  const xDomain = d3.extent(times, d => d.frame_index);

  // Domain of y = brightness_temp across all values
  const yDomain = d3.extent(values, d => d.brightness_temp);

  xScaleTS = d3.scaleLinear()
    .domain(xDomain)
    .range([0, tsWidth]);

  yScaleTS = d3.scaleLinear()
    .domain(yDomain)
    .nice()
    .range([tsHeight, 0]);

  xAxisTS = d3.axisBottom(xScaleTS)
    .ticks(Math.min(times.length, 10))
    .tickFormat(i => times[i] ? times[i].time_iso.slice(11, 16) : i); // show HH:MM

  yAxisTS = d3.axisLeft(yScaleTS)
    .ticks(6);

  xAxisGroup = tsG.append("g")
    .attr("transform", `translate(0,${tsHeight})`)
    .call(xAxisTS);

  yAxisGroup = tsG.append("g")
    .call(yAxisTS);

  // Axis labels (optional)
  tsG.append("text")
    .attr("x", tsWidth / 2)
    .attr("y", tsHeight + 25)
    .attr("text-anchor", "middle")
    .attr("font-size", 12)
    .text("Frame index / time of day");

  tsG.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -tsHeight / 2)
    .attr("y", -35)
    .attr("text-anchor", "middle")
    .attr("font-size", 12)
    .text("Brightness temperature");

  // Path for cell time series
  tsLinePath = tsG.append("path")
    .attr("fill", "none")
    .attr("stroke", "steelblue")
    .attr("stroke-width", 2);

  // Vertical focus line for current frame
  tsFocusLine = tsG.append("line")
    .attr("y1", 0)
    .attr("y2", tsHeight)
    .attr("stroke", "red")
    .attr("stroke-width", 1)
    .attr("stroke-dasharray", "4 2");

  // Position the focus line at t=0 initially
  tsFocusLine
    .attr("x1", xScaleTS(0))
    .attr("x2", xScaleTS(0));
}

function showTimeseriesForCell(cellId, cellMeta) {
  const cellValues = valuesByCell.get(cellId);
  if (!cellValues) return;

  // Sort by frame_index just in case
  cellValues.sort((a, b) => a.frame_index - b.frame_index);

  const lineGenerator = d3.line()
    .x(d => xScaleTS(d.frame_index))
    .y(d => yScaleTS(d.brightness_temp));

  tsLinePath
    .datum(cellValues)
    .attr("d", lineGenerator);

  const titleDiv = document.getElementById("timeseries-title");
  titleDiv.textContent = `Time series for cell ${cellId} (lat=${cellMeta.lat.toFixed(2)}, lon=${cellMeta.lon.toFixed(2)})`;
}
