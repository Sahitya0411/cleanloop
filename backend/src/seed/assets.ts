// Simple illustrations for seeded demo records, which have no real photos.
// Real reports and pickups always carry the resident's own photo.

const frame = (bg: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" width="400" height="300"><rect width="400" height="300" fill="${bg}"/>${body}<text x="390" y="290" font-family="Arial" font-size="11" fill="#00000066" text-anchor="end">demo illustration</text></svg>`;

const bag = (x: number, y: number, s = 1, c = '#3a3a3a') =>
  `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-28 10 Q-34 -24 0 -30 Q34 -24 28 10 Q22 34 0 34 Q-22 34 -28 10Z" fill="${c}"/><path d="M-8 -30 L0 -42 L8 -30Z" fill="${c}"/></g>`;

const bin = (x: number, y: number) =>
  `<g transform="translate(${x} ${y})"><rect x="-60" y="-70" width="120" height="140" rx="10" fill="#2e7d4f"/><rect x="-68" y="-84" width="136" height="20" rx="6" fill="#256a42"/><rect x="-40" y="-40" width="10" height="90" rx="5" fill="#ffffff33"/><rect x="-5" y="-40" width="10" height="90" rx="5" fill="#ffffff33"/><rect x="30" y="-40" width="10" height="90" rx="5" fill="#ffffff33"/></g>`;

const ground = '<rect y="230" width="400" height="70" fill="#c9bfa6"/>';

export const SEED_IMAGES: Record<string, string> = {
  'seed/bin-overflow.svg': frame(
    '#dfe8ef',
    `${ground}${bin(200, 160)}${bag(150, 70, 0.9)}${bag(205, 60, 1, '#4b4b4b')}${bag(255, 72, 0.85, '#2f4f6f')}${bag(120, 235, 0.8)}${bag(290, 240, 0.9, '#5a4632')}<circle cx="320" cy="200" r="6" fill="#f2c94c"/><circle cx="90" cy="215" r="5" fill="#eb5757"/>`,
  ),
  'seed/roadside-dump.svg': frame(
    '#e6e1d6',
    `${ground}${bag(110, 210, 1.1)}${bag(170, 200, 1.2, '#4b4b4b')}${bag(230, 215, 1.1, '#5a4632')}${bag(290, 205, 1.2, '#2f4f6f')}${bag(200, 160, 1, '#3d3d3d')}${bag(140, 165, 0.9, '#6b6b6b')}${bag(260, 160, 0.9)}<rect x="40" y="250" width="320" height="14" fill="#7a8a99"/><text x="200" y="40" font-family="Arial" font-size="16" text-anchor="middle" fill="#7a3b2e">waste spilling onto the drain</text>`,
  ),
  'seed/bin-full.svg': frame(
    '#e3eee6',
    `${ground}${bin(200, 160)}${bag(185, 78, 0.6)}${bag(220, 80, 0.55, '#4b4b4b')}`,
  ),
  'seed/clean.svg': frame(
    '#e6f2e9',
    `${ground}${bin(200, 160)}<path d="M120 60 l10 -20 l10 20 l20 10 l-20 10 l-10 20 l-10 -20 l-20 -10z" fill="#f2c94c"/><path d="M290 90 l6 -12 l6 12 l12 6 l-12 6 l-6 12 l-6 -12 l-12 -6z" fill="#f2c94c"/>`,
  ),
  'seed/laptop.svg': frame(
    '#ece9f5',
    '<rect x="110" y="80" width="180" height="115" rx="8" fill="#3f3d56"/><rect x="122" y="92" width="156" height="91" fill="#8c88b8"/><path d="M85 200 H315 L300 220 H100Z" fill="#5c5a78"/><path d="M300 215 C340 230 330 260 360 262" stroke="#222" stroke-width="5" fill="none"/>',
  ),
  'seed/cardboard.svg': frame(
    '#f3ebe0',
    '<rect x="100" y="150" width="200" height="90" fill="#c89b62"/><rect x="120" y="85" width="160" height="70" fill="#d8ac74"/><rect x="140" y="40" width="120" height="50" fill="#e2bb85"/><rect x="195" y="150" width="10" height="90" fill="#b5884f"/><rect x="195" y="85" width="10" height="70" fill="#c0935b"/>',
  ),
  'seed/bottles.svg': frame(
    '#e4f0f5',
    [130, 180, 230, 280]
      .map(
        (x, i) =>
          `<g transform="translate(${x} ${150 + (i % 2) * 15})"><rect x="-16" y="-50" width="32" height="110" rx="12" fill="#bfe3f2" stroke="#7fb8d1" stroke-width="3"/><rect x="-8" y="-68" width="16" height="20" rx="3" fill="#2f80ed"/></g>`,
      )
      .join(''),
  ),
};
