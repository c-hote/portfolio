let topoData;
let zoneGeometries;
let zoneAttributes = new Map();
let accessibilitySummary = [];
let industryMix = new Map();
let currentMode = "transit";
let currentTimePeriod = "AllDay";  // using distance-based proxy for now
let selectedZoneId = null;

let projection, path;
let colorScale;
let mapSvg, legendSvg;
let accessibilitySvg, industrySvg;

Promise.all([
  d3.json("data/zones_topology.json"),
  d3.csv("data/zone_attributes.csv", d => ({
    zone_id: d.zone_id,
    name: d.name,
    jurisdiction: d.jurisdiction,
    total_jobs: +d.total_jobs,
    cluster_jobs: +d.cluster_jobs,
    median_rent: d.median_rent ? +d.median_rent : null
  })),
  d3.csv("data/accessibility_summary.csv", d => ({
    zone_id: d.zone_id,
    time_period: d.time_period,
    mode: d.mode,
    jobs_15: +d.jobs_15,
    jobs_30: +d.jobs_30,
    jobs_45: +d.jobs_45,
    cluster_jobs_45: +d.cluster_jobs_45,
    access_index_45: +d.access_index_45
  })),
  d3.csv("data/industry_mix.csv", d => ({
    zone_id: d.zone_id,
    industry_group: d.industry_group,
    jobs: +d.jobs
  }))
]).then(([topoJson, attrRows, accessRows, industryRows]) => {
  topoData = topoJson;

  // 🔹 Dynamically pick the first object as the layer, whatever its name is
  const objectName = Object.keys(topoData.objects)[0];
  console.log("TopoJSON object name:", objectName);
  zoneGeometries = topojson.feature(topoData, topoData.objects[objectName]);

  console.log("Zone feature count:", zoneGeometries.features.length);

  attrRows.forEach(d => zoneAttributes.set(d.zone_id, d));
  accessibilitySummary = accessRows;
  industryMix = d3.group(industryRows, d => d.zone_id);

  initVis();
}).catch(err => {
  console.error("Error loading data:", err);
});



// Initialize visualization
function initVis() {
  console.log("initVis called");

  mapSvg = d3.select("#map-svg");
  legendSvg = d3.select("#legend-svg");
  accessibilitySvg = d3.select("#accessibility-svg");
  industrySvg = d3.select("#industry-svg");

  // IMPORTANT: clear prior renders if you re-run
  mapSvg.selectAll("*").remove();

  const mapWidth = mapSvg.node().clientWidth || 700;
  const mapHeight = mapSvg.node().clientHeight || 460;

  projection = d3.geoMercator()
    .fitSize([mapWidth, mapHeight], zoneGeometries);

  path = d3.geoPath().projection(projection);

  drawMap();          // <-- only call after mapSvg/projection/path are set
  initLegend();
  initAccessibilityChart();
  initIndustryChart();
}


 /*

  // Wire controls
  d3.selectAll("input[name='mode']").on("change", event => {
    currentMode = event.target.value;
    updateMapColors();
    if (selectedZoneId) {
      updateDetailPanel(selectedZoneId);
    }
  });

  d3.select("#time-select").on("change", event => {
    currentTimePeriod = event.target.value;
    updateMapColors();
    if (selectedZoneId) {
      updateDetailPanel(selectedZoneId);
    }
  });
*/

// Build map
function drawMap() {
  if (!mapSvg) {
    console.error("mapSvg is not initialized before drawMap()");
    return;
  }

  console.log("Drawing map with", zoneGeometries.features.length, "features");

  const zonesG = mapSvg.append("g").attr("class", "zones");

  zonesG.selectAll("path.zone")
    .data(zoneGeometries.features)
    .join("path")
    .attr("class", "zone")
    .attr("d", path)
    .attr("fill", d => colorForZone(d.properties.zone_id))
    .on("click", (event, d) => {
      selectedZoneId = d.properties.zone_id;
      updateMapSelection();
      updateDetailPanel(selectedZoneId);
      
    })
    .on("click", (event, d) => {
      const zid = d.properties.zone_id;
      console.log("clicked zone_id:", zid, "attrs?", zoneAttributes.has(zid));
      selectedZoneId = zid;
      updateMapSelection();
      updateDetailPanel(selectedZoneId);
    });

}



// Compute color scale and return color for a zone
function colorForZone(zoneId) {
  const rows = accessibilitySummary.filter(
    r => r.mode === currentMode && r.time_period === currentTimePeriod
  );
  if (!rows.length) return "#f0f0f0";

  const extent = d3.extent(rows, r => r.access_index_45);
  if (!colorScale) {
    colorScale = d3.scaleSequential(d3.interpolateYlGnBu)
      .domain(extent);
  } else {
    colorScale.domain(extent);
  }

  const row = rows.find(r => r.zone_id === zoneId);
  if (!row) return "#f0f0f0";

  return colorScale(row.access_index_45);
}

