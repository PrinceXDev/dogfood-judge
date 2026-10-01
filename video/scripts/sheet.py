"""Tile review stills into one contact sheet: python scripts/sheet.py <prefix> [cols]"""
import sys, glob, re
from PIL import Image
prefix = sys.argv[1]; cols = int(sys.argv[2]) if len(sys.argv) > 2 else 2
files = sorted(glob.glob(f"out/stills/{prefix}-*.png"), key=lambda f: int(re.findall(r"-(\d+)\.png$", f)[0]))
ims = [Image.open(f) for f in files]
w, h = ims[0].size
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (w * cols, h * rows), "white")
for i, im in enumerate(ims):
    sheet.paste(im, ((i % cols) * w, (i // cols) * h))
sheet.save(f"out/sheet-{prefix}.png"); print(f"out/sheet-{prefix}.png", [f.split('-')[-1] for f in files])
