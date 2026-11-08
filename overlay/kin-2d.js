// kin-2d.js — flat cartoon caricature avatar engine for Kin.
// Recognizable busts of famous people / cartoon characters, drawn as SVG,
// animated by one shared rig: gaze, blink, breathing, moods, and viseme
// lip-sync driven by real audio level. No 3D, no assets — pure vector.

const OUT = "#171720"; // cartoon outline

// ---------------------------------------------------------------- helpers ---

function eyes(skin, opts = {}) {
  const y = opts.eyeY ?? 95;
  const rx = opts.eyeRX ?? 13;
  const ry = opts.eyeRY ?? 15;
  const prx = opts.pupilRX ?? 5.5;
  const ir = opts.iris ?? "#2f8fd8";
  const lidTop = y - ry - 2;
  return `
    <ellipse cx="78" cy="${y}" rx="${rx}" ry="${ry}" fill="#ffffff" stroke="${OUT}" stroke-width="3"/>
    <ellipse cx="122" cy="${y}" rx="${rx}" ry="${ry}" fill="#ffffff" stroke="${OUT}" stroke-width="3"/>
    <ellipse id="pupL" cx="78" cy="${y}" rx="${prx}" ry="${ry - 2}" fill="${ir}"/>
    <ellipse id="pupR" cx="122" cy="${y}" rx="${prx}" ry="${ry - 2}" fill="${ir}"/>
    <circle cx="${78 - 2}" cy="${y - 4}" r="1.8" fill="#fff" opacity="0.9"/>
    <circle cx="${122 - 2}" cy="${y - 4}" r="1.8" fill="#fff" opacity="0.9"/>
    <rect id="lidL" x="${78 - rx - 2}" y="${lidTop}" width="${(rx + 2) * 2}" height="0" rx="6" fill="${skin}"/>
    <rect id="lidR" x="${122 - rx - 2}" y="${lidTop}" width="${(rx + 2) * 2}" height="0" rx="6" fill="${skin}"/>`;
}

function brows(style, color, y = 72) {
  // thick short cartoon brows; JS rotates/translates #browL/#browR per mood
  if (style === "thin") {
    return `
    <path id="browL" d="M66 ${y + 3} Q78 ${y - 3} 90 ${y + 2}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>
    <path id="browR" d="M110 ${y + 2} Q122 ${y - 3} 134 ${y + 3}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`;
  }
  if (style === "flat") {
    return `
    <path id="browL" d="M64 ${y + 1} L92 ${y + 3}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"/>
    <path id="browR" d="M108 ${y + 3} L136 ${y + 1}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round"/>`;
  }
  return `
    <path id="browL" d="M66 ${y + 4} Q77 ${y - 2} 88 ${y + 2}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"/>
    <path id="browR" d="M112 ${y + 2} Q123 ${y - 2} 134 ${y + 4}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"/>`;
}

