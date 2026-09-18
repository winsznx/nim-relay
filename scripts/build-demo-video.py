#!/usr/bin/env python3
"""
Builds the NIM Relay competition demo from the two raw iPhone screen recordings.

    python3 scripts/build-demo-video.py            # final 1920x1080 render
    python3 scripts/build-demo-video.py --preview  # fast 960x540 preview
    python3 scripts/build-demo-video.py --scale 2  # native 3840x2160 (4K); --scale 1.5 gives 2880x1620

Inputs: final/edit-plan.json (edit decision list, source seconds) and the two recordings it names.
Music: the app's own CC0 tracks in apps/web/public/assets/audio/music (see final/VIDEO_ASSET_LICENSES.md).
Needs ffmpeg/ffprobe and Pillow. Captions are drawn with Pillow (this ffmpeg has no drawtext), using the macOS
Avenir Next and SF Mono system fonts.

Outputs: final/NIM_Relay_Final_Demo.mp4 (presentation captions burned in), final/NIM_Relay_Final_Demo.srt,
final/NIM_Relay_Final_Demo_captioned.mp4 (same video plus a soft subtitle track).
"""
import argparse
import json
import math
import shutil
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FINAL = ROOT / 'final'
BUILD = FINAL / 'build'
MUSIC = ROOT / 'apps/web/public/assets/audio/music'
TRACKS = {'world': MUSIC / 'world-space-city.m4a', 'race': MUSIC / 'race-neon.m4a', 'ceremony': MUSIC / 'ceremony-mirrorshade.m4a'}

AVENIR = '/System/Library/Fonts/Avenir Next.ttc'
MONO = '/System/Library/Fonts/SFNSMono.ttf'
SF = '/System/Library/Fonts/SFNS.ttf'
FACE = {'bold': 0, 'demi': 2, 'medium': 5, 'regular': 7, 'heavy': 8}

W, H, FPS = 1920, 1080, 30
BIG_H, SMALL_H = 920, 600
GOLD = (245, 176, 52)
GOLD_SOFT = (245, 176, 52, 150)
INK = (241, 238, 230)
INK_SOFT = (178, 184, 202)
RADIUS_BIG, RADIUS_SMALL = 38, 26


# Layout is written in 1920x1080 units. SCALE renders every layer natively at a multiple of that (2 = 3840x2160).
SCALE = 1.0


def canvas_size() -> tuple[int, int]:
    return int(W * SCALE), int(H * SCALE)


class ScaledFont:
    """A font rendered at SCALE times its size that still measures in layout units."""

    def __init__(self, path: str, size: float, index: int = 0):
        self.real = ImageFont.truetype(path, max(1, int(round(size * SCALE))), index=index)

    def getlength(self, text: str) -> float:
        return self.real.getlength(text) / SCALE


class ScaledDraw:
    """ImageDraw that takes layout coordinates and draws them at SCALE."""

    def __init__(self, image: Image.Image):
        self.d = ImageDraw.Draw(image)

    @staticmethod
    def _xy(values):
        return [v * SCALE for v in values] if not isinstance(values[0], (tuple, list)) else [(x * SCALE, y * SCALE) for x, y in values]

    @staticmethod
    def _kw(kw: dict) -> dict:
        if 'width' in kw:
            kw['width'] = max(1, int(round(kw['width'] * SCALE)))
        return kw

    def text(self, xy, text, font, fill):
        self.d.text((xy[0] * SCALE, xy[1] * SCALE), text, font=font.real, fill=fill)

    def rectangle(self, box, **kw):
        self.d.rectangle(self._xy(box), **self._kw(kw))

    def rounded_rectangle(self, box, radius, **kw):
        self.d.rounded_rectangle(self._xy(box), radius * SCALE, **self._kw(kw))

    def ellipse(self, box, **kw):
        self.d.ellipse(self._xy(box), **self._kw(kw))

    def line(self, pts, **kw):
        self.d.line(self._xy(pts), **self._kw(kw))

    def polygon(self, pts, **kw):
        self.d.polygon(self._xy(pts), **self._kw(kw))

    def point(self, xy, fill):
        x, y = xy[0] * SCALE, xy[1] * SCALE
        self.d.rectangle([x, y, x + SCALE - 1, y + SCALE - 1], fill=fill)


def font(face: str, size: int) -> ScaledFont:
    return ScaledFont(AVENIR, size, FACE[face])


def blur(radius: float) -> ImageFilter.GaussianBlur:
    return ImageFilter.GaussianBlur(radius * SCALE)


def run(cmd: list[str]) -> None:
    subprocess.run(cmd, check=True)


def probe_size(path: Path) -> tuple[int, int]:
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', str(path)], check=True, capture_output=True, text=True).stdout.strip()
    w, h = out.split(',')
    return int(w), int(h)


# ---------------------------------------------------------------------------------------------------------- layout


def phone_box(src_size: tuple[int, int], height: int, x: int, y: int) -> dict:
    sw, sh = src_size
    width = int(round(height * sw / sh / 2)) * 2
    return {'x': x, 'y': y, 'w': width, 'h': height}


def layout_boxes(layout: str, size_a, size_b) -> dict:
    """Where each phone sits on the 1920x1080 canvas for a layout. Captions use the free column on the left."""
    top = (H - BIG_H) // 2 + 10
    small_top = (H - SMALL_H) // 2 + 30
    if layout in ('A', 'zoom'):
        return {'A': phone_box(size_a, BIG_H, 720, top), 'B': None if layout == 'zoom' else phone_box(size_b, SMALL_H, 1330, small_top), 'primary': 'A'}
    if layout in ('B', 'zoomB'):
        return {'B': phone_box(size_b, BIG_H, 720, top), 'A': None if layout == 'zoomB' else phone_box(size_a, SMALL_H, 1330, small_top), 'primary': 'B'}
    if layout == 'AB':
        return {'A': phone_box(size_a, BIG_H, 640, top), 'B': phone_box(size_b, BIG_H, 1220, top), 'primary': None}
    if layout == 'title':
        return {'A': phone_box(size_a, BIG_H, 1080, top), 'B': None, 'primary': 'solo'}
    if layout in ('solo', 'proof'):
        return {'A': phone_box(size_a, BIG_H, 720, top), 'B': phone_box(size_b, BIG_H, 720, top), 'primary': 'solo'}
    return {'A': None, 'B': None, 'primary': None}


