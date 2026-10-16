#!/usr/bin/env python3
"""生成「不背生词本」Bob 插件图标（256x256 RGBA PNG），仅用标准库。"""

import os
import struct
import zlib

SIZE = 256
SS = 3  # 超采样倍数

BG_TOP = (66, 109, 169)      # #426DA9
BG_BOTTOM = (35, 62, 102)    # #233E66
CARD = (255, 255, 255)
RIBBON = (228, 87, 79)       # #E4574F
BAR_DARK = (201, 212, 228)   # #C9D4E4
BAR_LIGHT = (218, 226, 238)  # #DAE2EE


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def inside_round_rect(x, y, x0, y0, x1, y1, r):
    if x < x0 or x > x1 or y < y0 or y > y1:
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    dx = x - cx
    dy = y - cy
    return dx * dx + dy * dy <= r * r


def pixel(x, y):
    # 圆角底板 + 渐变
    if not inside_round_rect(x, y, 0.5, 0.5, SIZE - 0.5, SIZE - 0.5, 57):
        return (0, 0, 0, 0)
    col = lerp(BG_TOP, BG_BOTTOM, y / SIZE)
    a = 255

    card = inside_round_rect(x, y, 46, 38, 210, 218, 22)

    if card:
        col = CARD

        # 书签丝带（顶部居中，底部 V 形缺口）
        rx0, rx1 = 112, 144
        ry0, ry1 = 38, 108
        if rx0 <= x <= rx1 and ry0 <= y <= ry1:
            notch_top = 82.0
            if y <= notch_top:
                col = RIBBON
            else:
                half = 16.0 * (1 - (y - notch_top) / (ry1 - notch_top))
                if abs(x - 128) > half:
                    col = RIBBON

        # 三条“文字”横条
        if inside_round_rect(x, y, 68, 130, 188, 142, 6):
            col = BAR_DARK
        if inside_round_rect(x, y, 68, 156, 168, 168, 6):
            col = BAR_LIGHT
        if inside_round_rect(x, y, 68, 182, 178, 194, 6):
            col = BAR_LIGHT

    return (col[0], col[1], col[2], a)


def render():
    w = SIZE * SS
    sub = bytearray(w * w * 4)
    for py in range(w):
        y = (py + 0.5) / SS
        base = py * w
        for px in range(w):
            x = (px + 0.5) / SS
            r, g, b, a = pixel(x, y)
            i = (base + px) * 4
            sub[i] = r
            sub[i + 1] = g
            sub[i + 2] = b
            sub[i + 3] = a

    out = bytearray(SIZE * SIZE * 4)
    n = SS * SS
    for oy in range(SIZE):
        for ox in range(SIZE):
            r = g = b = a = 0
            for sy in range(SS):
                row = (oy * SS + sy) * w
                for sx in range(SS):
                    i = (row + ox * SS + sx) * 4
                    alpha = sub[i + 3]
                    r += sub[i] * alpha
                    g += sub[i + 1] * alpha
                    b += sub[i + 2] * alpha
                    a += alpha
            o = (oy * SIZE + ox) * 4
            if a == 0:
                out[o:o + 4] = b"\x00\x00\x00\x00"
            else:
                out[o] = r // a
                out[o + 1] = g // a
                out[o + 2] = b // a
                out[o + 3] = a // n
    return out


def write_png(path, w, h, rgba):
    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = b"".join(
        b"\x00" + bytes(rgba[y * w * 4:(y + 1) * w * 4]) for y in range(h)
    )
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    target = os.path.join(here, "..", "src", "icon.png")
    write_png(target, SIZE, SIZE, render())
    print("written:", os.path.abspath(target))
