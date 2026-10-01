import { loadFont as loadGeist } from "@remotion/google-fonts/Geist";
import { loadFont as loadMono } from "@remotion/google-fonts/GeistMono";
import { loadFont as loadSerif } from "@remotion/google-fonts/InstrumentSerif";

// Same type and colour system as the product (src/frontend/app/globals.css),
// so the video and the UI read as one thing.
const geist = loadGeist("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] });
const mono = loadMono("normal", { weights: ["400", "500", "600"], subsets: ["latin"] });
const serif = loadSerif("italic", { weights: ["400"], subsets: ["latin"] });
loadSerif("normal", { weights: ["400"], subsets: ["latin"] });

export const fonts = {
  sans: geist.fontFamily,
  mono: mono.fontFamily,
  serif: serif.fontFamily,
};

export const C = {
  bg: "#060808",
  sunken: "#040505",
  surface: "#0b0e0e",
  surface2: "#101414",
  hover: "#151a1a",
  line: "#1b2121",
  lineStrong: "#2a3232",
  ink: "#e8efec",
  ink2: "#a9b4b0",
  muted: "#6c7774",
  accent: "#3cf2c0",
  accent2: "#38d6f5",
  accentInk: "#02130e",
  accentSoft: "rgba(60, 242, 192, 0.1)",
  glow: "rgba(60, 242, 192, 0.35)",
  good: "#4fe39a",
  warn: "#f4b84a",
  bad: "#ff5f6d",
  info: "#7ab8ff",
  grid: "rgba(255, 255, 255, 0.035)",
};

export const LINKS = {
  github: "https://github.com/PrinceXDev/dogfood-judge",
  githubShort: "github.com/PrinceXDev/dogfood-judge",
  linkedin: "https://www.linkedin.com/in/prince-panchani-70757b202/",
  linkedinShort: "linkedin.com/in/prince-panchani-70757b202",
  name: "Prince Panchani",
  role: "Built Dogfood Judge",
};