def background() -> Image.Image:
    """Midnight canvas with a restrained blue glow and a faint star field. Deterministic."""
    bg = Image.new('RGB', canvas_size(), (6, 9, 20))
    glow = Image.new('RGB', canvas_size(), (0, 0, 0))
    d = ScaledDraw(glow)
    for r, c in ((900, (14, 26, 58)), (620, (18, 34, 76)), (380, (22, 40, 90))):
        d.ellipse([W * 0.58 - r, H * 0.5 - r * 0.8, W * 0.58 + r, H * 0.5 + r * 0.8], fill=c)
    glow = glow.filter(blur(160))
    bg = Image.blend(bg, glow, 0.85)
    stars = ScaledDraw(bg)
    seed = 7
    for _ in range(170):
        seed = (seed * 1103515245 + 12345) % (2 ** 31)
        x = seed % W
        seed = (seed * 1103515245 + 12345) % (2 ** 31)
        y = seed % H
        seed = (seed * 1103515245 + 12345) % (2 ** 31)
        a = 40 + seed % 90
        stars.point((x, y), fill=(a, a, min(255, a + 30)))
    return bg


def rounded_mask(w: int, h: int, r: int) -> Image.Image:
    m = Image.new('L', (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], r, fill=255)
    return m


def draw_frame(canvas: Image.Image, box: dict, radius: int, lit: bool) -> None:
    """Soft shadow and a hairline gold rim behind a phone recording."""
    x, y, w, h = box['x'], box['y'], box['w'], box['h']
    shadow = Image.new('RGBA', canvas_size(), (0, 0, 0, 0))
    ScaledDraw(shadow).rounded_rectangle([x - 6, y + 10, x + w + 6, y + h + 22], radius + 8, fill=(0, 0, 0, 170))
    canvas.alpha_composite(shadow.filter(blur(26)))
    if lit:
        halo = Image.new('RGBA', canvas_size(), (0, 0, 0, 0))
        ScaledDraw(halo).rounded_rectangle([x - 10, y - 10, x + w + 10, y + h + 10], radius + 10, outline=(245, 176, 52, 90), width=10)
        canvas.alpha_composite(halo.filter(blur(14)))
    rim = Image.new('RGBA', canvas_size(), (0, 0, 0, 0))
    ScaledDraw(rim).rounded_rectangle([x - 2, y - 2, x + w + 1, y + h + 1], radius + 2, outline=(245, 176, 52, 120 if lit else 55), width=2)
    canvas.alpha_composite(rim)


def tracked(draw: ImageDraw.ImageDraw, xy, text: str, f, fill, spacing: float) -> int:
    x, y = xy
    for ch in text:
        draw.text((x, y), ch, font=f, fill=fill)
        x += f.getlength(ch) + spacing
    return int(x)


def draw_label(canvas: Image.Image, box: dict, phone: str, name: str, holder: bool, live: bool) -> None:
    d = ScaledDraw(canvas)
    small = box['h'] < BIG_H
    f = font('demi', 17 if small else 19)
    y = box['y'] - (30 if small else 34)
    x = box['x'] + 4
    x = tracked(d, (x, y), f'PHONE {phone}', f, GOLD, 2.2)
    d.text((x + 10, y), f'· {name}', font=font('medium', 17 if small else 19), fill=INK_SOFT)
    tag = 'HOLDS THE BATON' if holder else ('WATCHING LIVE' if live else '')
    if tag:
        tf = font('demi', 15)
        tw = sum(tf.getlength(c) + 1.6 for c in tag)
        ty = box['y'] + box['h'] + 14
        tx = box['x'] + (box['w'] - tw) / 2
        if holder:
            d.ellipse([tx - 18, ty + 5, tx - 8, ty + 15], fill=GOLD)
        tracked(d, (tx, ty), tag, tf, GOLD if holder else INK_SOFT, 1.6)


def wrap(text: str, f, width: int) -> list[str]:
    lines, line = [], ''
    for word in text.split(' '):
        test = f'{line} {word}'.strip()
        if f.getlength(test) <= width or not line:
            line = test
        else:
            lines.append(line)
            line = word
    lines.append(line)
    return lines


def draw_caption(canvas: Image.Image, cap: dict, left: int, width: int) -> None:
    """Kicker, headline and supporting line in the free left column, bottom aligned in the lower third."""
    d = ScaledDraw(canvas)
    head_f, sub_f, kick_f = font('heavy', 54), font('medium', 27), font('demi', 19)
    head = wrap(cap['head'].upper(), head_f, width)
    sub = wrap(cap.get('sub', ''), sub_f, width) if cap.get('sub') else []
    block = (34 if cap.get('kicker') else 0) + len(head) * 62 + (14 + len(sub) * 36 if sub else 0)
    y = 700 - block // 2
    if cap.get('kicker'):
        d.rectangle([left, y + 9, left + 26, y + 11], fill=GOLD)
        tracked(d, (left + 38, y), cap['kicker'].upper(), kick_f, GOLD, 3.0)
        y += 34
    for line in head:
        d.text((left, y), line, font=head_f, fill=INK)
        y += 62
    if sub:
        y += 14
        for line in sub:
            d.text((left, y), line, font=sub_f, fill=INK_SOFT)
            y += 36


def draw_title(canvas: Image.Image) -> None:
    d = ScaledDraw(canvas)
    left = 110
    hexagon(d, left + 22, 330, 22)
    tracked(d, (left + 62, 310), 'NIM RELAY', font('heavy', 38), INK, 9)
    head_f = font('heavy', 72)
    y = 430
    for line in ('HOW FAR CAN', 'ONE NIM TRAVEL?'):
        d.text((left, y), line, font=head_f, fill=INK)
        y += 84
    d.rectangle([left, y + 28, left + 60, y + 31], fill=GOLD)
    d.text((left, y + 48), 'Catch it. Carry it. Pass it on.', font=font('medium', 32), fill=GOLD)


