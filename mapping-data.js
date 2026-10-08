const BATAAN_BOUNDS = [
    [14.33, 120.02], // SW
    [14.97, 120.66]  // NE
];

const BATAAN_CENTER = [14.66, 120.44];

const RIVER_DATA = [
    {
        id: "balanga",
        name: "Balanga River",
        coast: "east",
        lat: 14.6761,
        lng: 120.5395,
        note: "Runs through Balanga City, the provincial capital, before reaching Manila Bay."
    },
    {
        id: "talisay",
        name: "Talisay River",
        coast: "east",
        lat: 14.6980,
        lng: 120.5470,
        note: "One of Bataan's two most-studied river ecosystems, sampled for fish diversity and water quality."
    },
    {
        id: "colo",
        name: "Colo River",
        coast: "east",
        lat: 14.8390,
        lng: 120.5110,
        note: "Flows near Hermosa in northern Bataan toward Manila Bay."
    },
    {
        id: "limay",
        name: "Limay River",
        coast: "east",
        lat: 14.5660,
        lng: 120.5960,
        note: "Named for the coastal Municipality of Limay."
    },
    {
        id: "abo-abo",
        name: "Abo-abo River",
        coast: "east",
        lat: 14.5480,
        lng: 120.5890,
        note: "A smaller waterway feeding the Manila Bay side of the peninsula, near Limay."
    },
    {
        id: "bantalan",
        name: "Bantalan River",
        coast: "east",
        lat: 14.5020,
        lng: 120.5560,
        note: "Small river along the southeastern Manila Bay coastline."
    },
    {
        id: "saysayin",
        name: "Saysayin River",
        coast: "east",
        lat: 14.4460,
        lng: 120.4990,
        note: "Reaches Manila Bay near Mariveles, at the southern tip of the peninsula."
    },
    {
        id: "agloloma",
        name: "Agloloma River",
        coast: "east",
        lat: 14.4160,
        lng: 120.4780,
        note: "Named for the barangay of Agloloma in Mariveles."
    },
    {
        id: "mamala",
        name: "Mamala River",
        coast: "east",
        lat: 14.4230,
        lng: 120.4900,
        note: "Drains into the mangrove-lined shallows near Mariveles."
    },
    {
        id: "bagac",
        name: "Bagac River",
        coast: "west",
        lat: 14.5989,
        lng: 120.3897,
        note: "The larger of the two river systems studied along the South China Sea coast."
    },
    {
        id: "almacen",
        name: "Almacen River",
        coast: "west",
        lat: 14.6600,
        lng: 120.2830,
        note: "One of three river systems (with Bagac and Talisay) assessed in Bataan Peninsula fish habitat studies.",
        // OSM tags this river "Alamacen River" (different spelling) — without this hint
        // the name-matching step would miss it and it would fall back to proximity-only.
        osmNames: ["Alamacen River", "Alamacen"]
    },
    {
        id: "morong",
        name: "Morong River",
        coast: "west",
        lat: 14.6742,
        lng: 120.2789,
        note: "Runs through Morong on the peninsula's western, South China Sea-facing coast."
    }
];