// KADA dashboard design tokens — imported by every component.
// Change a value here and it updates everywhere at once.

export const COLORS = {
  ink: "#17131F",
  inkSoft: "#4A4458",
  inkFaint: "#A9A2BE",
  gold: "#F2A93B",
  goldDeep: "#8A5A0E",
  goldBg: "#FCEFD9",
  coral: "#E85D4E",
  coralDeep: "#8C2E22",
  coralBg: "#FBEAE6",
  purple: "#7F77DD",
  purpleDeep: "#3C3489",
  purpleBg: "#EAE7F5",
  cream: "#FAF7F1",
  line: "#E8E1D4",
  green: "#2F9E64",
  greenBg: "#E4F3EA",
  red: "#C94A3F",
  redBg: "#FBE9E7",
  white: "#FFFFFF",
};

// Class type -> color, shared by Calendar, Work Schedule, and Booking List
export const CLASS_TYPES = {
  "age-5-10": { label: "Age 5-10", bg: COLORS.coralBg, border: COLORS.coral, text: COLORS.coralDeep },
  "age-11-16": { label: "Age 11-16", bg: COLORS.goldBg, border: COLORS.gold, text: COLORS.goldDeep },
  workshop: { label: "School workshop", bg: COLORS.purpleBg, border: COLORS.purple, text: COLORS.purpleDeep },
};

export const FONT_SERIF = "'Fraunces', Georgia, serif";
export const FONT_SANS = "'Inter', system-ui, sans-serif";

// Loaded via a <link> tag injected in App.jsx (more reliable than a CSS
// @import, which can lose the race against first paint).
export const FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&display=swap";

// Card shadow + stronger border, used everywhere a panel needs to read as
// a distinct surface rather than text floating on the page background.
export const SHADOW_CARD = "0 1px 2px rgba(23,19,31,0.06), 0 4px 16px rgba(23,19,31,0.05)";
export const SHADOW_POPOVER = "0 8px 24px rgba(23,19,31,0.12), 0 2px 6px rgba(23,19,31,0.08)";
export const BORDER_STRONG = "#DED5C2";