def hexagon(d: ImageDraw.ImageDraw, cx: float, cy: float, r: float) -> None:
    pts = [(cx + r * math.cos(math.radians(60 * i - 30)), cy + r * math.sin(math.radians(60 * i - 30))) for i in range(6)]
    d.polygon(pts, fill=GOLD)


def draw_card(canvas: Image.Image, card: dict) -> None:
    d = ScaledDraw(canvas)
    if card.get('logo'):
        hexagon(d, W / 2, 380, 40)
        f = font('heavy', 96)
        text = card['head']
        tw = sum(f.getlength(c) + 14 for c in text) - 14
        tracked(d, ((W - tw) / 2, 450), text, f, INK, 14)
        sf = font('demi', 44)
        d.text(((W - sf.getlength(card['sub'])) / 2, 600), card['sub'], font=sf, fill=GOLD)
        mf = font('medium', 26)
        d.text(((W - mf.getlength(card['small'])) / 2, 680), card['small'], font=mf, fill=INK_SOFT)
        return
    f = font('heavy', 88)
    lines = card['head'].upper().split('\n')
    y = (H - len(lines) * 104) / 2
    for i, line in enumerate(lines):
        d.text(((W - f.getlength(line)) / 2, y), line, font=f, fill=GOLD if i == len(lines) - 1 else INK)
        y += 104


def draw_proof_card(canvas: Image.Image, proof: dict, x: int, top: int, width: int) -> None:
    d = ScaledDraw(canvas)
    height = 560
    panel = Image.new('RGBA', canvas_size(), (0, 0, 0, 0))
    ScaledDraw(panel).rounded_rectangle([x, top, x + width, top + height], 28, fill=(12, 18, 36, 235), outline=(245, 176, 52, 110), width=2)
    canvas.alpha_composite(panel)
    tracked(d, (x + 34, top + 32), 'ON-CHAIN RECORD', font('demi', 18), GOLD, 3)
    d.text((x + 34, top + 62), proof['title'], font=font('heavy', 38), fill=INK)
    for i, line in enumerate(wrap(proof['subtitle'], font('medium', 19), width - 68)):
        d.text((x + 34, top + 114 + i * 26), line, font=font('medium', 19), fill=INK_SOFT)
    y = top + 190
    mono = ScaledFont(MONO, 19)
    for row in proof['rows']:
        d.line([x + 34, y - 14, x + width - 34, y - 14], fill=(60, 70, 100), width=1)
        d.text((x + 34, y), row['leg'], font=font('demi', 22), fill=GOLD)
        d.text((x + 120, y), f"{row['from']}  →  {row['to']}", font=ScaledFont(SF, 21), fill=INK)
        d.text((x + width - 34 - font('demi', 20).getlength('1 NIM'), y), '1 NIM', font=font('demi', 20), fill=GOLD)
        tx = row['tx']
        d.text((x + 120, y + 34), f'{tx[:20]}…{tx[-12:]}', font=mono, fill=INK_SOFT)
        note = 'recorded in this video' if row['recorded'] else 'earlier the same day'
        d.text((x + 120, y + 62), f'verified · {note}', font=font('medium', 17), fill=(120, 190, 150))
        y += 116


def draw_arrow(canvas: Image.Image, boxes: dict, direction: str) -> None:
    """Editorial motif between the two phones: a gold line from sender to receiver. Decoration, not app state."""
    a, b = boxes['A'], boxes['B']
    x0, x1 = a['x'] + a['w'] + 22, b['x'] - 22
    y = a['y'] + a['h'] // 2
    d = ScaledDraw(canvas)
    for i in range(int(x0), int(x1), 12):
        d.line([i, y, min(i + 6, x1), y], fill=(245, 176, 52, 170), width=3)
    tip = x1 if direction == 'AB' else x0
    s = 1 if direction == 'AB' else -1
    d.polygon([(tip, y), (tip - 16 * s, y - 10), (tip - 16 * s, y + 10)], fill=GOLD)
    f = font('demi', 15)
    text = '1 NIM'
    d.text(((x0 + x1) / 2 - f.getlength(text) / 2, y - 34), text, font=f, fill=GOLD)


# ---------------------------------------------------------------------------------------------------------- segments


def segment_duration(seg: dict) -> float:
    if seg['layout'] == 'card':
        return seg['dur']
    if 'b_in' in seg and seg.get('src') != 'A' and 'in' not in seg:
        return seg['b_out'] - seg['b_in'] + seg.get('hold', 0)
    return seg['out'] - seg['in'] + seg.get('hold', 0)


def source_times(seg: dict, offset: float) -> tuple[float | None, float | None]:
    """Start seconds in A and B. B runs `offset` seconds behind A on the same real-world clock."""
    if 'in' in seg:
        return seg['in'], seg['in'] - offset
    if 'b_in' in seg:
        return seg['b_in'] + offset, seg['b_in']
    return None, None


def build_static(seg: dict, plan: dict, sizes: dict, bg: Image.Image, idx: int) -> tuple[Path, Path, dict]:
    """Two full-canvas PNGs: the stage under the videos (background, frames, labels) and the caption layer on top."""
    layout = seg['layout']
    boxes = layout_boxes(layout, sizes['A'], sizes['B'])
    stage = bg.convert('RGBA')
    top = Image.new('RGBA', canvas_size(), (0, 0, 0, 0))
    labels = plan['labels']
    if layout == 'card':
        draw_card(top, seg['card'])
    else:
        shown = visible_phones(seg, boxes)
        for phone in shown:
            box = boxes[phone]
            primary = boxes['primary'] in (phone, 'solo', None)
            draw_frame(stage, box, RADIUS_BIG if box['h'] == BIG_H else RADIUS_SMALL, primary and seg.get('holder') == phone)
            if layout != 'title':
                draw_label(stage, box, phone, labels[phone], seg.get('holder') == phone, seg.get('live') == phone)
        if seg.get('arrow') and layout == 'AB':
            draw_arrow(stage, boxes, seg['arrow'])
        if layout in ('zoom', 'zoomB'):
            zb = zoom_box(seg, sizes, boxes)
            draw_frame(stage, zb, 24, True)
            tracked(ScaledDraw(stage), (zb['x'] + 4, zb['y'] - 32), 'NIMIQ PAY APPROVAL · ENLARGED', font('demi', 17), GOLD, 2.2)
        if layout == 'proof':
            draw_proof_card(stage, plan['proofCard'], 1240, 250, 600)
        if layout == 'title':
            draw_title(top)
        elif seg.get('caption'):
            column = min(boxes[p]['x'] for p in shown) if shown else 700
            draw_caption(top, seg['caption'], 96, column - 96 - 70)
    s, t = BUILD / f'stage_{idx:02d}.png', BUILD / f'top_{idx:02d}.png'
    stage.convert('RGB').save(s)
    top.save(t)
    return s, t, boxes