function updateMapColors() {
  mapSvg.selectAll("path.zone")
    .transition()
    .duration(300)
    .attr("fill", d => colorForZone(d.properties.zone_id));
}

function updateMapSelection() {
  mapSvg.selectAll("path.zone")
    .classed("zone-selected", d => d.properties.zone_id === selectedZoneId)
    .transition()
    .attr("stroke-width", d =>
      d.properties.zone_id === selectedZoneId ? 2 : 0.4
    );
}


// Legend
function initLegend() {
  const width = 240;
  const height = 10;
  const margin = { top: 6, right: 10, bottom: 26, left: 10 };

  legendSvg.selectAll("*").remove();
  legendSvg
    .attr("width", width + margin.left + margin.right)
    .attr("height", height + margin.top + margin.bottom);

  const g = legendSvg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Use current mode/time data
  const rows = accessibilitySummary.filter(
    r => r.mode === currentMode && r.time_period === currentTimePeriod
  );
  if (!rows.length) return;

  const extent = d3.extent(rows, r => r.access_index_45);
  colorScale = d3.scaleSequential(d3.interpolateYlGnBu)
    .domain(extent);

  const defs = legendSvg.append("defs");
  const gradient = defs.append("linearGradient")
    .attr("id", "legend-gradient")
    .attr("x1", "0%")
    .attr("x2", "100%");

  d3.range(0, 1.01, 0.01).forEach(t => {
    gradient.append("stop")
      .attr("offset", `${t * 100}%`)
      .attr("stop-color", colorScale(extent[0] + t * (extent[1] - extent[0])));
  });

  g.append("rect")
    .attr("width", width)
    .attr("height", height)
    .style("fill", "url(#legend-gradient)");

  const scale = d3.scaleLinear()
    .domain(extent)
    .range([0, width]);

  const axis = d3.axisBottom(scale)
    .ticks(4)
    .tickFormat(d3.format(".0%")); // if access_index_45 is [0,1]; adjust if 0-100

  g.append("g")
    .attr("class", "axis")
    .attr("transform", `translate(0, ${height})`)
    .call(axis);

  g.append("text")
    .attr("x", width / 2)
    .attr("y", height + 20)
    .attr("text-anchor", "middle")
    .attr("font-size", 11)
    .text("Jobs accessible within 45 minutes (index)");
}

// Accessibility chart (line chart)
function initAccessibilityChart() {
  const w = accessibilitySvg.node().clientWidth || 260;
  const h = accessibilitySvg.node().clientHeight || 180;
  accessibilitySvg.selectAll("*").remove();

  const margin = { top: 18, right: 10, bottom: 26, left: 36 };
  const innerW = w - margin.left - margin.right;
  const innerH = h - margin.top - margin.bottom;

  const g = accessibilitySvg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  // Save layout in dataset for reuse
  accessibilitySvg.node().__accessLayout = { margin, innerW, innerH, g };

  // Axes placeholders
  g.append("g").attr("class", "axis x-axis")
    .attr("transform", `translate(0, ${innerH})`);

  g.append("g").attr("class", "axis y-axis");
}

function updateAccessibilityChart(zoneId) {
  const layout = accessibilitySvg.node().__accessLayout;
  if (!layout) return;
  const { innerW, innerH, g } = layout;

  // thresholds
  const thresholds = [15, 30, 45];

  const rowTransit = accessibilitySummary.find(r =>
    r.zone_id === zoneId &&
    r.mode === "transit" &&
    r.time_period === currentTimePeriod
  );
  const rowAuto = accessibilitySummary.find(r =>
    r.zone_id === zoneId &&
    r.mode === "auto" &&
    r.time_period === currentTimePeriod
  );

  const dataTransit = rowTransit ? [
    { t: 15, jobs: rowTransit.jobs_15 },
    { t: 30, jobs: rowTransit.jobs_30 },
    { t: 45, jobs: rowTransit.jobs_45 }
  ] : [];

  const dataAuto = rowAuto ? [
    { t: 15, jobs: rowAuto.jobs_15 },
    { t: 30, jobs: rowAuto.jobs_30 },
    { t: 45, jobs: rowAuto.jobs_45 }
  ] : [];

  const allJobs = dataTransit.concat(dataAuto).map(d => d.jobs);
  const maxJobs = allJobs.length ? d3.max(allJobs) : 0;

  const x = d3.scalePoint()
    .domain(thresholds)
    .range([0, innerW]);

  const y = d3.scaleLinear()
    .domain([0, maxJobs || 1])
    .nice()
    .range([innerH, 0]);

  const xAxis = d3.axisBottom(x)
    .tickFormat(d => `${d} min`);

  const yAxis = d3.axisLeft(y)
    .ticks(4)
    .tickFormat(d3.format(".2s"));

  g.select(".x-axis").call(xAxis);
  g.select(".y-axis").call(yAxis);

  const line = d3.line()
    .x(d => x(d.t))
    .y(d => y(d.jobs));

  // Transit line
  const transitPath = g.selectAll(".line-transit")
    .data(dataTransit.length ? [dataTransit] : []);
  transitPath.join(
    enter => enter.append("path")
      .attr("class", "line-series line-transit")
      .attr("d", line),
    update => update.attr("d", line),
    exit => exit.remove()
  );

  // Auto line
  const autoPath = g.selectAll(".line-auto")
    .data(dataAuto.length ? [dataAuto] : []);
  autoPath.join(
    enter => enter.append("path")
      .attr("class", "line-series line-auto")
      .attr("d", line),
    update => update.attr("d", line),
    exit => exit.remove()
  );
  console.log("access rows for", zoneId,
  accessibilitySummary.filter(r => r.zone_id === zoneId && r.time_period === currentTimePeriod));

}

