import {
  DataDrivenPropertyValueSpecification,
  GeoJSONSource,
} from "maplibre-gl";
import { debounce } from "./debounce";
import { esriStyle, maplibre, LngLat } from "./maplibre";
import * as turf from "@turf/turf";

const [style, pathLayerIds] = await esriStyle();

const map = new maplibre.Map({
  container: "map",
  style,
  center: { lng: -78.91926884651184, lat: 35.98589793405729 }, // starting position [lng, lat]
  zoom: 14.898411449605867, // starting zoom,
  maxPitch: 85,
});

const color: DataDrivenPropertyValueSpecification<string> = [
  "interpolate",
  ["linear"],
  ["get", "slope"],
  0,
  "white",
  5,
  "yellow",
  10,
  "red",
];

map.on("load", () => {
  // Add in a hill line layer
  console.log(map);
  map.addSource("hill-line-source", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [],
    },
  });

  map.addSource("hill-label-source", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [],
    },
  });

  map.addLayer({
    id: "hill-lines",
    type: "line",
    source: "hill-line-source",
    layout: {
      "line-join": "miter",
      "line-cap": "square",
    },
    paint: {
      "line-color": "black",
      "line-width": 10,
      "line-opacity": ["get", "opacity"],
    },
  });

  map.addLayer({
    id: "hill-lines2",
    type: "line",
    source: "hill-line-source",
    layout: {
      "line-join": "miter",
      "line-cap": "square",
    },
    paint: {
      "line-color": color,
      "line-width": 3,
      "line-blur": 0,
      "line-opacity": ["get", "opacity"],
    },
  });

  map.addLayer({
    id: "hill-labels",
    type: "symbol",
    source: "hill-label-source",
    layout: {
      // "icon-image": "dog-park-11",
      "symbol-placement": "point",
      "symbol-spacing": 100,
      "text-field": [
        "format",
        ["get", "slopeString"],
        {},
        "\n",
        {},
        ["get", "elevationDeltaStr"],
        { "font-scale": 0.8 },
      ],
      "text-font": ["Arial Unicode MS Regular"],
      "symbol-sort-key": ["get", "negElevationDelta"],
      // ["get", "elevationDelta"],
      // "text-allow-overlap": true,
      // "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
      "text-size": 16,
      // "icon-text-fit": "both",
    },
    paint: {
      "text-color": color,
      "text-halo-color": "black",
      "text-halo-width": 5,
      "text-opacity": ["get", "opacity"],
    },
  });

  // console.log("terrain", map.terrain);

  map.on("click", (e) => {
    console.log(
      `elevation at ${e.lngLat}: ${
        map.transform.getElevation(e.lngLat, map.terrain) /
        (map.getTerrain().exaggeration || 1)
      }`
    );
  });

  const getHillLines = () => {
    const hillLines = map.queryRenderedFeatures(undefined, {
      layers: pathLayerIds,
    });

    const graph: { [coord: string]: { [coord: string]: boolean } } = {};
    const allConnections: { [coord: string]: { [coord: string]: boolean } } =
      {};
    const elevations: { [coord: string]: number } = {};

    type Coord = [number, number];
    const coordToKey = (coord: Coord): string => coord.join(",");
    const keyToCoord = (key: string): Coord =>
      key.split(",").map(parseFloat) as Coord;
    const coordComparator = (coord1: Coord, coord2: Coord) => {
      if (coord1[0] === coord2[0]) {
        return coord1[0] - coord2[0];
      }
      return coord1[1] - coord2[1];
    };
    const coordToLngLat = (coord: Coord) => new LngLat(coord[0], coord[1]);

    const getElevation = (coord: Coord, key: string) => {
      if (elevations[key]) return;
      elevations[key] =
        map.transform.getElevation(coordToLngLat(coord), map.terrain) /
        (map.getTerrain().exaggeration || 1);
    };

    const addConnection = (
      dict: { [coord: string]: { [coord: string]: boolean } },
      key1: string,
      key2: string
    ) => {
      const connections = dict[key1] || {};
      connections[key2] = true;
      dict[key1] = connections;
    };

    const addSegment = (coord1: Coord, coord2: Coord) => {
      const coords = [coord1, coord2].sort(coordComparator) as [Coord, Coord];
      const key1 = coordToKey(coords[0]);
      const key2 = coordToKey(coords[1]);
      getElevation(coord1, key1);
      getElevation(coord2, key2);
      addConnection(graph, key1, key2);
      // Add all connections
      addConnection(allConnections, key1, key2);
      addConnection(allConnections, key2, key1);
    };

    const isIntersection = (key: string): boolean => {
      const connections = allConnections[key] || {};
      const numConnections = Object.keys(connections).length;
      return numConnections > 2 || numConnections === 1;
    };

    const addLineString = (lineString: GeoJSON.Position[]) => {
      for (let i = 0; i < lineString.length - 1; i++) {
        addSegment(lineString[i] as Coord, lineString[i + 1] as Coord);
      }
    };

    const averageCoord = (coord1: Coord, coord2: Coord): Coord => {
      return [(coord1[0] + coord2[0]) / 2, (coord1[1] + coord2[1]) / 2];
    };

    const sqr = (x) => x * x;
    const getDist = (coord1: Coord, coord2: Coord): number =>
      Math.sqrt(sqr(coord2[0] - coord1[0]) + sqr(coord2[1] - coord1[1]));

    const interpLine = (
      line: Coord[],
      t: number,
      isPercent = true,
      reverse = false
    ): Coord => {
      let totalDist = 0;
      for (let i = 0; i < line.length - 1; i++) {
        const coord1 = line[i];
        const coord2 = line[i + 1];
        totalDist += getDist(coord1, coord2);
      }
      let desiredDist = isPercent ? totalDist * t : t;
      if (reverse) desiredDist = totalDist - desiredDist;
      totalDist = 0;
      for (let i = 0; i < line.length - 1; i++) {
        let coord1 = line[i];
        let coord2 = line[i + 1];
        const segmentDist = getDist(coord1, coord2);
        const targetDist = totalDist + segmentDist;

        // Check if start
        if (targetDist > desiredDist) {
          // Calculate percent of line segment to show
          const pct = (desiredDist - totalDist) / segmentDist;
          return [
            coord1[0] + (coord2[0] - coord1[0]) * pct,
            coord1[1] + (coord2[1] - coord1[1]) * pct,
          ];
        }

        totalDist = targetDist;
      }
      throw new Error("No point");
    };

    const shrinkLine = (line: Coord[], dist: number): Coord[] => {
      let totalDist = 0;
      for (let i = 0; i < line.length - 1; i++) {
        const coord1 = line[i];
        const coord2 = line[i + 1];
        totalDist += getDist(coord1, coord2);
      }
      let offset = dist / 2;
      let endDist = totalDist - dist / 2;
      totalDist = 0;
      const newLine: Coord[] = [];
      let started = false;
      let ended = false;
      for (let i = 0; i < line.length - 1; i++) {
        let coord1 = line[i];
        let coord2 = line[i + 1];
        const segmentDist = getDist(coord1, coord2);
        const targetDist = totalDist + segmentDist;

        // Check if start
        if (!started && targetDist > offset) {
          // Calculate percent of line segment to show
          const pct = (offset - totalDist) / segmentDist;
          coord1 = [
            coord1[0] + (coord2[0] - coord1[0]) * pct,
            coord1[1] + (coord2[1] - coord1[1]) * pct,
          ];
          started = true;
          newLine.push(coord1);
        }
        // Check if end
        if (started && targetDist >= endDist) {
          const pct = (endDist - totalDist) / segmentDist;
          coord2 = [
            coord1[0] + (coord2[0] - coord1[0]) * pct,
            coord1[1] + (coord2[1] - coord1[1]) * pct,
          ];
          ended = true;
          newLine.push(coord2);
        }
        if (started && !ended) {
          newLine.push(coord2);
        }

        // Set total dist
        totalDist = targetDist;
      }
      return newLine;
    };

    // const shrinkCoords = (
    //   coord1: Coord,
    //   coord2: Coord,
    //   length: number,
    //   multiplier = 0.00005
    // ): [Coord, Coord] => {
    //   const factor = (length / getDist(coord1, coord2)) * multiplier;
    //   return [
    //     [
    //       coord1[0] + ((coord2[0] - coord1[0]) * (1 - factor)) / 2,
    //       coord1[1] + ((coord2[1] - coord1[1]) * (1 - factor)) / 2,
    //     ],
    //     [
    //       coord2[0] + ((coord1[0] - coord2[0]) * (1 - factor)) / 2,
    //       coord2[1] + ((coord1[1] - coord2[1]) * (1 - factor)) / 2,
    //     ],
    //   ];
    // };

    const expect1 = <T>(list: T[]): T => {
      if (list.length !== 1) {
        throw new Error(`Expected one: ${JSON.stringify(list)}`);
      }
      return list[0];
    };

    const makeArrow = (line: Coord[], dist: number): Coord[][] => {
      const coord1 = interpLine(line, dist, false, true);
      const coord2 = line[line.length - 1];

      const angle = Math.atan2(coord1[0] - coord2[0], coord1[1] - coord2[1]);
      // const length = getDist(coord1, coord2);

      const arrowPoint1: Coord = [
        coord2[0] + Math.sin(angle - Math.PI / 4) * dist,
        coord2[1] + Math.cos(angle - Math.PI / 4) * dist,
      ];

      const arrowPoint2: Coord = [
        coord2[0] + Math.sin(angle + Math.PI / 4) * dist,
        coord2[1] + Math.cos(angle + Math.PI / 4) * dist,
      ];

      return [line, [arrowPoint1, coord2, arrowPoint2]];
    };

    for (const feature of hillLines) {
      if (feature.geometry.type === "LineString") {
        addLineString(feature.geometry.coordinates);
      }
      if (feature.geometry.type === "MultiLineString") {
        for (const lineString of feature.geometry.coordinates) {
          addLineString(lineString);
        }
      }
    }

    const sortCoords = (
      coord1: Coord,
      coord2: Coord,
      elevation1: number,
      elevation2: number
    ): [Coord, Coord] => {
      if (elevation1 < elevation2) {
        return [coord1, coord2];
      }
      return [coord2, coord1];
    };

    const sortLine = (line: Coord[]): [Coord[], number, number] => {
      const start = line[0];
      const end = line[line.length - 1];
      const elev1 = elevations[coordToKey(start)];
      const elev2 = elevations[coordToKey(end)];

      if (elev1 < elev2) {
        return [line, elev1, elev2];
      }
      return [line.reverse(), elev2, elev1];
    };

    // Coalesce lines
    const lines: Coord[][] = [];
    const allLines: { [key1: string]: { [key2: string]: Coord[] } } = {};

    const pushLine = (
      key1: string,
      key2: string,
      line: Coord[],
      addToLines = false
    ) => {
      const linePaths = allLines[key1] || {};
      linePaths[key2] = line;
      allLines[key1] = linePaths;
      if (addToLines) {
        lines.push(line);
      }
    };

    for (const key1 of Object.keys(graph)) {
      if (!isIntersection(key1)) continue;
      const coord1 = keyToCoord(key1);
      // Key is intersection: go in all directions til another intersection
      for (const key2 of Object.keys(graph[key1])) {
        if (allLines[key1]?.[key2] != null) {
          // Already encountered
          continue;
        }
        // Build up line
        const coord2 = keyToCoord(key2);
        const lineKeys = [key1, key2];
        const lineCoords = [coord1, coord2];
        let prevPoint = key1;
        let endPoint = key2;
        while (!isIntersection(endPoint)) {
          // Build up line
          let tmpPoint = endPoint;
          endPoint = expect1(
            Object.keys(allConnections[endPoint]).filter(
              (key) => key !== prevPoint
            )
          );
          prevPoint = tmpPoint;
          lineKeys.push(endPoint);
          lineCoords.push(keyToCoord(endPoint));
        }
        pushLine(key1, key2, lineCoords, true);
        pushLine(
          lineKeys[lineKeys.length - 1],
          lineKeys[lineKeys.length - 2],
          lineCoords
        );
      }
    }

    // Reconstruct graph
    const featureCollection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [],
    };
    const dotCollection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [],
    };
    for (const line of lines) {
      const [sorted, elev1, elev2] = sortLine(line);
      const lineDist = turf.length(turf.lineString(line), { units: "meters" });
      if (lineDist < 10) continue; // too short
      const mid = interpLine(line, 0.5);
      if (mid.length !== 2 || isNaN(mid[0]) || isNaN(mid[1])) {
        throw new Error("BAD MIDPOINT");
      }
      const shrunk = shrinkLine(sorted, Math.pow(2, -map.getZoom()) * 20);
      if (shrunk.length < 2) continue;

      const slope = (Math.abs(elev2 - elev1) / lineDist) * 100;
      if (slope >= 100) {
        continue; // too high
      }

      const elevationDelta = Math.abs(elev2 - elev1);

      const clamp = (x: number, min: number, max: number) => {
        return Math.max(Math.min(x, max), min);
      };
      const opacity =
        clamp(slope / 10, 0, 1) *
        clamp(elevationDelta / 10, 0, 1) *
        clamp(lineDist / 100, 0, 1);

      const properties = {
        color: [
          "white",
          "red",
          "green",
          "blue",
          "white",
          "orange",
          "yellow",
          "aqua",
          "pink",
        ][Math.floor(Math.random() * 8) * 0],
        // elevation1: elevations[key1],
        // elevation2: elevations[key2],
        elevationDelta,
        negElevationDelta: -elevationDelta,
        lineDist,
        elevationDeltaStr: `▲${elevationDelta.toLocaleString(undefined, {
          maximumFractionDigits: 0,
        })}/${lineDist.toLocaleString(undefined, {
          maximumFractionDigits: 0,
        })}m`,
        slope,
        slopeString: `${slope.toLocaleString(undefined, {
          maximumFractionDigits: 0,
        })}%`,
        opacity,
      };

      dotCollection.features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: mid,
        },
        properties,
      });
      featureCollection.features.push({
        type: "Feature",
        geometry: {
          type: "MultiLineString",
          coordinates: makeArrow(shrunk, Math.pow(2, -map.getZoom()) * 10),
        },
        properties,
      });
    }

    const hillLineSource: GeoJSONSource = map.getSource(
      "hill-line-source"
    ) as GeoJSONSource;
    hillLineSource.setData(featureCollection);
    const hillLabelSource: GeoJSONSource = map.getSource(
      "hill-label-source"
    ) as GeoJSONSource;
    // console.log(dotCollection);
    hillLabelSource.setData(dotCollection);
  };

  let updateRender = true;

  map.on("moveend", () => (updateRender = true));

  map.on(
    "render",
    debounce(() => {
      if (updateRender) {
        updateRender = false;
        getHillLines();
      }
    })
  );
});
