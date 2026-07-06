import struct
import zlib
import os

SIZE = 256
CX = CY = SIZE // 2

def make_png(pixels):
    def chunk(chunk_type, data):
        c = chunk_type + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    raw = b''
    for y in range(SIZE):
        raw += b'\x00'
        for x in range(SIZE):
            r, g, b, a = pixels[y][x]
            raw += struct.pack('BBBB', r, g, b, a)

    compressed = zlib.compress(raw)

    ihdr = struct.pack('>IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0)
    return (b'\x89PNG\r\n\x1a\n' +
            chunk(b'IHDR', ihdr) +
            chunk(b'IDAT', compressed) +
            chunk(b'IEND', b''))

def dist(x1, y1, x2, y2):
    return ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5

def line_pts(x0, y0, x1, y1):
    pts = []
    dx = abs(x1 - x0)
    dy = -abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx + dy
    while True:
        pts.append((x0, y0))
        if x0 == x1 and y0 == y1:
            break
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy
    return pts

def set_pixel(pixels, x, y, color):
    if 0 <= x < SIZE and 0 <= y < SIZE:
        pixels[y][x] = color

def draw_circle(pixels, cx, cy, r, color, thickness=1):
    for y in range(cy - r - thickness, cy + r + thickness + 1):
        for x in range(cx - r - thickness, cx + r + thickness + 1):
            d = dist(x, y, cx, cy)
            if abs(d - r) <= thickness:
                set_pixel(pixels, x, y, color)

def fill_circle(pixels, cx, cy, r, color):
    for y in range(cy - r, cy + r + 1):
        for x in range(cx - r, cx + r + 1):
            if dist(x, y, cx, cy) <= r:
                set_pixel(pixels, x, y, color)

def draw_line(pixels, x0, y0, x1, y1, color, thickness=1):
    pts = line_pts(x0, y0, x1, y1)
    for px, py in pts:
        for t in range(-thickness // 2, thickness // 2 + 1):
            for tt in range(-thickness // 2, thickness // 2 + 1):
                set_pixel(pixels, px + t, py + tt, color)

def draw_arc(pixels, cx, cy, radius, start_deg, end_deg, color, thickness=2):
    import math
    for y in range(cy - radius - thickness, cy + radius + thickness + 1):
        for x in range(cx - radius - thickness, cx + radius + thickness + 1):
            d = dist(x, y, cx, cy)
            if abs(d - radius) <= thickness:
                angle = math.degrees(math.atan2(y - cy, x - cx))
                if angle < 0:
                    angle += 360
                if start_deg <= angle <= end_deg:
                    set_pixel(pixels, x, y, color)

pixels = [[(18, 18, 22, 255) for _ in range(SIZE)] for _ in range(SIZE)]

# Clock face
draw_circle(pixels, CX, CY, 90, (239, 68, 68, 255), 6)

# Hour hand (pointing roughly to 10 o'clock)
hour_x = CX + int(50 * -0.866)
hour_y = CY + int(50 * -0.5)
draw_line(pixels, CX, CY, hour_x, hour_y, (239, 68, 68, 255), 6)

# Minute hand (pointing roughly to 2 o'clock)
min_x = CX + int(65 * 0.5)
min_y = CY + int(65 * -0.866)
draw_line(pixels, CX, CY, min_x, min_y, (239, 68, 68, 255), 4)

# Center dot
fill_circle(pixels, CX, CY, 8, (239, 68, 68, 255))

# 12 o'clock tick
draw_line(pixels, CX, CY - 88, CX, CY - 78, (239, 68, 68, 255), 3)

# Tick marks for 3, 6, 9
for angle in [0, 90, 180, 270]:
    import math
    rad = math.radians(angle)
    tx = CX + int(75 * math.cos(rad))
    ty = CY + int(75 * math.sin(rad))
    fill_circle(pixels, tx, ty, 4, (239, 68, 68, 255))

# Decorative curve (smile arc at bottom)
draw_arc(pixels, CX, CY + 10, 110, 200, 340, (251, 191, 36, 255), 4)

# Small alarm bells at top
bell_lx, bell_ly = CX - 50, CY - 115
bell_rx, bell_ry = CX + 50, CY - 115
fill_circle(pixels, bell_lx, bell_ly, 10, (239, 68, 68, 255))
fill_circle(pixels, bell_rx, bell_ry, 10, (239, 68, 68, 255))

png_data = make_png(pixels)

out_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'frontend', 'icons')
os.makedirs(out_dir, exist_ok=True)

path_256 = os.path.join(out_dir, 'icon-256.png')
with open(path_256, 'wb') as f:
    f.write(png_data)
print(f'Generated: {path_256} ({os.path.getsize(path_256)} bytes)')