// Industry bar chart
function initIndustryChart() {
  const w = industrySvg.node().clientWidth || 260;
  const h = industrySvg.node().clientHeight || 180;
  industrySvg.selectAll("*").remove();

  const margin = { top: 10, right: 10, bottom: 40, left: 40 };
  const innerW = w - margin.left - margin.right;
  const innerH = h - margin.top - margin.bottom;

  const g = industrySvg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

  industrySvg.node().__industryLayout = { margin, innerW, innerH, g };

  g.append("g").attr("class", "axis x-axis")
    .attr("transform", `translate(0, ${innerH})`);

  g.append("g").attr("class", "axis y-axis");
}

function updateIndustryChart(zoneId) {
  const layout = industrySvg.node().__industryLayout;
  if (!layout) return;
  const { innerW, innerH, g } = layout;

  const rows = (industryMix.get(zoneId) || []).slice();
  if (!rows.length) {
    g.selectAll(".bar").remove();
    g.selectAll(".bar-label").remove();
    g.selectAll(".x-axis").call(d3.axisBottom(d3.scaleBand().range([0, innerW])).tickValues([]));
    g.selectAll(".y-axis").call(d3.axisLeft(d3.scaleLinear().range([innerH, 0])).tickValues([]));
    return;
  }

  rows.sort((a, b) => d3.descending(a.jobs, b.jobs));
  const topRows = rows.slice(0, 8);

  const x = d3.scaleBand()
    .domain(topRows.map(d => d.industry_group))
    .range([0, innerW])
    .padding(0.1);

  const y = d3.scaleLinear()
    .domain([0, d3.max(topRows, d => d.jobs) || 1])
    .nice()
    .range([innerH, 0]);

  const xAxis = d3.axisBottom(x).tickFormat(d => d.length > 10 ? d.slice(0, 10) + "…" : d);
  const yAxis = d3.axisLeft(y).ticks(4).tickFormat(d3.format(".2s"));

  g.select(".x-axis")
    .call(xAxis)
    .selectAll("text")
    .attr("transform", "rotate(-35)")
    .style("text-anchor", "end");

  g.select(".y-axis").call(yAxis);

  const bars = g.selectAll(".bar")
    .data(topRows, d => d.industry_group);

  bars.join(
    enter => enter.append("rect")
      .attr("class", "bar")
      .attr("x", d => x(d.industry_group))
      .attr("y", d => y(d.jobs))
      .attr("width", x.bandwidth())
      .attr("height", d => innerH - y(d.jobs)),
    update => update
      .attr("x", d => x(d.industry_group))
      .attr("y", d => y(d.jobs))
      .attr("width", x.bandwidth())
      .attr("height", d => innerH - y(d.jobs)),
    exit => exit.remove()
  );
}

// Detail panel updates
function updateDetailPanel(zoneId) {
  const zoneFeature = zoneGeometries.features.find(f => f.properties.zone_id === zoneId);
  const attrs = zoneAttributes.get(zoneId);

  const title = attrs && attrs.name ? attrs.name : `Block Group ${zoneId}`;
  d3.select("#detail-title").text(title);

  const jobsText = attrs && attrs.total_jobs ? d3.format(",")(attrs.total_jobs) : "n/a";
  const clusterText = attrs && attrs.cluster_jobs ? d3.format(",")(attrs.cluster_jobs) : "n/a";
  const rentText = attrs && attrs.median_rent ? `$${d3.format(",")(attrs.median_rent)}` : "n/a";
  const jur = attrs && attrs.jurisdiction ? attrs.jurisdiction : "n/a";

  d3.select("#detail-meta").text(
    `Jurisdiction: ${jur}. Total jobs: ${jobsText}. Cluster jobs: ${clusterText}. Median rent: ${rentText}.`
  );

  updateAccessibilityChart(zoneId);
  updateIndustryChart(zoneId);
}