def visible_phones(seg: dict, boxes: dict) -> list[str]:
    layout = seg['layout']
    if layout in ('solo', 'title', 'proof'):
        return [seg.get('src', 'A')]
    if layout == 'zoom':
        return ['A']
    if layout == 'zoomB':
        return ['B']
    return [p for p in ('A', 'B') if boxes.get(p)]


def zoom_box(seg: dict, sizes: dict, boxes: dict) -> dict:
    phone = 'A' if seg['layout'] == 'zoom' else 'B'
    sw, sh = sizes[phone]
    z = seg['zoom']
    cw, ch = sw * z['w'], sh * z['h']
    width = 640
    height = int(round(width * ch / cw / 2)) * 2
    return {'x': 1220, 'y': (H - height) // 2 + 10, 'w': width, 'h': height, 'crop': (int(sw * z['x']), int(sh * z['y']), int(cw) // 2 * 2, int(ch) // 2 * 2), 'phone': phone}


def even(v: float) -> int:
    return int(round(v * SCALE / 2)) * 2


def mask_file(w: int, h: int, r: int) -> Path:
    path = BUILD / f'mask_{w}x{h}_{r}.png'
    if not path.exists():
        rounded_mask(w, h, r).save(path)
    return path


def render_segment(seg: dict, plan: dict, sizes: dict, bg: Image.Image, idx: int, preview: bool) -> Path:
    stage, top, boxes = build_static(seg, plan, sizes, bg, idx)
    dur = segment_duration(seg)
    out = BUILD / f'seg_{idx:02d}.mp4'
    inputs = ['-loop', '1', '-framerate', str(FPS), '-t', f'{dur:.3f}', '-i', str(stage)]
    filters = []
    base = '[0:v]'
    n = 1
    if seg['layout'] != 'card':
        a_in, b_in = source_times(seg, plan['offset'])
        sources = {'A': (ROOT / plan['sourceA'], a_in), 'B': (ROOT / plan['sourceB'], b_in)}
        hold = seg.get('hold', 0)
        clip = dur - hold
        placements = [(p, boxes[p]) for p in visible_phones(seg, boxes)]
        if seg['layout'] in ('zoom', 'zoomB'):
            zb = zoom_box(seg, sizes, boxes)
            placements.append(('zoom', zb))
        for phone, box in placements:
            box = {**box, 'x': even(box['x']), 'y': even(box['y']), 'w': even(box['w']), 'h': even(box['h']), 'rl': box['h']}
            src_phone = box.get('phone', phone) if phone == 'zoom' else phone
            path, start = sources[src_phone]
            start = max(0.0, start)
            inputs += ['-ss', f'{start:.3f}', '-t', f'{clip + 0.2:.3f}', '-i', str(path)]
            radius = int(round((24 if phone == 'zoom' else (RADIUS_BIG if box['rl'] == BIG_H else RADIUS_SMALL)) * SCALE))
            inputs += ['-loop', '1', '-i', str(mask_file(box['w'], box['h'], radius))]
            v, m = n, n + 1
            n += 2
            chain = f'[{v}:v]fps={FPS},'
            if phone == 'zoom':
                cx, cy, cw, ch = box['crop']
                chain += f'crop={cw}:{ch}:{cx}:{cy},'
            chain += f"scale={box['w']}:{box['h']}:flags=lanczos,trim=duration={clip:.3f},setpts=PTS-STARTPTS"
            if hold:
                chain += f',tpad=stop_mode=clone:stop_duration={hold:.3f}'
            dim = boxes['primary'] not in (phone, 'solo', None) and phone != 'zoom'
            if dim:
                chain += ',eq=brightness=-0.10:saturation=0.7'
            chain += f',format=rgba[v{v}];[{m}:v]format=gray[m{m}];[v{v}][m{m}]alphamerge[p{v}]'
            filters.append(chain)
            filters.append(f"{base}[p{v}]overlay={box['x']}:{box['y']}:shortest=1[b{v}]")
            base = f'[b{v}]'
    inputs += ['-loop', '1', '-framerate', str(FPS), '-t', f'{dur:.3f}', '-i', str(top)]
    filters.append(f'[{n}:v]format=rgba,fade=t=in:st=0.25:d=0.35:alpha=1[cap]')
    filters.append(f'{base}[cap]overlay=0:0,format=yuv420p' + (',scale=960:540' if preview else '') + '[out]')
    run(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', ';'.join(filters), '-map', '[out]', '-t', f'{dur:.3f}', '-r', str(FPS),
         '-c:v', 'libx264', '-preset', 'ultrafast' if preview else 'medium', '-crf', '26' if preview else '15', '-an', str(out)])
    return out


# ---------------------------------------------------------------------------------------------------------- assembly


def timeline(plan: dict) -> list[tuple[float, float]]:
    x = plan['crossfade']
    t, spans = 0.0, []
    for seg in plan['segments']:
        d = segment_duration(seg)
        spans.append((t, t + d))
        t += d - x
    return spans


