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

let pinnedCellId = null;
let pinnedLinePath;   // second path

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
  initColorLegend();
}

function initColorLegend() {
  const legendSvg = d3.select("#color-legend");
  const width = +legendSvg.attr("width") - 60;
  const height = +legendSvg.attr("height") - 30;

  const g = legendSvg.append("g")
    .attr("transform", "translate(40,10)");

  // Domain based on your brightness_temp range
  const tempMin = d3.min(values, d => d.brightness_temp);
  const tempMax = d3.max(values, d => d.brightness_temp);

  const legendScale = d3.scaleLinear()
    .domain([tempMin, tempMax])
    .range([0, width]);

  const legendAxis = d3.axisBottom(legendScale)
    .ticks(5);

  // Gradient
  const defs = legendSvg.append("defs");
  const gradient = defs.append("linearGradient")
    .attr("id", "legend-gradient");

  gradient.append("stop").attr("offset", "0%").attr("stop-color", d3.interpolateInferno(0));
  gradient.append("stop").attr("offset", "100%").attr("stop-color", d3.interpolateInferno(1));

  g.append("rect")
    .attr("width", width)
    .attr("height", 12)
    .style("fill", "url(#legend-gradient)");

  g.append("g")
    .attr("transform", `translate(0, ${12})`)
    .call(legendAxis);

  g.append("text")
    .attr("x", width / 2)
    .attr("y", 30)
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .text("Brightness temperature (K)");
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
  const cellSelection = overlaySvg
    .selectAll("rect.cell")
    .data(cells, d => d.cell_id);

  const cellsEnter = cellSelection.enter()
    .append("rect")
    .attr("class", "cell")
    .attr("x", d => (d.x_norm - d.width_norm / 2) * imgWidth)
    .attr("y", d => (d.y_norm - d.height_norm / 2) * imgHeight)
    .attr("width", d => d.width_norm * imgWidth)
    .attr("height", d => d.height_norm * imgHeight)
    .attr("fill", "rgba(255,255,255,0)")
    .attr("stroke", "none")
    .style("pointer-events", "all")
    .on("mouseover", (event, d) => {
      d3.select(event.currentTarget)
        .attr("stroke", "yellow")
        .attr("stroke-width", 1.5);

      showTimeseriesForCell(d.cell_id, d, false); // not pinned
    })
    .on("mouseout", (event, d) => {
      if (d.cell_id !== pinnedCellId) {
        d3.select(event.currentTarget)
          .attr("stroke", "none");
      }
    })
    .on("click", (event, d) => {
      pinnedCellId = d.cell_id;
      // Reset all strokes
      overlaySvg.selectAll("rect.cell")
        .attr("stroke", "none");

      // Highlight pinned
      d3.select(event.currentTarget)
        .attr("stroke", "cyan")
        .attr("stroke-width", 2);

      showTimeseriesForCell(d.cell_id, d, true); // pinned
    });

  cellsEnter.append("title")
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

  // Second path
  pinnedLinePath = tsG.append("path")
    .attr("fill", "none")
    .attr("stroke", "gray")
    .attr("stroke-width", 2)
    .attr("stroke-dasharray", "4 2");


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

function showTimeseriesForCell(cellId, cellMeta, isPinned) {
  const cellValues = valuesByCell.get(cellId);
  if (!cellValues) return;

  cellValues.sort((a, b) => a.frame_index - b.frame_index);

  const lineGenerator = d3.line()
    .x(d => xScaleTS(d.frame_index))
    .y(d => yScaleTS(d.brightness_temp));

  if (isPinned) {
    pinnedLinePath
      .datum(cellValues)
      .attr("d", lineGenerator);
  } else {
    tsLinePath
      .datum(cellValues)
      .attr("d", lineGenerator);
  }

  const titleDiv = document.getElementById("timeseries-title");
  if (isPinned) {
    titleDiv.textContent =
      `Pinned cell ${cellId} (cyan, lat=${cellMeta.lat.toFixed(2)}, lon=${cellMeta.lon.toFixed(2)}) and hover cell (blue)`;
  } else {
    titleDiv.textContent =
      `Hover cell ${cellId} (blue, lat=${cellMeta.lat.toFixed(2)}, lon=${cellMeta.lon.toFixed(2)})`;
  }
}

