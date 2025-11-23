// =========================
// Variables globales
// =========================

// Mapa
let map;

// Red vial
let edges = [];      // { id, lat1, lon1, lat2, lon2 }
let edgeLayers = []; // polylines de Leaflet

// Puntos
let points = [];          // puntos originales del CSV
let integratedNodes = []; // puntos integrados en la red (coordenadas proyectadas)
let pointMarkers = [];    // marcadores en el mapa

// Rutas TSP
let routeLayers = [];     // polylines de rutas TSP

// =========================
// Inicializar mapa y eventos
// =========================
window.addEventListener('load', () => {
  // Crear el mapa centrado en Bogotá
  map = L.map('map').setView([4.65, -74.1], 13);

  // Capa base de OpenStreetMap
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  // Conectar inputs y botones
  document.getElementById('fileNetwork')
    .addEventListener('change', onNetworkFileSelected);

  document.getElementById('filePoints')
    .addEventListener('change', onPointsFileSelected);

  document.getElementById('btnRun')
    .addEventListener('click', onRunAlgorithms);

  document.getElementById('btnDownload')
    .addEventListener('click', onDownloadResults);

  console.log('Mapa inicializado');
});

// =========================
// Carga de RED VIAL
// =========================
function onNetworkFileSelected(evt) {
  const file = evt.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    parseNetworkCSV(text);
    drawNetwork();
  };
  reader.readAsText(file);
}

function parseNetworkCSV(text) {
  edges = [];
  const lines = text.trim().split('\n');
  if (lines.length <= 1) return;

  // Saltamos cabecera
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 5) continue;

    const id   = parts[0];
    const lat1 = parseFloat(parts[1]);
    const lon1 = parseFloat(parts[2]);
    const lat2 = parseFloat(parts[3]);
    const lon2 = parseFloat(parts[4]);

    if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) continue;

    edges.push({ id, lat1, lon1, lat2, lon2 });
  }

  console.log('Red cargada. Aristas:', edges.length);
}

function drawNetwork() {
  // eliminar polylines anteriores
  edgeLayers.forEach(layer => map.removeLayer(layer));
  edgeLayers = [];

  edges.forEach(e => {
    const line = L.polyline(
      [[e.lat1, e.lon1], [e.lat2, e.lon2]],
      { weight: 3 }
    ).addTo(map);
    edgeLayers.push(line);
  });

  if (edges.length > 0) {
    const e = edges[0];
    const centerLat = (e.lat1 + e.lat2) / 2;
    const centerLon = (e.lon1 + e.lon2) / 2;
    map.setView([centerLat, centerLon], 15);
  }
}

// =========================
// Carga de PUNTOS
// =========================
function onPointsFileSelected(evt) {
  const file = evt.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    parsePointsCSV(text);
    integratePointsIntoNetwork();
    drawPoints();
  };
  reader.readAsText(file);
}

function parsePointsCSV(text) {
  points = [];
  const lines = text.trim().split('\n');
  if (lines.length <= 1) return;

  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length < 3) continue;

    const id  = parts[0];
    const lat = parseFloat(parts[1]);
    const lon = parseFloat(parts[2]);

    if (isNaN(lat) || isNaN(lon)) continue;

    points.push({ id, lat, lon });
  }

  console.log('Puntos cargados:', points.length);
}

// =========================
// Integrar puntos a la red
// (encontrar la arista más cercana y proyectar)
// =========================
function integratePointsIntoNetwork() {
  integratedNodes = [];

  if (edges.length === 0) {
    alert('Primero carga la red vial.');
    return;
  }

  points.forEach(p => {
    let best = null;

    edges.forEach(e => {
      const res = distancePointToSegment(
        p.lat, p.lon,
        e.lat1, e.lon1,
        e.lat2, e.lon2
      );
      if (!best || res.dist < best.dist) {
        best = {
          edge: e,
          dist: res.dist,
          projLat: res.projx,
          projLon: res.projy,
          t: res.t
        };
      }
    });

    if (best) {
      integratedNodes.push({
        id: p.id,
        lat: best.projLat,
        lon: best.projLon
      });
    }
  });

  console.log('Puntos integrados en la red:', integratedNodes.length);
}