def join_video(files: list[Path], plan: dict, out: Path, preview: bool, crf: int = 18, overlays: list | None = None) -> float:
    x = plan['crossfade']
    durs = [segment_duration(s) for s in plan['segments']]
    inputs = []
    for f in files:
        inputs += ['-i', str(f)]
    chain, prev, acc = [], '[0:v]', durs[0]
    for i in range(1, len(files)):
        label = f'[x{i}]'
        chain.append(f'{prev}[{i}:v]xfade=transition=fade:duration={x}:offset={acc - x:.3f}{label}')
        prev, acc = label, acc + durs[i] - x
    for k, (img, a, b) in enumerate(overlays or []):
        inputs += ['-loop', '1', '-framerate', str(FPS), '-i', str(img)]
        chain.append(f"{prev}[{len(files) + k}:v]overlay=0:0:shortest=0:eof_action=pass:enable='between(t,{a:.3f},{b:.3f})'[s{k}]")
        prev = f'[s{k}]'
    chain.append(f'{prev}trim=duration={acc:.3f},scale=in_range=pc:out_range=tv,format=yuv420p[vout]')
    run(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', ';'.join(chain), '-map', '[vout]', '-r', str(FPS),
         '-c:v', 'libx264', '-preset', 'ultrafast' if preview else 'slow', '-crf', '28' if preview else str(crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-an', str(out)])
    return acc


def build_music(plan: dict, total: float, out: Path, gain_db: float = -4.0, fades: bool = True) -> None:
    """Chapters of the app's own soundtrack: world, race, handoff ceremony, back to the world. 1 s crossfades."""
    spans = timeline(plan)
    runs = []
    for seg, (s, e) in zip(plan['segments'], spans):
        if runs and runs[-1][0] == seg['music']:
            runs[-1][2] = e
        else:
            runs.append([seg['music'], s, e])
    xf = 1.0
    inputs, parts = [], []
    offsets = {k: 0.0 for k in TRACKS}
    for i, (track, s, e) in enumerate(runs):
        length = (e - s) + (xf if i < len(runs) - 1 else 0)
        start = offsets[track]
        offsets[track] += length
        inputs += ['-stream_loop', '-1', '-i', str(TRACKS[track])]
        parts.append(f'[{i}:a]atrim=start={start:.3f}:duration={length:.3f},asetpts=PTS-STARTPTS,aformat=sample_rates=48000:channel_layouts=stereo[m{i}]')
    prev = '[m0]'
    for i in range(1, len(runs)):
        parts.append(f'{prev}[m{i}]acrossfade=d={xf}:c1=tri:c2=tri[c{i}]')
        prev = f'[c{i}]'
    fade = f',afade=t=in:d=1.2,afade=t=out:st={total - 2.5:.3f}:d=2.5' if fades else ''
    parts.append(f'{prev}volume={gain_db}dB{fade},atrim=duration={total:.3f}[a]')
    run(['ffmpeg', '-v', 'error', '-y', *inputs, '-filter_complex', ';'.join(parts), '-map', '[a]', *(['-c:a', 'pcm_s24le'] if out.suffix == '.wav' else ['-c:a', 'aac', '-b:a', '192k']), str(out)])


# ---------------------------------------------------------------------------------------------------------- narration


def loudnorm_measure(inp: Path, pre: str = '') -> dict:
    """Integrated loudness, true peak and range of a file, via loudnorm's analysis pass."""
    chain = (pre + ',' if pre else '') + 'loudnorm=print_format=json'
    err = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(inp), '-af', chain, '-f', 'null', '-'], capture_output=True, text=True).stderr
    return json.loads(err[err.rindex('{'):err.rindex('}') + 1])


def loudnorm_apply(inp: Path, out: Path, pre: str, target: float, tp: float, lra: float, extra: list[str]) -> None:
    """Two-pass EBU R128 normalisation, linear when the file allows it."""
    m = loudnorm_measure(inp, pre)
    ln = (f"loudnorm=I={target}:TP={tp}:LRA={lra}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
          f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    chain = (pre + ',' if pre else '') + ln + ',aresample=48000'
    run(['ffmpeg', '-v', 'error', '-y', '-i', str(inp), '-af', chain, *extra, str(out)])


def build_voice(vo: dict, out: Path) -> None:
    """Pause edits, then light cleanup: high-pass, gentle noise reduction and mild compression. No reverb or pitch work."""
    src = ROOT / vo['file']
    total = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(src)], check=True, capture_output=True, text=True).stdout)
    keep, t = [], 0.0
    for a, b in sorted(vo['remove']):
        if a > t:
            keep.append((t, a))
        t = b
    keep.append((t, total))
    xf = vo['joinCrossfade']
    parts = [f'[0:a]pan=mono|c0=0.5*c0+0.5*c1,aresample=48000,asplit={len(keep)}' + ''.join(f'[s{i}]' for i in range(len(keep)))]
    for i, (a, b) in enumerate(keep):
        parts.append(f'[s{i}]atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS[k{i}]')
    prev = '[k0]'
    for i in range(1, len(keep)):
        parts.append(f'{prev}[k{i}]acrossfade=d={xf}:c1=qsin:c2=qsin[j{i}]')
        prev = f'[j{i}]'
    parts.append(f'{prev}highpass=f=80,afftdn=nr=6:nf=-50,acompressor=threshold=-24dB:ratio=2:attack=10:release=180:makeup=1.5[v]')
    edited = BUILD / 'voice_edited.wav'
    run(['ffmpeg', '-v', 'error', '-y', '-i', str(src), '-filter_complex', ';'.join(parts), '-map', '[v]', '-c:a', 'pcm_s24le', str(edited)])
    loudnorm_apply(edited, out, '', vo['voiceLufs'], -2.0, 7, ['-ac', '1', '-c:a', 'pcm_s24le'])


def speech_map(voice: Path, min_pause: float) -> tuple[float, float, list[tuple[float, float]]]:
    """First word, last word and the pauses long enough to lift the music in."""
    err = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(voice), '-af', f'highpass=f=100,silencedetect=noise=-34dB:d={min_pause}', '-f', 'null', '-'], capture_output=True, text=True).stderr
    starts = [float(x) for x in __import__('re').findall(r'silence_start: ([0-9.]+)', err)]
    ends = [float(x) for x in __import__('re').findall(r'silence_end: ([0-9.]+)', err)]
    total = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(voice)], check=True, capture_output=True, text=True).stdout)
    silences = list(zip(starts, ends + [total] * (len(starts) - len(ends))))
    first = silences[0][1] if silences and silences[0][0] < 0.05 else 0.0
    last = silences[-1][0] if silences and silences[-1][1] >= total - 0.05 else total
    pauses = [(a, b) for a, b in silences if a > first and b < last]
    return first, last, pauses


