# Generates the Mamba Grab icon (orange gradient tile, white "M" with a download arrow) — PNG, ICO and extension sizes.
from PIL import Image, ImageDraw, ImageFont
import os
S = 1024
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
grad = Image.new('RGBA', (S, S))
for y in range(S):
    for x in range(0, S, 4):
        t = (x + y) / (2 * S)
        c = (255, int(122 + (193 - 122) * t), int(0 + 94 * t), 255)
        for k in range(4): grad.putpixel((x + k, y), c) if x + k < S else None
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([40, 40, S - 40, S - 40], radius=230, fill=255)
img.paste(grad, (0, 0), mask)
d = ImageDraw.Draw(img)
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 560)
d.text((S / 2, S / 2 - 70), 'M', font=font, fill='white', anchor='mm')
# download arrow
cx, top = S / 2, 640
d.rectangle([cx - 46, top, cx + 46, top + 130], fill='white')
d.polygon([(cx - 150, top + 120), (cx + 150, top + 120), (cx, top + 260)], fill='white')
d.rounded_rectangle([cx - 240, top + 280, cx + 240, top + 322], radius=20, fill='white')
here = os.path.dirname(os.path.abspath(__file__))
img.resize((512, 512), Image.LANCZOS).save(os.path.join(here, 'icon.png'))
img.save(os.path.join(here, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
ext = os.path.join(here, '..', 'extension', 'icons')
os.makedirs(ext, exist_ok=True)
for n in (16, 32, 48, 128):
    img.resize((n, n), Image.LANCZOS).save(os.path.join(ext, f'icon{n}.png'))
print('ok')
