import os
import re
import math
from dataclasses import dataclass
from typing import List, Tuple, Optional

# -----------------------------
# Helpers: input + acceptance
# -----------------------------

def get_user_input(prompt: str, cast=str, allow_empty: bool = False):
    while True:
        s = input(prompt).strip()
        if s == "" and allow_empty:
            return None
        try:
            return cast(s)
        except Exception:
            print(f"Invalid input. Expected {cast.__name__}.")

def is_perfect_square(n: int) -> bool:
    if n <= 0:
        return False
    r = int(math.isqrt(n))
    return r * r == n

def decode_id_to_color_indexes(id_string: str, segment_length: int = 7) -> List[int]:
    # Mirrors map.js: left-to-right split, no padding, last segment may be shorter
    out = []
    for i in range(0, len(id_string), segment_length):
        seg = id_string[i:i + segment_length]
        try:
            out.append(int(seg, 10))
        except ValueError:
            pass
    return out

def are_valid_color_indexes(indexes: List[int]) -> bool:
    max_color_index = 16 ** 6  # 16777216
    return all(1 <= x <= max_color_index for x in indexes)

def has_adjacent_conflict(indexes: List[int], wrap: bool = False) -> bool:
    if not is_perfect_square(len(indexes)):
        return True
    m = int(math.isqrt(len(indexes)))

    def idx(r, c):
        return indexes[r * m + c]

    for r in range(m):
        for c in range(m):
            cur = idx(r, c)
            # right
            rr, cc = r, c + 1
            if cc < m:
                if cur == idx(rr, cc):
                    return True
            elif wrap and m > 1:
                if cur == idx(r, 0):
                    return True
            # down
            rr, cc = r + 1, c
            if rr < m:
                if cur == idx(rr, cc):
                    return True
            elif wrap and m > 1:
                if cur == idx(0, c):
                    return True
    return False

def color_index_to_hex(index: int) -> str:
    # 1 -> #000000, 16^6 -> #FFFFFF
    v = index - 1
    return "#" + format(v, "06x")

@dataclass
class AcceptanceReport:
    ok: bool
    reason: str
    m: int
    indexes: List[int]
    hex_colors: List[str]

def verify_acceptance_from_decimal_string(id_decimal: str, wrap_adjacency: bool = False) -> AcceptanceReport:
    indexes = decode_id_to_color_indexes(id_decimal, segment_length=7)

    if not is_perfect_square(len(indexes)):
        return AcceptanceReport(False, f"Token count {len(indexes)} is not a perfect square.", 0, indexes, [])
    if not are_valid_color_indexes(indexes):
        return AcceptanceReport(False, "One or more tokens are outside [1..16^6].", int(math.isqrt(len(indexes))), indexes, [])
    if has_adjacent_conflict(indexes, wrap=wrap_adjacency):
        return AcceptanceReport(False, "Adjacency conflict: at least one orthogonal neighbor pair is equal.", int(math.isqrt(len(indexes))), indexes, [])

    m = int(math.isqrt(len(indexes)))
    hex_colors = [color_index_to_hex(x) for x in indexes]
    return AcceptanceReport(True, "Accepted.", m, indexes, hex_colors)

# -----------------------------
# Deterministic circuit derivation
# -----------------------------

GATES = ['x', 'y', 'z', 'h', 's', 'sdg', 't', 'tdg', 'rx', 'ry', 'rz', 'cx']

def token_to_angle(token: int) -> float:
    # Deterministic discrete angle: multiples of pi/16 (never 0)
    k = (token % 32) + 1
    return k * (math.pi / 16.0)

def derive_quantum_and_classical_from_grid(
    indexes: List[int],
    m: int,
    max_qubits: int = 8,
    max_layers: int = 16,
    reversible_only: bool = False
):
    """
    Deterministic mapping:
    - Use top-left m×m grid tokens.
    - Qubits = min(m, max_qubits), Layers = min(m, max_layers)
    - Gate for (r,c) chosen by token % len(GATES)
    """
    # Lazy import so the script can at least run menu/help if qiskit isn't installed
    from qiskit import QuantumCircuit

    q = min(m, max_qubits)
    layers = min(m, max_layers)

    qc = QuantumCircuit(q, name="derived_quantum")
    cc = QuantumCircuit(q, name="classical_shadow")

    def grid_token(r, c) -> int:
        return indexes[r * m + c]

    for r in range(layers):
        for c in range(q):
            tok = grid_token(r, c)
            gate = GATES[tok % len(GATES)]

            if reversible_only:
                # force into exact classical correspondence
                gate = 'cx' if (tok % 2 == 1 and q > 1) else 'x'

            if gate in ['x', 'y', 'z', 'h', 's', 'sdg', 't', 'tdg']:
                getattr(qc, gate)(c)
                # classical shadow only keeps x
                if gate == 'x':
                    cc.x(c)

            elif gate == 'cx':
                if q == 1:
                    qc.x(c)
                    cc.x(c)
                else:
                    control = c
                    # deterministic target selection from token
                    shift = 1 + (tok % (q - 1))
                    target = (c + shift) % q
                    qc.cx(control, target)
                    cc.cx(control, target)

            elif gate in ['rx', 'ry', 'rz']:
                ang = token_to_angle(tok)
                getattr(qc, gate)(ang, c)
                # no classical equivalent → ignored in classical shadow

        # Optional barrier per layer for readability
        qc.barrier()

    return qc, cc

