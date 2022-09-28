import maplibre from "maplibre-gl";

// export const maplibre: typeof maplibreFn = (maplibreFn as any)();
// export const
export const LngLat = maplibre.LngLat;

export async function esriStyle() {
  // Adapted from https://gist.github.com/jgravois/51e2b30e3d6cf6c00f06b263a29108a2

  // https://esri.com/arcgis-blog/products/arcgis-living-atlas/mapping/new-osm-vector-basemap
  const styleUrl =
    "https://www.arcgis.com/sharing/rest/content/items/92966c7ebc3d4ddaac34050560568bad/resources/styles/root.json";

  // first fetch the esri style file
  // https://www.mapbox.com/mapbox-gl-js/style-spec
  const response = await fetch(styleUrl);
  const style = await response.json();
  // next fetch metadata for the raw tiles
  const metadataUrl = style.sources.esri.url;
  const metadataResponse = await fetch(metadataUrl);
  const metadata = await metadataResponse.json();

  function format(style, metadata) {
    // ArcGIS Pro published vector services dont prepend tile or tileMap urls with a /
    style.sources.esri = {
      type: "vector",
      scheme: "xyz",
      tilejson: metadata.tilejson || "2.0.0",
      format: (metadata.tileInfo && metadata.tileInfo.format) || "pbf",
      /* mapbox-gl-js does not respect the indexing of esri tiles
        because we cache to different zoom levels depending on feature density, in rural areas 404s will still be encountered.
        more info: https://github.com/mapbox/mapbox-gl-js/pull/1377
        */
      // index: metadata.tileMap ? style.sources.esri.url + '/' + metadata.tileMap : null,
      maxzoom: 15,
      tiles: [style.sources.esri.url + "/" + metadata.tiles[0]],
      description: metadata.description,
      name: metadata.name,
    };

    style.sources.terrain = {
      tiles: [
        "https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png",
      ],
      encoding: "terrarium",
      type: "raster-dem",
      tileSize: 256,
      maxzoom: 15,
    };

    style.layers.push({
      id: "hills",
      type: "hillshade",
      source: "terrain",
      layout: { visibility: "visible" },
      paint: { "hillshade-shadow-color": "#000" },
    });

    const isPathLayer = (id) =>
      ((id.startsWith("road/") || id.startsWith("path/")) &&
        id.endsWith("/line")) ||
      id === "road" ||
      id === "path";
    // || (id.indexOf("path") !== -1 &&
    //   id.indexOf("casing") === -1 &&
    //   id.indexOf("label") === -1);
    const pathLayers = style.layers
      .filter((x) => isPathLayer(x.id))
      .map((x) => x.id);

    style.terrain = {
      source: "terrain",
      exaggeration: 5,
    };
    console.log(style);
    return [style, pathLayers];
  }

  return format(style, metadata);
}
