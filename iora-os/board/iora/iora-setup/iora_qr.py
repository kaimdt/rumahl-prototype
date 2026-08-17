#!/usr/bin/env python3
"""iora_qr — minimal QR code encoder (ISO/IEC 18004), byte mode, ECC level L.

Self-contained, dependency-free implementation used by the IORA first-boot
GUI to render a scannable setup URL. Supports versions 1-10 (enough for
LAN URLs). Verified against Chrome's BarcodeDetector during development.

API:
    qr_matrix(text: str) -> list[list[int]]   # 1 = dark module
    qr_to_png(text: str, path: str, scale=8, quiet=4)  # convenience renderer
"""

from __future__ import annotations

# ── Error-correction block table (version, ECC L): (g1_blocks, g1_data,
#    g2_blocks, g2_data, ecc_per_block). Source: ISO 18004 / thonky table.
_ECC_L = {
    1: (1, 19, 0, 0, 7),
    2: (1, 34, 0, 0, 10),
    3: (1, 55, 0, 0, 15),
    4: (1, 80, 0, 0, 20),
    5: (1, 108, 0, 0, 26),
    6: (2, 68, 0, 0, 18),
    7: (2, 78, 0, 0, 20),
    8: (2, 97, 0, 0, 24),
    9: (2, 116, 0, 0, 30),
    10: (2, 68, 2, 69, 18),
}

# Alignment pattern centre coordinates per version.
_ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
}

# ── GF(256) helpers (QR uses the 0x11D primitive polynomial) ────────────────
_GF_EXP = [0] * 512
_GF_LOG = [0] * 256
_x = 1
for _i in range(255):
    _GF_EXP[_i] = _x
    _GF_LOG[_x] = _i
    _x <<= 1
    if _x & 0x100:
        _x ^= 0x11D
for _i in range(255, 512):
    _GF_EXP[_i] = _GF_EXP[_i - 255]


def _gf_mul(a: int, b: int) -> int:
    if a == 0 or b == 0:
        return 0
    return _GF_EXP[_GF_LOG[a] + _GF_LOG[b]]


def _rs_generator(degree: int) -> list:
    """Reed-Solomon generator polynomial for the given degree.
    Follows Nayuki's verified QR implementation: coefficients are stored
    highest-power first, EXCLUDING the leading term (always 1·x^degree),
    so the array has exactly `degree` entries."""
    result = [0] * (degree - 1) + [1]
    root = 1  # alpha^0 — generator = prod (x - alpha^i), i = 0..degree-1
    for _ in range(degree):
        for j in range(degree):
            result[j] = _gf_mul(result[j], root)
            if j + 1 < degree:
                result[j] ^= result[j + 1]
        root = _gf_mul(root, 0x02)
    return result


def _rs_encode(data: list, ecc_len: int) -> list:
    """Reed-Solomon remainder (ECC codewords) for a data block.
    The divisor excludes the leading term (implicitly 1), so the shift
    register is exactly `ecc_len` wide."""
    gen = _rs_generator(ecc_len)
    result = [0] * len(gen)
    for b in data:
        factor = b ^ result.pop(0)
        result.append(0)
        for i, coef in enumerate(gen):
            result[i] ^= _gf_mul(coef, factor)
    return result


def _version_for(length: int) -> int:
    for v in range(1, 11):
        g1_b, g1_d, g2_b, g2_d, _e = _ECC_L[v]
        total_data = g1_b * g1_d + g2_b * g2_d
        # byte mode: 4 mode bits + 8 count bits (v1-9) / 16 (v10)
        count_bits = 8 if v <= 9 else 16
        capacity = (total_data * 8 - 4 - count_bits) // 8
        if length <= capacity:
            return v
    raise ValueError(f"data too long for version 10 ({length} bytes)")