// Mouth visemes. Each: d-string; closed is line-only, others are filled.
function mouths({ cx = 100, cy = 136, w = 30, style = "smile" }) {
  const hw = w / 2;
  const dark = "#472028";
  const lips = "#b8626a";
  switch (style) {
    case "grin": // huge open grin (Luffy, Goku)
      return {
        closed: `M${cx - hw} ${cy - 4} Q${cx} ${cy + 18} ${cx + hw} ${cy - 4} Q${cx} ${cy + 2} ${cx - hw} ${cy - 4} Z`,
        mid: `M${cx - hw} ${cy - 4} Q${cx} ${cy + 18} ${cx + hw} ${cy - 4} Q${cx} ${cy + 8} ${cx - hw} ${cy - 4} Z`,
        open: `M${cx - hw - 2} ${cy - 6} Q${cx} ${cy + 26} ${cx + hw + 2} ${cy - 6} Q${cx} ${cy + 4} ${cx - hw - 2} ${cy - 6} Z`,
        wide: `M${cx - hw - 8} ${cy - 8} Q${cx} ${cy + 24} ${cx + hw + 8} ${cy - 8} Q${cx} ${cy + 2} ${cx - hw - 8} ${cy - 8} Z`,
        closedFill: "#ffffff",
      };
    case "pout": // full lips (Kim)
      return {
        closed: `M${cx - hw + 4} ${cy} Q${cx} ${cy + 9} ${cx + hw - 4} ${cy} Q${cx} ${cy - 6} ${cx - hw + 4} ${cy} Z`,
        mid: `M${cx - hw + 2} ${cy - 1} Q${cx} ${cy + 10} ${cx + hw - 2} ${cy - 1} Q${cx} ${cy + 7} ${cx - hw + 2} ${cy - 1} Z`,
        open: `M${cx - hw + 2} ${cy - 2} Q${cx} ${cy + 12} ${cx + hw - 2} ${cy - 2} Q${cx + 6} ${cy + 20} ${cx} ${cy + 21} Q${cx - 6} ${cy + 20} ${cx - hw + 2} ${cy - 2} Z`,
        wide: `M${cx - hw} ${cy - 4} Q${cx} ${cy + 10} ${cx + hw} ${cy - 4} Q${cx + 10} ${cy + 20} ${cx} ${cy + 22} Q${cx - 10} ${cy + 20} ${cx - hw} ${cy - 4} Z`,
        closedFill: lips,
      };
    case "frown": // Vegeta
      return {
        closed: `M${cx - hw + 2} ${cy + 6} Q${cx} ${cy - 4} ${cx + hw - 2} ${cy + 6}`,
        mid: `M${cx - hw + 3} ${cy + 5} Q${cx} ${cy - 3} ${cx + hw - 3} ${cy + 5} Q${cx} ${cy + 14} ${cx - hw + 3} ${cy + 5} Z`,
        open: `M${cx - hw + 2} ${cy + 4} Q${cx} ${cy - 4} ${cx + hw - 2} ${cy + 4} Q${cx + 5} ${cy + 18} ${cx} ${cy + 19} Q${cx - 5} ${cy + 18} ${cx - hw + 2} ${cy + 4} Z`,
        wide: `M${cx - hw - 2} ${cy + 2} Q${cx} ${cy - 6} ${cx + hw + 2} ${cy + 2} Q${cx + 8} ${cy + 20} ${cx} ${cy + 22} Q${cx - 8} ${cy + 20} ${cx - hw - 2} ${cy + 2} Z`,
        closedFill: dark,
      };
    case "serene": // Dalai Lama
      return {
        closed: `M${cx - hw + 6} ${cy} Q${cx} ${cy + 7} ${cx + hw - 6} ${cy}`,
        mid: `M${cx - hw + 6} ${cy} Q${cx} ${cy + 7} ${cx + hw - 6} ${cy} Q${cx} ${cy + 8} ${cx - hw + 6} ${cy} Z`,
        open: `M${cx - hw + 4} ${cy - 1} Q${cx} ${cy + 6} ${cx + hw - 4} ${cy - 1} Q${cx + 4} ${cy + 16} ${cx} ${cy + 17} Q${cx - 4} ${cy + 16} ${cx - hw + 4} ${cy - 1} Z`,
        wide: `M${cx - hw} ${cy - 2} Q${cx} ${cy + 5} ${cx + hw} ${cy - 2} Q${cx + 6} ${cy + 16} ${cx} ${cy + 18} Q${cx - 6} ${cy + 16} ${cx - hw} ${cy - 2} Z`,
        closedFill: dark,
      };
    case "square": // SpongeBob with buck teeth
      return {
        closed: `M${cx - hw} ${cy - 2} Q${cx} ${cy + 6} ${cx + hw} ${cy - 2} M${cx - 8} ${cy - 2} h16 M${cx - 8} ${cy - 2} v7 M${cx + 8} ${cy - 2} v7 M${cx} ${cy - 2} v7`,
        mid: `M${cx - hw} ${cy - 3} Q${cx} ${cy + 4} ${cx + hw} ${cy - 3} Q${cx} ${cy + 12} ${cx - hw} ${cy - 3} Z`,
        open: `M${cx - hw - 1} ${cy - 5} Q${cx} ${cy + 2} ${cx + hw + 1} ${cy - 5} Q${cx} ${cy + 20} ${cx - hw - 1} ${cy - 5} Z`,
        wide: `M${cx - hw - 6} ${cy - 6} Q${cx} ${cy} ${cx + hw + 6} ${cy - 6} Q${cx} ${cy + 22} ${cx - hw - 6} ${cy - 6} Z`,
        closedFill: "none",
      };
    default: // smirk (Trump)
      return {
        closed: `M${cx - hw + 2} ${cy + 2} Q${cx - 4} ${cy + 8} ${cx + hw - 2} ${cy - 2}`,
        mid: `M${cx - hw + 2} ${cy + 2} Q${cx - 2} ${cy + 8} ${cx + hw - 2} ${cy - 2} Q${cx + 2} ${cy + 12} ${cx - 6} ${cy + 10} Z`,
        open: `M${cx - hw + 2} ${cy} Q${cx - 2} ${cy + 7} ${cx + hw - 2} ${cy - 4} Q${cx + 6} ${cy + 18} ${cx} ${cy + 20} Q${cx - 6} ${cy + 16} ${cx - hw + 2} ${cy} Z`,
        wide: `M${cx - hw - 2} ${cy - 1} Q${cx - 2} ${cy + 5} ${cx + hw + 2} ${cy - 7} Q${cx + 8} ${cy + 18} ${cx - 2} ${cy + 21} Q${cx - 8} ${cy + 16} ${cx - hw - 2} ${cy - 1} Z`,
        closedFill: "none",
      };
  }
}

