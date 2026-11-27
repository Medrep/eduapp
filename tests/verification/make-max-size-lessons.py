from hashlib import sha256
from pathlib import Path
import sys

maximum = 20 * 1024 * 1024
original = Path(sys.argv[1]).read_bytes()
assert len(original) == 333_033
assert sha256(original).hexdigest() == "7590b609c72a5e454887707ed16a5e3de6bec759ea1fc2e88247f9654265566c"
destination = Path(sys.argv[2])
destination.mkdir(exist_ok=True)
before, closing, after = original.rpartition(b"</body>")
assert closing
filler = maximum - len(original)
comment = b"<!-- " + b"x" * (filler - len(b"<!--  -->")) + b" -->"
valid_segment = b"<p>Material do samodzielnego czytania. " + b"Powtorzenie dla kontrolowanego testu. " * 12 + b"</p>\n"
nodes, leftover = divmod(filler - len(b"<!--  -->"), len(valid_segment))
dense = valid_segment * nodes + b"<!-- " + b"x" * leftover + b" -->"
for name, insert in [("exact-limit-comment.html", comment), ("exact-limit-structural.html", dense)]:
    output = before + insert + closing + after
    assert len(output) == maximum
    output.decode("utf-8")
    (destination / name).write_bytes(output)
    print(name, len(output), sha256(output).hexdigest())
print("Added many valid paragraph nodes only in structural test:", nodes)
