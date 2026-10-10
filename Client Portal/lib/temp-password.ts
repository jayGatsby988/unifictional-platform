import { randomInt } from "node:crypto";

// Plain, easy-to-read words so a client can type the password off a text message.
const WORDS = [
  "cedar", "maple", "ridge", "harbor", "summit", "granite", "willow", "canyon", "meadow", "timber", "river", "falcon",
  "copper", "aspen", "birch", "beacon", "orchard", "prairie", "spruce", "lantern", "anchor", "basalt", "cobalt", "delta",
  "ember", "fjord", "glacier", "hollow", "island", "juniper", "kestrel", "lagoon", "marble", "north", "olive", "pebble",
  "quarry", "redwood", "sierra", "tundra", "upland", "valley", "walnut", "yarrow", "zephyr", "alder", "bramble", "cliff",
  "dune", "everett", "forest", "grove", "heron", "inlet", "jetty", "kayak", "ledge", "mesa", "nectar", "oak", "pine", "quill",
  "rapids", "shore", "trail", "umber", "vista", "wharf", "cove", "bluff", "crest", "brook", "stone", "sound", "tide", "rainier",
];

/** e.g. "Cedar-Harbor-4821". Temporary: the client sets their own after first sign-in. */
export function tempPassword(): string {
  const w = () => { const s = WORDS[randomInt(WORDS.length)]; return s[0].toUpperCase() + s.slice(1); };
  return `${w()}-${w()}-${randomInt(1000, 10000)}`;
}