function neck(skin) {
  return `<rect x="86" y="148" width="28" height="30" fill="${skin}" stroke="${OUT}" stroke-width="3"/>`;
}

function shoulders(fill, extra = "") {
  return `
    <path id="k2d-body" d="M30 260 Q28 208 66 190 Q84 196 100 196 Q116 196 134 190 Q172 208 170 260 Z"
      fill="${fill}" stroke="${OUT}" stroke-width="3.5"/>${extra}`;
}

// NOTE: build() returns bare <g>-level markup; mount2D supplies the outer <svg>.
function svgWrap(inner) {
  return inner;
}

// ------------------------------------------------------------- characters ---

const CHARACTERS = {
  trump: {
    label: "Donald",
    build() {
      const skin = "#f0b47c";
      const m = mouths({ style: "smirk", cy: 138, w: 30 });
      return svgWrap(`
        ${shoulders("#2b3350", `
          <path d="M84 196 L100 214 L116 196" fill="#f6f5f0" stroke="${OUT}" stroke-width="3"/>
          <path d="M94 202 L96 202 L97 232 L103 232 L104 202 L106 202 L104 196 L96 196 Z" fill="#c8302f" stroke="${OUT}" stroke-width="2.5"/>`)}
        ${neck(skin)}
        <g id="k2d-head">
          <path d="M64 60 Q66 34 100 32 Q134 34 136 60 Q138 96 132 118 Q124 146 100 148 Q76 146 68 118 Q62 96 64 60 Z"
            fill="${skin}" stroke="${OUT}" stroke-width="3.5"/>
          <path d="M60 62 Q58 30 92 26 Q126 22 136 42 Q144 58 132 66 Q120 52 108 54 Q96 42 84 52 Q72 56 62 68 Q58 66 60 62 Z"
            fill="#f7dc8a" stroke="${OUT}" stroke-width="3.5"/>
          <path d="M128 46 Q142 54 138 66 Q130 60 126 52 Z" fill="#f7dc8a" stroke="${OUT}" stroke-width="3"/>
          <path d="M64 64 Q68 76 78 80" fill="none" stroke="#e5a96a" stroke-width="2.5"/>
          <path d="M100 104 Q104 112 100 116 Q95 112 96 108 Z" fill="#e8a565" stroke="#b0704a" stroke-width="2.5"/>
          ${brows("flat", "#e5c878", 70)}
          <g id="k2d-face">
            ${eyes(skin, { iris: "#3f6fae", eyeRY: 13, pupilRX: 5 })}
            <path id="mouth" d="${m.closed}" fill="${m.closedFill}" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>
            <circle cx="60" cy="112" r="6" fill="#e79a5e" opacity="0.55"/>
            <circle cx="140" cy="112" r="6" fill="#e79a5e" opacity="0.55"/>
          </g>
        </g>`).replace("</svg>", "");
    },
    mouths: mouths({ style: "smirk", cy: 138, w: 30 }),
  },

  kim: {
    label: "Kim K",
    build() {
      const skin = "#eec49e";
      const m = mouths({ style: "pout", cy: 136, w: 26 });
      return svgWrap(`
        <path id="k2d-body" d="M34 260 Q34 214 68 194 Q86 200 100 200 Q114 200 132 194 Q166 214 166 260 Z" fill="#191b20"/>
        <path d="M70 200 Q100 212 130 200 L140 260 L60 260 Z" fill="#241d1c" stroke="${OUT}" stroke-width="3"/>
        ${neck(skin)}
        <g id="k2d-head">
          <path d="M64 168 Q56 120 62 84 Q66 42 100 40 Q134 42 138 84 Q144 120 136 168 Q136 186 100 188 Q64 186 64 168 Z"
            fill="#2e1f1e" stroke="${OUT}" stroke-width="3.5"/>
          <path d="M68 164 Q64 110 70 82 Q74 48 100 46 Q126 48 130 82 Q136 110 132 164 Q120 172 100 172 Q80 172 68 164 Z"
            fill="${skin}" stroke="${OUT}" stroke-width="3.5"/>
          <path d="M84 52 Q100 44 116 52" fill="none" stroke="${OUT}" stroke-width="3.5"/>
          <path d="M72 60 Q70 80 76 96" fill="none" stroke="#3a2a26" stroke-width="4"/>
          <path d="M128 60 Q130 80 124 96" fill="none" stroke="#3a2a26" stroke-width="4"/>
          <ellipse cx="100" cy="30" r="30" cy="26" fill="#2e1f1e" stroke="${OUT}" stroke-width="3.5" style="display:none"/>
          <path d="M66 30 Q100 18 134 30 Q138 40 130 44 Q100 34 70 44 Q62 40 66 30 Z" fill="#2e1f1e"/>
          ${brows("thin", "#3a2a26", 72)}
          <g id="k2d-face">
            ${eyes(skin, { iris: "#5d4632", eyeRX: 14, eyeRY: 14, pupilRX: 6 })}
            <path d="M64 88 Q74 80 86 86" fill="none" stroke="#241a18" stroke-width="3.5" stroke-linecap="round"/>
            <path d="M114 86 Q126 80 136 88" fill="none" stroke="#241a18" stroke-width="3.5" stroke-linecap="round"/>
            <path d="M97 108 Q102 112 97 116" fill="none" stroke="#caa08c" stroke-width="3"/>
            <path id="mouth" d="${m.closed}" fill="${m.closedFill}" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>
            <ellipse cx="58" cy="120" rx="9" ry="14" fill="#e7a98c" opacity="0.35"/>
            <ellipse cx="142" cy="120" rx="9" ry="14" fill="#e7a98c" opacity="0.35"/>
          </g>
        </g>`).replace("</svg>", "");
    },
    mouths: mouths({ style: "pout", cy: 136, w: 26 }),
  },

  kanye: {
    label: "Kanye",
    build() {
      const skin = "#7d5b42";
      const m = mouths({ style: "frown", cy: 138, w: 26 });
      return svgWrap(`
        ${shoulders("#15161a", `
          <path d="M86 200 L114 200 L112 214 L88 214 Z" fill="#d9c26b" stroke="${OUT}" stroke-width="2.5"/>`)}
        ${neck(skin)}
        <g id="k2d-head">
          <path d="M64 62 Q64 34 100 32 Q136 34 136 62 Q140 100 132 122 Q124 148 100 150 Q76 148 68 122 Q60 100 64 62 Z"
            fill="${skin}" stroke="${OUT}" stroke-width="3.5"/>
          <path d="M76 44 Q100 36 124 44 Q122 40 100 38 Q78 40 76 44 Z" fill="#5d4130"/>
          <ellipse cx="82" cy="44" rx="10" ry="6" fill="#8a6a50" opacity="0.7"/>
          ${brows("flat", "#33231a", 70)}
          <g id="k2d-face">
            ${eyes(skin, { iris: "#2c2018", eyeRX: 13, eyeRY: 12, pupilRX: 5 })}
            <path d="M96 104 Q100 110 104 104" fill="none" stroke="#4a3325" stroke-width="3"/>
            <path d="M88 148 Q100 152 112 148 L110 156 Q100 158 90 156 Z" fill="#33231a" stroke="${OUT}" stroke-width="2"/>
            <path d="M94 124 Q100 122 106 124 Q106 134 100 136 Q94 134 94 124 Z" fill="#5d4130" opacity="0.6"/>
            <path id="mouth" d="${m.closed}" fill="${m.closedFill}" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>
          </g>
        </g>`).replace("</svg>", "");
    },
    mouths: mouths({ style: "frown", cy: 138, w: 26 }),
  },

  goku: {
    label: "Goku",
    build() {
      const skin = "#f6c298";
      const m = mouths({ style: "grin", cy: 134, w: 30 });
      return svgWrap(`
        ${shoulders("#f0811f", `
          <path d="M74 200 Q100 190 126 200 L118 224 Q100 232 82 224 Z" fill="#3a66b8" stroke="${OUT}" stroke-width="3"/>`)}
        ${neck(skin)}
        <g id="k2d-head">
          <path d="M66 70 L44 48 L70 58 L62 34 L84 52 L92 26 L102 50 L112 22 L118 50 L138 32 L130 56 L156 44 L134 70 Z"
            fill="#181820" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>
          <path d="M64 66 Q64 38 100 36 Q136 38 136 66 Q138 100 130 122 Q122 146 100 148 Q78 146 70 122 Q62 100 64 66 Z"
            fill="${skin}" stroke="${OUT}" stroke-width="3.5"/>
          ${brows("thick", "#181820", 72)}
          <g id="k2d-face">
            ${eyes(skin, { iris: "#2c2320", eyeRY: 14 })}
            <path d="M100 102 L105 116 Q100 120 95 116 Z" fill="#e0a173" stroke="${OUT}" stroke-width="2.5"/>
            <path id="mouth" d="${m.closed}" fill="${m.closedFill}" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>
          </g>
        </g>`).replace("</svg>", "");
    },
    mouths: mouths({ style: "grin", cy: 134, w: 30 }),
  },

  vegeta: {
    label: "Vegeta",
    build() {
      const skin = "#f2bd93";
      const m = mouths({ style: "frown", cy: 138, w: 24 });
      return svgWrap(`
        ${shoulders("#2c58b0", `
          <path d="M70 198 Q100 188 130 198 L124 214 Q100 222 76 214 Z" fill="#e8e6e0" stroke="${OUT}" stroke-width="3"/>
          <rect x="94" y="216" width="12" height="10" fill="#e8e6e0" stroke="${OUT}" stroke-width="2"/>`)}
        ${neck(skin)}
        <g id="k2d-head">
          <path d="M64 68 Q60 20 100 12 Q140 20 136 68 L124 56 L134 40 L112 46 L118 28 L100 40 L90 22 L88 44 L70 36 L76 58 Z"
            fill="#14141c" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>
          <path d="M64 66 Q64 40 100 38 Q136 40 136 66 Q138 100 130 122 Q122 146 100 148 Q78 146 70 122 Q62 100 64 66 Z"
            fill="${skin}" stroke="${OUT}" stroke-width="3.5"/>
          <path d="M96 38 L104 38 L102 56 L98 56 Z" fill="${skin}" stroke="${OUT}" stroke-width="2.5"/>
          ${brows("thick", "#14141c", 70)}
          <g id="k2d-face">
            ${eyes(skin, { iris: "#2c2320", eyeRY: 13 })}
            <path d="M100 104 L104 116 Q100 119 96 116 Z" fill="#e0a173" stroke="${OUT}" stroke-width="2.5"/>
            <path id="mouth" d="${m.closed}" fill="${m.closedFill}" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>
          </g>
        </g>`).replace("</svg>", "");
    },
    mouths: mouths({ style: "frown", cy: 138, w: 24 }),
  },

  luffy: {
    label: "Luffy",
    build() {
      const skin = "#f4c9a0";
      const m = mouths({ style: "grin", cy: 134, w: 34 });
      return svgWrap(`
        ${shoulders("#b8342c", `
          <path d="M78 200 Q100 196 122 200 L112 220 Q100 226 88 220 Z" fill="${skin}" stroke="${OUT}" stroke-width="3"/>`)}
        ${neck(skin)}
        <g id="k2d-head">
          <path d="M64 66 Q64 38 100 36 Q136 38 136 66 Q138 100 130 122 Q122 146 100 148 Q78 146 70 122 Q62 100 64 66 Z"
            fill="${skin}" stroke="${OUT}" stroke-width="3.5"/>
          <g id="k2d-face">
            ${eyes(skin, { iris: "#3a2c22", eyeRX: 14, eyeRY: 14 })}
            <path d="M74 106 L78 118 M82 106 L86 118" stroke="#a85342" stroke-width="2.5" stroke-linecap="round"/>
            <path d="M92 112 L96 124 Q100 128 104 124 L108 112" fill="none" stroke="#a85342" stroke-width="2.5"/>
            <path d="M78 118 Q84 122 90 118 M110 118 Q116 122 122 118" fill="none" stroke="#d99771" stroke-width="2.5"/>
            <path id="mouth" d="${m.closed}" fill="${m.closedFill}" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>
          </g>
          <ellipse cx="100" cy="40" rx="52" ry="16" fill="#e9c74f" stroke="${OUT}" stroke-width="3.5"/>
          <path d="M48 40 Q100 24 152 40 Q152 52 100 56 Q48 52 48 40 Z" fill="#e9c74f" stroke="${OUT}" stroke-width="3.5"/>
          <path d="M48 44 Q100 30 152 44 L152 54 Q100 40 48 54 Z" fill="#b8342c"/>
          <rect x="94" y="42" width="12" height="10" fill="#e9c74f" stroke="${OUT}" stroke-width="2"/>
        </g>`).replace("</svg>", "");
    },
    mouths: mouths({ style: "grin", cy: 134, w: 34 }),
  },

  dalai: {
    label: "Dalai Lama",
    build() {
      const skin = "#e8b889";
      const m = mouths({ style: "serene", cy: 136, w: 26 });
      return svgWrap(`
        ${shoulders("#7a2f34", `
          <path d="M64 200 Q100 210 136 200 L140 214 Q100 226 60 214 Z" fill="#c9992f" stroke="${OUT}" stroke-width="3"/>`)}
        ${neck(skin)}
        <g id="k2d-head">
          <path d="M64 62 Q64 34 100 32 Q136 34 136 62 Q138 98 130 120 Q122 146 100 148 Q78 146 70 120 Q62 98 64 62 Z"
            fill="${skin}" stroke="${OUT}" stroke-width="3.5"/>
          <ellipse cx="80" cy="42" rx="12" ry="6" fill="#f0cc9e" opacity="0.8"/>
          <path d="M78 52 Q100 46 122 52" fill="none" stroke="#c9a27a" stroke-width="2"/>
          ${brows("thin", "#cfd3d8", 70)}
          <g id="k2d-face">
            ${eyes(skin, { iris: "#4a382c", eyeRX: 12, eyeRY: 12, pupilRX: 5 })}
            <circle cx="78" cy="95" r="17" fill="none" stroke="#c9992f" stroke-width="3"/>
            <circle cx="122" cy="95" r="17" fill="none" stroke="#c9992f" stroke-width="3"/>
            <path d="M95 95 L105 95 M61 92 Q66 88 72 90 M139 92 Q134 88 128 90" fill="none" stroke="#c9992f" stroke-width="3"/>
            <path d="M98 106 Q100 112 102 106" fill="none" stroke="#c99a6e" stroke-width="2.5"/>
            <path d="M84 128 Q86 132 84 136 M116 128 Q114 132 116 136" fill="none" stroke="#d6a578" stroke-width="2"/>
            <path id="mouth" d="${m.closed}" fill="${m.closedFill}" stroke="${OUT}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
          </g>
        </g>`).replace("</svg>", "");
    },
    mouths: mouths({ style: "serene", cy: 136, w: 26 }),
  },

  spongebob: {
    label: "SpongeBob",
    build() {
      const yellow = "#f6e14d";
      const skin = yellow;
      const m = mouths({ style: "square", cy: 130, w: 34 });
      return svgWrap(`
        <rect x="42" y="176" width="116" height="84" fill="${yellow}" stroke="${OUT}" stroke-width="3.5"/>
        <rect x="80" y="196" width="40" height="34" fill="#f2f0e6" stroke="${OUT}" stroke-width="3"/>
        <path d="M92 200 L96 200 L96 226 L92 226 Z M104 200 L108 200 L108 226 L104 226 Z" fill="#b8342c"/>
        <rect x="96" y="196" width="8" height="30" fill="#b8342c"/>
        ${neck(skin)}
        <g id="k2d-head">
          <rect x="56" y="24" width="88" height="130" rx="10" fill="${yellow}" stroke="${OUT}" stroke-width="3.5"/>
          <g id="k2d-face">
            ${eyes(skin, { iris: "#5db8e8", eyeRX: 16, eyeRY: 16, pupilRX: 8 })}
            <circle cx="60" cy="70" r="2" fill="#d8bf2f"/>
            <circle cx="64" cy="78" r="2" fill="#d8bf2f"/>
            <circle cx="58" cy="80" r="2" fill="#d8bf2f"/>
            <circle cx="140" cy="70" r="2" fill="#d8bf2f"/>
            <circle cx="136" cy="78" r="2" fill="#d8bf2f"/>
            <circle cx="142" cy="80" r="2" fill="#d8bf2f"/>
            <circle cx="70" cy="118" r="2" fill="#d8bf2f"/>
            <circle cx="130" cy="118" r="2" fill="#d8bf2f"/>
            <path d="M92 118 Q100 124 108 118" fill="none" stroke="${OUT}" stroke-width="3"/>
            <path id="mouth" d="${m.closed}" fill="${m.closedFill}" stroke="${OUT}" stroke-width="3" stroke-linejoin="round"/>
            <rect x="92" y="124" width="7" height="10" fill="#ffffff" stroke="${OUT}" stroke-width="2"/>
            <rect x="101" y="124" width="7" height="10" fill="#ffffff" stroke="${OUT}" stroke-width="2"/>
          </g>
        </g>`).replace("</svg>", "");
    },
    mouths: mouths({ style: "square", cy: 130, w: 34 }),
  },
};