// Distancia punto–segmento (euclidiana sobre lat/lon)
function distancePointToSegment(px, py, x1, y1, x2, y2) {
  const vx = x2 - x1;
  const vy = y2 - y1;
  const wx = px - x1;
  const wy = py - y1;

  const c1 = vx * wx + vy * wy;
  const c2 = vx * vx + vy * vy;

  let t = 0;
  if (c2 > 0) {
    t = c1 / c2;
  }
  // recortar al segmento
  t = Math.max(0, Math.min(1, t));

  const projx = x1 + t * vx;
  const projy = y1 + t * vy;

  const dx = px - projx;
  const dy = py - projy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  return { dist, projx, projy, t };
}

// Dibujar puntos integrados
function drawPoints() {
  // borrar marcadores viejos
  pointMarkers.forEach(m => map.removeLayer(m));
  pointMarkers = [];

  integratedNodes.forEach(n => {
    const marker = L.circleMarker([n.lat, n.lon], {
      radius: 6
    }).addTo(map);

    marker.bindPopup(`Punto ${n.id}`);
    pointMarkers.push(marker);
  });
}

// =========================
// Matriz de distancias entre puntos integrados
// =========================
function buildDistanceMatrix() {
  const n = integratedNodes.length;
  const dist = Array.from({ length: n }, () => Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = euclideanDistance(
        integratedNodes[i].lat, integratedNodes[i].lon,
        integratedNodes[j].lat, integratedNodes[j].lon
      );
      dist[i][j] = d;
      dist[j][i] = d;
    }
  }
  return dist;
}

function euclideanDistance(x1, y1, x2, y2) {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

// =========================
// TSP por fuerza bruta
// =========================
function tspBruteForce(dist) {
  const n = dist.length;
  const nodes = [];
  for (let i = 1; i < n; i++) nodes.push(i); // dejamos 0 como inicio

  let bestOrder = null;
  let bestLength = Infinity;

  // generar todas las permutaciones de [1..n-1]
  permute(nodes, 0, nodes.length - 1, (perm) => {
    let length = 0;
    let prev = 0; // empezamos en nodo 0

    // recorrer en el orden de la permutación
    for (let k = 0; k < perm.length; k++) {
      const curr = perm[k];
      length += dist[prev][curr];
      prev = curr;
    }
    // volver al inicio
    length += dist[prev][0];

    if (length < bestLength) {
      bestLength = length;
      bestOrder = [0, ...perm, 0]; // guardamos tour completo
    }
  });

  return { bestOrder, bestLength };
}

// backtracking simple para permutaciones
function permute(arr, l, r, visit) {
  if (l === r) {
    visit(arr.slice()); // copiar
    return;
  }
  for (let i = l; i <= r; i++) {
    swap(arr, l, i);
    permute(arr, l + 1, r, visit);
    swap(arr, l, i); // deshacer
  }
}

function swap(arr, i, j) {
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}

// =========================
// Dibujar ruta TSP en el mapa
// =========================
function drawRoute(order, color) {
  // limpiar rutas viejas
  routeLayers.forEach(layer => map.removeLayer(layer));
  routeLayers = [];

  const latlngs = order.map(idx => {
    const node = integratedNodes[idx];
    return [node.lat, node.lon];
  });

  const poly = L.polyline(latlngs, {
    weight: 4,
    color: color || 'red'
  }).addTo(map);

  routeLayers.push(poly);
  map.fitBounds(poly.getBounds());
}

// =========================
// Ejecutar algoritmos (por ahora solo fuerza bruta)
// =========================
function onRunAlgorithms() {
  if (integratedNodes.length === 0) {
    alert('Primero carga la red y los puntos.');
    return;
  }

  const n = integratedNodes.length;
  if (n > 10) {
    alert('Fuerza bruta solo soporta pocos puntos (máx ~10). Reduce el número para esta prueba.');
    return;
  }

  const dist = buildDistanceMatrix();

  const t0 = performance.now();
  const result = tspBruteForce(dist);
  const t1 = performance.now();

  if (!result.bestOrder) {
    alert('No se encontró ruta (algo salió mal).');
    return;
  }

  console.log('Orden óptimo (fuerza bruta):', result.bestOrder);
  console.log('Longitud total:', result.bestLength);
  console.log('Tiempo de ejecución (ms):', (t1 - t0).toFixed(3));

  drawRoute(result.bestOrder, 'red');

  alert(
    `Fuerza bruta TSP\n` +
    `Puntos: ${n}\n` +
    `Longitud total (euclidiana): ${result.bestLength.toFixed(6)}\n` +
    `Tiempo: ${(t1 - t0).toFixed(3)} ms`
  );
}

// =========================
// Descargar resultados (placeholder)
// =========================
function onDownloadResults() {
  console.log('Aquí luego generaremos el archivo de salida (WKT/GeoJSON).');
}