def duck_envelope(vo: dict, first: float, last: float, pauses: list, total: float) -> str:
    """Music gain in dB over time: low under speech, lifted in pauses and around the narration, 250 ms ramps."""
    r = vo['rampSeconds']
    under = vo['musicUnderSpeechDb']
    windows = [(-10.0, first - 0.05, vo['musicOutsideNarrationDb'] - under), (last + 0.1, total + 10, vo['musicOutsideNarrationDb'] - under)]
    windows += [(a + 0.05, b - 0.05, vo['musicInPausesDb'] - under) for a, b in pauses if b - a >= 2 * r + 0.1]
    terms = [f'{d:.2f}*clip(min((t-({a:.3f}))/{r},(({b:.3f})-t)/{r}),0,1)' for a, b, d in windows]
    return f"pow(10,({under}+{'+'.join(terms)})/20)"


def build_narrated_mix(plan: dict, total: float, out: Path) -> dict:
    vo = plan['voiceover']
    voice = BUILD / 'voice.wav'
    build_voice(vo, voice)
    # Pauses are found on the edited voice before loudness normalisation, where the room noise sits below -34 dBFS.
    first, last, pauses = speech_map(BUILD / 'voice_edited.wav', vo['minPauseForLift'])
    bed = BUILD / 'music_bed.wav'
    build_music(plan, total, bed, gain_db=0.0, fades=False)
    envelope = duck_envelope(vo, first, last, pauses, total)
    ducked = BUILD / 'music_ducked.wav'
    run(['ffmpeg', '-v', 'error', '-y', '-i', str(bed), '-af', f"asetnsamples=480,volume='{envelope}':eval=frame,afade=t=out:st={total - 2.0:.3f}:d=2.0",
         '-c:a', 'pcm_s24le', str(ducked)])
    mix = BUILD / 'mix_premaster.wav'
    run(['ffmpeg', '-v', 'error', '-y', '-i', str(voice), '-i', str(ducked), '-filter_complex',
         f'[0:a]pan=stereo|c0=c0|c1=c0,apad=whole_dur={total:.3f}[v];[v][1:a]amix=inputs=2:normalize=0:duration=longest,atrim=duration={total:.3f}[m]',
         '-map', '[m]', '-c:a', 'pcm_s24le', str(mix)])
    master = BUILD / 'mix_master.wav'
    loudnorm_apply(mix, master, '', vo['masterLufs'], vo['masterTruePeak'] - 0.3, 11, ['-c:a', 'pcm_s24le'])
    run(['ffmpeg', '-v', 'error', '-y', '-i', str(master), '-c:a', 'aac', '-b:a', '256k', str(out)])
    return {'voice': voice, 'music': ducked, 'master': master, 'first': first, 'last': last, 'pauses': pauses}


def section_levels(stems: dict, sections: list[tuple[str, float, float]]) -> list[dict]:
    """Voice and music loudness in each checked section, measured on the separate stems."""
    rows = []
    for name, a, b in sections:
        pre = f'atrim=start={a}:end={b},asetpts=PTS-STARTPTS'
        v = loudnorm_measure(stems['voice'], pre)
        m = loudnorm_measure(stems['music'], pre)
        rows.append({'section': name, 'from': a, 'to': b, 'voiceLufs': float(v['input_i']), 'musicLufs': float(m['input_i'])})
    return rows


def write_audio_report(plan: dict, stems: dict, video: Path, out: Path) -> None:
    vo_src = ROOT / plan['voiceover']['file']
    dur = lambda f: float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(f)], check=True, capture_output=True, text=True).stdout)
    final = loudnorm_measure(video)
    peak = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(video), '-vn', '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True).stderr
    max_volume = float(__import__('re').search(r'max_volume: (-?[0-9.]+) dB', peak).group(1))
    removed = sum(b - a for a, b in plan['voiceover']['remove'])
    sections = [('Opening', 0.0, 12.0), ('Nimiq Pay and handoff', 48.0, 68.0), ('Return pass', 85.0, 93.0), ('Proof', 102.0, 111.0), ('Closing line', 111.0, dur(video))]
    rows = section_levels(stems, sections)
    lines = [
        '# NIM Relay demo: narration mix report', '',
        f'Built by `python3 scripts/build-demo-video.py --scale 2 --vo`.', '',
        '| Measure | Value |', '|---|---|',
        f'| Voiceover file | `{plan["voiceover"]["file"]}` |',
        f'| Voiceover duration, raw | {dur(vo_src):.2f} s |',
        f'| Removed (silent lead-in and pause trims, no words cut, no time-stretch) | {removed:.2f} s |',
        f'| Voiceover duration, edited | {dur(stems["voice"]):.2f} s |',
        f'| First word / last word in the final video | {stems["first"]:.2f} s / {stems["last"]:.2f} s |',
        f'| Final video duration | {dur(video):.2f} s |',
        f'| Integrated loudness | {float(final["input_i"]):.1f} LUFS (target -14) |',
        f'| True peak | {float(final["input_tp"]):.1f} dBTP (limit -1) |',
        f'| Loudness range | {float(final["input_lra"]):.1f} LU |',
        f'| Sample peak | {max_volume:.1f} dBFS |',
        f'| Clipping | {"none" if max_volume < -0.1 else "YES, peak at full scale"} |',
        '', '## Voice against music by section', '',
        'Integrated loudness of each stem over the section, measured separately before the master gain.', '',
        '| Section | Time | Voice | Music | Voice above music |', '|---|---|---|---|---|',
    ]
    for r in rows:
        lines.append(f"| {r['section']} | {r['from']:.1f}-{r['to']:.1f} s | {r['voiceLufs']:.1f} LUFS | {r['musicLufs']:.1f} LUFS | {r['voiceLufs'] - r['musicLufs']:.1f} dB |")
    lines += ['', '## Pause edits in the narration', '', '| Removed from the raw voiceover | Length |', '|---|---|']
    lines += [f'| {a:.2f}-{b:.2f} s | {b - a:.2f} s |' for a, b in plan['voiceover']['remove']]
    out.write_text('\n'.join(lines) + '\n')