# -----------------------------
# Save / draw PNGs
# -----------------------------

def ensure_dir(path: str):
    os.makedirs(path, exist_ok=True)

def save_circuit_png(qc, path: str):
    from qiskit.visualization import circuit_drawer
    circuit_drawer(qc, output='mpl', filename=path)

def combine_pngs_side_by_side(left_path: str, right_path: str, out_path: str):
    from PIL import Image

    a = Image.open(left_path).convert("RGBA")
    b = Image.open(right_path).convert("RGBA")

    w = a.width + b.width
    h = max(a.height, b.height)
    out = Image.new("RGBA", (w, h), (20, 20, 20, 255))
    out.paste(a, (0, 0))
    out.paste(b, (a.width, 0))
    out.save(out_path)

def write_gate_sequence(qc, out_txt: str):
    """
    Qiskit 1.2+ compatible:
    - qc.data yields CircuitInstruction objects
    - Qubit index must be obtained via qc.find_bit(qubit).index
    """
    parts = []

    for ci in qc.data:
        op = ci.operation
        if op.name == "barrier":
            continue

        qinds = [qc.find_bit(q).index for q in ci.qubits]

        if op.name in ("rx", "ry", "rz"):
            angle = op.params[0]
            parts.append(f"{op.name}({angle},{qinds[0]})")
        elif op.name == "cx":
            parts.append(f"cx({qinds[0]},{qinds[1]})")
        else:
            parts.append(f"{op.name}({qinds[0]})")

    with open(out_txt, "w", encoding="utf-8") as f:
        f.write(" ".join(parts) + "\n")


# -----------------------------
# Menu app
# -----------------------------

def main():
    print("\nAcceptance → Quantum/Classical Circuit Deriver\n")

    while True:
        mode = get_user_input("Enter 1 to derive from accepted state, 2 to render PNGs from saved QASM, 3 to exit: ", int)

        if mode == 1:
            raw = get_user_input("Paste accepted state as (a) decimal integer or (b) binary like 0b1010: ", str)
            wrap = get_user_input("Wrap-around adjacency? (y/n): ", str).lower().startswith("y")
            reversible_only = get_user_input("Reversible-only (exact classical correspondent)? (y/n): ", str).lower().startswith("y")
            max_qubits = get_user_input("Max qubits (e.g. 8): ", int)
            max_layers = get_user_input("Max layers (e.g. 16): ", int)

            # Parse input
            if raw.lower().startswith("0b"):
                n = int(raw, 2)
                dec_str = str(n)
            else:
                # allow huge integers
                if not re.fullmatch(r"[0-9]+", raw):
                    print("Not a valid integer string.")
                    continue
                dec_str = raw.lstrip("0") or "0"

            report = verify_acceptance_from_decimal_string(dec_str, wrap_adjacency=wrap)
            print(f"\nAcceptance check: {report.reason}")
            if not report.ok:
                print("Not accepted → no circuits generated.\n")
                continue

            print(f"Grid: {report.m} x {report.m}  (tokens={len(report.indexes)})")

            try:
                qc, cc = derive_quantum_and_classical_from_grid(
                    indexes=report.indexes,
                    m=report.m,
                    max_qubits=max_qubits,
                    max_layers=max_layers,
                    reversible_only=reversible_only
                )
            except ModuleNotFoundError as e:
                print("\nMissing dependency. Install with:")
                print('  pip install "qiskit[visualization]" matplotlib numpy pillow\n')
                raise

            outdir = "out"
            ensure_dir(outdir)

            # Save text configs
            write_gate_sequence(qc, os.path.join(outdir, "source_quantum.txt"))
            write_gate_sequence(cc, os.path.join(outdir, "source_classical.txt"))

            # Save PNGs
            qpng = os.path.join(outdir, "quantum.png")
            cpng = os.path.join(outdir, "classical.png")
            apng = os.path.join(outdir, "assembly.png")

            save_circuit_png(qc, qpng)
            save_circuit_png(cc, cpng)
            combine_pngs_side_by_side(qpng, cpng, apng)

            print("\nWrote:")
            print(f"  {qpng}")
            print(f"  {cpng}")
            print(f"  {apng}")
            print(f"  {os.path.join(outdir, 'source_quantum.txt')}")
            print(f"  {os.path.join(outdir, 'source_classical.txt')}\n")

        elif mode == 2:
            # Optional: render from QASM if you export/keep it.
            print("\nThis mode is a placeholder if you later decide to save QASM.")
            print("Right now mode 1 generates PNGs directly.\n")

        elif mode == 3:
            break
        else:
            print("Unknown mode.\n")

if __name__ == "__main__":
    main()