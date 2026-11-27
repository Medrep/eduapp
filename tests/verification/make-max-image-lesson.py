from base64 import b64encode
from hashlib import sha256
from pathlib import Path
from struct import pack
import sys
from zlib import compress, crc32

original = Path(sys.argv[1]).read_bytes()
assert sha256(original).hexdigest() == "7590b609c72a5e454887707ed16a5e3de6bec759ea1fc2e88247f9654265566c"
target = 20 * 1024 * 1024
head, body_end, tail = original.rpartition(b"</body>")
assert body_end
attribute_start = b'<img alt="Lokalna proba obrazu" src="data:image/png;base64,'
attribute_end = b'">'

def chunk(kind, data):
    return pack(">I", len(data)) + kind + data + pack(">I", crc32(kind + data))

header = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
image = chunk(b"IDAT", compress(b"\x00\x00\x00\x00")) + chunk(b"IEND", b"")
text_header = b"Note\x00"
binary_overhead = len(header) + len(chunk(b"tEXt", text_header)) + len(image)
attribute_budget = target - len(original) - len(attribute_start) - len(attribute_end)
binary_budget = (attribute_budget // 4) * 3
png = header + chunk(b"tEXt", text_header + b"x" * (binary_budget - binary_overhead)) + image
embedded = b64encode(png)
output = head + attribute_start + embedded + attribute_end + b" " * (attribute_budget - len(embedded)) + body_end + tail
assert len(output) == target
output.decode("utf-8")
destination = Path(sys.argv[2])
destination.write_bytes(output)
print(destination.name, len(output), sha256(output).hexdigest())
print("PNG bytes:", len(png), "data-attribute payload bytes:", len(embedded))