# ---------------------------------------------------------------------------------------------------------- subtitles

WHISPER_MODEL = Path.home() / 'Library/Application Support/Recordly/whisper/ggml-small.bin'
HEARD_AS = {'name': 'nim', 'names': 'nim', 'nims': 'nim', 'betting': 'baton', 'beton': 'baton', 'batting': 'baton', 'bettings': 'batons', 'namek': 'nimiq', 'nimmik': 'nimiq'}


def norm(word: str) -> str:
    return ''.join(c for c in word.lower().replace('’', "'") if c.isalnum())


def script_words(script: str) -> list[str]:
    """The script as display words; hyphenated words count as one display word."""
    return script.split()


def align_narration(plan: dict, voice: Path, out: Path) -> None:
    """Times each script word against whisper.cpp word timings of the edited voice. Cached in final/narration-cues.json."""
    import difflib
    wav = BUILD / 'voice16.wav'
    run(['ffmpeg', '-v', 'error', '-y', '-i', str(voice), '-ar', '16000', '-ac', '1', str(wav)])
    run(['whisper-cli', '-m', str(WHISPER_MODEL), '-f', str(wav), '-l', 'en', '-ml', '1', '-sow', '-ojf', '-of', str(BUILD / 'voice_words'), '-np'])
    heard = []
    for seg in json.loads((BUILD / 'voice_words.json').read_text())['transcription']:
        w = norm(seg['text'])
        if w:
            heard.append((HEARD_AS.get(w, w), seg['offsets']['from'] / 1000, seg['offsets']['to'] / 1000))
    words = script_words(plan['voiceover']['script'])
    # One-NIM style words are two spoken words; compare on their parts, keep display words whole.
    parts, owner = [], []
    for i, w in enumerate(words):
        for piece in w.replace('-', ' ').split():
            parts.append(norm(piece))
            owner.append(i)
    matcher = difflib.SequenceMatcher(a=parts, b=[h[0] for h in heard], autojunk=False)
    times: list[list[float] | None] = [None] * len(words)
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            i = owner[block.a + k]
            _, a, b = heard[block.b + k]
            times[i] = [a, b] if times[i] is None else [min(times[i][0], a), max(times[i][1], b)]
    known = [i for i, t in enumerate(times) if t]
    for i in range(len(words)):
        if times[i] is None:
            prev = max((k for k in known if k < i), default=None)
            nxt = min((k for k in known if k > i), default=None)
            a = times[prev][1] if prev is not None else 0.0
            b = times[nxt][0] if nxt is not None else a + 0.4
            times[i] = [a, b]
    out.write_text(json.dumps({'words': [{'w': w, 'from': round(t[0], 3), 'to': round(t[1], 3)} for w, t in zip(words, times)],
                               'matched': len(known), 'total': len(words)}, indent=1) + '\n')


def build_cues(plan: dict, cue_file: Path, first: float, last: float) -> list[dict]:
    """Readable phrases: one cue per sentence, or balanced parts of about 44 characters, preferring breaks at commas."""
    words = json.loads(cue_file.read_text())['words']
    sentences, cur = [], []
    for w in words:
        cur.append(w)
        if w['w'][-1] in '.?!':
            sentences.append(cur)
            cur = []
    if cur:
        sentences.append(cur)
    cues = []
    for sent in sentences:
        text = ' '.join(x['w'] for x in sent)
        parts = max(1, math.ceil(len(text) / 46))
        target = len(text) / parts
        chunk, size = [], 0
        for i, w in enumerate(sent):
            chunk.append(w)
            size += len(w['w']) + 1
            remaining = len(sent) - i - 1
            at_comma = w['w'][-1] in ',:'
            if remaining and len(cues) >= 0 and ((size >= target * 0.8 and at_comma) or size >= target * 1.12) and remaining >= 2:
                cues.append(chunk)
                chunk, size = [], 0
        if chunk:
            cues.append(chunk)
    out = []
    for c in cues:
        cue = {'text': ' '.join(x['w'] for x in c), 'from': c[0]['from'], 'to': c[-1]['to']}
        # Short back-to-back sentences ("One NIM. One relay.") read better as one line than as flashes.
        if out and len(cue['text']) <= 24 and len(out[-1]['text']) <= 24 and out[-1]['text'][-1] in '.?!':
            out[-1] = {'text': f"{out[-1]['text']} {cue['text']}", 'from': out[-1]['from'], 'to': cue['to']}
        else:
            out.append(cue)
    for i, c in enumerate(out):
        c['from'] = max(0.0, c['from'] - 0.08)
        limit = out[i + 1]['from'] - 0.08 if i + 1 < len(out) else last + 0.5
        c['to'] = min(max(c['to'] + 0.25, c['from'] + 1.0), limit)
    return out


def draw_subtitle(text: str, layout: str, boxes: dict, shown: list[str]) -> Image.Image:
    """One narration line (two at most): small, off-white on a soft dark backing, low in the free column."""
    img = Image.new('RGBA', canvas_size(), (0, 0, 0, 0))
    f = font('demi', 30)
    if layout == 'card' or not shown:
        width, center = 1100, True
        left = (W - width) / 2
    else:
        column = min(boxes[p]['x'] for p in shown)
        left, width, center = 96, column - 96 - 70, False
    lines = wrap(text, f, width - 36)
    line_h = 40
    box_w = max(f.getlength(l) for l in lines) + 36
    box_h = len(lines) * line_h + 22
    bottom = 1010
    x0 = (W - box_w) / 2 if center else left
    y0 = bottom - box_h
    panel = Image.new('RGBA', canvas_size(), (0, 0, 0, 0))
    ScaledDraw(panel).rounded_rectangle([x0, y0, x0 + box_w, bottom], 14, fill=(4, 7, 16, 185))
    img.alpha_composite(panel)
    d = ScaledDraw(img)
    for k, line in enumerate(lines):
        lx = (W - f.getlength(line)) / 2 if center else x0 + 18
        d.text((lx, y0 + 9 + k * line_h), line, font=f, fill=INK)
    return img