def _build_data_codewords(text: str, version: int) -> list:
    raw = text.encode("utf-8")
    count_bits = 8 if version <= 9 else 16
    g1_b, g1_d, g2_b, g2_d, _ = _ECC_L[version]
    total_data = g1_b * g1_d + g2_b * g2_d
    bits = []
    # mode indicator 0100 (byte)
    bits.extend([0, 1, 0, 0])
    # character count
    for i in range(count_bits - 1, -1, -1):
        bits.append((len(raw) >> i) & 1)
    # data bytes
    for b in raw:
        for i in range(7, -1, -1):
            bits.append((b >> i) & 1)
    # terminator (up to 4 zero bits)
    bits.extend([0] * min(4, total_data * 8 - len(bits)))
    # pad to byte boundary
    while len(bits) % 8:
        bits.append(0)
    # pad codewords 0xEC 0x11 ...
    pad = [0xEC, 0x11]
    idx = 0
    while len(bits) < total_data * 8:
        for i in range(7, -1, -1):
            bits.append((pad[idx % 2] >> i) & 1)
        idx += 1
    return [int("".join(str(b) for b in bits[i:i + 8]), 2) for i in range(0, len(bits), 8)]


def _interleave(blocks_data: list, blocks_ecc: list, ecc_len: int) -> list:
    out = []
    max_d = max(len(b) for b in blocks_data)
    for i in range(max_d):
        for b in blocks_data:
            if i < len(b):
                out.append(b[i])
    for i in range(ecc_len):
        for b in blocks_ecc:
            out.append(b[i])
    return out


def _split_blocks(data: list, version: int):
    g1_b, g1_d, g2_b, g2_d, ecc = _ECC_L[version]
    blocks = []
    pos = 0
    for _ in range(g1_b):
        blocks.append(data[pos:pos + g1_d])
        pos += g1_d
    for _ in range(g2_b):
        blocks.append(data[pos:pos + g2_d])
        pos += g2_d
    return blocks, ecc


def _place_finder(matrix, row, col, size):
    for r in range(-1, 8):
        for c in range(-1, 8):
            rr, cc = row + r, col + c
            if not (0 <= rr < size and 0 <= cc < size):
                continue
            if 0 <= r <= 6 and 0 <= c <= 6:
                # 7x7: dark outer ring (r/c 0 or 6), light 5x5, dark 3x3 center
                matrix[rr][cc] = (
                    0 if (1 <= r <= 5 and 1 <= c <= 5 and not (2 <= r <= 4 and 2 <= c <= 4)) else 1
                )
            else:
                matrix[rr][cc] = 0  # separator


def _place_alignment(matrix, cx, cy, size):
    for r in range(-2, 3):
        for c in range(-2, 3):
            rr, cc = cy + r, cx + c
            if not (0 <= rr < size and 0 <= cc < size):
                continue
            # dark if on the 5x5 ring or the center dot
            matrix[rr][cc] = 1 if (abs(r) == 2 or abs(c) == 2 or (r == 0 and c == 0)) else 0


def _place_format(matrix, ecc_bits, mask, size, format_cells=None):
    # 15 bits: 2 EC-level bits (L = 01) + 3 mask bits, BCH(15,5), XOR 0x5412
    data = (0b01 << 3) | mask
    rem = data << 10
    g = 0b10100110111
    for i in range(14, 9, -1):
        if rem & (1 << i):
            rem ^= g << (i - 10)
    fmt = ((data << 10) | rem) ^ 0b101010000010010
    bits = [(fmt >> i) & 1 for i in range(14, -1, -1)]
    # (i, j) coordinates around the top-left finder, from the spec layout
    coords = [
        (8, 0), (8, 1), (8, 2), (8, 3), (8, 4), (8, 5), (8, 7), (8, 8),
        (7, 8), (5, 8), (4, 8), (3, 8), (2, 8), (1, 8), (0, 8),
    ]
    for k, (r, c) in enumerate(coords):
        matrix[r][c] = bits[k]
        # mirrored copy: top-right area / bottom-left area
        if k < 8:
            matrix[8][size - 1 - k] = bits[k]
        else:
            matrix[size - 1 - (k - 8)][8] = bits[k]
    matrix[size - 8][8] = 1  # dark module
    if format_cells is not None:
        format_cells.update(coords)
        format_cells.update((8, size - 1 - k) for k in range(8))
        format_cells.update((size - 1 - (k - 8), 8) for k in range(8, 15))
        format_cells.add((size - 8, 8))


