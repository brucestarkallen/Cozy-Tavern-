#!/usr/bin/env python3
"""M678: THE ACADEMY'S MAP — the coat's backdrop, drawn by code, rendered once to WebP.

His: "something easy to the eyes … similar to the Harry Potter map that moves … cozy". This draws an ORIGINAL enchanted
parchment map (no film artwork, names or layout): a castle on a cliff over a lake, villages, forests, a river, roads, a
compass rose, folds and stains — sepia ink with watercolour washes, warm lit windows. Two compositions, one for a tall
screen (a phone) and one for a wide one, because a single picture cannot put the castle where the story's own welcome
card is not on both. The page shows one or the other by aspect ratio (css/academy.css).

What moves (footprints walking a road, windows flickering, mist) is NOT in the picture: it is a handful of small HTML
elements laid over it in the same coordinates (index.html .academy-stage), so the browser animates them on the
compositor and never repaints the map. This script writes their positions between the markers in index.html, so the
road the footprints walk is the road drawn here.

  python3 tools/academy_map.py            # both pictures + the stage positions in index.html
  python3 tools/academy_map.py --svg      # also keep the SVG sources in /tmp/academy-map for a look

Needs Playwright's Chromium (it renders the SVG) and Pillow (it writes the WebP).
"""
import json, math, os, random, re, sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
FONTS = REPO / 'assets' / 'fonts'
OUT = REPO / 'assets' / 'academy'

INK = '#2b1a0c'
INK_SOFT = 'rgba(43,26,12,0.55)'
GLOW = '#ffd27a'


# --------------------------------------------------------------------------------------------- small geometry helpers

def f(v):
    return ('%.1f' % v).rstrip('0').rstrip('.')


def catmull(points, closed=False):
    """A smooth path through the points (Catmull-Rom as cubic Béziers)."""
    pts = list(points)
    if len(pts) < 2:
        return ''
    if closed:
        pts = [pts[-1]] + pts + [pts[0], pts[1]]
    else:
        pts = [pts[0]] + pts + [pts[-1]]
    d = ['M%s,%s' % (f(pts[1][0]), f(pts[1][1]))]
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6)
        d.append('C%s,%s %s,%s %s,%s' % (f(c1[0]), f(c1[1]), f(c2[0]), f(c2[1]), f(p2[0]), f(p2[1])))
    if closed:
        d.append('Z')
    return ' '.join(d)


def sample_catmull(points, n_per=24):
    """Points along the same Catmull-Rom curve (for widths, footprints and distance tests)."""
    pts = [points[0]] + list(points) + [points[-1]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for k in range(n_per):
            t = k / n_per
            t2, t3 = t * t, t * t * t
            x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3)
            y = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)
            out.append((x, y))
    out.append(points[-1])
    return out


def poly(points, closed=True):
    d = 'M' + ' L'.join('%s,%s' % (f(x), f(y)) for x, y in points)
    return d + (' Z' if closed else '')


def dist_to_polyline(p, line):
    best = 1e18
    for a, b in zip(line, line[1:]):
        ax, ay = a
        bx, by = b
        dx, dy = bx - ax, by - ay
        L = dx * dx + dy * dy
        t = 0 if L == 0 else max(0, min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / L))
        qx, qy = ax + t * dx, ay + t * dy
        d = (p[0] - qx) ** 2 + (p[1] - qy) ** 2
        if d < best:
            best = d
    return math.sqrt(best)


def inside(p, polygon):
    x, y = p
    c = False
    n = len(polygon)
    for i in range(n):
        x1, y1 = polygon[i]
        x2, y2 = polygon[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1 + 1e-12) + x1:
            c = not c
    return c


class Noise:
    """2-D Perlin noise, seeded, plus fractal sums."""

    def __init__(self, seed):
        r = random.Random(seed)
        p = list(range(256))
        r.shuffle(p)
        self.p = p + p
        self.g = [(math.cos(a), math.sin(a)) for a in (r.random() * math.tau for _ in range(256))]

    def _grad(self, h, x, y):
        gx, gy = self.g[h & 255]
        return gx * x + gy * y

    def __call__(self, x, y):
        xi, yi = math.floor(x), math.floor(y)
        xf, yf = x - xi, y - yi
        xi &= 255
        yi &= 255
        u = xf * xf * xf * (xf * (xf * 6 - 15) + 10)
        v = yf * yf * yf * (yf * (yf * 6 - 15) + 10)
        p = self.p
        aa, ab = p[p[xi] + yi], p[p[xi] + yi + 1]
        ba, bb = p[p[xi + 1] + yi], p[p[xi + 1] + yi + 1]
        x1 = self._grad(aa, xf, yf) + u * (self._grad(ba, xf - 1, yf) - self._grad(aa, xf, yf))
        x2 = self._grad(ab, xf, yf - 1) + u * (self._grad(bb, xf - 1, yf - 1) - self._grad(ab, xf, yf - 1))
        return x1 + v * (x2 - x1)

    def fbm(self, x, y, octaves=4):
        s, a, fr = 0.0, 0.5, 1.0
        for _ in range(octaves):
            s += a * self(x * fr, y * fr)
            a *= 0.5
            fr *= 2.0
        return s


def poisson(w, h, r, rnd, k=18, bounds=None):
    """Bridson's Poisson-disk sampling: an even scatter with no two points closer than r."""
    cell = r / math.sqrt(2)
    gw, gh = int(w / cell) + 1, int(h / cell) + 1
    grid = [[None] * gh for _ in range(gw)]
    x0, y0 = (bounds[0], bounds[1]) if bounds else (0, 0)
    first = (x0 + rnd.random() * w, y0 + rnd.random() * h)
    pts, active = [first], [first]
    grid[int((first[0] - x0) / cell)][int((first[1] - y0) / cell)] = first
    while active:
        i = rnd.randrange(len(active))
        base = active[i]
        found = False
        for _ in range(k):
            a = rnd.random() * math.tau
            rr = r * (1 + rnd.random())
            q = (base[0] + rr * math.cos(a), base[1] + rr * math.sin(a))
            if not (x0 <= q[0] < x0 + w and y0 <= q[1] < y0 + h):
                continue
            gx, gy = int((q[0] - x0) / cell), int((q[1] - y0) / cell)
            ok = True
            for ix in range(max(0, gx - 2), min(gw, gx + 3)):
                for iy in range(max(0, gy - 2), min(gh, gy + 3)):
                    o = grid[ix][iy]
                    if o and (o[0] - q[0]) ** 2 + (o[1] - q[1]) ** 2 < r * r:
                        ok = False
                        break
                if not ok:
                    break
            if ok:
                grid[gx][gy] = q
                pts.append(q)
                active.append(q)
                found = True
                break
        if not found:
            active.pop(i)
    return pts