// ------------------------------------------------------------------- rig ---

const MOODS = {
  idle: { browY: 0, browRot: 0, lid: 0, wander: false, wide: 0 },
  attentive: { browY: -4, browRot: 0, lid: 0, wander: false, wide: 0.1 },
  thinking: { browY: -2, browRot: -8, lid: 0.3, wander: false, wide: 0, pupils: [-0.3, -0.5] },
  watching: { browY: 0, browRot: 0, lid: 0, wander: true, wide: 0 },
  concerned: { browY: -3, browRot: 12, lid: 0.25, wide: 0 },
  dozing: { browY: 1, browRot: 0, lid: 0.82, wide: 0 },
};

export function mount2D(stageEl) {
  let charId = null;
  let mood = "idle";
  let gazeX = 0;
  let gazeY = 0;
  let talking = false;
  let speechLevel = 0;
  let smoothLevel = 0;
  let streaming = false;
  let destroyed = false;

  let layer = null;
  let refs = {};
  let blinkT = 0;          // countdown to next blink
  let blinkPhase = 0;     // 0..1..0 over ~220ms
  let breathing = 0;
  let lastTs = performance.now();
  let mouthHold = 0;      // swap hold so mouth shape doesn't flicker
  let lastShape = "closed";

  function setCharacter(id) {
    if (!CHARACTERS[id]) return false;
    charId = id;
    if (layer) layer.remove();
    const holder = document.createElement("div");
    holder.id = "k2d-holder";
    holder.style.cssText =
      "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none";
    const size = document.createElement("div");
    size.style.cssText = "width:170px;height:220px;position:relative";
    size.innerHTML = `<svg viewBox="0 0 200 260" xmlns="http://www.w3.org/2000/svg" style="position:absolute;inset:0;width:100%;height:100%">${CHARACTERS[id].build()}</svg>`;
    holder.appendChild(size);
    stageEl.appendChild(holder);
    layer = holder;
    refs = {
      head: holder.querySelector("#k2d-head"),
      face: holder.querySelector("#k2d-face"),
      body: holder.querySelector("#k2d-body"),
      pupL: holder.querySelector("#pupL"),
      pupR: holder.querySelector("#pupR"),
      lidL: holder.querySelector("#lidL"),
      lidR: holder.querySelector("#lidR"),
      browL: holder.querySelector("#browL"),
      browR: holder.querySelector("#browR"),
      mouth: holder.querySelector("#mouth"),
      zzz: null,
    };
    return true;
  }

  function setMood(next) {
    if (MOODS[next]) mood = next;
  }

  function setGaze(dx, dy) {
    gazeX = Math.max(-1, Math.min(1, dx || 0));
    gazeY = Math.max(-1, Math.min(1, dy || 0));
  }

  function setStreaming(next) {
    streaming = Boolean(next);
  }

  function setSpeech(level, isTalking) {
    if (typeof level === "number") speechLevel = Math.max(0, Math.min(1, level));
    if (typeof isTalking === "boolean") talking = isTalking;
  }

  function frame(ts) {
    if (destroyed) return;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;
    if (layer && refs.mouth) {
      const t = ts / 1000;
      const pose = MOODS[mood] || MOODS.idle;

      // blink scheduling
      blinkT -= dt;
      if (blinkT <= 0) {
        blinkT = 2 + Math.random() * 4;
        blinkPhase = 0.001;
      }
      if (blinkPhase > 0) {
        blinkPhase += dt / 0.11;
        if (blinkPhase >= 2) blinkPhase = 0;
      }
      const blinkAmt = blinkPhase > 0 ? Math.sin(Math.min(1, blinkPhase) * Math.PI) : 0;

      // speech smoothing
      smoothLevel += (speechLevel - smoothLevel) * Math.min(1, dt * 18);

      // breathing
      breathing += dt * (mood === "dozing" ? 1.1 : 2.2);
      const breatheY = Math.sin(breathing) * (mood === "dozing" ? 4 : 2);
      const talkBob = talking ? Math.abs(Math.sin(t * 10)) * 3 : 0;

      // gaze / mood pupils
      let px = gazeX * 5;
      let py = gazeY * 3.5;
      if (pose.pupils) {
        px += pose.pupils[0] * 5;
        py += pose.pupils[1] * 4;
      } else if (pose.wander) {
        px += Math.sin(t * 0.7) * 3;
        py += Math.cos(t * 0.5) * 1.5;
      }

      refs.pupL?.setAttribute("transform", `translate(${px} ${py})`);
      refs.pupR?.setAttribute("transform", `translate(${px} ${py})`);

      // lids: mood coverage + blink
      const lidH = 34 * Math.min(1, pose.lid + blinkAmt * 1.05);
      refs.lidL?.setAttribute("height", lidH.toFixed(1));
      refs.lidR?.setAttribute("height", lidH.toFixed(1));

      // brows
      const by = pose.browY;
      refs.browL?.setAttribute(
        "transform",
        `translate(0 ${by}) rotate(${pose.browRot} 77 72)`
      );
      refs.browR?.setAttribute(
        "transform",
        `translate(0 ${by}) rotate(${-pose.browRot} 123 72)`
      );

      // mouth viseme
      const m = CHARACTERS[charId].mouths;
      const open = talking ? Math.max(0, smoothLevel) : 0;
      let shape = "closed";
      if (open > 0.62) shape = "wide";
      else if (open > 0.34) shape = "open";
      else if (open > 0.14) shape = "mid";
      if (shape !== lastShape) {
        lastShape = shape;
        mouthHold = 0.05 + Math.random() * 0.06; // hold each viseme a beat
      }
      mouthHold -= dt;
      if (mouthHold <= 0 && shape === "closed" && open > 0.05) {
        shape = "mid";
        lastShape = "mid";
      }
      refs.mouth.setAttribute("d", m[shape] ?? m.closed);
      refs.mouth.setAttribute("fill", shape === "closed" ? (m.closedFill ?? "none") : (m.closedFill === "#ffffff" ? "#472028" : (m.closedFill === "#b8626a" ? "#7c3a44" : "#472028")));
      if (m.closedFill === "none") refs.mouth.setAttribute("fill", shape === "closed" ? "none" : "#472028");

      // head + body motion
      const headEl = refs.head;
      if (headEl) {
        headEl.setAttribute(
          "transform",
          `translate(${gazeX * 3} ${breatheY + talkBob}) rotate(${gazeX * 3} 100 140)`
        );
      }
      const bob = talking ? Math.abs(Math.sin(t * 10 + 1)) * 2 : 0;
      if (refs.body) refs.body.setAttribute("transform", `translate(0 ${bob})`);
      const holder = layer;
      if (holder) {
        holder.style.transform = `scale(${mood === "attentive" ? 1.03 : 1})`;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setCharacter,
    setMood,
    setGaze,
    setStreaming,
    setSpeech,
    get character() {
      return charId;
    },
    destroy() {
      destroyed = true;
      layer?.remove();
    },
  };
}

export { CHARACTERS };