def _place_version_info(matrix, version, size):
    if version < 7:
        return
    data = version << 12
    rem = data
    g = 0b1111100100101
    for i in range(17, 11, -1):
        if rem & (1 << i):
            rem ^= g << (i - 12)
    bits = ((version << 12) | rem)
    for i in range(18):
        bit = (bits >> i) & 1
        r, c = i // 3, i % 3
        matrix[r][size - 11 + c] = bit
        matrix[size - 11 + c][r] = bit


def _mask_penalty(matrix, size):
    """QR mask penalty: N1=3, N2=3, N3=40, N4=10."""
    score = 0
    # N1: runs of same color >= 5 (rows + cols)
    for row in matrix:
        run = 1
        for c in range(1, size):
            if row[c] == row[c - 1]:
                run += 1
            else:
                if run >= 5:
                    score += 3 + (run - 5)
                run = 1
        if run >= 5:
            score += 3 + (run - 5)
    for c in range(size):
        run = 1
        for r in range(1, size):
            if matrix[r][c] == matrix[r - 1][c]:
                run += 1
            else:
                if run >= 5:
                    score += 3 + (run - 5)
                run = 1
        if run >= 5:
            score += 3 + (run - 5)
    # N2: 2x2 blocks of same color
    for r in range(size - 1):
        for c in range(size - 1):
            v = matrix[r][c]
            if matrix[r][c + 1] == v and matrix[r + 1][c] == v and matrix[r + 1][c + 1] == v:
                score += 3
    # N3: finder-like patterns 1:1:3:1:1 with 4 light modules either side
    pattern = [1, 0, 1, 1, 1, 0, 1]
    for r in range(size):
        for c in range(size - 6):
            if matrix[r][c:c + 7] == pattern:
                if (c >= 4 and matrix[r][c - 4:c] == [0] * 4) or \
                   (c + 11 <= size and matrix[r][c + 7:c + 11] == [0] * 4):
                    score += 40
    for c in range(size):
        for r in range(size - 6):
            col = [matrix[r + i][c] for i in range(7)]
            if col == pattern:
                if (r >= 4 and [matrix[r - 4 + i][c] for i in range(4)] == [0] * 4) or \
                   (r + 11 <= size and [matrix[r + 7 + i][c] for i in range(4)] == [0] * 4):
                    score += 40
    # N4: proportion of dark modules
    dark = sum(sum(row) for row in matrix)
    total = size * size
    pct = dark * 100 / total
    prev = pct - (pct % 5)
    score += 10 * min(abs(prev - 50) // 5, abs(prev + 5 - 50) // 5)
    return score


def _apply_mask(matrix, data_cells, mask, size):
    for r, c in data_cells:
        cond = False
        if mask == 0:
            cond = (r + c) % 2 == 0
        elif mask == 1:
            cond = r % 2 == 0
        elif mask == 2:
            cond = c % 3 == 0
        elif mask == 3:
            cond = (r + c) % 3 == 0
        elif mask == 4:
            cond = (r // 2 + c // 3) % 2 == 0
        elif mask == 5:
            cond = (r * c) % 2 + (r * c) % 3 == 0
        elif mask == 6:
            cond = ((r * c) % 2 + (r * c) % 3) % 2 == 0
        else:
            cond = ((r + c) % 2 + (r * c) % 3) % 2 == 0
        if cond:
            matrix[r][c] ^= 1


def qr_matrix(text: str) -> list:
    """Return the QR module matrix (list of rows; 1 = dark) for `text`."""
    version = _version_for(len(text.encode("utf-8")))
    size = 17 + 4 * version
    matrix = [[-1] * size for _ in range(size)]

    # Function patterns
    _place_finder(matrix, 0, 0, size)
    _place_finder(matrix, 0, size - 7, size)
    _place_finder(matrix, size - 7, 0, size)
    for r in range(size):  # timing — only between the finder areas
        for c in range(size):
            if r == 6 and 8 <= c <= size - 9:
                matrix[r][c] = 0 if c % 2 else 1
            if c == 6 and 8 <= r <= size - 9:
                matrix[r][c] = 0 if r % 2 else 1
    positions = _ALIGN[version]
    for ar in positions:
        for ac in positions:
            if (ar == 6 and ac == 6) or (ar == 6 and ac == size - 7) or (ar == size - 7 and ac == 6):
                continue
            _place_alignment(matrix, ac, ar, size)

    # Reserve the format-info cells (and dark module) BEFORE data placement
    # so data bits are never written there — the format depends on the mask
    # and is filled in per-trial in the mask loop below.
    format_cells = set()
    _place_format(matrix, 0b01, 0, size, format_cells)
    for r, c in format_cells:
        matrix[r][c] = -2  # reserved (data placement skips anything != -1)
    # Version info cells (versions >= 7) must also be reserved.
    version_cells = set()
    if version >= 7:
        for i in range(18):
            r, c = i // 3, i % 3
            version_cells.add((r, size - 11 + c))
            version_cells.add((size - 11 + c, r))
        for r, c in version_cells:
            matrix[r][c] = -2

    # Data codewords with ECC + interleave
    data = _build_data_codewords(text, version)
    blocks, ecc_len = _split_blocks(data, version)
    ecc_blocks = [_rs_encode(b, ecc_len) for b in blocks]
    codewords = _interleave(blocks, ecc_blocks, ecc_len)

    # Place data: zigzag from bottom-right, two columns at a time
    data_cells = []
    bit_index = 0
    bits = []
    for cw in codewords:
        for i in range(7, -1, -1):
            bits.append((cw >> i) & 1)
    right = size - 1
    upward = True
    while right > 0:
        if right == 6:
            right -= 1
        for i in range(size):
            r = (size - 1 - i) if upward else i
            for c_off in (0, 1):
                c = right - c_off
                if matrix[r][c] == -1:
                    matrix[r][c] = bits[bit_index] if bit_index < len(bits) else 0
                    data_cells.append((r, c))
                    bit_index += 1
        upward = not upward
        right -= 2

    # Choose the mask with the lowest penalty; format info is written on
    # each masked trial so the penalty reflects the final symbol.
    best = None
    best_score = None
    for mask in range(8):
        trial = [row[:] for row in matrix]
        _apply_mask(trial, data_cells, mask, size)
        _place_format(trial, 0b01, mask, size)
        _place_version_info(trial, version, size)
        score = _mask_penalty(trial, size)
        if best_score is None or score < best_score:
            best_score = score
            best = trial
    return best


def qr_to_png(text: str, path: str, scale: int = 8, quiet: int = 4) -> None:
    """Render a QR code as a PNG file (white background, black modules)."""
    import struct
    import zlib

    mat = qr_matrix(text)
    n = len(mat)
    dim = (n + quiet * 2) * scale
    row_len = dim * 3
    raw = bytearray()
    for y in range(dim):
        raw.append(0)  # filter: none
        for x in range(dim):
            mx, my = (x // scale) - quiet, (y // scale) - quiet
            dark = 0 <= mx < n and 0 <= my < n and mat[my][mx] == 1
            raw += b"\x00\x00\x00" if dark else b"\xff\xff\xff"

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", dim, dim, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(raw)))
           + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    import sys
    text = sys.argv[1] if len(sys.argv) > 1 else "https://example.com/setup"
    out = sys.argv[2] if len(sys.argv) > 2 else "/tmp/qr.png"
    qr_to_png(text, out)
    mat = qr_matrix(text)
    print(f"QR {len(mat)}x{len(mat)} for {len(text)} chars -> {out}")