def ribbon_poly(center, half_width, closed=False):
    """A band around a centre line: half_width(t) at each sample; returns the outline polygon."""
    left, right = [], []
    n = len(center)
    for i, (x, y) in enumerate(center):
        a = center[max(0, i - 1)]
        b = center[min(n - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L, dx / L
        hw = half_width(i / max(1, n - 1))
        left.append((x + nx * hw, y + ny * hw))
        right.append((x - nx * hw, y - ny * hw))
    return left + right[::-1]


# --------------------------------------------------------------------------------------------- the drawing

class Map:
    def __init__(self, W, H, seed, k):
        self.W, self.H, self.k = W, H, k
        self.rnd = random.Random(seed)
        self.noise = Noise(seed + 1)
        self.defs = []
        self.layers = {name: [] for name in ('paper', 'wash', 'water', 'land', 'ink', 'trees', 'built', 'labels', 'night', 'light')}
        self.lit = []          # every lit window: (x, y, size)
        self.blocked = []      # (kind, data): places trees and hills keep away from
        self.roads = []        # sampled road lines
        self.walk = None       # the road the footprints walk (sampled)
        self.walk_from_x = 0   # the prints begin where the road first reaches this x (the part of it a screen shows)
        self.uid = 0

    def id(self, base):
        self.uid += 1
        return '%s%d' % (base, self.uid)

    def add(self, layer, s):
        self.layers[layer].append(s)

    # ---- paper -----------------------------------------------------------------------------
    def paper(self, folds_x, folds_y):
        W, H = self.W, self.H
        self.defs.append('''
<radialGradient id="paperg" cx="50%" cy="44%" r="78%">
  <stop offset="0" stop-color="#e3cb99"/><stop offset="0.45" stop-color="#d5b77f"/>
  <stop offset="0.78" stop-color="#b8925a"/><stop offset="1" stop-color="#7d5a31"/>
</radialGradient>
<filter id="mottle" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.0024" numOctaves="5" seed="11"/>
  <feColorMatrix type="matrix" values="0 0 0 0 0.36  0 0 0 0 0.22  0 0 0 0 0.09  2.1 0 0 0 -0.95"/>
</filter>
<filter id="mottle2" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.011" numOctaves="3" seed="23"/>
  <feColorMatrix type="matrix" values="0 0 0 0 0.98  0 0 0 0 0.93  0 0 0 0 0.80  -2.4 0 0 0 1.25"/>
</filter>
<filter id="grain" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="5"/>
  <feColorMatrix type="matrix" values="0 0 0 0 0.25  0 0 0 0 0.15  0 0 0 0 0.06  1.6 0 0 0 -0.62"/>
</filter>
<filter id="wobble" x="-5%" y="-5%" width="110%" height="110%">
  <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="3" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="washy" x="-10%" y="-10%" width="120%" height="120%">
  <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="3" seed="9" result="n"/>
  <feDisplacementMap in="SourceGraphic" in2="n" scale="16" xChannelSelector="R" yChannelSelector="G" result="d"/>
  <feGaussianBlur in="d" stdDeviation="2.2"/>
</filter>
<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6"/></filter>
<radialGradient id="glowg"><stop offset="0" stop-color="#ffe6a8" stop-opacity="0.9"/><stop offset="0.3" stop-color="#ffc55e" stop-opacity="0.38"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></radialGradient>
<radialGradient id="haloG"><stop offset="0" stop-color="#ffc768" stop-opacity="0.2"/><stop offset="0.55" stop-color="#f09a45" stop-opacity="0.07"/><stop offset="1" stop-color="#f09a45" stop-opacity="0"/></radialGradient>
<linearGradient id="stoneG" x1="0" x2="1" y1="0" y2="0">
  <stop offset="0" stop-color="#cdb68c"/><stop offset="0.4" stop-color="#ad9469"/><stop offset="1" stop-color="#5f4b31"/>
</linearGradient>
<linearGradient id="stoneDark" x1="0" x2="1"><stop offset="0" stop-color="#a68d64"/><stop offset="1" stop-color="#6a5539"/></linearGradient>
<linearGradient id="slateG" x1="0" x2="1"><stop offset="0" stop-color="#6c6f78"/><stop offset="0.5" stop-color="#4a4c56"/><stop offset="1" stop-color="#2b2b33"/></linearGradient>
<linearGradient id="roofRed" x1="0" x2="1"><stop offset="0" stop-color="#a1513a"/><stop offset="1" stop-color="#5e2a1c"/></linearGradient>
<linearGradient id="roofBrown" x1="0" x2="1"><stop offset="0" stop-color="#8a6a45"/><stop offset="1" stop-color="#4d3720"/></linearGradient>
''')
        self.add('paper', '<rect width="%d" height="%d" fill="url(#paperg)"/>' % (W, H))
        self.add('paper', '<rect width="%d" height="%d" filter="url(#mottle)" opacity="0.62" style="mix-blend-mode:multiply"/>' % (W, H))
        self.add('paper', '<rect width="%d" height="%d" filter="url(#mottle2)" opacity="0.45"/>' % (W, H))
        self.add('paper', '<rect width="%d" height="%d" filter="url(#grain)" opacity="0.32" style="mix-blend-mode:multiply"/>' % (W, H))
        r = self.rnd
        # old stains: rings with a darker rim
        for _ in range(6):
            cx, cy = r.uniform(0.05, 0.95) * W, r.uniform(0.05, 0.95) * H
            rad = r.uniform(60, 190) * self.k
            gid = self.id('stain')
            self.defs.append('<radialGradient id="%s"><stop offset="0" stop-color="#8a5a2a" stop-opacity="0.05"/><stop offset="0.82" stop-color="#8a5a2a" stop-opacity="0.04"/><stop offset="0.95" stop-color="#6e4520" stop-opacity="0.2"/><stop offset="1" stop-color="#6e4520" stop-opacity="0"/></radialGradient>' % gid)
            self.add('paper', '<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="url(#%s)" filter="url(#wobble)"/>' % (f(cx), f(cy), f(rad), f(rad * r.uniform(0.8, 1.05)), gid))
        # the folds: the map was kept folded in a pocket — panels a breath apart in tone, a crease between them
        xs = [0] + [x * W for x in folds_x] + [W]
        ys = [0] + [y * H for y in folds_y] + [H]
        for i in range(len(xs) - 1):
            for j in range(len(ys) - 1):
                tone = r.choice(['rgba(255,240,205,0.06)', 'rgba(90,55,20,0.05)', 'rgba(255,240,205,0.03)', 'rgba(90,55,20,0.08)'])
                self.add('paper', '<rect x="%s" y="%s" width="%s" height="%s" fill="%s"/>' % (f(xs[i]), f(ys[j]), f(xs[i + 1] - xs[i]), f(ys[j + 1] - ys[j]), tone))
        for x in folds_x:
            X = x * W
            self.add('paper', '<rect x="%s" y="0" width="%s" height="%d" fill="url(#foldV)"/>' % (f(X - 26), f(52), H))
            self.add('paper', '<line x1="%s" y1="0" x2="%s" y2="%d" stroke="rgba(70,40,15,0.28)" stroke-width="1.4"/>' % (f(X), f(X), H))
            self.add('paper', '<line x1="%s" y1="0" x2="%s" y2="%d" stroke="rgba(255,244,214,0.3)" stroke-width="2"/>' % (f(X + 2), f(X + 2), H))
        for y in folds_y:
            Y = y * H
            self.add('paper', '<rect x="0" y="%s" width="%d" height="%s" fill="url(#foldH)"/>' % (f(Y - 26), W, f(52)))
            self.add('paper', '<line x1="0" y1="%s" x2="%d" y2="%s" stroke="rgba(70,40,15,0.28)" stroke-width="1.4"/>' % (f(Y), W, f(Y)))
            self.add('paper', '<line x1="0" y1="%s" x2="%d" y2="%s" stroke="rgba(255,244,214,0.3)" stroke-width="2"/>' % (f(Y + 2), W, f(Y + 2)))
        self.defs.append('<linearGradient id="foldV" x1="0" x2="1"><stop offset="0" stop-color="#5a3812" stop-opacity="0"/><stop offset="0.48" stop-color="#5a3812" stop-opacity="0.13"/><stop offset="0.52" stop-color="#fff2d0" stop-opacity="0.1"/><stop offset="1" stop-color="#fff2d0" stop-opacity="0"/></linearGradient>')
        self.defs.append('<linearGradient id="foldH" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#5a3812" stop-opacity="0"/><stop offset="0.48" stop-color="#5a3812" stop-opacity="0.13"/><stop offset="0.52" stop-color="#fff2d0" stop-opacity="0.1"/><stop offset="1" stop-color="#fff2d0" stop-opacity="0"/></linearGradient>')

    # ---- water -----------------------------------------------------------------------------
    def lake(self, pts, name=None):
        k = self.k
        cx0 = sum(p[0] for p in pts) / len(pts)
        cy0 = sum(p[1] for p in pts) / len(pts)
        dense = sample_catmull(pts + [pts[0]], 4)[:-1]
        pts = []
        for i, (x, y) in enumerate(dense):
            dx, dy = x - cx0, y - cy0
            L = math.hypot(dx, dy) or 1
            push = self.noise.fbm(x / 260 + 3.1, y / 260 - 1.7, 3) * 110 * k
            pts.append((x + dx / L * push, y + dy / L * push))
        d = catmull(pts, closed=True)
        shape = sample_catmull(pts + [pts[0]], 10)
        cx = sum(p[0] for p in shape) / len(shape)
        cy = sum(p[1] for p in shape) / len(shape)
        cid = self.id('lakeclip')
        self.defs.append('<clipPath id="%s"><path d="%s"/></clipPath>' % (cid, d))
        gid = self.id('lakeg')
        self.defs.append('<radialGradient id="%s" cx="50%%" cy="45%%" r="60%%"><stop offset="0" stop-color="#7ea4ab"/><stop offset="0.7" stop-color="#5f8f9c"/><stop offset="1" stop-color="#456f7e"/></radialGradient>' % gid)
        self.add('water', '<path d="%s" fill="#ffffff"/>' % d)   # white is nothing under multiply: the rivers' ends vanish into the lake
        self.add('water', '<path d="%s" fill="url(#%s)" opacity="0.62" filter="url(#washy)"/>' % (d, gid))
        # water-lining: the shore drawn again and again, a little further in each time, fainter each time
        rings = []
        for i, sc in enumerate((0.975, 0.95, 0.92, 0.885, 0.845, 0.8)):
            op = (0.5, 0.42, 0.34, 0.26, 0.19, 0.13)[i]
            rings.append('<path d="%s" fill="none" stroke="%s" stroke-opacity="%s" stroke-width="%s" vector-effect="non-scaling-stroke" '
                         'transform="translate(%s,%s) scale(%s) translate(%s,%s)"/>' % (d, INK, op, f(1.3 * k), f(cx), f(cy), sc, f(-cx), f(-cy)))
        self.add('water', '<g clip-path="url(#%s)">%s</g>' % (cid, ''.join(rings)))
        self.add('water', '<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linejoin="round" filter="url(#wobble)"/>' % (d, INK, f(2.4 * k)))
        self.blocked.append(('poly', shape, 22 * k))
        # little waves on the open water
        r = self.rnd
        minx, maxx = min(p[0] for p in pts), max(p[0] for p in pts)
        miny, maxy = min(p[1] for p in pts), max(p[1] for p in pts)
        waves = []
        for _ in range(int((maxx - minx) * (maxy - miny) / (7000 * k * k))):
            x, y = r.uniform(minx, maxx), r.uniform(miny, maxy)
            if inside((x, y), shape) and dist_to_polyline((x, y), shape) > 95 * k:
                w = r.uniform(9, 16) * k
                waves.append('M%s,%s q%s,%s %s,0 q%s,%s %s,0' % (f(x - w), f(y), f(w / 2), f(-4.5 * k), f(w), f(w / 2), f(-4.5 * k), f(w)))
        self.add('water', '<path d="%s" fill="none" stroke="%s" stroke-opacity="0.42" stroke-width="%s" stroke-linecap="round"/>' % (' '.join(waves), INK, f(1.2 * k)))
        return shape

    def river(self, pts, w0, w1):
        k = self.k
        c = sample_catmull(pts, 16)
        outline = ribbon_poly(c, lambda t: (w0 + (w1 - w0) * t) * k / 2)
        d = poly(outline)
        self.add('water', '<path d="%s" fill="#6a97a2" opacity="0.66" filter="url(#washy)"/>' % d)
        self.add('water', '<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linejoin="round" filter="url(#wobble)"/>' % (d, INK, f(1.7 * k)))
        # current marks along the stream
        r = self.rnd
        marks = []
        for i in range(6, len(c) - 6, 9):
            x, y = c[i]
            a, b = c[i - 2], c[i + 2]
            ang = math.atan2(b[1] - a[1], b[0] - a[0])
            L = r.uniform(7, 13) * k
            off = r.uniform(-0.25, 0.25) * (w0 + (w1 - w0) * i / len(c)) * k
            nx, ny = -math.sin(ang), math.cos(ang)
            x, y = x + nx * off, y + ny * off
            marks.append('M%s,%s l%s,%s' % (f(x - math.cos(ang) * L / 2), f(y - math.sin(ang) * L / 2), f(math.cos(ang) * L), f(math.sin(ang) * L)))
        self.add('water', '<path d="%s" stroke="%s" stroke-opacity="0.4" stroke-width="%s" stroke-linecap="round"/>' % (' '.join(marks), INK, f(1.1 * k)))
        self.blocked.append(('line', c, (w0 + w1) / 2 * k / 2 + 12 * k))
        return c

    # ---- land ------------------------------------------------------------------------------
    def road(self, pts, walk=False, width=1.0):
        k = self.k
        c = sample_catmull(pts, 18)
        d = catmull(pts)
        self.add('land', '<path d="%s" fill="none" stroke="#9b7a4c" stroke-opacity="0.32" stroke-width="%s" stroke-linecap="round" filter="url(#washy)"/>' % (d, f(13 * k * width)))
        self.add('ink', '<path d="%s" fill="none" stroke="%s" stroke-opacity="%s" stroke-width="%s" stroke-dasharray="%s %s" stroke-linecap="round"/>' % (d, INK, '0.38' if walk else '0.8', f(2.3 * k * width), f(9 * k), f(8 * k)))
        self.blocked.append(('line', c, 16 * k * width))
        self.roads.append(c)
        if walk:
            self.walk = c
        return c

    def fields(self, cx, cy, n, spread):
        """Farmland: a few patches with furrows and a hedge of dots, kept off the roads and off each other."""
        k, r = self.k, self.rnd
        out = []
        placed = 0
        tries = 0
        while placed < n and tries < 400:
            tries += 1
            x, y = cx + r.uniform(-spread, spread) * k, cy + r.uniform(-spread * 0.55, spread * 0.55) * k
            w, h = r.uniform(80, 130) * k, r.uniform(46, 74) * k
            if self.is_blocked((x, y), max(w, h) * 0.55):
                continue
            a = r.uniform(-14, 14)
            fid = self.id('field')
            self.defs.append('<clipPath id="%s"><rect x="%s" y="%s" width="%s" height="%s"/></clipPath>' % (fid, f(-w / 2), f(-h / 2), f(w), f(h)))
            step = 6.5 * k
            rot = r.choice([0, 90])
            lines = ''.join('M%s,%s L%s,%s ' % (f(-w), f(yy), f(w), f(yy)) for yy in [-h + i * step for i in range(int(2 * h / step) + 2)])
            tint = r.choice(['#b4a15b', '#a7a35f', '#c2a865', '#9c9a5c'])
            hedge = []
            per = 2 * (w + h)
            for i in range(int(per / (7 * k))):
                t = i * 7 * k
                if t < w: px, py = -w / 2 + t, -h / 2
                elif t < w + h: px, py = w / 2, -h / 2 + (t - w)
                elif t < 2 * w + h: px, py = w / 2 - (t - w - h), h / 2
                else: px, py = -w / 2, h / 2 - (t - 2 * w - h)
                hedge.append('M%s,%s h0.01' % (f(px), f(py)))
            out.append('<g transform="translate(%s,%s) rotate(%s)">'
                       '<rect x="%s" y="%s" width="%s" height="%s" fill="%s" opacity="0.38"/>'
                       '<g clip-path="url(#%s)"><path d="%s" transform="rotate(%s)" stroke="%s" stroke-opacity="0.2" stroke-width="%s"/></g>'
                       '<path d="%s" stroke="#3e4a22" stroke-opacity="0.75" stroke-width="%s" stroke-linecap="round"/></g>'
                       % (f(x), f(y), f(a), f(-w / 2), f(-h / 2), f(w), f(h), tint, fid, lines, rot, INK, f(1 * k), ' '.join(hedge), f(3.6 * k)))
            self.blocked.append(('circle', (x, y), max(w, h) * 0.6))
            placed += 1
        self.add('land', '<g filter="url(#wobble)">%s</g>' % ''.join(out))

    def hills(self, mask):
        k, r = self.k, self.rnd
        out = []
        for (x, y) in poisson(self.W, self.H, 95 * k, r):
            if not mask(x, y) or self.is_blocked((x, y), 30 * k):
                continue
            w = r.uniform(34, 58) * k
            h = w * r.uniform(0.35, 0.5)
            out.append('<path d="M%s,%s q%s,%s %s,0" fill="#b89664" fill-opacity="0.25" stroke="%s" stroke-width="%s" stroke-linecap="round"/>' % (
                f(x - w / 2), f(y), f(w / 2), f(-h * 2), f(w), INK, f(1.6 * k)))
            hatch = ''.join('M%s,%s l%s,%s ' % (f(x + w * t), f(y - h * (1 - (2 * t) ** 2) * 0.9), f(2.5 * k), f(h * 0.45)) for t in (0.12, 0.22, 0.32, 0.4))
            out.append('<path d="%s" stroke="%s" stroke-opacity="0.55" stroke-width="%s" stroke-linecap="round"/>' % (hatch, INK, f(1.1 * k)))
            self.blocked.append(('circle', (x, y - h / 2), w * 0.55))
        self.add('land', '<g filter="url(#wobble)">%s</g>' % ''.join(out))

    def mountains(self, ridge, n, size):
        """A range: overlapping peaks drawn back to front, a lit face and a hachured shadow face, old snow on the tops."""
        k, r = self.k, self.rnd
        line = sample_catmull(ridge, 30)
        items = []
        for row in range(2):
            for i in range(n):
                t = (i + r.uniform(-0.35, 0.35) + row * 0.5) / max(1, n - 1)
                idx = min(len(line) - 1, max(0, int(t * (len(line) - 1))))
                x, y = line[idx]
                s = size * r.uniform(0.6, 1.15) * k * (0.78 if row == 0 else 1.0)
                y += (-0.28 if row == 0 else 0.06) * size * k + r.uniform(-0.08, 0.08) * s
                items.append((y, x, s))
        items.sort()
        out = []
        for y, x, s in items:
            h = s * r.uniform(0.7, 1.0)
            px = x + r.uniform(-0.15, 0.15) * s
            L = (x - s * 0.6, y)
            R = (x + s * 0.6, y)
            P = (px, y - h)
            # a jagged ridge on each side
            def jag(a, b, n_):
                pts_ = [a]
                for j in range(1, n_):
                    t = j / n_
                    pts_.append((a[0] + (b[0] - a[0]) * t + r.uniform(-0.03, 0.03) * s, a[1] + (b[1] - a[1]) * t + r.uniform(-0.04, 0.04) * s))
                pts_.append(b)
                return pts_
            left = jag(L, P, 4)
            right = jag(P, R, 4)
            mid = (px + s * 0.1, y)
            spine = jag(P, mid, 3)
            out.append('<path d="%s" fill="#c9b186"/>' % poly(left + spine[1:][::-1]))
            out.append('<path d="%s" fill="#86704f"/>' % poly(right + [mid] + spine[::-1][1:-1]))
            hs = []
            for j in range(1, 10):
                t = j / 10
                ax, ay = P[0] + (R[0] - P[0]) * t, P[1] + (R[1] - P[1]) * t
                hs.append('M%s,%s L%s,%s' % (f(ax), f(ay), f(ax - (ax - mid[0]) * 0.5), f(ay + (y - ay) * 0.6)))
            out.append('<path d="%s" stroke="%s" stroke-opacity="0.55" stroke-width="%s" stroke-linecap="round"/>' % (' '.join(hs), INK, f(1 * k)))
            out.append('<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (poly(left + right[1:], closed=False), INK, f(1.8 * k)))
            out.append('<path d="%s" fill="none" stroke="%s" stroke-opacity="0.6" stroke-width="%s"/>' % (poly(spine, closed=False), INK, f(1.1 * k)))
            cap = poly([(P[0] - s * 0.12, P[1] + h * 0.2), (P[0] - s * 0.05, P[1] + h * 0.15), P, (P[0] + s * 0.07, P[1] + h * 0.13), (P[0] + s * 0.12, P[1] + h * 0.22), (P[0] + s * 0.02, P[1] + h * 0.27)])
            out.append('<path d="%s" fill="#f1e3c3" fill-opacity="0.8"/>' % cap)
            self.blocked.append(('circle', (x, y - h / 2), s * 0.62))
        self.add('land', '<g filter="url(#wobble)">%s</g>' % ''.join(out))

    def is_blocked(self, p, pad=0):
        for kind, data, *rest in self.blocked:
            if kind == 'circle':
                (cx, cy), rad = data, rest[0]
                if (p[0] - cx) ** 2 + (p[1] - cy) ** 2 < (rad + pad) ** 2:
                    return True
            elif kind == 'line':
                if dist_to_polyline(p, data) < rest[0] + pad:
                    return True
            elif kind == 'poly':
                if inside(p, data) or dist_to_polyline(p, data) < rest[0] + pad:
                    return True
            elif kind == 'rect':
                x0, y0, x1, y1 = data
                if x0 - pad <= p[0] <= x1 + pad and y0 - pad <= p[1] <= y1 + pad:
                    return True
        return False

    def forest(self, density):
        """density(x, y) in 0..1: where trees stand. A pine or a broadleaf by a second noise; drawn back to front."""
        k, r = self.k, self.rnd
        pts = poisson(self.W, self.H, 13.5 * k, r)
        trees = []
        for (x, y) in pts:
            d = density(x, y)
            if d <= 0 or r.random() > d:
                continue
            if self.is_blocked((x, y), 4 * k):
                continue
            kind = 'pine' if self.noise.fbm(x / 700 + 7.3, y / 700 - 2.1, 2) > -0.05 else 'oak'
            s = r.uniform(19, 28) * k * (1.0 if kind == 'pine' else 0.9)
            trees.append((y, x, s, kind))
        trees.sort()
        body, shade, outline, trunks, lights = [], [], [], [], []
        for y, x, s, kind in trees:
            if kind == 'pine':
                h, w = s * 1.35, s * 0.62
                tiers = 3
                left, right = [], []
                for t in range(tiers + 1):
                    yy = y - h + h * t / tiers
                    ww = w * (0.18 + 0.82 * t / tiers)
                    left.append((x - ww * 0.55, yy + h * 0.06))
                    left.append((x - ww * 0.95, yy + h / tiers * 0.98)) if t < tiers else None
                    right.append((x + ww * 0.55, yy + h * 0.06))
                    right.append((x + ww * 0.95, yy + h / tiers * 0.98)) if t < tiers else None
                pts_ = [(x, y - h * 1.04)] + left[:-1] + [(x - w * 0.95, y - h * 0.02), (x + w * 0.95, y - h * 0.02)] + right[:-1][::-1]
                d = poly(pts_)
                body.append(d)
                shade.append(poly([(x, y - h * 1.04)] + [(x + w * 0.95, y - h * 0.02), (x + w * 0.1, y - h * 0.02)]))
                lights.append('M%s,%s L%s,%s' % (f(x - w * 0.1), f(y - h * 0.9), f(x - w * 0.55), f(y - h * 0.25)))
                outline.append(d)
                trunks.append('M%s,%s l0,%s' % (f(x), f(y - h * 0.02), f(s * 0.22)))
            else:
                rad = s * 0.5
                cx, cy = x, y - s * 0.62
                bumps = []
                nb = 7
                for i in range(nb):
                    a = -math.pi / 2 + i * math.tau / nb + r.uniform(-0.15, 0.15)
                    rr = rad * r.uniform(0.82, 1.0)
                    bumps.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr * 0.92))
                d = catmull(bumps, closed=True)
                body.append(d)
                shade.append('M%s,%s A%s,%s 0 0 1 %s,%s A%s,%s 0 0 0 %s,%s Z' % (
                    f(cx + rad * 0.15), f(cy - rad * 0.9), f(rad), f(rad), f(cx - rad * 0.1), f(cy + rad * 0.95), f(rad * 0.8), f(rad * 0.9), f(cx + rad * 0.15), f(cy - rad * 0.9)))
                outline.append(d)
                lights.append('M%s,%s a%s,%s 0 0 1 %s,%s' % (f(cx - rad * 0.55), f(cy - rad * 0.05), f(rad * 0.6), f(rad * 0.6), f(rad * 0.5), f(-rad * 0.55)))
                trunks.append('M%s,%s l0,%s' % (f(x), f(cy + rad * 0.85), f(s * 0.32)))
        self.add('trees', '<g filter="url(#wobble)">'
                 '<path d="%s" fill="#55632f" fill-opacity="0.85"/>'
                 '<path d="%s" fill="#222a12" fill-opacity="0.5"/>'
                 '<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linecap="round"/>'
                 '<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>'
                 '<path d="%s" fill="none" stroke="#c9d08a" stroke-opacity="0.45" stroke-width="%s" stroke-linecap="round"/>'
                 '</g>' % (' '.join(body), ' '.join(shade), ' '.join(trunks), INK, f(1.6 * k), ' '.join(outline), INK, f(1.25 * k), ' '.join(lights), f(2 * k)))
        return len(trees)

    # ---- buildings ---------------------------------------------------------------------------
    def window(self, x, y, w, h, lit, out):
        k = self.k
        arch = 'M%s,%s L%s,%s A%s,%s 0 0 1 %s,%s L%s,%s Z' % (f(x - w / 2), f(y + h / 2), f(x - w / 2), f(y - h / 2 + w / 2), f(w / 2), f(w / 2), f(x + w / 2), f(y - h / 2 + w / 2), f(x + w / 2), f(y + h / 2))
        if lit:
            out.append('<path d="%s" fill="%s" stroke="%s" stroke-width="%s"/>' % (arch, GLOW, INK, f(0.9 * k)))
            self.lit.append((x, y, max(w, h)))
        else:
            out.append('<path d="%s" fill="#3a2716" stroke="%s" stroke-width="%s"/>' % (arch, INK, f(0.8 * k)))

    def tower(self, x, base, w, h, roof='slate', roof_h=None, lit=0.6, flag=False, crenel=False, out=None):
        k, r = self.k, self.rnd
        out = out if out is not None else []
        top = base - h
        e = w * 0.09  # perspective of the round
        body = 'M%s,%s L%s,%s Q%s,%s %s,%s L%s,%s Q%s,%s %s,%s Z' % (
            f(x - w / 2), f(base), f(x - w / 2), f(top), f(x), f(top + e), f(x + w / 2), f(top), f(x + w / 2), f(base), f(x), f(base + e), f(x - w / 2), f(base))
        out.append('<path d="%s" fill="url(#stoneG)" stroke="%s" stroke-width="%s"/>' % (body, INK, f(1.7 * k)))
        # courses of stone
        courses = []
        n = max(2, int(h / (34 * k)))
        for i in range(1, n):
            yy = top + h * i / n
            courses.append('M%s,%s Q%s,%s %s,%s' % (f(x - w / 2), f(yy), f(x), f(yy + e), f(x + w / 2), f(yy)))
        out.append('<path d="%s" fill="none" stroke="%s" stroke-opacity="0.28" stroke-width="%s"/>' % (' '.join(courses), INK, f(1 * k)))
        # shadow hatching on the right
        hat = ''.join('M%s,%s L%s,%s ' % (f(x + w * t), f(top + e * 0.7), f(x + w * t), f(base + e * 0.7)) for t in (0.3, 0.37, 0.43))
        out.append('<path d="%s" stroke="%s" stroke-opacity="0.35" stroke-width="%s"/>' % (hat, INK, f(1 * k)))
        # windows
        ww, wh = max(5 * k, w * 0.15), max(9 * k, w * 0.27)
        rows = max(1, int((h - wh * 1.5) / (wh * 2.1)))
        cols = 1 if w < 52 * k else 2
        for i in range(rows):
            yy = top + wh * 1.3 + i * (h - wh * 2.2) / max(1, rows - 0.5)
            for c in range(cols):
                xx = x - (cols - 1) * w * 0.17 + c * w * 0.34 - w * 0.04
                self.window(xx, yy, ww, wh, r.random() < lit, out)
        if crenel:
            cw = w * 1.14
            ch = 10 * k
            out.append('<path d="M%s,%s L%s,%s L%s,%s L%s,%s Z" fill="url(#stoneG)" stroke="%s" stroke-width="%s"/>' % (
                f(x - cw / 2), f(top + ch * 0.6), f(x - cw / 2), f(top - ch), f(x + cw / 2), f(top - ch), f(x + cw / 2), f(top + ch * 0.6), INK, f(1.5 * k)))
            m = 5
            for i in range(m):
                mx = x - cw / 2 + cw * (i + 0.5) / m
                out.append('<rect x="%s" y="%s" width="%s" height="%s" fill="url(#stoneG)" stroke="%s" stroke-width="%s"/>' % (f(mx - cw / m * 0.28), f(top - ch * 1.75), f(cw / m * 0.56), f(ch * 0.78), INK, f(1.2 * k)))
            top = top - ch * 1.75
        if roof:
            rh = roof_h if roof_h else w * 1.55
            rw = w * (0.66 if not crenel else 0.6)
            fill = {'slate': 'url(#slateG)', 'red': 'url(#roofRed)', 'brown': 'url(#roofBrown)'}[roof]
            apex = (x, top - rh)
            cone = 'M%s,%s Q%s,%s %s,%s Q%s,%s %s,%s Q%s,%s %s,%s Z' % (
                f(x - rw), f(top), f(x - rw * 0.32), f(top - rh * 0.42), f(apex[0]), f(apex[1]),
                f(x + rw * 0.32), f(top - rh * 0.42), f(x + rw), f(top), f(x), f(top + e * 1.4), f(x - rw), f(top))
            out.append('<path d="%s" fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (cone, fill, INK, f(1.7 * k)))
            hs = ''.join('M%s,%s L%s,%s ' % (f(apex[0]), f(apex[1] + rh * 0.08), f(x + rw * t), f(top + e * 0.6)) for t in (0.25, 0.45, 0.62, 0.8))
            out.append('<path d="%s" stroke="%s" stroke-opacity="0.45" stroke-width="%s"/>' % (hs, INK, f(1 * k)))
            if flag:
                fx, fy = apex
                out.append('<path d="M%s,%s l0,%s" stroke="%s" stroke-width="%s"/>' % (f(fx), f(fy), f(-26 * k), INK, f(1.5 * k)))
                out.append('<path d="M%s,%s q%s,%s %s,%s q%s,%s %s,%s z" fill="#8f2f1d" stroke="%s" stroke-width="%s"/>' % (
                    f(fx), f(fy - 26 * k), f(10 * k), f(2 * k), f(22 * k), f(5 * k), f(-10 * k), f(3 * k), f(-22 * k), f(7 * k), INK, f(1 * k)))
        return out

    def hall(self, x0, x1, base, h, roof_h, lit=0.75, out=None):
        k, r = self.k, self.rnd
        out = out if out is not None else []
        top = base - h
        out.append('<path d="%s" fill="url(#stoneDark)" stroke="%s" stroke-width="%s"/>' % (poly([(x0, base), (x0, top), (x1, top), (x1, base)]), INK, f(1.7 * k)))
        out.append('<path d="%s" fill="url(#slateG)" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (
            poly([(x0 - 6 * k, top), (x0 + roof_h * 0.55, top - roof_h), (x1 - roof_h * 0.55, top - roof_h), (x1 + 6 * k, top)]), INK, f(1.7 * k)))
        hs = ''.join('M%s,%s l%s,%s ' % (f(x0 + (x1 - x0) * t), f(top - roof_h * 0.92), f(-6 * k), f(roof_h * 0.85)) for t in [i / 14 for i in range(1, 14)])
        out.append('<path d="%s" stroke="%s" stroke-opacity="0.35" stroke-width="%s"/>' % (hs, INK, f(1 * k)))
        n = max(2, int((x1 - x0) / (24 * k)))
        for i in range(n):
            xx = x0 + (x1 - x0) * (i + 0.5) / n
            self.window(xx, top + h * 0.48, 8 * k, h * 0.5, r.random() < lit, out)
        return out

    def wall(self, x0, x1, base, h, out):
        k = self.k
        top = base - h
        out.append('<path d="%s" fill="url(#stoneDark)" stroke="%s" stroke-width="%s"/>' % (poly([(x0, base), (x0, top), (x1, top), (x1, base)]), INK, f(1.6 * k)))
        m = max(2, int((x1 - x0) / (14 * k)))
        for i in range(m):
            mx = x0 + (x1 - x0) * (i + 0.5) / m
            out.append('<rect x="%s" y="%s" width="%s" height="%s" fill="url(#stoneDark)" stroke="%s" stroke-width="%s"/>' % (f(mx - 4 * k), f(top - 8 * k), f(8 * k), f(8 * k), INK, f(1.1 * k)))
        return out

    def crag(self, cx, top, half_w, depth):
        """The rock a castle stands on: its shoulders under the walls, its slopes spreading wider as they fall into the
        land, a lit face and a shadowed one, cracks and strata. Drawn on the land layer, so the forest grows over its foot."""
        k, r = self.k, self.rnd
        n = 9
        top_pts = [(cx - half_w + 2 * half_w * i / (n - 1), top + r.uniform(-4, 6) * k) for i in range(n)]
        right = [(cx + half_w * (1.0 + 0.4 * t), top + depth * t + r.uniform(-0.05, 0.05) * depth) for t in (0.25, 0.5, 0.75, 1.0)]
        bottom = []
        m = 10
        for i in range(1, m):
            t = i / m
            x = cx + half_w * 1.4 - 2 * half_w * 1.4 * t
            y = top + depth * (1.0 + 0.12 * math.sin(math.pi * t)) + r.uniform(-0.06, 0.06) * depth
            bottom.append((x, y))
        left = [(cx - half_w * (1.0 + 0.4 * t), top + depth * t + r.uniform(-0.05, 0.05) * depth) for t in (1.0, 0.75, 0.5, 0.25)]
        shape = top_pts + right + bottom + left
        d = catmull(shape, closed=True)
        gid = self.id('rock')
        self.defs.append('<linearGradient id="%s" x1="0" y1="0" x2="0.7" y2="1"><stop offset="0" stop-color="#b9a07a"/><stop offset="0.5" stop-color="#8e7656"/><stop offset="1" stop-color="#6e5a3e" stop-opacity="0.35"/></linearGradient>' % gid)
        cid = self.id('cragclip')
        self.defs.append('<clipPath id="%s"><path d="%s"/></clipPath>' % (cid, d))
        out = ['<path d="%s" fill="url(#%s)"/>' % (d, gid)]
        inner = []
        x = cx - half_w * 1.3 + r.uniform(10, 30) * k
        while x < cx + half_w * 1.3:
            crack = [(x, top - 4 * k)]
            yy, xx = top, x
            spread = (x - cx) / (half_w * 1.4)
            while yy < top + depth * 1.1:
                yy += r.uniform(18, 32) * k
                xx += r.uniform(-7, 7) * k + spread * 9 * k
                crack.append((xx, yy))
            wshade = r.uniform(8, 15) * k
            inner.append('<path d="%s" fill="#2a1a0c" fill-opacity="0.18"/>' % poly(crack + [(px + wshade, py) for px, py in crack[::-1]]))
            inner.append('<path d="%s" fill="none" stroke="%s" stroke-opacity="0.6" stroke-width="%s" stroke-linejoin="round"/>' % (poly(crack, closed=False), INK, f(1.2 * k)))
            x += r.uniform(28, 46) * k
        for j in range(4):
            y0 = top + depth * (0.18 + 0.2 * j) + r.uniform(-6, 6) * k
            pts_ = [(cx - half_w * 1.4 + 2.8 * half_w * i / 10, y0 + r.uniform(-7, 7) * k) for i in range(11)]
            inner.append('<path d="%s" fill="none" stroke="%s" stroke-opacity="0.2" stroke-width="%s"/>' % (catmull(pts_), INK, f(1.1 * k)))
        fade = self.id('cragfade')
        self.defs.append('<linearGradient id="%s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="0.72" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>' % fade)
        mid = self.id('cragmask')
        self.defs.append('<mask id="%s" maskContentUnits="userSpaceOnUse"><rect x="%s" y="%s" width="%s" height="%s" fill="url(#%s)"/></mask>' % (
            mid, f(cx - half_w * 1.6), f(top - 20 * k), f(half_w * 3.2), f(depth * 1.3), fade))
        out.append('<g clip-path="url(#%s)">%s</g>' % (cid, ''.join(inner)))
        # the outline: strong on the shoulders and slopes, gone where the rock meets the land
        out.append('<path d="%s" fill="none" stroke="%s" stroke-width="%s" stroke-linejoin="round" mask="url(#%s)"/>' % (d, INK, f(2 * k), mid))
        self.add('land', '<g filter="url(#wobble)">%s</g>' % ''.join(out))

    def castle(self, cx, base, s):
        """The castle on its cliff: halls, walls and towers back to front, a long bridge, every window a lamp."""
        k, r = self.k, self.rnd
        S = s * k
        out = []
        # the crag it stands on
        self.crag(cx, base, 300 * S, 210 * S)
        # back row: tall towers and the great hall
        self.tower(cx - 150 * S, base - 40 * S, 44 * S, 190 * S, 'slate', lit=0.5, out=out)
        self.tower(cx + 120 * S, base - 46 * S, 48 * S, 230 * S, 'slate', lit=0.55, flag=True, out=out)
        self.hall(cx - 120 * S, cx + 95 * S, base - 30 * S, 110 * S, 70 * S, out=out)
        self.tower(cx - 30 * S, base - 60 * S, 70 * S, 300 * S, 'slate', roof_h=150 * S, lit=0.6, flag=True, crenel=True, out=out)
        self.tower(cx + 30 * S, base - 52 * S, 40 * S, 250 * S, 'slate', roof_h=96 * S, lit=0.5, out=out)
        # middle: walls
        self.wall(cx - 250 * S, cx - 150 * S, base, 70 * S, out)
        self.wall(cx + 130 * S, cx + 250 * S, base, 64 * S, out)
        self.hall(cx - 175 * S, cx - 60 * S, base, 76 * S, 46 * S, lit=0.7, out=out)
        self.hall(cx + 40 * S, cx + 165 * S, base + 2 * S, 84 * S, 50 * S, lit=0.7, out=out)
        # front: shorter towers at the corners and the gate
        self.tower(cx - 255 * S, base + 8 * S, 46 * S, 150 * S, 'slate', lit=0.5, crenel=True, out=out)
        self.tower(cx - 100 * S, base + 10 * S, 38 * S, 120 * S, 'red', lit=0.6, out=out)
        self.tower(cx + 95 * S, base + 12 * S, 42 * S, 135 * S, 'slate', lit=0.6, flag=True, out=out)
        self.tower(cx + 250 * S, base + 14 * S, 50 * S, 165 * S, 'slate', lit=0.5, crenel=True, out=out)
        gx = cx - 5 * S
        out.append('<path d="M%s,%s L%s,%s A%s,%s 0 0 1 %s,%s L%s,%s Z" fill="#2c1d10" stroke="%s" stroke-width="%s"/>' % (
            f(gx - 16 * S), f(base + 4 * S), f(gx - 16 * S), f(base - 22 * S), f(16 * S), f(16 * S), f(gx + 16 * S), f(base - 22 * S), f(gx + 16 * S), f(base + 4 * S), INK, f(1.6 * k)))
        self.add('built', '<g filter="url(#wobble)">%s</g>' % ''.join(out))
        # the big warm haze of a castle with every lamp lit
        self.add('light', '<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="url(#haloG)"/>' % (f(cx), f(base - 120 * S), f(420 * S), f(300 * S)))
        self.blocked.append(('rect', (cx - 310 * S, base - 420 * S, cx + 300 * S, base + 120 * S)))
        return (cx, base)

    def keep(self, cx, base, s, name_top=None):
        """A smaller castle: a keep and two towers on a mound."""
        k, r = self.k, self.rnd
        S = s * k
        out = []
        self.crag(cx, base + 6 * S, 118 * S, 80 * S)
        self.tower(cx - 55 * S, base - 6 * S, 34 * S, 110 * S, 'red', lit=0.55, out=out)
        self.wall(cx - 55 * S, cx + 55 * S, base + 4 * S, 46 * S, out)
        self.tower(cx + 5 * S, base - 14 * S, 52 * S, 150 * S, 'red', roof_h=82 * S, lit=0.6, flag=True, crenel=True, out=out)
        self.tower(cx + 58 * S, base + 2 * S, 32 * S, 96 * S, 'red', lit=0.55, out=out)
        self.add('built', '<g filter="url(#wobble)">%s</g>' % ''.join(out))
        self.add('light', '<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="url(#haloG)"/>' % (f(cx), f(base - 60 * S), f(190 * S), f(150 * S)))
        self.blocked.append(('rect', (cx - 125 * S, base - 250 * S, cx + 125 * S, base + 50 * S)))

    def house(self, x, y, s, roof, lit, out, sign=False):
        k = self.k
        w, h = 26 * s * k, 18 * s * k
        d = 11 * s * k
        rh = 14 * s * k
        # front, side, roof
        out.append('<path d="%s" fill="#cdb48a" stroke="%s" stroke-width="%s"/>' % (poly([(x - w / 2, y), (x - w / 2, y - h), (x + w / 2, y - h), (x + w / 2, y)]), INK, f(1.3 * k)))
        out.append('<path d="%s" fill="#93784f" stroke="%s" stroke-width="%s"/>' % (poly([(x + w / 2, y), (x + w / 2, y - h), (x + w / 2 + d, y - h - d * 0.45), (x + w / 2 + d, y - d * 0.45)]), INK, f(1.3 * k)))
        fill = {'red': 'url(#roofRed)', 'brown': 'url(#roofBrown)', 'slate': 'url(#slateG)'}[roof]
        out.append('<path d="%s" fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (poly([(x - w / 2 - 3 * k, y - h), (x - w * 0.1, y - h - rh), (x + w / 2 + d - w * 0.1, y - h - rh - d * 0.45), (x + w / 2 + d + 2 * k, y - h - d * 0.45)]), fill, INK, f(1.3 * k)))
        out.append('<rect x="%s" y="%s" width="%s" height="%s" fill="#8d7556" stroke="%s" stroke-width="%s"/>' % (f(x + w * 0.12), f(y - h - rh * 1.05), f(4 * s * k), f(9 * s * k), INK, f(1 * k)))
        self.window(x - w * 0.22, y - h * 0.55, 6 * s * k, 7 * s * k, lit, out)
        self.window(x + w * 0.2, y - h * 0.55, 6 * s * k, 7 * s * k, lit and self.rnd.random() < 0.7, out)
        if sign:
            sx, sy = x - w / 2 - 4 * k, y - h * 0.8
            out.append('<path d="M%s,%s l%s,0" stroke="%s" stroke-width="%s"/>' % (f(sx), f(sy), f(-12 * k), INK, f(1.4 * k)))
            out.append('<rect x="%s" y="%s" width="%s" height="%s" rx="%s" fill="#e7c477" stroke="%s" stroke-width="%s"/>' % (f(sx - 14 * k), f(sy + 2 * k), f(11 * k), f(9 * k), f(1.5 * k), INK, f(1.1 * k)))

    def village(self, cx, cy, n, spread, tavern=False):
        k, r = self.k, self.rnd
        spots = []
        tries = 0
        while len(spots) < n and tries < 600:
            tries += 1
            a = r.random() * math.tau
            d = math.sqrt(r.random()) * spread * k
            p = (cx + math.cos(a) * d, cy + math.sin(a) * d * 0.6)
            if any((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 < (34 * k) ** 2 for q in spots):
                continue
            if any(dist_to_polyline(p, rd) < 14 * k for rd in self.roads):
                continue
            spots.append(p)
        if tavern:
            spots.append((cx, cy))
        spots.sort(key=lambda p: p[1])
        out = []
        for p in spots:
            big = tavern and p == (cx, cy)
            self.house(p[0], p[1], 1.35 if big else r.uniform(0.85, 1.1), r.choice(['red', 'brown', 'red', 'slate']), r.random() < 0.8 or big, out, sign=big)
        self.add('built', '<g filter="url(#wobble)">%s</g>' % ''.join(out))
        self.add('light', '<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="url(#haloG)"/>' % (f(cx), f(cy - 10 * k), f(spread * 1.6 * k), f(spread * 1.1 * k)))
        self.blocked.append(('circle', (cx, cy - 12 * k), spread * 1.15 * k))

    def bridge(self, a, b, arches=5):
        k = self.k
        (x0, y0), (x1, y1) = a, b
        L = math.hypot(x1 - x0, y1 - y0)
        ang = math.degrees(math.atan2(y1 - y0, x1 - x0))
        hgt = 26 * k
        parts = ['<path d="M0,0 L%s,0 L%s,%s L0,%s Z" fill="url(#stoneDark)" stroke="%s" stroke-width="%s"/>' % (f(L), f(L), f(hgt), f(hgt), INK, f(1.6 * k))]
        aw = L / arches
        for i in range(arches):
            ax = i * aw
            parts.append('<path d="M%s,%s L%s,%s A%s,%s 0 0 1 %s,%s L%s,%s Z" fill="#3b2a18" fill-opacity="0.45" stroke="%s" stroke-width="%s"/>' % (
                f(ax + aw * 0.14), f(hgt), f(ax + aw * 0.14), f(hgt * 0.62), f(aw * 0.36), f(hgt * 0.42), f(ax + aw * 0.86), f(hgt * 0.62), f(ax + aw * 0.86), f(hgt), INK, f(1.1 * k)))
        parts.append('<path d="M0,%s L%s,%s" stroke="%s" stroke-width="%s"/>' % (f(-5 * k), f(L), f(-5 * k), INK, f(1.4 * k)))
        posts = ' '.join('M%s,%s l0,%s' % (f(i * L / 16), f(-5 * k), f(5 * k)) for i in range(17))
        parts.append('<path d="%s" stroke="%s" stroke-width="%s"/>' % (posts, INK, f(1.1 * k)))
        self.add('built', '<g filter="url(#wobble)" transform="translate(%s,%s) rotate(%s)">%s</g>' % (f(x0), f(y0), f(ang), ''.join(parts)))

    def ship(self, x, y, s, flip=False):
        k = self.k
        S = s * k
        sx = -1 if flip else 1
        g = []
        g.append('<path d="M%s,0 Q0,%s %s,0 L%s,%s Q0,%s %s,%s Z" fill="#7b5a36" stroke="%s" stroke-width="%s"/>' % (
            f(-34 * S), f(14 * S), f(34 * S), f(28 * S), f(9 * S), f(18 * S), f(-28 * S), f(9 * S), INK, f(1.5 * k)))
        g.append('<path d="M0,0 L0,%s M%s,%s L%s,%s" stroke="%s" stroke-width="%s"/>' % (f(-62 * S), f(-16 * S), f(-4 * S), f(-16 * S), f(-44 * S), INK, f(1.4 * k)))
        g.append('<path d="M2,%s Q%s,%s 2,%s Z" fill="#efe2c2" stroke="%s" stroke-width="%s"/>' % (f(-58 * S), f(30 * S), f(-34 * S), f(-8 * S), INK, f(1.3 * k)))
        g.append('<path d="M%s,%s Q%s,%s %s,%s Z" fill="#e9d9b5" stroke="%s" stroke-width="%s"/>' % (f(-15 * S), f(-42 * S), f(4 * S), f(-24 * S), f(-15 * S), f(-7 * S), INK, f(1.2 * k)))
        g.append('<path d="M0,%s l%s,%s l%s,%s z" fill="#8f2f1d" stroke="%s" stroke-width="%s"/>' % (f(-62 * S), f(12 * S), f(3 * S), f(-12 * S), f(4 * S), INK, f(0.9 * k)))
        g.append('<path d="M%s,%s q%s,%s %s,0 q%s,%s %s,0" fill="none" stroke="%s" stroke-opacity="0.5" stroke-width="%s"/>' % (
            f(-40 * S), f(14 * S), f(8 * S), f(-5 * S), f(16 * S), f(8 * S), f(-5 * S), f(16 * S), INK, f(1.1 * k)))
        self.add('built', '<g filter="url(#wobble)" transform="translate(%s,%s) scale(%s,1)">%s</g>' % (f(x), f(y), sx, ''.join(g)))

    def compass(self, cx, cy, R):
        k = self.k
        R *= k
        g = []
        g.append('<circle r="%s" fill="#e8d3a4" fill-opacity="0.45" stroke="%s" stroke-width="%s"/>' % (f(R * 0.98), INK, f(1.6 * k)))
        g.append('<circle r="%s" fill="none" stroke="%s" stroke-width="%s"/>' % (f(R * 0.9), INK, f(1 * k)))
        g.append('<circle r="%s" fill="none" stroke="%s" stroke-width="%s" stroke-dasharray="%s %s"/>' % (f(R * 0.94), INK, f(5 * k), f(1.3 * k), f(5.2 * k)))
        g.append('<circle r="%s" fill="none" stroke="%s" stroke-opacity="0.7" stroke-width="%s"/>' % (f(R * 0.42), INK, f(1 * k)))
        def star(n, r_out, r_in, rot, dark, light):
            for i in range(n):
                a = rot + i * math.tau / n
                tip = (math.cos(a) * r_out, math.sin(a) * r_out)
                l = (math.cos(a - math.pi / n) * r_in, math.sin(a - math.pi / n) * r_in)
                rr = (math.cos(a + math.pi / n) * r_in, math.sin(a + math.pi / n) * r_in)
                g.append('<path d="%s" fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (poly([(0, 0), l, tip]), light, INK, f(1.1 * k)))
                g.append('<path d="%s" fill="%s" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (poly([(0, 0), tip, rr]), dark, INK, f(1.1 * k)))
        star(16, R * 0.62, R * 0.07, -math.pi / 2 + math.pi / 16, '#6a4a2a', '#e9d6aa')
        star(8, R * 0.7, R * 0.12, -math.pi / 2 + math.pi / 8, '#4d3420', '#f0dfb6')
        star(4, R * 0.95, R * 0.16, -math.pi / 2, '#3a2412', '#f6e8c4')
        g.append('<circle r="%s" fill="#8f2f1d" stroke="%s" stroke-width="%s"/>' % (f(R * 0.06), INK, f(1 * k)))
        fs = R * 0.26
        for txt, (x, y) in (('N', (0, -R * 1.18)), ('E', (R * 1.18, 0)), ('S', (0, R * 1.18)), ('W', (-R * 1.18, 0))):
            g.append('<text x="%s" y="%s" font-family="Fell" font-size="%s" fill="%s" text-anchor="middle" dominant-baseline="central">%s</text>' % (f(x), f(y), f(fs), INK, txt))
        self.add('built', '<g transform="translate(%s,%s)" filter="url(#wobble)">%s</g>' % (f(cx), f(cy), ''.join(g)))
        self.blocked.append(('circle', (cx, cy), R * 1.35))

    def label(self, x, y, text, size, italic=True, sc=False, spacing=0.06, rotate=0, halo=True):
        k = self.k
        fam = 'FellSC' if sc else 'Fell'
        style = 'italic' if italic and not sc else 'normal'
        attrs = 'x="%s" y="%s" font-family="%s" font-style="%s" font-size="%s" letter-spacing="%sem" text-anchor="middle" transform="rotate(%s %s %s)"' % (
            f(x), f(y), fam, style, f(size * k), spacing, f(rotate), f(x), f(y))
        if halo:
            self.add('labels', '<text %s fill="none" stroke="#e6cf9c" stroke-opacity="0.75" stroke-width="%s" stroke-linejoin="round">%s</text>' % (attrs, f(size * 0.22 * k), text))
        self.add('labels', '<text %s fill="%s">%s</text>' % (attrs, INK, text))
        w = len(text) * size * 0.5 * k
        self.blocked.append(('rect', (x - w / 2, y - size * k, x + w / 2, y + size * 0.3 * k)))

    def ribbon(self, x, y, text, size):
        k = self.k
        w = (len(text) * size * 0.54 + size * 2.2) * k
        h = size * 1.55 * k
        fold = h * 0.9
        g = []
        g.append('<path d="M%s,%s l%s,%s l%s,%s l%s,0 l0,%s Z" fill="#c9ad78" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (
            f(-w / 2 - fold * 0.2), f(h * 0.25), f(-fold * 0.9), f(h * 0.05), f(fold * 0.5), f(h * 0.45), f(fold * 0.6), f(-h * 0.5), INK, f(1.4 * k)))
        g.append('<path d="M%s,%s l%s,%s l%s,%s l%s,0 l0,%s Z" fill="#c9ad78" stroke="%s" stroke-width="%s" stroke-linejoin="round"/>' % (
            f(w / 2 + fold * 0.2), f(h * 0.25), f(fold * 0.9), f(h * 0.05), f(-fold * 0.5), f(h * 0.45), f(-fold * 0.6), f(-h * 0.5), INK, f(1.4 * k)))
        g.append('<path d="M%s,%s Q0,%s %s,%s L%s,%s Q0,%s %s,%s Z" fill="#ead7ab" stroke="%s" stroke-width="%s"/>' % (
            f(-w / 2), f(-h / 2), f(-h / 2 - 8 * k), f(w / 2), f(-h / 2), f(w / 2), f(h / 2), f(h / 2 - 8 * k), f(-w / 2), f(h / 2), INK, f(1.6 * k)))
        g.append('<text x="0" y="%s" font-family="Fell" font-size="%s" fill="%s" text-anchor="middle" dominant-baseline="central">%s</text>' % (f(-2 * k), f(size * k), INK, text))
        self.add('labels', '<g transform="translate(%s,%s)" filter="url(#wobble)">%s</g>' % (f(x), f(y), ''.join(g)))
        self.blocked.append(('rect', (x - w / 2 - fold, y - h, x + w / 2 + fold, y + h)))

    def window_glows(self):
        out = []
        for x, y, s in self.lit:
            rr = s * 1.7
            out.append('<circle cx="%s" cy="%s" r="%s" fill="url(#glowg)"/>' % (f(x), f(y), f(rr)))
            out.append('<path d="M%s,%s h%s" stroke="#fff3cf" stroke-opacity="0.55" stroke-width="%s" stroke-linecap="round"/>' % (f(x - s * 0.12), f(y + s * 0.05), f(s * 0.24), f(s * 0.22)))
        self.add('light', '<g style="mix-blend-mode:screen">%s</g>' % ''.join(out))

    def svg(self, font_css):
        W, H = self.W, self.H
        L = self.layers
        return ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" viewBox="0 0 %d %d"><style>%s</style><defs>%s</defs>'
                '%s<g style="mix-blend-mode:multiply">%s%s%s%s</g><g>%s%s</g><g>%s</g>%s%s</svg>') % (
            W, H, W, H, font_css, ''.join(self.defs),
            ''.join(L['paper']), ''.join(L['wash']), ''.join(L['land']), ''.join(L['water']), ''.join(L['ink']),
            ''.join(L['trees']), ''.join(L['built']), ''.join(L['labels']), ''.join(L['night']), ''.join(L['light']))

    def night(self, cx, cy):
        """Candlelight: the whole sheet sinks toward a warm dusk, least where the lamps are (cx, cy as fractions)."""
        self.defs.append('<radialGradient id="nightG" cx="%s" cy="%s" r="85%%">'
                         '<stop offset="0" stop-color="#f4e6cb"/><stop offset="0.35" stop-color="#d8c2a0"/>'
                         '<stop offset="0.7" stop-color="#a68d6d"/><stop offset="1" stop-color="#6b5641"/></radialGradient>' % (cx, cy))
        self.add('night', '<rect width="%d" height="%d" fill="url(#nightG)" style="mix-blend-mode:multiply"/>' % (self.W, self.H))


# --------------------------------------------------------------------------------------------- the two compositions

def wide():
    """2560 x 1440 — a desktop or a phone on its side. The welcome card sits centre-low; the castle stands above it."""
    W, H = 2560, 1440
    m = Map(W, H, seed=678, k=1.0)
    m.paper([1 / 3, 2 / 3], [1 / 2])
    m.river([(2260, -40), (2190, 120), (2060, 230), (2010, 380), (2110, 520), (2070, 690), (1960, 820), (1930, 1040)], 26, 64)
    m.river([(-40, 610), (180, 660), (330, 760), (560, 800), (800, 900), (980, 1040), (1240, 1100), (1500, 1120), (1820, 1130)], 18, 40)
    lake = [(1700, 1010), (1880, 930), (2140, 900), (2400, 960), (2560, 1000), (2620, 1300), (2560, 1500), (2100, 1520), (1820, 1420), (1660, 1210)]
    m.lake(lake)
    m.castle(1010, 470, 1.02)
    m.keep(1960, 470, 0.95)
    m.road([(430, 1180), (520, 1060), (640, 990), (760, 910), (850, 760), (930, 650), (980, 560)])
    m.road([(1130, 560), (1330, 600), (1560, 560), (1770, 520), (1900, 500)])
    m.road([(430, 1180), (650, 1215), (900, 1228), (1150, 1218), (1400, 1226), (1590, 1206)], walk=True)
    m.walk_from_x = 720
    m.road([(430, 1180), (260, 1060), (150, 900), (60, 760)])
    m.bridge((1585, 585), (1800, 520), arches=6)
    m.village(430, 1170, 9, 95, tavern=True)
    m.village(1520, 1360, 6, 70)
    m.village(250, 420, 5, 60)
    m.compass(300, 230, 150)
    m.mountains([(1500, 170), (1800, 120), (2120, 120), (2500, 210)], 13, 120)
    m.mountains([(-40, 130), (160, 90), (420, 60)], 5, 110)
    m.ship(2230, 1170, 1.25)
    m.ship(2420, 1340, 0.95, flip=True)
    m.ribbon(870, 760, 'Lanternhold', 44)
    m.label(430, 1290, 'Cozy Tavern', 40)
    m.label(1960, 735, 'Emberkeep', 36)
    m.label(2230, 1080, 'Mirrormere', 46, spacing=0.2)
    m.label(560, 560, 'Whisperwood', 52, sc=True, spacing=0.28, rotate=-8)
    m.label(1900, 70, 'The Greyback Peaks', 40, sc=True, spacing=0.22)
    m.label(250, 520, 'Thornwick', 32)
    m.label(1520, 1440 - 40, 'Mill End', 30)
    m.fields(780, 1150, 7, 140)
    m.fields(1500, 1250, 5, 110)
    noise = m.noise

    def density(x, y):
        n = noise.fbm(x / 520, y / 520, 4)
        edge = 0.18 + 0.5 * max(abs(x / W - 0.5) * 2, 0) ** 1.4
        v = n * 1.6 + edge
        if 820 < x < 1760 and 640 < y < 1060:
            v -= 0.55    # the welcome card's ground: a clearing, so the card does not sit on a wall of trees
        return max(0.0, min(1.0, v))
    m.forest(density)
    m.hills(lambda x, y: density(x, y) < 0.25 and 140 < y < H - 80)
    m.night('40%', '30%')
    m.window_glows()
    return m


def tall():
    """1440 x 2560 — a phone held upright. The castle stands in the top third, above the welcome card; the lake lies
    under the card; the tavern's village and the road the footprints walk are in the lower third."""
    W, H = 1440, 2560
    m = Map(W, H, seed=679, k=1.25)
    m.paper([1 / 2], [1 / 3, 2 / 3])
    m.river([(1120, 1380), (1240, 1600), (1160, 1760), (1220, 1920), (1330, 2100), (1300, 2300), (1380, 2620)], 30, 52)
    m.river([(1500, 300), (1330, 420), (1270, 600), (1330, 780), (1260, 960), (1150, 1120)], 24, 40)
    lake = [(170, 1090), (420, 1010), (760, 990), (1080, 1030), (1290, 1110), (1330, 1290), (1210, 1420), (900, 1470), (520, 1460), (250, 1390), (130, 1240)]
    m.lake(lake)
    m.castle(700, 660, 1.0)
    m.road([(380, 2100), (330, 1960), (250, 1820), (150, 1660), (130, 1520), (90, 1420), (70, 1260)])
    m.road([(380, 2100), (620, 2160), (860, 2120), (1100, 2060), (1250, 2000)], walk=True)
    m.walk_from_x = 470
    m.road([(380, 2100), (300, 2300), (240, 2600)])
    m.road([(1000, 860), (1150, 860), (1300, 920), (1440, 900)])
    m.bridge((1160, 2020), (1330, 2000), arches=4)
    m.village(400, 2090, 8, 85, tavern=True)
    m.village(1150, 2300, 5, 65)
    m.compass(230, 300, 125)
    m.mountains([(-30, 210), (330, 150), (700, 130), (1100, 140), (1480, 210)], 11, 120)
    m.ship(820, 1290, 1.1)
    m.ship(1060, 1200, 0.8, flip=True)
    m.ribbon(700, 1000 - 70, 'Lanternhold', 44)
    m.label(400, 2210, 'Cozy Tavern', 40)
    m.label(760, 1405, 'Mirrormere', 46, spacing=0.2)
    m.label(330, 1700, 'Whisperwood', 44, sc=True, spacing=0.24, rotate=-12)
    m.label(720, 90, 'The Greyback Peaks', 36, sc=True, spacing=0.2)
    m.label(1150, 2410, 'Mill End', 32)
    m.fields(700, 2000, 6, 150)
    noise = m.noise

    def density(x, y):
        n = noise.fbm(x / 430, y / 430, 4)
        edge = 0.2 + 0.55 * max(abs(x / W - 0.5) * 2, 0) ** 1.3
        v = n * 1.6 + edge
        if 1520 < y < 1980 and 300 < x < 1140:
            v -= 0.35
        return max(0.0, min(1.0, v))
    m.forest(density)
    m.hills(lambda x, y: density(x, y) < 0.25 and 200 < y < H - 80)
    m.night('50%', '22%')
    m.window_glows()
    return m


# --------------------------------------------------------------------------------------------- what moves: the stage

def stage(m):
    """Footprints along the walking road (left, right, left …), the lamps that flicker (a few lit windows, spread out),
    in percentages of the picture, so the overlay lands on the same pixels at any size."""
    W, H = m.W, m.H
    line = m.walk
    while len(line) > 2 and line[0][0] < m.walk_from_x:
        line = line[1:]
    # resample the road at even steps
    pts = [line[0]]
    acc = 0.0
    step = 52 * m.k
    for a, b in zip(line, line[1:]):
        seg = math.hypot(b[0] - a[0], b[1] - a[1])
        while acc + seg >= step:
            t = (step - acc) / seg
            a = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            pts.append(a)
            seg = math.hypot(b[0] - a[0], b[1] - a[1])
            acc = 0.0
        acc += seg
    prints = []
    for i in range(1, min(len(pts) - 1, 19)):
        (x0, y0), (x1, y1) = pts[i - 1], pts[i + 1]
        ang = math.degrees(math.atan2(y1 - y0, x1 - x0)) + 90
        side = -1 if i % 2 else 1
        nx, ny = -(y1 - y0), (x1 - x0)
        L = math.hypot(nx, ny) or 1
        x, y = pts[i][0] + nx / L * 12 * m.k * side, pts[i][1] + ny / L * 12 * m.k * side
        prints.append({'x': round(100 * x / W, 2), 'y': round(100 * y / H, 2), 'r': round(ang, 1), 'side': 'l' if side < 0 else 'r'})
    # lamps: lit windows spread over the picture (no two within 120px)
    lamps = []
    for x, y, s in sorted(m.lit, key=lambda p: (m.rnd.random())):
        if all((x - a) ** 2 + (y - b) ** 2 > (120 * m.k) ** 2 for a, b, _ in lamps):
            lamps.append((x, y, s))
        if len(lamps) >= 9:
            break
    return {'prints': prints, 'lamps': [{'x': round(100 * x / W, 2), 'y': round(100 * y / H, 2), 's': round(100 * s * 3.2 / W, 2)} for x, y, s in lamps]}


def stage_html(name, data):
    lines = ['<div class="academy-stage academy-%s">' % name]
    for i, p in enumerate(data['prints']):
        lines.append('<i class="ac-print ac-%s" style="--x:%s%%;--y:%s%%;--r:%sdeg;--i:%d"></i>' % (p['side'], p['x'], p['y'], p['r'], i))
    for i, l in enumerate(data['lamps']):
        lines.append('<i class="ac-lamp" style="--x:%s%%;--y:%s%%;--s:%s%%;--i:%d"></i>' % (l['x'], l['y'], l['s'], i))
    lines.append('<i class="ac-mist ac-mist-1"></i><i class="ac-mist ac-mist-2"></i>')
    lines.append('<i class="ac-owl"><i class="ac-owl-a"></i><i class="ac-owl-b"></i></i>')
    lines.append('</div>')
    return '\n          '.join(lines)


def card_svg():
    """The welcome card's edge as a nine-slice border image: a parchment sheet with a scalloped, cloud-soft rim and its
    own shadow. Slices are 60px (26 of shadow outside the box, 34 of rim inside); the middle of each side is 120px and
    holds exactly four scallops, so `round` repeats it seamlessly along any length."""
    O, A, P, R = 26.0, 5.0, 30.0, 22.0
    lo, hi = O, 240 - O
    pts = []
    # top edge, left to right
    def edge_y(x):
        return lo + A - A * abs(math.sin(math.pi * (x - 60) / P))
    # corner arcs + edges sampled clockwise
    steps = 160
    def corner(cx, cy, a0):
        return [(cx + R * math.cos(a0 + (math.pi / 2) * t / 12), cy + R * math.sin(a0 + (math.pi / 2) * t / 12)) for t in range(13)]
    pts += corner(lo + R, lo + R, math.pi)
    pts += [(x, edge_y(x)) for x in [lo + R + (hi - lo - 2 * R) * i / steps for i in range(1, steps)]]
    pts += corner(hi - R, lo + R, -math.pi / 2)
    pts += [(hi - A + A * abs(math.sin(math.pi * (y - 60) / P)), y) for y in [lo + R + (hi - lo - 2 * R) * i / steps for i in range(1, steps)]]
    pts += corner(hi - R, hi - R, 0)
    pts += [(x, hi - A + A * abs(math.sin(math.pi * (x - 60) / P))) for x in [hi - R - (hi - lo - 2 * R) * i / steps for i in range(1, steps)]]
    pts += corner(lo + R, hi - R, math.pi / 2)
    pts += [(edge_y(y), y) for y in [hi - R - (hi - lo - 2 * R) * i / steps for i in range(1, steps)]]
    d = poly(pts)
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">'
            '<defs><filter id="s" x="-20%%" y="-20%%" width="140%%" height="140%%"><feGaussianBlur stdDeviation="7"/></filter>'
            '<linearGradient id="e" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ead8ae"/><stop offset="1" stop-color="#dfc89a"/></linearGradient></defs>'
            '<path d="%s" fill="#140a03" fill-opacity="0.62" transform="translate(0,6)" filter="url(#s)"/>'
            '<path d="%s" fill="#e6d2a6"/>'
            '<path d="%s" fill="none" stroke="#8a6232" stroke-opacity="0.55" stroke-width="6"/>'
            '<path d="%s" fill="none" stroke="#5a3a18" stroke-opacity="0.85" stroke-width="1.6"/>'
            '<rect x="%s" y="%s" width="%s" height="%s" rx="10" fill="none" stroke="#7a5428" stroke-opacity="0.45" stroke-width="1.2"/>'
            '</svg>') % (d, d, d, d, f(O + 18), f(O + 18), f(240 - 2 * (O + 18)), f(240 - 2 * (O + 18)))


def ivy_svg(seed, turned=False):
    """A spray of ivy for a corner of the room: a vine, its tendrils, leaves along both sides. Drawn for the top-left
    corner; the other corner is the same spray turned."""
    r = random.Random(seed)
    W = H = 340
    leaves, vines, veins = [], [], []
    def leaf(x, y, size, ang):
        base = [(0, 0), (-0.48, -0.32), (-0.24, -0.33), (-0.4, -0.72), (-0.14, -0.62), (0, -1.0), (0.14, -0.62), (0.4, -0.72), (0.24, -0.33), (0.48, -0.32)]
        ca, sa = math.cos(ang), math.sin(ang)
        pts = [(x + (px * ca - py * sa) * size, y + (px * sa + py * ca) * size) for px, py in base]
        leaves.append(catmull(pts, closed=True))
        tip = (x + (0 * ca - (-0.85) * sa) * size, y + (0 * sa + (-0.85) * ca) * size)
        veins.append('M%s,%s L%s,%s' % (f(x), f(y), f(tip[0]), f(tip[1])))
        for side in (-1, 1):
            q = (x + (side * 0.36 * ca - (-0.55) * sa) * size, y + (side * 0.36 * sa + (-0.55) * ca) * size)
            m = (x + (0 * ca - (-0.3) * sa) * size, y + (0 * sa + (-0.3) * ca) * size)
            veins.append('M%s,%s L%s,%s' % (f(m[0]), f(m[1]), f(q[0]), f(q[1])))
    def vine(points, leaf_every, size0, size1):
        c = sample_catmull(points, 20)
        vines.append(catmull(points))
        for i in range(4, len(c) - 2, leaf_every):
            x, y = c[i]
            a, b = c[i - 1], c[i + 1]
            ang = math.atan2(b[1] - a[1], b[0] - a[0])
            side = 1 if (i // leaf_every) % 2 else -1
            t = i / len(c)
            size = (size0 + (size1 - size0) * t) * r.uniform(0.8, 1.15)
            stem = (x + math.cos(ang + side * math.pi / 2) * size * 0.25, y + math.sin(ang + side * math.pi / 2) * size * 0.25)
            vines.append('M%s,%s L%s,%s' % (f(x), f(y), f(stem[0]), f(stem[1])))
            leaf(stem[0], stem[1], size, ang + side * (math.pi / 2) + math.pi / 2 + r.uniform(-0.5, 0.5))
    vine([(-10, 40), (60, 50), (120, 80), (170, 70), (230, 95), (300, 90)], 4, 42, 22)
    vine([(-10, 40), (30, 110), (40, 180), (25, 250), (45, 330)], 4, 42, 20)
    vine([(60, 50), (90, 120), (130, 150), (150, 205)], 4, 32, 18)
    vine([(30, 110), (85, 140), (100, 190)], 4, 30, 17)
    vine([(170, 70), (200, 30), (250, 20)], 4, 26, 16)
    turn = ' transform="rotate(180 %d %d)"' % (W // 2, H // 2) if turned else ''
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d"><g%s>'
            '<defs><linearGradient id="l" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4a6431"/><stop offset="1" stop-color="#1f2d13"/></linearGradient>'
            '<filter id="sh" x="-10%%" y="-10%%" width="120%%" height="120%%"><feGaussianBlur stdDeviation="3"/></filter></defs>'
            '<g transform="translate(3,5)" opacity="0.55" filter="url(#sh)"><path d="%s" fill="#000"/><path d="%s" fill="none" stroke="#000" stroke-width="5"/></g>'
            '<path d="%s" fill="none" stroke="#3b2814" stroke-width="4" stroke-linecap="round"/>'
            '<path d="%s" fill="url(#l)" stroke="#16200c" stroke-width="1.4" stroke-linejoin="round"/>'
            '<path d="%s" fill="none" stroke="#9aaa66" stroke-opacity="0.45" stroke-width="1.1" stroke-linecap="round"/>'
            '</g></svg>') % (W, H, W, H, turn, ' '.join(leaves), ' '.join(vines), ' '.join(vines), ' '.join(leaves), ' '.join(veins))


def ledger_compass_svg():
    """A faint compass printed on the ledger's sheet."""
    g = ['<circle cx="100" cy="100" r="86" fill="none" stroke="#000" stroke-width="1.6"/>',
         '<circle cx="100" cy="100" r="78" fill="none" stroke="#000" stroke-width="1"/>',
         '<circle cx="100" cy="100" r="82" fill="none" stroke="#000" stroke-width="4" stroke-dasharray="1.2 5"/>',
         '<circle cx="100" cy="100" r="34" fill="none" stroke="#000" stroke-width="1"/>']
    for i in range(16):
        a = -math.pi / 2 + i * math.tau / 16
        L = 74 if i % 4 == 0 else (56 if i % 2 == 0 else 40)
        w = 9 if i % 4 == 0 else (7 if i % 2 == 0 else 5)
        tip = (100 + math.cos(a) * L, 100 + math.sin(a) * L)
        l = (100 + math.cos(a - math.pi / 2) * w, 100 + math.sin(a - math.pi / 2) * w)
        rr = (100 + math.cos(a + math.pi / 2) * w, 100 + math.sin(a + math.pi / 2) * w)
        g.append('<path d="%s" fill="none" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/>' % poly([l, tip, rr]))
        g.append('<path d="%s" fill="#000" fill-opacity="0.55"/>' % poly([(100, 100), tip, rr]))
    g.append('<text x="100" y="9" font-family="Georgia,serif" font-size="15" text-anchor="middle" dominant-baseline="central">N</text>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -10 212 220" width="212" height="220">'
            '<g opacity="0.16" style="color:#3a2410" stroke="#3a2410" fill="#3a2410">%s</g></svg>') % ''.join(g).replace('#000', '#3a2410')


def ledger_castle_svg():
    """A small ink sketch of the castle for the foot of the ledger."""
    out = []
    def tw(x, base, w, h, rh):
        top = base - h
        out.append('M%s,%s L%s,%s L%s,%s L%s,%s' % (f(x - w / 2), f(base), f(x - w / 2), f(top), f(x + w / 2), f(top), f(x + w / 2), f(base)))
        out.append('M%s,%s Q%s,%s %s,%s Q%s,%s %s,%s' % (f(x - w * 0.62), f(top), f(x - w * 0.2), f(top - rh * 0.45), f(x), f(top - rh), f(x + w * 0.2), f(top - rh * 0.45), f(x + w * 0.62), f(top)))
        for i in range(1, int(h / 16)):
            out.append('M%s,%s l0,4' % (f(x), f(top + i * 16)))
    tw(40, 150, 18, 70, 34); tw(66, 150, 22, 96, 44); tw(96, 150, 28, 120, 58); tw(124, 150, 20, 88, 40); tw(150, 150, 18, 64, 30)
    out.append('M20,150 L172,150 M28,150 q20,-14 40,-4 q30,-14 60,-2 q24,-10 44,2')
    out.append('M70,104 L120,104 L120,150 M70,104 L70,150')
    out.append('M6,158 q40,8 90,2 q50,-6 96,6')
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 170" width="200" height="170"><path d="%s" fill="none" stroke="#3a2410" '
            'stroke-opacity="0.2" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>') % ' '.join(out)


def font_css():
    def b64(name):
        import base64
        return base64.b64encode((FONTS / name).read_bytes()).decode()
    return ("@font-face{font-family:Fell;src:url(data:font/woff2;base64,%s) format('woff2');font-style:normal}"
            "@font-face{font-family:Fell;src:url(data:font/woff2;base64,%s) format('woff2');font-style:italic}"
            "@font-face{font-family:FellSC;src:url(data:font/woff2;base64,%s) format('woff2')}") % (
        b64('im-fell-english-latin-400-normal.woff2'), b64('im-fell-english-latin-400-italic.woff2'), b64('im-fell-english-sc-latin-400-normal.woff2'))


def render(m, out_webp, keep_svg=False):
    from playwright.sync_api import sync_playwright
    from PIL import Image
    svg = m.svg(font_css())
    tmp = Path('/tmp/academy-map')
    tmp.mkdir(exist_ok=True)
    svg_path = tmp / (out_webp.stem + '.svg')
    svg_path.write_text(svg)
    html = tmp / (out_webp.stem + '.html')
    html.write_text('<!doctype html><html><body style="margin:0">%s</body></html>' % svg)
    png = tmp / (out_webp.stem + '.png')
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--no-sandbox'])
        pg = b.new_page(viewport={'width': m.W, 'height': m.H}, device_scale_factor=1)
        pg.goto('file://' + str(html))
        pg.wait_for_timeout(1500)
        pg.screenshot(path=str(png), clip={'x': 0, 'y': 0, 'width': m.W, 'height': m.H})
        b.close()
    Image.open(png).convert('RGB').save(out_webp, 'WEBP', quality=80, method=6)
    if not keep_svg:
        for q in (svg_path, html):
            q.unlink()
    return png


def main():
    keep = '--svg' in sys.argv
    OUT.mkdir(parents=True, exist_ok=True)
    stages = {}
    for name, build in (('wide', wide), ('tall', tall)):
        m = build()
        render(m, OUT / ('map-%s.webp' % name), keep)
        stages[name] = stage(m)
        print(name, 'lit windows', len(m.lit), 'prints', len(stages[name]['prints']), 'lamps', len(stages[name]['lamps']),
              os.path.getsize(OUT / ('map-%s.webp' % name)) // 1024, 'KB')
    (OUT / 'card.svg').write_text(card_svg())
    (OUT / 'ivy.svg').write_text(ivy_svg(11))
    (OUT / 'ivy-turned.svg').write_text(ivy_svg(23, turned=True))
    (OUT / 'ledger-compass.svg').write_text(ledger_compass_svg())
    (OUT / 'ledger-castle.svg').write_text(ledger_castle_svg())
    idx = REPO / 'index.html'
    s = idx.read_text()
    a, b = '<!-- academy-stage:begin -->', '<!-- academy-stage:end -->'
    if a in s and b in s:
        block = a + '\n          ' + stage_html('wide', stages['wide']) + '\n          ' + stage_html('tall', stages['tall']) + '\n          ' + b
        s = re.sub(re.escape(a) + '.*?' + re.escape(b), lambda _: block, s, flags=re.S)
        idx.write_text(s)
        print('index.html stage written')
    (Path('/tmp/academy-map') / 'stage.json').write_text(json.dumps(stages, indent=1))


if __name__ == '__main__':
    main()