def subtitle_overlays(plan: dict, cues: list[dict], sizes: dict) -> list[tuple[Path, float, float]]:
    spans = timeline(plan)
    overlays = []
    for n, cue in enumerate(cues):
        mid = (cue['from'] + cue['to']) / 2
        idx = max(i for i, (a, _) in enumerate(spans) if a <= mid)
        seg = plan['segments'][idx]
        boxes = layout_boxes(seg['layout'], sizes['A'], sizes['B'])
        shown = [] if seg['layout'] == 'card' else visible_phones(seg, boxes)
        path = BUILD / f'sub_{n:03d}.png'
        draw_subtitle(cue['text'], seg['layout'], boxes, shown).save(path)
        overlays.append((path, cue['from'], cue['to']))
    return overlays


def write_cue_srt(cues: list[dict], out: Path) -> None:
    lines = []
    for i, c in enumerate(cues, 1):
        lines += [str(i), f"{srt_time(c['from'])} --> {srt_time(c['to'])}", c['text'], '']
    out.write_text('\n'.join(lines))


def srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}'


def write_srt(plan: dict, out: Path) -> None:
    spans = timeline(plan)
    cues = []
    for seg, (s, e) in zip(plan['segments'], spans):
        if seg['layout'] == 'title':
            text = 'NIM RELAY\nHow far can one NIM travel?'
        elif seg['layout'] == 'card':
            card = seg['card']
            text = ' '.join(card['head'].split('\n')) + (f"\n{card['sub']}" if card.get('sub') else '')
        elif seg.get('caption'):
            cap = seg['caption']
            text = cap['head'] + (f"\n{cap['sub']}" if cap.get('sub') else '')
        else:
            continue
        if cues and cues[-1][2] == text:
            cues[-1][1] = e
        else:
            if cues:
                cues[-1][1] = min(cues[-1][1], s + 0.2)
            cues.append([s + 0.25, e, text])
    lines = []
    for i, (s, e, text) in enumerate(cues, 1):
        lines += [str(i), f'{srt_time(s)} --> {srt_time(e)}', text, '']
    out.write_text('\n'.join(lines))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--preview', action='store_true')
    parser.add_argument('--only', type=int, nargs='*', help='re-render only these segment indexes')
    parser.add_argument('--vo', action='store_true', help='mix the narration from edit-plan.json voiceover over the music')
    parser.add_argument('--subs', action='store_true', help='with --vo: burn in narration subtitles timed to the voice')
    parser.add_argument('--realign', action='store_true', help='re-run whisper.cpp to time the script against the voice')
    parser.add_argument('--crf', type=int, default=18, help='x264 quality for the final encode (lower is better, bigger)')
    parser.add_argument('--scale', type=float, default=1.0, help='1 = 1920x1080, 1.5 = 2880x1620, 2 = 3840x2160')
    args = parser.parse_args()
    global SCALE, BUILD
    SCALE = args.scale
    suffix = {1.0: '', 1.5: '_3K', 2.0: '_4K'}.get(SCALE, f'_x{SCALE:g}')
    if SCALE != 1.0:
        BUILD = FINAL / f'build{suffix}'
    plan = json.loads((FINAL / 'edit-plan.json').read_text())
    BUILD.mkdir(parents=True, exist_ok=True)
    sizes = {'A': probe_size(ROOT / plan['sourceA']), 'B': probe_size(ROOT / plan['sourceB'])}
    bg = background()
    files, rendered = [], False
    for i, seg in enumerate(plan['segments']):
        target = BUILD / f'seg_{i:02d}.mp4'
        # A narration mix reuses the rendered picture; a plain build refreshes every segment unless --only narrows it.
        if (args.only is None and not args.vo) or (args.only and i in args.only) or not target.exists():
            print(f'segment {i:02d} {seg["scene"]} ({segment_duration(seg):.1f}s)', flush=True)
            render_segment(seg, plan, sizes, bg, i, args.preview)
            rendered = True
        files.append(target)
    name = 'NIM_Relay_Preview' if args.preview else f'NIM_Relay_Final_Demo{suffix}'
    silent = BUILD / f'{name}_video.mp4'
    total = sum(segment_duration(s) for s in plan['segments']) - plan['crossfade'] * (len(plan['segments']) - 1)
    music = BUILD / 'music.m4a'
    stems, cues = None, None
    if args.vo:
        name = 'NIM_Relay_Final_Demo_VO' + ('_Subtitled' if args.subs else '')
        stems = build_narrated_mix(plan, total, music)
        if args.subs:
            cue_file = FINAL / 'narration-cues.json'
            if args.realign or not cue_file.exists():
                align_narration(plan, stems['voice'], cue_file)
            cues = build_cues(plan, cue_file, stems['first'], stems['last'])
            silent = BUILD / f'{name}_video.mp4'
            rendered = True
    else:
        build_music(plan, total, music)
    if rendered or not silent.exists():
        overlays = subtitle_overlays(plan, cues, sizes) if cues else None
        total = join_video(files, plan, silent, args.preview, args.crf, overlays)
    out = FINAL / f'{name}.mp4'
    run(['ffmpeg', '-v', 'error', '-y', '-i', str(silent), '-i', str(music), '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'copy', '-shortest', '-movflags', '+faststart', str(out)])
    srt = FINAL / f'{name}.srt'
    if cues:
        write_cue_srt(cues, srt)
    else:
        write_srt(plan, srt)
    if not args.preview:
        captioned = FINAL / f'{name}_captioned.mp4'
        run(['ffmpeg', '-v', 'error', '-y', '-i', str(out), '-i', str(srt), '-map', '0', '-map', '1', '-c', 'copy', '-c:s', 'mov_text', '-metadata:s:s:0', 'language=eng', '-movflags', '+faststart', str(captioned)])
    if stems:
        write_audio_report(plan, stems, out, FINAL / f'{name}_audio-report.md')
    print(f'{out} {total:.2f}s')


if __name__ == '__main__':
    main()
